import * as THREE from 'three';
import { PALETTE, toon, toonMesh, toonUnique } from '../style/toon';
import { hasModel, model, type ModelName, type ModelOptions } from '../style/models';
import type { Slot } from '../world/slots';

export type ItemKind =
  | 'bun'
  | 'patty'
  | 'lettuce'
  | 'tomato'
  | 'potato'
  | 'chicken'
  | 'dough'
  | 'cheese'
  | 'lavash'
  | 'doner'
  | 'plate'
  | 'knife'
  | 'pin';
export type ItemState = 'raw' | 'chopped' | 'cooked' | 'burnt';
export type ItemMode = 'free' | 'rest' | 'held' | 'slot' | 'onPlate' | 'dead';

export const INGREDIENTS: ItemKind[] = ['bun', 'patty', 'lettuce', 'tomato', 'potato', 'chicken', 'dough', 'cheese', 'lavash', 'doner'];

/** Эти продукты не меняют состояние — в рецепте пишутся просто по имени. */
const STATELESS: ItemKind[] = ['bun', 'lavash', 'doner'];

/** Название в винительном падеже: «возьмите булку». */
export const KIND_ACC: Record<ItemKind, string> = {
  bun: 'булку',
  patty: 'котлету',
  lettuce: 'салат',
  tomato: 'помидор',
  potato: 'картошку',
  chicken: 'курицу',
  dough: 'тесто',
  cheese: 'сыр',
  lavash: 'лаваш',
  doner: 'мясо донера',
  plate: 'тарелку',
  knife: 'нож',
  pin: 'скалку',
};

/** Ключ ингредиента в рецепте, например «patty:cooked». Булка всегда просто «bun». */
export function itemKey(kind: ItemKind, state: ItemState): string {
  return STATELESS.includes(kind) ? kind : `${kind}:${state}`;
}

let nextId = 1;

export class Item {
  readonly id = nextId++;
  readonly root = new THREE.Group();
  private visual = new THREE.Group();
  private materials: THREE.MeshToonMaterial[] = [];

  mode: ItemMode = 'free';
  state: ItemState = 'raw';
  vel = new THREE.Vector3();
  slot: Slot | null = null;
  plate: Item | null = null;
  contents: Item[] = [];

  chop = 0; // 0..1 прогресс нарезки
  cook = 0; // 0..1 прогресс жарки
  burn = 0; // 0..1 сколько до сгорания
  height = 0.05;
  radius = 0.06;

  private bounceT = 1;
  private highlighted = false;
  /** Время, когда предмет оказался на полу (для очистки мусора). */
  floorTime = -1;

  constructor(readonly kind: ItemKind) {
    this.root.add(this.visual);
    this.root.userData.item = this;
    this.rebuild();
  }

  get key(): string {
    if (this.kind === 'dough' && this.state === 'cooked' && this.isPizza) return 'pizza';
    return itemKey(this.kind, this.state);
  }

  /** На основе есть и сыр, и помидор. */
  get isPizza(): boolean {
    return this.contents.some((c) => c.kind === 'cheese') && this.contents.some((c) => c.kind === 'tomato');
  }

  /** Раскатанное тесто — на него кладут начинку. */
  get isBase(): boolean {
    return this.kind === 'dough' && this.state === 'chopped';
  }

  acceptsTopping(item: Item): boolean {
    if (!this.isBase) return false;
    if (item.key !== 'tomato:chopped' && item.key !== 'cheese:chopped') return false;
    return !this.contents.some((c) => c.kind === item.kind);
  }

  get isIngredient(): boolean {
    return INGREDIENTS.includes(this.kind);
  }

  get choppable(): boolean {
    return ['lettuce', 'tomato', 'cheese', 'potato', 'dough'].includes(this.kind) && this.state === 'raw';
  }

  setState(s: ItemState): void {
    if (this.state === s) return;
    this.state = s;
    this.rebuild();
    this.bounce();
    // начинка пиццы печётся вместе с основой
    if (this.kind === 'dough' && (s === 'cooked' || s === 'burnt')) {
      for (const c of this.contents) c.setState(s);
      this.layoutBase();
    }
  }

