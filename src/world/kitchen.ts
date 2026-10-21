import * as THREE from 'three';
import { PALETTE, StaticBatcher, toon, toonUnique } from '../style/toon';
import { makeSign } from '../ui/canvasPanel';
import type { ItemKind } from '../items/item';
import { Slot, type Surface } from './slots';

export const COUNTER_TOP = 0.9;

/** Границы, внутри которых игрок может стоять (центр кухни). */
export const PLAY_AREA = { minX: -1.1, maxX: 1.1, minZ: -0.8, maxZ: 2.35 };
export const ROOM = { minX: -2.2, maxX: 2.2, minZ: -1.6, maxZ: 2.6, height: 2.8 };

export interface Spawner {
  kind: ItemKind;
  box: THREE.Box3;
  spawnPos: THREE.Vector3;
}

export interface Kitchen {
  group: THREE.Group;
  surfaces: Surface[];
  slots: Slot[];
  spawners: Spawner[];
  board: Slot;
  boardBox: THREE.Box3;
  pans: Slot[];
  burners: THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>[];
  serve: Slot;
  knifeSlot: Slot;
  trash: { pos: THREE.Vector3; radius: number; top: number };
  plateStackPos: THREE.Vector3;
  orderBoardPos: THREE.Vector3;
  hudPos: THREE.Vector3;
  bell: THREE.Object3D;
  /** Все объекты, по которым можно «целиться» мышью (столы, пол). */
  aimTargets: THREE.Object3D[];
}

