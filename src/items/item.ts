import * as THREE from 'three';
import { PALETTE, toonMesh, toonUnique } from '../style/toon';
import type { Slot } from '../world/slots';

export type ItemKind = 'bun' | 'patty' | 'lettuce' | 'tomato' | 'plate' | 'knife';
export type ItemState = 'raw' | 'chopped' | 'cooked' | 'burnt';
export type ItemMode = 'free' | 'rest' | 'held' | 'slot' | 'onPlate' | 'dead';

export const INGREDIENTS: ItemKind[] = ['bun', 'patty', 'lettuce', 'tomato'];

export const KIND_NAMES: Record<ItemKind, string> = {
  bun: 'Булка',
  patty: 'Котлета',
  lettuce: 'Салат',
  tomato: 'Помидор',
  plate: 'Тарелка',
  knife: 'Нож',
};

/** Ключ ингредиента в рецепте, например «patty:cooked». Булка всегда просто «bun». */
export function itemKey(kind: ItemKind, state: ItemState): string {
  return kind === 'bun' ? 'bun' : `${kind}:${state}`;
}

export function keyName(key: string): string {
  const [kind, state] = key.split(':') as [ItemKind, ItemState | undefined];
  const base = KIND_NAMES[kind];
  if (!state) return base;
  if (kind === 'patty' && state === 'cooked') return 'Жареная котлета';
  if (state === 'chopped') return kind === 'lettuce' ? 'Нарезанный салат' : 'Нарезанный помидор';
  return base;
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
    return itemKey(this.kind, this.state);
  }

  get isIngredient(): boolean {
    return INGREDIENTS.includes(this.kind);
  }

  get choppable(): boolean {
    return (this.kind === 'lettuce' || this.kind === 'tomato') && this.state === 'raw';
  }

  setState(s: ItemState): void {
    if (this.state === s) return;
    this.state = s;
    this.rebuild();
    this.bounce();
  }

  /** Короткое «пружинящее» сплющивание при постановке. */
  bounce(): void {
    this.bounceT = 0;
  }

  setHighlight(on: boolean): void {
    if (on === this.highlighted) return;
    this.highlighted = on;
    for (const m of this.materials) m.emissive.setHex(on ? 0x553322 : 0x000000);
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
    const bun = this.contents.find((c) => c.kind === 'bun');
    if (bun) {
      bun.root.position.set(0, y, 0);
      bun.setBunSplit(true);
      y += 0.028;
    }
    for (const c of this.contents) {
      if (c === bun) continue;
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
    buildVisual(this, this.visual, (c) => {
      const m = toonUnique(c);
      this.materials.push(m);
      return m;
    });
    if (this.highlighted) for (const m of this.materials) m.emissive.setHex(0x553322);
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
    case 'plate': {
      add(g, new THREE.CylinderGeometry(0.12, 0.09, 0.018, 20), mat(PALETTE.plate), 0, 0.009, 0, 0.006);
      const rim = new THREE.TorusGeometry(0.115, 0.007, 6, 24);
      rim.rotateX(Math.PI / 2);
      add(g, rim, mat(0x9fe0ff), 0, 0.019, 0, 0);
      item.height = 0.03;
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