  /** Короткое «пружинящее» сплющивание при постановке. */
  bounce(): void {
    this.bounceT = 0;
  }

  setHighlight(on: boolean): void {
    if (on === this.highlighted) return;
    this.highlighted = on;
    for (const m of this.materials) m.emissive.setHex(on ? 0x553322 : ((m.userData.baseEmissive as number | undefined) ?? 0));
  }

  /** Центр предмета в мировых координатах (для расстояния до руки). */
  center(out: THREE.Vector3): THREE.Vector3 {
    this.root.getWorldPosition(out);
    out.y += this.height * 0.5;
    return out;
  }

  update(dt: number): void {
    if (this.bounceT < 1) {
      this.bounceT = Math.min(1, this.bounceT + dt / 0.4);
      const t = this.bounceT;
      const s = 1 + Math.sin(t * Math.PI * 3) * (1 - t) * 0.35;
      this.visual.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
    } else {
      this.visual.scale.set(1, 1, 1);
    }
  }

  /** Раскладка содержимого тарелки «стопкой». Булка делится на низ и верх. */
  layoutPlate(): void {
    let y = 0.022;
    // лаваш всегда снизу
    const lavash = this.contents.find((c) => c.kind === 'lavash');
    if (lavash) {
      lavash.root.position.set(0, y, 0);
      y += 0.01;
    }
    const bun = this.contents.find((c) => c.kind === 'bun');
    if (bun) {
      bun.root.position.set(0, y, 0);
      bun.setBunSplit(true);
      y += 0.028;
    }
    for (const c of this.contents) {
      if (c === bun || c === lavash) continue;
      c.root.position.set(0, y, 0);
      y += c.height * 0.75;
    }
    if (bun) {
      const top = bun.visual.getObjectByName('top');
      // Верхняя половинка лежит на самом верху стопки (в локальных координатах булки).
      if (top) top.position.y = y - 0.022;
      y += 0.04;
    }
    this.height = Math.max(0.03, y);
  }

  /** Начинка на основе пиццы: сыр ниже, помидор сверху. */
  layoutBase(): void {
    // у готовой пиццы своя модель — начинку прячем
    const whole = (this.state === 'cooked' || this.state === 'burnt') && this.isPizza && hasModel('pizza');
    for (const c of this.contents) c.root.visible = !whole;
    const sorted = [...this.contents].sort((a, b) => (a.kind === 'cheese' ? -1 : 1) - (b.kind === 'cheese' ? -1 : 1));
    let y = this.state === 'chopped' ? 0.016 : 0.02;
    for (const c of sorted) {
      c.root.position.set(0, y, 0);
      y += 0.006;
    }
    this.height = 0.03 + this.contents.length * 0.006;
  }

  setBunSplit(split: boolean): void {
    const top = this.visual.getObjectByName('top');
    if (top && !split) top.position.y = 0.024;
  }

  private rebuild(): void {
    this.root.remove(this.visual);
    const old = this.visual;
    old.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
    this.materials = [];
    this.visual = new THREE.Group();
    this.root.add(this.visual);
    const own = (m: THREE.MeshToonMaterial): THREE.Material => {
      const c = m.clone();
      this.materials.push(c);
      return c;
    };
    // Сначала пробуем модель Kenney; если её нет для этого состояния — свои примитивы.
    if (!kenneyVisual(this, this.visual, own)) {
      buildVisual(this, this.visual, (c) => {
        const m = toonUnique(c);
        this.materials.push(m);
        return m;
      });
    }
    if (this.highlighted) for (const m of this.materials) m.emissive.setHex(0x553322);
  }

  /** Удалить вместе со всем, что лежит сверху (тарелка, пицца). */
  disposeDeep(): void {
    for (const c of this.contents) c.disposeDeep();
    this.dispose();
  }

  dispose(): void {
    this.visual.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
  }
}

type Mat = (c: number) => THREE.Material;
type Own = (m: THREE.MeshToonMaterial) => THREE.Material;

