import * as THREE from 'three';
import { Item, type ItemKind, type ItemState } from '../items/item';
import type { Kitchen } from '../world/kitchen';
import type { Particles } from '../world/particles';
import type { Sfx, SfxName } from '../audio/sfx';
import { ProgressBar } from '../ui/progressBar';
import { Cooking } from '../systems/cooking';
import type { Snapshot } from './protocol';

interface Mirrored {
  item: Item;
  target: THREE.Vector3;
  targetQ: THREE.Quaternion;
  targetS: number;
  holder: string;
  sig: string;
}

/**
 * У второго игрока и зрителя кухня не «живёт» сама: всё, что на ней лежит,
 * повторяется по снимкам от хоста и плавно догоняет их.
 */
export class Mirror {
  readonly items = new Map<number, Mirrored>();
  private bars: ProgressBar[] = [];
  private highlighted = new Set<Item>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly kitchen: Kitchen,
    private readonly fx: Particles,
    private readonly sfx: Sfx,
  ) {}

  /** Применить снимок. holdPose(holder) — где держит предмет наш собственный игрок (без задержки сети). */
  apply(s: Snapshot, onPulse: (hand: string, i: number, ms: number) => void, onBell: () => void): void {
    const seen = new Set<number>();
    for (const raw of s.items) {
      const [id, kind, state, x, y, z, qx, qy, qz, qw, sc, holder, contents] = raw as [number, ItemKind, ItemState, number, number, number, number, number, number, number, number, string, unknown[] | undefined];
      seen.add(id);
      let m = this.items.get(id);
      if (!m) {
        const item = new Item(kind);
        item.mode = 'rest';
        this.scene.add(item.root);
        m = { item, target: new THREE.Vector3(x, y, z), targetQ: new THREE.Quaternion(qx, qy, qz, qw), targetS: sc, holder, sig: '' };
        item.root.position.set(x, y, z);
        item.root.quaternion.set(qx, qy, qz, qw);
        this.items.set(id, m);
      }
      m.target.set(x, y, z);
      m.targetQ.set(qx, qy, qz, qw);
      m.targetS = sc;
      m.holder = holder;
      const sig = JSON.stringify(contents ?? []);
      if (sig !== m.sig) {
        // начинку проще пересобрать целиком — меняется она редко
        this.setContents(m.item, (contents ?? []) as unknown[][]);
        m.sig = sig;
      }
      if (m.item.state !== state) m.item.setState(state);
    }
    for (const [id, m] of this.items) {
      if (seen.has(id)) continue;
      this.removeItem(m.item);
      this.items.delete(id);
    }

    // подсветка
    const now = new Set<Item>();
    for (const id of s.hl) {
      const m = this.items.get(id);
      if (m) now.add(m.item);
    }
    for (const it of this.highlighted) if (!now.has(it)) it.setHighlight(false);
    for (const it of now) it.setHighlight(true);
    this.highlighted = now;

    // полоски прогресса
    while (this.bars.length < s.bars.length) {
      const b = new ProgressBar();
      this.scene.add(b.group);
      this.bars.push(b);
    }
    this.bars.forEach((b, i) => {
      const d = s.bars[i];
      if (!d) b.hide();
      else b.set(d[3], d[4], new THREE.Vector3(d[0], d[1], d[2]), b.group.userData.cam ?? new THREE.Vector3(0, 1.6, 1));
    });

    Cooking.applyVisual(this.kitchen, s.st, this.sfx);

    // события: звуки, частицы, вибрация
    for (const e of s.ev) {
      const kind = e[0];
      if (kind === 's') this.sfx.play(e[1] as SfxName, e[2] ? new THREE.Vector3(...(e[2] as [number, number, number])) : undefined);
      else if (kind === 'f') {
        const [, p, o] = e as [string, number[], Record<string, unknown>];
        this.fx.spawn(new THREE.Vector3(p[0], p[1], p[2]), {
          ...o,
          vel: o.vel ? new THREE.Vector3(...(o.vel as [number, number, number])) : undefined,
        } as Parameters<Particles['spawn']>[1]);
      } else if (kind === 'h') onPulse(e[1] as string, e[2] as number, e[3] as number);
      else if (kind === 'b') onBell();
    }
  }

  private setContents(item: Item, list: unknown[][]): void {
    for (const c of item.contents) {
      c.root.removeFromParent();
      c.disposeDeep();
    }
    item.contents = [];
    for (const raw of list) {
      const [, kind, state, sub] = raw as [number, ItemKind, ItemState, unknown[][] | undefined];
      const c = new Item(kind);
      c.mode = 'onPlate';
      c.plate = item;
      if (sub?.length) this.setContents(c, sub);
      c.setState(state);
      item.contents.push(c);
      item.root.add(c.root);
    }
    if (item.kind === 'plate') item.layoutPlate();
    else if (item.kind === 'dough') item.layoutBase();
  }

  private removeItem(item: Item): void {
    item.root.removeFromParent();
    item.disposeDeep();
    this.highlighted.delete(item);
  }

  /**
   * Каждый кадр: предметы догоняют позу из снимка. Предметы в руках нашего игрока
   * ставим прямо в руку — так не чувствуется задержка сети.
   */
  update(dt: number, camPos: THREE.Vector3, ownHold: (holder: string, pos: THREE.Vector3, quat: THREE.Quaternion) => boolean): void {
    const k = 1 - Math.exp(-dt * 16);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    for (const m of this.items.values()) {
      const it = m.item;
      it.update(dt);
      for (const c of it.contents) c.update(dt);
      if (m.holder && ownHold(m.holder, p, q)) {
        it.root.quaternion.copy(q);
        it.root.position.copy(p).add(new THREE.Vector3(0, -it.height * 0.5, 0).applyQuaternion(q));
        continue;
      }
      if (it.root.position.distanceTo(m.target) > 0.6) it.root.position.copy(m.target);
      else it.root.position.lerp(m.target, k);
      it.root.quaternion.slerp(m.targetQ, k);
      const s = THREE.MathUtils.lerp(it.root.scale.x, m.targetS, k);
      it.root.scale.setScalar(s);
    }
    for (const b of this.bars) {
      b.group.userData.cam = camPos;
      if (b.group.visible) b.group.lookAt(camPos);
    }
  }

  /** Найти предмет, который держит наша рука (для ПК: решать, «взять» или «положить»). */
  heldBy(holder: string): Item | null {
    for (const m of this.items.values()) if (m.holder === holder) return m.item;
    return null;
  }

  clear(): void {
    for (const m of this.items.values()) this.removeItem(m.item);
    this.items.clear();
    for (const b of this.bars) b.hide();
    this.highlighted.clear();
  }
}
