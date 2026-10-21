import * as THREE from 'three';
import { Item, type ItemKind } from '../items/item';
import type { Hand } from '../input/hand';
import type { Kitchen, Spawner } from '../world/kitchen';
import { ROOM } from '../world/kitchen';
import { onSurface, type Slot } from '../world/slots';
import type { Sfx } from '../audio/sfx';
import type { Particles } from '../world/particles';

const GRAVITY = -9.8;
const MAX_ITEMS = 40;

export interface GrabTarget {
  item?: Item;
  spawner?: Spawner;
  dist: number;
}

/**
 * Все подвижные предметы: захват, бросок, простая гравитация,
 * прилипание к точкам на столах, тарелки и мусорка.
 */
export class ItemWorld {
  items: Item[] = [];
  /** Вызывается, когда предмет встал в слот (например, тарелка на окно выдачи). */
  onPlaced: (item: Item, slot: Slot) => void = () => {};
  onTrashed: (item: Item) => void = () => {};
  /** Можно ли сейчас брать из ящиков (выключено в меню). */
  spawnEnabled = true;
  time = 0;

  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly kitchen: Kitchen,
    private readonly sfx: Sfx,
    private readonly fx: Particles,
  ) {}

  spawn(kind: ItemKind, pos: THREE.Vector3): Item {
    const item = new Item(kind);
    item.root.position.copy(pos);
    this.scene.add(item.root);
    this.items.push(item);
    this.enforceLimit();
    return item;
  }

  /** Нож всегда один — кладём его на подставку у доски. */
  ensureKnife(): void {
    if (this.items.some((i) => i.kind === 'knife')) return;
    const knife = this.spawn('knife', this.kitchen.knifeSlot.pos);
    this.snap(knife, this.kitchen.knifeSlot, false);
  }

  remove(item: Item): void {
    if (item.slot) {
      item.slot.occupant = null;
      item.slot = null;
    }
    item.mode = 'dead';
    item.root.removeFromParent();
    item.disposeDeep();
    item.contents = [];
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
  }

  clearAll(): void {
    for (const it of [...this.items]) if (it.kind !== 'knife') this.remove(it);
    for (const s of this.kitchen.slots) if (s.occupant && s.occupant.kind !== 'knife') s.occupant = null;
  }

  /** Самый старый лишний предмет пропадает, чтобы не уронить fps. */
  private enforceLimit(): void {
    while (this.items.length > MAX_ITEMS) {
      const victim = this.items.find((i) => i.mode === 'rest' || i.mode === 'free');
      if (!victim) break;
      this.fx.puff(victim.root.position);
      this.remove(victim);
    }
  }

  // ---------------------------------------------------------------- захват

  /** VR: ближайший предмет или ящик рядом с рукой. */
  findNear(hand: Hand): GrabTarget | null {
    let best: GrabTarget | null = null;
    for (const it of this.items) {
      // предмет в другой руке тоже можно перехватить
      if (it.mode === 'dead') continue;
      const d = it.center(this.tmp).distanceTo(hand.pos);
      const reach = Math.max(0.1, it.radius + 0.04);
      if (d < reach && (!best || d < best.dist)) best = { item: it, dist: d };
    }
    if (best) return best;
    if (!this.spawnEnabled) return null;
    for (const sp of this.kitchen.spawners) {
      if (sp.box.containsPoint(hand.pos)) return { spawner: sp, dist: 0 };
    }
    return null;
  }

  /** ПК: предмет или ящик под прицелом. */
  findByRay(ray: THREE.Ray, maxDist: number, raycaster: THREE.Raycaster): GrabTarget | null {
    raycaster.ray.copy(ray);
    raycaster.far = maxDist;
    const roots = this.items.filter((i) => i.mode !== 'dead' && i.mode !== 'held').map((i) => i.root);
    const hits = raycaster.intersectObjects(roots, true);
    let best: GrabTarget | null = null;
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.item) o = o.parent;
      if (!o) continue;
      let item = o.userData.item as Item;
      while (item.mode === 'onPlate' && item.plate) item = item.plate;
      best = { item, dist: h.distance };
      break;
    }
    if (this.spawnEnabled) {
      for (const sp of this.kitchen.spawners) {
        const p = ray.intersectBox(sp.box, this.tmp2);
        if (p) {
          const d = p.distanceTo(ray.origin);
          if (d < maxDist && (!best || d < best.dist - 0.05)) best = { spawner: sp, dist: d };
        }
      }
    }
    return best;
  }

  grab(hand: Hand, target: GrabTarget, hands: Hand[]): void {
    let item = target.item;
    if (!item && target.spawner) {
      item = this.spawn(target.spawner.kind, hand.pos);
      this.fx.puff(target.spawner.spawnPos, 0xfff1d6);
    }
    if (!item) return;
    for (const h of hands) if (h !== hand && h.held === item) h.held = null;
    if (item.slot) {
      item.slot.occupant = null;
      item.slot = null;
    }
    item.mode = 'held';
    item.vel.set(0, 0, 0);
    item.floorTime = -1;
    hand.held = item;
    item.setHighlight(false);
    item.bounce();
    this.sfx.play('pick', hand.pos);
    hand.pulse(0.4, 40);
  }

  /**
   * Отпустить предмет. Если рядом подходящее место — предмет прилипает,
   * иначе падает со скоростью руки.
   */
  release(hand: Hand, velocity: THREE.Vector3, placeAt?: THREE.Vector3, placeRadius = 0.2): void {
    const item = hand.held;
    hand.held = null;
    if (!item) return;
    item.root.quaternion.identity();
    const speed = velocity.length();
    if (placeAt) {
      if (this.tryPlace(item, placeAt, placeRadius)) return;
      item.root.position.copy(placeAt);
    } else if (speed < 1.1) {
      if (this.tryPlace(item, item.root.position, placeRadius)) return;
    }
    item.mode = 'free';
    item.vel.copy(velocity).clampLength(0, 9);
  }

  /** Пытается положить предмет рядом с точкой: в мусор, на тарелку или в слот. */
  tryPlace(item: Item, point: THREE.Vector3, radius: number): boolean {
    const tr = this.kitchen.trash;
    const dxz = Math.hypot(point.x - tr.pos.x, point.z - tr.pos.z);
    if (dxz < tr.radius + 0.08 && point.y < tr.top + 0.4) {
      this.trash(item);
      return true;
    }
    if (item.isIngredient) {
      let bestPlate: Item | null = null;
      let bestD = 0.16;
      for (const p of this.items) {
        if (p.mode === 'dead' || p === item || p.mode === 'held') continue;
        // тарелка принимает любую еду, раскатанное тесто — сыр и помидор
        if (p.kind !== 'plate' && !p.acceptsTopping(item)) continue;
        const pp = p.root.getWorldPosition(this.tmp);
        const d = Math.hypot(point.x - pp.x, point.z - pp.z);
        const dy = point.y - pp.y;
        if (d < bestD && dy > -0.12 && dy < 0.45) {
          bestD = d;
          bestPlate = p;
        }
      }
      if (bestPlate) {
        this.addToPlate(bestPlate, item);
        return true;
      }
    }
    let best: Slot | null = null;
    let bestD = radius;
    for (const s of this.kitchen.slots) {
      if (!s.accepts(item)) continue;
      const d = Math.hypot(point.x - s.pos.x, point.z - s.pos.z);
      const dy = point.y - s.pos.y;
      if (d < bestD && dy > -0.15 && dy < 0.45) {
        bestD = d;
        best = s;
      }
    }
    if (best) {
      this.snap(item, best);
      return true;
    }
    return false;
  }

  snap(item: Item, slot: Slot, sound = true): void {
    slot.occupant = item;
    item.slot = slot;
    item.mode = 'slot';
    item.vel.set(0, 0, 0);
    item.floorTime = -1;
    item.root.position.copy(slot.pos);
    item.root.quaternion.identity();
    item.root.rotation.y = slot.rotY;
    item.bounce();
    if (sound) this.sfx.play('drop', slot.pos);
    this.onPlaced(item, slot);
  }

  addToPlate(plate: Item, item: Item): void {
    item.mode = 'onPlate';
    item.plate = plate;
    item.vel.set(0, 0, 0);
    item.root.quaternion.identity();
    plate.contents.push(item);
    plate.root.add(item.root);
    if (plate.kind === 'plate') plate.layoutPlate();
    else plate.layoutBase();
    plate.bounce();
    item.bounce();
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
    this.sfx.play('drop', plate.root.getWorldPosition(this.tmp));
  }

  trash(item: Item): void {
    const p = item.root.getWorldPosition(new THREE.Vector3());
    this.fx.puff(new THREE.Vector3(this.kitchen.trash.pos.x, this.kitchen.trash.top, this.kitchen.trash.pos.z), 0xb8f08f);
    this.sfx.play('trash', p);
    this.onTrashed(item);
    if (item.kind === 'knife') {
      this.remove(item);
      this.ensureKnife();
      return;
    }
    this.remove(item);
  }

  // ---------------------------------------------------------------- кадр

  /**
   * holdPose — где держать предмет: для VR позиция и поворот руки,
   * для ПК точка перед камерой.
   */
  update(dt: number, hands: Hand[], holdPose: (h: Hand, pos: THREE.Vector3, quat: THREE.Quaternion) => void): void {
    this.time += dt;
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    for (const h of hands) {
      const it = h.held;
      if (!it) continue;
      if (it.mode !== 'held') {
        h.held = null;
        continue;
      }
      holdPose(h, pos, quat);
      it.root.quaternion.copy(quat);
      // держим за центр предмета
      it.root.position.copy(pos).add(this.tmp.set(0, -it.height * 0.5, 0).applyQuaternion(quat));
    }

    for (const it of [...this.items]) {
      it.update(dt);
      for (const c of it.contents) c.update(dt);
      if (it.mode === 'free') this.integrate(it, dt);
      if (it.mode === 'rest' && it.root.position.y < 0.01) {
        if (it.floorTime < 0) it.floorTime = this.time;
        const age = this.time - it.floorTime;
        if (it.kind === 'knife' && age > 2.5) {
          this.fx.puff(it.root.position);
          this.remove(it);
          this.ensureKnife();
        } else if (age > 120) {
          this.fx.puff(it.root.position);
          this.remove(it);
        }
      }
    }
  }

  private integrate(it: Item, dt: number): void {
    const p = it.root.position;
    const prevY = p.y;
    it.vel.y += GRAVITY * dt;
    p.addScaledVector(it.vel, dt);
    // кувыркаемся в полёте
    it.root.rotation.x += it.vel.z * dt * 4;
    it.root.rotation.z -= it.vel.x * dt * 4;

    // стены
    const r = it.radius;
    if (p.x < ROOM.minX + r) { p.x = ROOM.minX + r; it.vel.x *= -0.3; }
    if (p.x > ROOM.maxX - r) { p.x = ROOM.maxX - r; it.vel.x *= -0.3; }
    if (p.z < ROOM.minZ + r) { p.z = ROOM.minZ + r; it.vel.z *= -0.3; }
    if (p.z > ROOM.maxZ - r) { p.z = ROOM.maxZ - r; it.vel.z *= -0.3; }

    // мусорка: влетел сверху
    const tr = this.kitchen.trash;
    if (Math.hypot(p.x - tr.pos.x, p.z - tr.pos.z) < tr.radius && prevY >= tr.top - 0.05 && p.y < tr.top) {
      this.trash(it);
      return;
    }
    // мусорка сбоку — твёрдая, отскакиваем
    const dTr = Math.hypot(p.x - tr.pos.x, p.z - tr.pos.z);
    if (p.y < tr.top && prevY < tr.top - 0.02 && dTr < tr.radius + r) {
      const nx = (p.x - tr.pos.x) / (dTr || 1);
      const nz = (p.z - tr.pos.z) / (dTr || 1);
      p.x = tr.pos.x + nx * (tr.radius + r);
      p.z = tr.pos.z + nz * (tr.radius + r);
      const vn = it.vel.x * nx + it.vel.z * nz;
      if (vn < 0) {
        it.vel.x -= 1.3 * vn * nx;
        it.vel.z -= 1.3 * vn * nz;
      }
    }

    // стойки и шкафы — сплошные: предмет, прилетевший сбоку, отскакивает, а не проходит внутрь
    for (const sd of this.kitchen.solids) {
      if (p.y >= sd.top - 0.005 || prevY >= sd.top - 0.02) continue;
      if (p.x <= sd.minX - r || p.x >= sd.maxX + r || p.z <= sd.minZ - r || p.z >= sd.maxZ + r) continue;
      let best = Infinity;
      let side: string | null = null;
      for (const o of sd.open) {
        const pen = o === '+x' ? sd.maxX + r - p.x : o === '-x' ? p.x - (sd.minX - r) : o === '+z' ? sd.maxZ + r - p.z : p.z - (sd.minZ - r);
        if (pen < best) {
          best = pen;
          side = o;
        }
      }
      if (side === '+x') { p.x = sd.maxX + r; it.vel.x = Math.abs(it.vel.x) * 0.3; }
      if (side === '-x') { p.x = sd.minX - r; it.vel.x = -Math.abs(it.vel.x) * 0.3; }
      if (side === '+z') { p.z = sd.maxZ + r; it.vel.z = Math.abs(it.vel.z) * 0.3; }
      if (side === '-z') { p.z = sd.minZ - r; it.vel.z = -Math.abs(it.vel.z) * 0.3; }
    }

    if (it.vel.y > 0) return;
    let landY: number | null = null;
    for (const s of this.kitchen.surfaces) {
      if (!onSurface(s, p.x, p.z) || prevY < s.top - 0.02 || p.y > s.top) continue;
      if (landY === null || s.top > landY) landY = s.top;
    }
    if (landY === null && p.y <= 0) landY = 0;
    if (landY === null) return;

    p.y = landY;
    const hSpeed = Math.hypot(it.vel.x, it.vel.z);
    it.vel.set(0, 0, 0);
    it.root.quaternion.identity();
    if (hSpeed < 4 && this.tryPlace(it, p, 0.22)) return;
    it.mode = 'rest';
    it.bounce();
    this.sfx.play('drop', p);
  }
}