/** Модели Kenney для продуктов. Возвращает false, если для этого состояния модели нет. */
function kenneyVisual(item: Item, g: THREE.Group, own: Own): boolean {
  const s = item.state;
  const M = (name: ModelName, o: ModelOptions = {}): THREE.Group => model(name, { outline: 0.004, material: own, ...o });
  const burnt = (m: THREE.MeshToonMaterial): THREE.Material => {
    const c = own(m) as THREE.MeshToonMaterial;
    c.color.setHex(0x3a2e30);
    return c;
  };
  const need = (n: ModelName): boolean => hasModel(n);
  /** Своя копия материала, перекрашенная (умножение цвета на текстуру). */
  const tint = (hex: number) => (m: THREE.MeshToonMaterial): THREE.Material => {
    const c = own(m) as THREE.MeshToonMaterial;
    c.color.setHex(hex);
    return c;
  };
  switch (item.kind) {
    case 'bun': {
      if (!need('burger')) return false;
      const bottom = new THREE.Group();
      bottom.name = 'bottom';
      bottom.add(M('burger', { node: 'bun-bottom', scale: 0.34, center: false }));
      const top = new THREE.Group();
      top.name = 'top';
      top.add(M('burger', { node: 'bun-top', scale: 0.34, center: false }));
      g.add(bottom, top);
      const bh = new THREE.Box3().setFromObject(bottom).max.y;
      top.position.y = bh + 0.006;
      item.height = new THREE.Box3().setFromObject(g).max.y;
      item.radius = 0.065;
      return true;
    }
    case 'patty':
      if (!need('meat-patty')) return false;
      g.add(M('meat-patty', { size: 0.12, material: s === 'burnt' ? burnt : s === 'raw' ? tint(0xffa8a8) : own }));
      item.height = 0.025;
      item.radius = 0.06;
      return true;
    case 'lettuce':
      if (!need('cabbage')) return false;
      if (s === 'raw') {
        g.add(M('cabbage', { size: 0.13 }));
        item.height = 0.11;
        item.radius = 0.07;
      } else {
        // нарезанный салат — горка листьев (тот же кочан, сплющенный)
        g.add(M('cabbage', { size: 0.11, stretch: [1, 0.3, 1] }));
        item.height = 0.03;
        item.radius = 0.06;
      }
      return true;
    case 'tomato':
      if (s === 'raw' && need('tomato')) {
        g.add(M('tomato', { size: 0.1 }));
        item.height = 0.09;
        item.radius = 0.055;
        return true;
      }
      if (s === 'chopped' && need('tomato-slice')) {
        for (let i = 0; i < 3; i++) {
          const sl = M('tomato-slice', { size: 0.085 });
          sl.position.set((i - 1) * 0.016, i * 0.007, 0);
          sl.rotation.y = i * 0.7;
          g.add(sl);
        }
        item.height = 0.022;
        item.radius = 0.06;
        return true;
      }
      return false;
    case 'cheese':
      if (s === 'raw' && need('cheese')) {
        g.add(M('cheese', { size: 0.1 }));
        item.height = 0.07;
        item.radius = 0.06;
        return true;
      }
      if (s === 'chopped' && need('cheese-cut')) {
        g.add(M('cheese-cut', { size: 0.09 }));
        item.height = 0.015;
        item.radius = 0.055;
        return true;
      }
      return false;
    case 'potato':
      if (s === 'cooked' && need('fries')) {
        g.add(M('fries', { size: 0.075 }));
        item.height = 0.11;
        item.radius = 0.06;
        return true;
      }
      if (s === 'raw' && need('egg')) {
        // клубень: «яйцо», перекрашенное в коричневый и положенное набок
        const p = M('egg', { size: 0.07, material: tint(0xb07a48) });
        p.rotation.z = Math.PI / 2;
        p.position.set(0.05, 0.035, 0);
        g.add(p);
        item.height = 0.07;
        item.radius = 0.065;
        return true;
      }
      // нарезанная и сгоревшая картошка — свои брусочки (у модели фри внутри часть стаканчика)
      return false;
    case 'chicken': {
      // куриная ножка: мясо (яйцо Kenney, перекрашенное) + косточка
      if (!need('egg')) return false;
      const meat = s === 'raw' ? 0xffc0b4 : s === 'burnt' ? 0x3a2e30 : 0xe0883a;
      const leg = M('egg', { size: 0.07, stretch: [1, 1, 1.25], material: tint(meat) });
      leg.rotation.z = Math.PI / 2;
      leg.position.set(0.035, 0.035, 0);
      g.add(leg);
      const boneMat = own(toon(PALETTE.bone));
      const bone = toonMesh(new THREE.CylinderGeometry(0.009, 0.009, 0.06, 8).rotateZ(Math.PI / 2), boneMat, 0.004);
      bone.position.set(0.06, 0.035, 0);
      g.add(bone);
      for (const dz of [-0.011, 0.011]) {
        const knob = toonMesh(new THREE.SphereGeometry(0.013, 8, 6), boneMat, 0.004);
        knob.position.set(0.093, 0.035, dz);
        g.add(knob);
      }
      item.height = 0.07;
      item.radius = 0.08;
      return true;
    }
    case 'dough':
      if ((s === 'cooked' || s === 'burnt') && item.isPizza && need('pizza')) {
        g.add(M('pizza', { size: 0.24, material: s === 'burnt' ? burnt : own }));
        item.height = 0.03;
        item.radius = 0.13;
        return true;
      }
      if (s === 'raw' && need('egg')) {
        // шарик теста
        g.add(M('egg', { size: 0.1, stretch: [1, 0.55, 1], material: tint(0xfff6e0) }));
        item.height = 0.08;
        item.radius = 0.065;
        return true;
      }
      if ((s === 'chopped' || ((s === 'cooked' || s === 'burnt') && !item.isPizza)) && need('cutting-board-round')) {
        // раскатанная основа: круглая «лепёшка»
        const col = s === 'chopped' ? 0xfff2d6 : s === 'cooked' ? 0xffcc80 : 0x3a2e30;
        g.add(M('cutting-board-round', { size: 0.24, stretch: [1, 0.45, 1], material: tint(col) }));
        item.height = 0.03;
        item.radius = 0.13;
        return true;
      }
      return false;
    case 'lavash':
      if (!need('cutting-board-round')) return false;
      g.add(M('cutting-board-round', { size: 0.22, stretch: [1, 0.25, 1], material: tint(0xffe8b8) }));
      item.height = 0.01;
      item.radius = 0.11;
      return true;
    case 'doner':
      if (!need('bacon')) return false;
      for (let i = 0; i < 3; i++) {
        const sl = M('bacon', { size: 0.09, material: tint(i % 2 ? 0xc8784a : 0xa05a30) });
        sl.position.set((i - 1) * 0.018, i * 0.008, 0);
        sl.rotation.y = i * 0.9;
        g.add(sl);
      }
      item.height = 0.03;
      item.radius = 0.06;
      return true;
    case 'pin':
      if (!need('rollingPin')) return false;
      g.add(M('rollingPin', { size: 0.3 }));
      item.height = 0.04;
      item.radius = 0.12;
      return true;
    case 'plate':
      if (!need('plate')) return false;
      g.add(M('plate', { size: 0.24 }));
      item.height = 0.03;
      item.radius = 0.12;
      return true;
    case 'knife':
      if (!need('cooking-knife')) return false;
      g.add(M('cooking-knife', { size: 0.27 }));
      item.height = 0.02;
      item.radius = 0.1;
      return true;
    default:
      return false;
  }
}