export function buildKitchen(): Kitchen {
  const root = new THREE.Group();
  const b = new StaticBatcher();
  const floorB = new StaticBatcher();
  const T = COUNTER_TOP;

  // ---------- Пол «шахматкой» ----------
  const tile = 0.55;
  for (let ix = 0; ix < 8; ix++) {
    for (let iz = 0; iz < 8; iz++) {
      const x = ROOM.minX + tile / 2 + ix * tile;
      const z = ROOM.minZ + tile / 2 + iz * tile;
      if (x > ROOM.maxX || z > ROOM.maxZ + 0.2) continue;
      floorB.box(tile, 0.02, tile, (ix + iz) % 2 ? PALETTE.floorA : PALETTE.floorB, x, -0.01, z, 0, false);
    }
  }
  const floorGroup = floorB.build();
  root.add(floorGroup);

  // ---------- Стены ----------
  const W = ROOM.maxX - ROOM.minX;
  const D = ROOM.maxZ - ROOM.minZ;
  const H = ROOM.height;
  b.box(W, H, 0.1, PALETTE.wall, 0, H / 2, ROOM.minZ - 0.05, 0, false);
  b.box(W, H, 0.1, PALETTE.wall, 0, H / 2, ROOM.maxZ + 0.05, 0, false);
  b.box(0.1, H, D, PALETTE.wall, ROOM.minX - 0.05, H / 2, (ROOM.minZ + ROOM.maxZ) / 2, 0, false);
  b.box(0.1, H, D, PALETTE.wall, ROOM.maxX + 0.05, H / 2, (ROOM.minZ + ROOM.maxZ) / 2, 0, false);
  // плинтус и полоса плитки
  for (const [x, z, w, d] of [
    [0, ROOM.minZ, W, 0.04],
    [0, ROOM.maxZ, W, 0.04],
    [ROOM.minX, (ROOM.minZ + ROOM.maxZ) / 2, 0.04, D],
    [ROOM.maxX, (ROOM.minZ + ROOM.maxZ) / 2, 0.04, D],
  ] as const) {
    b.box(w, 0.12, d, PALETTE.wallTrim, x, 0.06, z, 0, false);
    b.box(w, 0.06, d, PALETTE.wallTrim, x, 1.45, z, 0, false);
  }

  // ---------- Стойки (П-образно) ----------
  const counters: Surface[] = [
    { minX: -1.8, maxX: 1.8, minZ: -1.5, maxZ: -0.9, top: T }, // задняя
    { minX: -1.8, maxX: -1.2, minZ: -0.9, maxZ: 0.95, top: T }, // левая
    { minX: 1.2, maxX: 1.8, minZ: -0.9, maxZ: 0.95, top: T }, // правая
  ];
  for (const c of counters) {
    const cx = (c.minX + c.maxX) / 2;
    const cz = (c.minZ + c.maxZ) / 2;
    const w = c.maxX - c.minX;
    const d = c.maxZ - c.minZ;
    b.box(w - 0.04, T - 0.1, d - 0.04, PALETTE.counter, cx, (T - 0.1) / 2 + 0.06, cz, 0, true);
    b.box(w - 0.1, 0.06, d - 0.1, PALETTE.counterDark, cx, 0.03, cz, 0, false);
    b.box(w + 0.04, 0.06, d + 0.04, PALETTE.counterTop, cx, T - 0.03, cz, 0, true);
  }
  // дверцы шкафчиков с ручками
  for (let x = -1.55; x <= 1.6; x += 0.5) {
    if (x > -1.2 && x < 1.2) {
      b.box(0.42, 0.55, 0.02, PALETTE.counterDark, x + 0.2, 0.45, -0.875, 0, true);
      b.box(0.12, 0.03, 0.03, PALETTE.steelDark, x + 0.2, 0.66, -0.855, 0, false);
    }
  }
  for (let z = -0.6; z <= 0.8; z += 0.5) {
    b.box(0.02, 0.55, 0.42, PALETTE.counterDark, -1.175, 0.45, z, 0, true);
    b.box(0.03, 0.03, 0.12, PALETTE.steelDark, -1.155, 0.66, z, 0, false);
    b.box(0.02, 0.55, 0.42, PALETTE.counterDark, 1.175, 0.45, z, 0, true);
    b.box(0.03, 0.03, 0.12, PALETTE.steelDark, 1.155, 0.66, z, 0, false);
  }

  const surfaces: Surface[] = [...counters];
  const slots: Slot[] = [];
  const signs: THREE.Object3D[] = [];
  const addSign = (label: string, w: number, x: number, y: number, z: number, rotY: number, fill?: string): void => {
    const s = makeSign(label, w, fill);
    s.position.set(x, y, z);
    s.rotation.y = rotY;
    signs.push(s);
  };

  // ---------- Разделочная доска ----------
  const boardPos = new THREE.Vector3(-0.72, T, -1.15);
  b.box(0.42, 0.03, 0.3, PALETTE.woodLight, boardPos.x, T + 0.015, boardPos.z, 0, true);
  b.box(0.06, 0.004, 0.03, PALETTE.wood, boardPos.x + 0.16, T + 0.032, boardPos.z - 0.11, 0, false);
  const board = new Slot('board', new THREE.Vector3(boardPos.x, T + 0.03, boardPos.z));
  slots.push(board);
  const boardBox = new THREE.Box3(
    new THREE.Vector3(boardPos.x - 0.24, T, boardPos.z - 0.18),
    new THREE.Vector3(boardPos.x + 0.24, T + 0.3, boardPos.z + 0.18),
  );
  addSign('Доска', 0.3, boardPos.x, T + 0.3, ROOM.minZ + 0.01, 0, '#ffe08a');
  const knifeSlot = new Slot('knife', new THREE.Vector3(-1.12, T, -1.12), 0.4);
  slots.push(knifeSlot);

  // ---------- Плита ----------
  const stoveX = 0.38;
  b.box(0.95, 0.04, 0.56, PALETTE.stove, stoveX, T + 0.02, -1.2, 0, true);
  b.box(0.95, 0.1, 0.04, PALETTE.stove, stoveX, T + 0.07, -1.47, 0, true);
  // ручки плиты
  for (const dx of [-0.3, -0.1, 0.1, 0.3]) {
    const knob = new THREE.CylinderGeometry(0.022, 0.022, 0.02, 10);
    knob.rotateX(Math.PI / 2);
    b.add(knob, PALETTE.steel, new THREE.Matrix4().makeTranslation(stoveX + dx, T + 0.08, -1.44), true);
  }
  const pans: Slot[] = [];
  const burners: THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>[] = [];
  for (const dx of [-0.22, 0.22]) {
    const px = stoveX + dx;
    const pz = -1.15;
    const burner = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.008, 16), toonUnique(0x2a2a38));
    burner.position.set(px, T + 0.044, pz);
    root.add(burner);
    burners.push(burner);
    // сковорода: дно, борт, ручка
    b.add(new THREE.CylinderGeometry(0.135, 0.12, 0.012, 18), PALETTE.steelDark, new THREE.Matrix4().makeTranslation(px, T + 0.054, pz), true);
    const rim = new THREE.TorusGeometry(0.135, 0.012, 6, 22);
    rim.rotateX(Math.PI / 2);
    b.add(rim, PALETTE.steelDark, new THREE.Matrix4().makeTranslation(px, T + 0.07, pz), false);
    b.box(0.2, 0.02, 0.035, PALETTE.ink, px, T + 0.07, pz + 0.22, Math.PI / 2, false);
    const slot = new Slot('pan', new THREE.Vector3(px, T + 0.06, pz));
    pans.push(slot);
    slots.push(slot);
  }
  addSign('Плита', 0.3, stoveX, T + 0.3, ROOM.minZ + 0.01, 0, '#ffb38a');

  // ---------- Свободные места на стойках ----------
  for (const x of [-1.45, -0.25, 1.05]) slots.push(new Slot('counter', new THREE.Vector3(x, T, -1.12)));
  slots.push(new Slot('counter', new THREE.Vector3(-0.25, T, -1.36)));
  slots.push(new Slot('counter', new THREE.Vector3(1.05, T, -1.36)));
  slots.push(new Slot('counter', new THREE.Vector3(1.4, T, 0.6)));
  slots.push(new Slot('counter', new THREE.Vector3(1.6, T, 0.6)));

  // ---------- Ящики с ингредиентами (левая стойка) ----------
  const spawners: Spawner[] = [];
  const crateDefs: [ItemKind, number, string, string][] = [
    ['bun', -0.62, 'Булки', '#ffd58a'],
    ['patty', -0.18, 'Котлеты', '#ffb3c0'],
    ['lettuce', 0.26, 'Салат', '#b8f08f'],
    ['tomato', 0.7, 'Помидоры', '#ff9a8a'],
  ];
  const decoColor: Record<string, number> = {
    bun: PALETTE.bunTop,
    patty: PALETTE.pattyRaw,
    lettuce: PALETTE.lettuce,
    tomato: PALETTE.tomato,
  };
  for (const [kind, z, label, fill] of crateDefs) {
    const x = -1.48;
    const cw = 0.4;
    const cd = 0.38;
    const ch = 0.18;
    // стенки ящика
    b.box(cw, 0.02, cd, PALETTE.crate, x, T + 0.01, z, 0, true);
    b.box(cw, ch, 0.025, PALETTE.crate, x, T + ch / 2, z - cd / 2, 0, true);
    b.box(cw, ch, 0.025, PALETTE.crate, x, T + ch / 2, z + cd / 2, 0, true);
    b.box(0.025, ch, cd, PALETTE.crate, x - cw / 2, T + ch / 2, z, 0, true);
    b.box(0.025, ch, cd, PALETTE.crate, x + cw / 2, T + ch / 2, z, 0, true);
    // горка продуктов внутри
    for (let i = 0; i < 6; i++) {
      const g = new THREE.IcosahedronGeometry(0.055, 0);
      const ox = ((i % 3) - 1) * 0.11;
      const oz = (Math.floor(i / 3) - 0.5) * 0.14;
      g.scale(1, kind === 'patty' ? 0.4 : 0.85, 1);
      b.add(g, decoColor[kind], new THREE.Matrix4().makeTranslation(x + ox, T + 0.1 + (i % 2) * 0.02, z + oz), false);
    }
    const box = new THREE.Box3(new THREE.Vector3(x - cw / 2 - 0.04, T, z - cd / 2 - 0.04), new THREE.Vector3(x + cw / 2 + 0.04, T + 0.35, z + cd / 2 + 0.04));
    spawners.push({ kind, box, spawnPos: new THREE.Vector3(x, T + 0.2, z) });
    surfaces.push({ minX: x - cw / 2, maxX: x + cw / 2, minZ: z - cd / 2, maxZ: z + cd / 2, top: T + 0.12 });
    addSign(label, 0.3, -1.15, T - 0.15, z, Math.PI / 2, fill);
  }

  // ---------- Тарелки (правая стойка) ----------
  const plateStackPos = new THREE.Vector3(1.48, T, 0.08);
  for (let i = 0; i < 5; i++) {
    b.add(new THREE.CylinderGeometry(0.12, 0.09, 0.018, 20), PALETTE.plate, new THREE.Matrix4().makeTranslation(plateStackPos.x, T + 0.009 + i * 0.022, plateStackPos.z), true);
  }
  spawners.push({
    kind: 'plate',
    box: new THREE.Box3(new THREE.Vector3(plateStackPos.x - 0.16, T, plateStackPos.z - 0.16), new THREE.Vector3(plateStackPos.x + 0.16, T + 0.25, plateStackPos.z + 0.16)),
    spawnPos: new THREE.Vector3(plateStackPos.x, T + 0.12, plateStackPos.z),
  });
  surfaces.push({ minX: plateStackPos.x - 0.12, maxX: plateStackPos.x + 0.12, minZ: plateStackPos.z - 0.12, maxZ: plateStackPos.z + 0.12, top: T + 0.11 });
  addSign('Тарелки', 0.3, 1.15, T - 0.15, plateStackPos.z, -Math.PI / 2, '#d8f0ff');

  // ---------- Окно выдачи (правая стойка) ----------
  const serveZ = -0.52;
  const serveX = 1.45;
  b.box(0.42, 0.02, 0.42, PALETTE.steel, serveX, T + 0.01, serveZ, 0, true);
  // арка-окно в стене
  b.box(0.08, 1.0, 0.08, PALETTE.bell, 1.75, T + 0.5, serveZ - 0.3, 0, true);
  b.box(0.08, 1.0, 0.08, PALETTE.bell, 1.75, T + 0.5, serveZ + 0.3, 0, true);
  b.box(0.1, 0.08, 0.7, PALETTE.bell, 1.75, T + 1.02, serveZ, 0, true);
  b.box(0.02, 0.92, 0.52, PALETTE.window, ROOM.maxX - 0.005, T + 0.5, serveZ, 0, false);
  const serve = new Slot('serve', new THREE.Vector3(serveX, T + 0.02, serveZ));
  slots.push(serve);
  addSign('ВЫДАЧА', 0.4, 1.7, T + 1.2, serveZ, -Math.PI / 2, '#ffd23f');
  // звонок
  const bell = new THREE.Group();
  const bellBase = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.015, 14), toon(PALETTE.steelDark));
  const bellDome = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(PALETTE.bell));
  bellDome.position.y = 0.008;
  bell.add(bellBase, bellDome);
  bell.position.set(1.4, T + 0.008, serveZ - 0.3);
  root.add(bell);

  // ---------- Мусорка ----------
  const trashPos = new THREE.Vector3(1.0, 0, 1.05);
  const binH = 0.72;
  b.add(new THREE.CylinderGeometry(0.2, 0.17, binH, 16, 1, true), PALETTE.bin, new THREE.Matrix4().makeTranslation(trashPos.x, binH / 2, trashPos.z), true);
  b.add(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 16), PALETTE.ink, new THREE.Matrix4().makeTranslation(trashPos.x, 0.05, trashPos.z), false);
  const rim = new THREE.TorusGeometry(0.2, 0.018, 6, 20);
  rim.rotateX(Math.PI / 2);
  b.add(rim, PALETTE.bin, new THREE.Matrix4().makeTranslation(trashPos.x, binH, trashPos.z), false);
  addSign('Мусор', 0.26, trashPos.x, 0.45, trashPos.z + 0.205, 0, '#b8f08f');

  // ---------- Декор ----------
  // окно на левой стене
  b.box(0.04, 0.9, 1.2, PALETTE.wallTrim, ROOM.minX + 0.01, 1.75, 1.4, 0, true);
  b.box(0.02, 0.78, 1.08, 0xc8f0ff, ROOM.minX + 0.03, 1.75, 1.4, 0, false);
  b.box(0.03, 0.78, 0.04, PALETTE.wallTrim, ROOM.minX + 0.04, 1.75, 1.4, 0, false);
  b.box(0.03, 0.04, 1.08, PALETTE.wallTrim, ROOM.minX + 0.04, 1.75, 1.4, 0, false);
  // полки на задней стене с кастрюлями и банками
  b.box(1.0, 0.04, 0.22, PALETTE.wood, -1.15, 2.25, -1.48, 0, true);
  b.box(1.0, 0.04, 0.22, PALETTE.wood, 1.25, 2.25, -1.48, 0, true);
  const jarColors = [0xff5a3c, 0xffd23f, 0x6ccf4a, 0x7fd6ff, 0xc77dff];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.CylinderGeometry(0.06, 0.06, 0.14 + (i % 2) * 0.05, 10);
    b.add(g, jarColors[i], new THREE.Matrix4().makeTranslation(-1.5 + i * 0.18, 2.34 + (i % 2) * 0.025, -1.48), true);
  }
  for (let i = 0; i < 3; i++) {
    const g = new THREE.CylinderGeometry(0.11, 0.1, 0.15, 14);
    b.add(g, PALETTE.steel, new THREE.Matrix4().makeTranslation(0.95 + i * 0.28, 2.345, -1.48), true);
  }
  // висящая лампа
  b.box(0.02, 0.5, 0.02, PALETTE.ink, 0, ROOM.height - 0.25, 0.3, 0, false);
  const shade = new THREE.ConeGeometry(0.25, 0.22, 16, 1, true);
  b.add(shade, 0xffd23f, new THREE.Matrix4().makeTranslation(0, ROOM.height - 0.55, 0.3), true);
  b.add(new THREE.SphereGeometry(0.08, 12, 8), 0xfffbe0, new THREE.Matrix4().makeTranslation(0, ROOM.height - 0.66, 0.3), false);
  // часы-таймер на правой стене просто для вида
  const clock = new THREE.CylinderGeometry(0.16, 0.16, 0.03, 20);
  clock.rotateZ(Math.PI / 2);
  b.add(clock, 0xffffff, new THREE.Matrix4().makeTranslation(ROOM.maxX - 0.02, 2.0, 1.2), true);

  root.add(b.build(0.012));
  for (const s of signs) root.add(s);

  // невидимые плоскости для прицеливания мышью
  const aimTargets: THREE.Object3D[] = [];
  const aimMat = new THREE.MeshBasicMaterial({ visible: false });
  for (const s of surfaces) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s.maxX - s.minX, s.maxZ - s.minZ), aimMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set((s.minX + s.maxX) / 2, s.top, (s.minZ + s.maxZ) / 2);
    root.add(m);
    aimTargets.push(m);
  }
  const floorAim = new THREE.Mesh(new THREE.PlaneGeometry(W, D), aimMat);
  floorAim.rotation.x = -Math.PI / 2;
  floorAim.position.set(0, 0, (ROOM.minZ + ROOM.maxZ) / 2);
  floorAim.userData.floor = true;
  root.add(floorAim);
  aimTargets.push(floorAim);

  return {
    group: root,
    surfaces,
    slots,
    spawners,
    board,
    boardBox,
    pans,
    burners,
    serve,
    knifeSlot,
    trash: { pos: trashPos, radius: 0.2, top: binH },
    plateStackPos,
    orderBoardPos: new THREE.Vector3(0.35, 1.78, ROOM.minZ + 0.02),
    hudPos: new THREE.Vector3(-1.2, 1.78, ROOM.minZ + 0.02),
    bell,
    aimTargets,
  };
}