function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, outline = 0.005): THREE.Mesh {
  const m = toonMesh(geo, mat, outline);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function buildVisual(item: Item, g: THREE.Group, mat: Mat): void {
  const s = item.state;
  switch (item.kind) {
    case 'bun': {
      const bottom = new THREE.Group();
      bottom.name = 'bottom';
      const b = add(bottom, new THREE.CylinderGeometry(0.06, 0.056, 0.022, 14), mat(PALETTE.bunBottom), 0, 0.011, 0);
      b.name = 'bottomMesh';
      const top = new THREE.Group();
      top.name = 'top';
      const dome = new THREE.SphereGeometry(0.062, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      dome.scale(1, 0.65, 1);
      add(top, dome, mat(PALETTE.bunTop), 0, 0, 0);
      // кунжут
      const seedMat = mat(0xfff6d8);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const seed = new THREE.Mesh(new THREE.SphereGeometry(0.006, 5, 3), seedMat);
        seed.scale.set(1, 0.5, 1.6);
        seed.position.set(Math.cos(a) * 0.03, 0.036, Math.sin(a) * 0.03);
        top.add(seed);
      }
      top.position.y = 0.024;
      g.add(bottom, top);
      item.height = 0.065;
      item.radius = 0.065;
      break;
    }
    case 'patty': {
      const color = s === 'raw' ? PALETTE.pattyRaw : s === 'cooked' ? PALETTE.pattyCooked : PALETTE.pattyBurnt;
      add(g, new THREE.CylinderGeometry(0.056, 0.058, 0.024, 12), mat(color), 0, 0.012, 0);
      if (s === 'cooked') {
        // полоски от гриля
        const stripe = mat(0x5a2e18);
        for (let i = -1; i <= 1; i++) {
          const st = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.003, 0.008), stripe);
          st.position.set(0, 0.025, i * 0.022);
          g.add(st);
        }
      }
      item.height = 0.025;
      item.radius = 0.06;
      break;
    }
    case 'lettuce': {
      if (s === 'raw') {
        const head = new THREE.IcosahedronGeometry(0.065, 1);
        head.scale(1, 0.85, 1);
        add(g, head, mat(PALETTE.lettuce), 0, 0.055, 0);
        const inner = new THREE.IcosahedronGeometry(0.035, 0);
        add(g, inner, mat(PALETTE.lettuceDark), 0.02, 0.1, 0.01, 0.004);
        item.height = 0.11;
        item.radius = 0.07;
      } else {
        const leaf = mat(PALETTE.lettuce);
        for (let i = 0; i < 3; i++) {
          const geo = new THREE.CylinderGeometry(0.05 - i * 0.008, 0.05 - i * 0.008, 0.008, 7);
          const m = add(g, geo, leaf, (i - 1) * 0.012, 0.004 + i * 0.007, (i % 2) * 0.01, 0.004);
          m.rotation.y = i * 0.8;
        }
        item.height = 0.025;
        item.radius = 0.06;
      }
      break;
    }
    case 'tomato': {
      if (s === 'raw') {
        const body = new THREE.SphereGeometry(0.05, 12, 10);
        body.scale(1, 0.85, 1);
        add(g, body, mat(PALETTE.tomato), 0, 0.043, 0);
        add(g, new THREE.CylinderGeometry(0.004, 0.006, 0.02, 5), mat(PALETTE.stem), 0, 0.092, 0, 0.003);
        const leaf = new THREE.ConeGeometry(0.025, 0.008, 5);
        add(g, leaf, mat(PALETTE.stem), 0, 0.083, 0, 0.003);
        item.height = 0.1;
        item.radius = 0.055;
      } else if (s === 'cooked' || s === 'burnt') {
        // соус на пицце
        add(g, new THREE.CylinderGeometry(0.03, 0.03, 0.004, 10), mat(s === 'cooked' ? PALETTE.sauce : PALETTE.burnt), 0.045, 0.002, 0.02, 0);
        add(g, new THREE.CylinderGeometry(0.03, 0.03, 0.004, 10), mat(s === 'cooked' ? PALETTE.sauce : PALETTE.burnt), -0.04, 0.002, 0.035, 0);
        add(g, new THREE.CylinderGeometry(0.03, 0.03, 0.004, 10), mat(s === 'cooked' ? PALETTE.sauce : PALETTE.burnt), -0.01, 0.002, -0.05, 0);
        item.height = 0.006;
        item.radius = 0.1;
      } else {
        const red = mat(PALETTE.tomato);
        const inner = mat(PALETTE.tomatoInner);
        for (let i = 0; i < 3; i++) {
          const sl = add(g, new THREE.CylinderGeometry(0.045, 0.045, 0.008, 12), red, (i - 1) * 0.018, 0.004 + i * 0.006, 0, 0.004);
          const core = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.009, 10), inner);
          sl.add(core);
        }
        item.height = 0.022;
        item.radius = 0.06;
      }
      break;
    }
    case 'potato': {
      if (s === 'raw') {
        const body = new THREE.SphereGeometry(0.05, 10, 8);
        body.scale(1.25, 0.8, 0.9);
        add(g, body, mat(PALETTE.potato), 0, 0.04, 0);
        const eye = mat(0x8a5a2e);
        for (const [x, y, z] of [[0.03, 0.065, 0.015], [-0.035, 0.06, -0.01], [0.0, 0.07, -0.025]]) {
          const e = new THREE.Mesh(new THREE.SphereGeometry(0.006, 5, 4), eye);
          e.position.set(x, y, z);
          g.add(e);
        }
        item.height = 0.08;
        item.radius = 0.065;
      } else {
        const stickColor = s === 'chopped' ? PALETTE.potatoInner : s === 'cooked' ? PALETTE.fries : PALETTE.burnt;
        if (s === 'cooked') {
          // бумажный кулёк для фри
          add(g, new THREE.BoxGeometry(0.11, 0.035, 0.075), mat(0xe8402f), 0, 0.0175, 0, 0.004);
        }
        const stick = mat(stickColor);
        const base = s === 'cooked' ? 0.035 : 0.006;
        for (let i = 0; i < 9; i++) {
          const st = toonMesh(new THREE.BoxGeometry(0.014, 0.014, 0.085), stick, 0.003);
          st.position.set(((i % 3) - 1) * 0.022, base + Math.floor(i / 3) * 0.011, ((i * 7) % 5) * 0.006 - 0.012);
          st.rotation.y = ((i * 37) % 11) * 0.06 - 0.3;
          if (s === 'cooked') st.rotation.x = -0.5 + (i % 3) * 0.25;
          g.add(st);
        }
        item.height = s === 'cooked' ? 0.08 : 0.035;
        item.radius = 0.06;
      }
      break;
    }
    case 'chicken': {
      const color = s === 'raw' ? PALETTE.chickenRaw : s === 'burnt' ? PALETTE.burnt : PALETTE.chickenCooked;
      const meat = s === 'raw' ? new THREE.SphereGeometry(0.045, 10, 8) : new THREE.IcosahedronGeometry(0.048, 1);
      meat.scale(1.35, 0.85, 1);
      add(g, meat, mat(color), -0.015, 0.038, 0);
      add(g, new THREE.CylinderGeometry(0.009, 0.009, 0.06, 6).rotateZ(Math.PI / 2), mat(PALETTE.bone), 0.065, 0.035, 0, 0.004);
      add(g, new THREE.SphereGeometry(0.014, 8, 6), mat(PALETTE.bone), 0.095, 0.035, 0, 0.004);
      item.height = 0.075;
      item.radius = 0.08;
      break;
    }
    case 'dough': {
      if (s === 'raw') {
        const ball = new THREE.SphereGeometry(0.055, 12, 10);
        ball.scale(1, 0.75, 1);
        add(g, ball, mat(PALETTE.dough), 0, 0.041, 0);
        item.height = 0.08;
        item.radius = 0.065;
      } else {
        const color = s === 'chopped' ? PALETTE.dough : s === 'cooked' ? PALETTE.crust : PALETTE.burnt;
        add(g, new THREE.CylinderGeometry(0.12, 0.12, 0.016, 20), mat(s === 'cooked' ? 0xf3cf86 : color), 0, 0.008, 0);
        const rim = new THREE.TorusGeometry(0.115, 0.014, 6, 22);
        rim.rotateX(Math.PI / 2);
        add(g, rim, mat(color), 0, 0.016, 0, 0.004);
        item.height = 0.03;
        item.radius = 0.13;
      }
      break;
    }
    case 'cheese': {
      if (s === 'raw') {
        const wedge = new THREE.CylinderGeometry(0.065, 0.065, 0.045, 3);
        add(g, wedge, mat(PALETTE.cheese), 0, 0.0225, 0);
        const hole = mat(0xe8b830);
        for (const [x, z] of [[0.01, 0.02], [-0.02, -0.01]]) {
          const h = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.047, 6), hole);
          h.position.set(x, 0.0225, z);
          g.add(h);
        }
        item.height = 0.045;
        item.radius = 0.065;
      } else if (s === 'chopped') {
        const shred = mat(PALETTE.cheese);
        for (let i = 0; i < 10; i++) {
          const sh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.006, 0.008), shred);
          const a = i * 2.4;
          sh.position.set(Math.cos(a) * 0.03 * ((i % 3) / 2 + 0.3), 0.004 + (i % 3) * 0.004, Math.sin(a) * 0.03);
          sh.rotation.y = a;
          g.add(sh);
        }
        item.height = 0.018;
        item.radius = 0.055;
      } else {
        add(g, new THREE.CylinderGeometry(0.098, 0.1, 0.005, 16), mat(s === 'cooked' ? PALETTE.cheeseMelt : PALETTE.burnt), 0, 0.0025, 0, 0);
        item.height = 0.006;
        item.radius = 0.1;
      }
      break;
    }
    case 'lavash': {
      add(g, new THREE.CylinderGeometry(0.11, 0.11, 0.008, 16), mat(PALETTE.lavash), 0, 0.004, 0, 0.004);
      const spot = mat(0xd9b06a);
      for (let i = 0; i < 5; i++) {
        const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.009, 6), spot);
        sp.position.set(Math.cos(i * 1.3) * 0.06, 0.004, Math.sin(i * 1.3) * 0.06);
        g.add(sp);
      }
      item.height = 0.01;
      item.radius = 0.11;
      break;
    }
    case 'doner': {
      const c1 = mat(PALETTE.doner);
      const c2 = mat(PALETTE.donerDark);
      for (let i = 0; i < 7; i++) {
        const sh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.008, 0.02), i % 2 ? c1 : c2);
        sh.position.set(((i * 5) % 7) * 0.008 - 0.024, 0.005 + (i % 3) * 0.007, ((i * 3) % 5) * 0.01 - 0.02);
        sh.rotation.set(0.2 * (i % 2), i * 0.9, 0.15);
        g.add(sh);
      }
      item.height = 0.025;
      item.radius = 0.06;
      break;
    }
    case 'plate': {
      add(g, new THREE.CylinderGeometry(0.12, 0.09, 0.018, 20), mat(PALETTE.plate), 0, 0.009, 0, 0.006);
      const rim = new THREE.TorusGeometry(0.115, 0.007, 6, 24);
      rim.rotateX(Math.PI / 2);
      add(g, rim, mat(0x9fe0ff), 0, 0.019, 0, 0);
      item.height = 0.03;
      item.radius = 0.12;
      break;
    }
    case 'pin': {
      const roll = new THREE.CylinderGeometry(0.025, 0.025, 0.2, 10).rotateZ(Math.PI / 2);
      add(g, roll, mat(PALETTE.woodLight), 0, 0.025, 0, 0.004);
      for (const side of [-1, 1]) add(g, new THREE.CylinderGeometry(0.01, 0.01, 0.06, 6).rotateZ(Math.PI / 2), mat(PALETTE.wood), side * 0.13, 0.025, 0, 0.003);
      item.height = 0.05;
      item.radius = 0.12;
      break;
    }
    case 'knife': {
      const blade = new THREE.BoxGeometry(0.17, 0.006, 0.035);
      blade.translate(0.06, 0, 0);
      add(g, blade, mat(PALETTE.steel), 0, 0.012, 0, 0.004);
      add(g, new THREE.BoxGeometry(0.1, 0.022, 0.028), mat(PALETTE.wood), -0.08, 0.012, 0, 0.004);
      item.height = 0.025;
      item.radius = 0.1;
      break;
    }
  }
}
