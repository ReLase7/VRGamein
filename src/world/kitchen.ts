import * as THREE from 'three';
import { PALETTE, StaticBatcher, toon, toonMesh, toonUnique } from '../style/toon';
import { makeSign } from '../ui/canvasPanel';
import { makeLogo } from '../ui/logo';
import { Item } from '../items/item';
import { hasModel, model, type ModelName, type ModelOptions } from '../style/models';
import type { ItemKind } from '../items/item';
import { Slot, type Surface } from './slots';

export const COUNTER_TOP = 0.9;

/**
 * Планировка: П-образная стойка вплотную к трём стенам.
 *   задняя стойка  — вертел донера, доска, плита, фритюр
 *   левая стойка   — ящики с продуктами в два ряда
 *   правая стойка  — окно выдачи, тарелки, печь для пиццы, вторая доска
 */
export const ROOM = { minX: -1.8, maxX: 1.8, minZ: -1.5, maxZ: 2.6, height: 2.8 };
const SIDE_END = 1.9; // докуда тянется правая стойка (левая — до самой стены)
const LEFT_END = ROOM.maxZ;
/** Границы, внутри которых игрок может стоять (центр кухни). */
export const PLAY_AREA = { minX: -1.05, maxX: 1.05, minZ: -0.75, maxZ: 2.45 };

export interface Spawner {
  kind: ItemKind;
  box: THREE.Box3;
  spawnPos: THREE.Vector3;
}

/** Сплошной блок от пола до top: предметы не могут пройти сквозь него сбоку. */
export interface Solid extends Surface {
  /** Низ блока (по умолчанию пол). */
  bottom?: number;
  /** С каких сторон блок открыт (куда выталкивать предмет). */
  open: ('+x' | '-x' | '+z' | '-z')[];
}

export interface Kitchen {
  group: THREE.Group;
  surfaces: Surface[];
  solids: Solid[];
  slots: Slot[];
  spawners: Spawner[];
  boards: Slot[];
  boardBoxes: THREE.Box3[];
  pans: Slot[];
  burners: THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>[];
  fryers: Slot[];
  oil: THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>;
  oven: Slot;
  ovenGlow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  spit: { box: THREE.Box3; tray: Slot; meat: THREE.Object3D; pos: THREE.Vector3 };
  serve: Slot;
  knifeSlots: Slot[];
  pinSlots: Slot[];
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
  /** Поставить модель Kenney в статичную часть кухни. Возвращает false, если модели нет. */
  const place = (name: ModelName, x: number, y: number, z: number, rotY: number, o: ModelOptions, outline = true): boolean => {
    if (!hasModel(name)) return false;
    const m = model(name, { ...o, outline: 0 });
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    b.addObject(m, outline);
    return true;
  };
  const floorB = new StaticBatcher();
  const T = COUNTER_TOP;
  const W = ROOM.maxX - ROOM.minX;
  const D = ROOM.maxZ - ROOM.minZ;
  const H = ROOM.height;

  // ---------- Пол «шахматкой» ----------
  const nx = 8;
  const nz = 9;
  const tx = W / nx;
  const tz = D / nz;
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      const x = ROOM.minX + tx / 2 + ix * tx;
      const z = ROOM.minZ + tz / 2 + iz * tz;
      floorB.box(tx, 0.02, tz, (ix + iz) % 2 ? PALETTE.floorA : PALETTE.floorB, x, -0.01, z, 0, false);
    }
  }
  root.add(floorB.build());

  // ---------- Стены ----------
  b.box(W + 0.2, H, 0.1, PALETTE.wall, 0, H / 2, ROOM.minZ - 0.05, 0, false);
  b.box(W + 0.2, H, 0.1, PALETTE.wall, 0, H / 2, ROOM.maxZ + 0.05, 0, false);
  b.box(0.1, H, D, PALETTE.wall, ROOM.minX - 0.05, H / 2, (ROOM.minZ + ROOM.maxZ) / 2, 0, false);
  b.box(0.1, H, D, PALETTE.wall, ROOM.maxX + 0.05, H / 2, (ROOM.minZ + ROOM.maxZ) / 2, 0, false);
  // полоса плитки на стенах; плинтус только там, где нет стоек
  b.box(W, 0.06, 0.03, PALETTE.wallTrim, 0, 1.45, ROOM.minZ + 0.015, 0, false);
  b.box(W, 0.06, 0.03, PALETTE.wallTrim, 0, 1.45, ROOM.maxZ - 0.015, 0, false);
  b.box(ROOM.maxX + 1.2, 0.12, 0.03, PALETTE.wallTrim, (ROOM.maxX - 1.2) / 2, 0.06, ROOM.maxZ - 0.015, 0, false);
  for (const side of [-1, 1]) {
    const x = side * (ROOM.maxX - 0.015);
    b.box(0.03, 0.06, D, PALETTE.wallTrim, x, 1.45, (ROOM.minZ + ROOM.maxZ) / 2, 0, false);
  }
  b.box(0.03, 0.12, ROOM.maxZ - SIDE_END, PALETTE.wallTrim, ROOM.maxX - 0.015, 0.06, (SIDE_END + ROOM.maxZ) / 2, 0, false);

  // ---------- Стойки (П-образно, вплотную к стенам) ----------
  const back: Surface = { minX: ROOM.minX, maxX: ROOM.maxX, minZ: ROOM.minZ, maxZ: -0.9, top: T };
  const left: Surface = { minX: ROOM.minX, maxX: -1.2, minZ: -0.9, maxZ: LEFT_END, top: T };
  const right: Surface = { minX: 1.2, maxX: ROOM.maxX, minZ: -0.9, maxZ: SIDE_END, top: T };
  const counters = [back, left, right];
  // Одним П-образным куском: на стыках нет лишних линий обводки.
  // m — насколько кусок выступает в сторону игрока (у стены — всегда вплотную).
  const uShape = (m: number, y0: number, h: number, color: number, outline: boolean): void => {
    const pts: [number, number][] = [
      [ROOM.minX, ROOM.minZ],
      [ROOM.maxX, ROOM.minZ],
      [ROOM.maxX, SIDE_END + m],
      [1.2 - m, SIDE_END + m],
      [1.2 - m, -0.9 + m],
      [-1.2 + m, -0.9 + m],
      [-1.2 + m, LEFT_END],
      [ROOM.minX, LEFT_END],
    ];
    const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    b.add(geo, color, new THREE.Matrix4().makeTranslation(0, y0, 0), outline);
  };
  uShape(-0.05, 0, 0.06, PALETTE.counterDark, false); // цоколь
  uShape(-0.02, 0.06, T - 0.12, PALETTE.counter, true); // корпус
  uShape(0.02, T - 0.06, 0.06, PALETTE.counterTop, true); // столешница

  // дверцы шкафчиков с ручками — строго в пределах своей стороны
  for (const x of [-0.9, -0.3, 0.3, 0.9]) {
    b.box(0.52, 0.56, 0.02, PALETTE.counterDark, x, 0.44, -0.91, 0, true);
    b.box(0.12, 0.03, 0.03, PALETTE.steelDark, x, 0.64, -0.885, 0, false);
  }
  for (const z of [-0.6, -0.05, 0.5, 1.05, 1.6, 2.15]) {
    for (const side of [-1, 1]) {
      if (side > 0 && z > 1.7) continue;
      b.box(0.02, 0.56, 0.48, PALETTE.counterDark, side * 1.21, 0.44, z, 0, true);
      b.box(0.03, 0.03, 0.12, PALETTE.steelDark, side * 1.195, 0.64, z, 0, false);
    }
  }
  // торец правой стойки
  b.box(0.48, 0.56, 0.02, PALETTE.counterDark, 1.5, 0.44, SIDE_END - 0.01, 0, true);

  const surfaces: Surface[] = [...counters];
  const solids: Solid[] = [
    { ...back, maxZ: back.maxZ + 0.02, open: ['+z'] },
    { ...left, maxX: left.maxX + 0.02, open: ['+x'] },
    { ...right, minX: right.minX - 0.02, maxZ: right.maxZ + 0.02, open: ['-x', '+z'] },
  ];
  const slots: Slot[] = [];
  const signs: THREE.Object3D[] = [];
  const addSign = (label: string, w: number, x: number, y: number, z: number, rotY: number, fill?: string): void => {
    const s = makeSign(label, w, fill);
    s.position.set(x, y, z);
    s.rotation.y = rotY;
    signs.push(s);
  };
  const backSign = (label: string, x: number, fill: string): void => addSign(label, 0.3, x, T + 0.3, ROOM.minZ + 0.01, 0, fill);
  /** Твёрдый блок на стойке (станция, ящик): предметы отскакивают от его боков. */
  const block = (minX: number, maxX: number, minZ: number, maxZ: number, bottom: number, top: number): void => {
    const open: Solid['open'] = [];
    if (maxX < ROOM.maxX - 0.05) open.push('+x');
    if (minX > ROOM.minX + 0.05) open.push('-x');
    if (maxZ < ROOM.maxZ - 0.05) open.push('+z');
    if (minZ > ROOM.minZ + 0.05) open.push('-z');
    solids.push({ minX, maxX, minZ, maxZ, bottom, top, open });
  };

  // ---------- Разделочные доски ----------
  const boards: Slot[] = [];
  const boardBoxes: THREE.Box3[] = [];
  const addBoard = (x: number, z: number, rot: number): void => {
    const w = rot ? 0.3 : 0.42;
    const d = rot ? 0.42 : 0.3;
    if (!place('cutting-board', x, T, z, rot ? 0 : Math.PI / 2, { size: 0.42 })) b.box(w, 0.03, d, PALETTE.woodLight, x, T + 0.015, z, 0, true);
    const slot = new Slot('board', new THREE.Vector3(x, T + 0.03, z));
    boards.push(slot);
    slots.push(slot);
    boardBoxes.push(new THREE.Box3(new THREE.Vector3(x - w / 2 - 0.03, T, z - d / 2 - 0.03), new THREE.Vector3(x + w / 2 + 0.03, T + 0.3, z + d / 2 + 0.03)));
    surfaces.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: T + 0.03 });
  };
  addBoard(-0.82, -1.15, 0);
  backSign('Доска', -0.82, '#ffe08a');
  addBoard(1.48, 1.45, 1);
  addSign('Доска', 0.26, 1.19, T - 0.15, 1.45, -Math.PI / 2, '#ffe08a');
  // у каждой доски — свой нож и своя скалка
  const knifeSlots = [new Slot('knife', new THREE.Vector3(-0.47, T, -1.33), 0.25), new Slot('knife', new THREE.Vector3(1.48, T, 1.12), 0)];
  const pinSlots = [new Slot('pin', new THREE.Vector3(-0.47, T, -1.08), 0.25), new Slot('pin', new THREE.Vector3(1.5, T, 1.8), 0)];
  slots.push(...knifeSlots, ...pinSlots);

  // ---------- Плита ----------
  const stoveX = 0.2;
  b.box(0.95, 0.04, 0.56, PALETTE.stove, stoveX, T + 0.02, -1.2, 0, true);
  b.box(0.95, 0.1, 0.04, PALETTE.stove, stoveX, T + 0.07, -1.47, 0, true);
  for (const dx of [-0.3, -0.1, 0.1, 0.3]) {
    const knob = new THREE.CylinderGeometry(0.022, 0.022, 0.02, 10);
    knob.rotateX(Math.PI / 2);
    b.add(knob, PALETTE.steel, new THREE.Matrix4().makeTranslation(stoveX + dx, T + 0.08, -1.44), true);
  }
  surfaces.push({ minX: stoveX - 0.475, maxX: stoveX + 0.475, minZ: -1.48, maxZ: -0.92, top: T + 0.04 });
  const pans: Slot[] = [];
  const burners: THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>[] = [];
  for (const dx of [-0.22, 0.22]) {
    const px = stoveX + dx;
    const pz = -1.15;
    const burner = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.008, 16), toonUnique(0x2a2a38));
    burner.position.set(px, T + 0.044, pz);
    root.add(burner);
    burners.push(burner);
    // сковорода Kenney: ручкой к игроку
    if (!place('frying-pan', px, T + 0.048, pz, Math.PI, { scale: 0.41, center: false })) {
      b.add(new THREE.CylinderGeometry(0.135, 0.12, 0.012, 18), PALETTE.steelDark, new THREE.Matrix4().makeTranslation(px, T + 0.054, pz), true);
      const rim = new THREE.TorusGeometry(0.135, 0.012, 6, 22);
      rim.rotateX(Math.PI / 2);
      b.add(rim, PALETTE.steelDark, new THREE.Matrix4().makeTranslation(px, T + 0.07, pz), false);
      b.box(0.2, 0.02, 0.035, PALETTE.ink, px, T + 0.07, pz + 0.22, Math.PI / 2, false);
    }
    const slot = new Slot('pan', new THREE.Vector3(px, T + 0.06, pz));
    pans.push(slot);
    slots.push(slot);
  }
  backSign('Плита', stoveX, '#ffb38a');

  // ---------- Фритюр ----------
  const fryX = 0.95;
  const fryZ = -1.2;
  b.box(0.5, 0.14, 0.5, PALETTE.steel, fryX, T + 0.07, fryZ, 0, true);
  b.box(0.5, 0.2, 0.06, PALETTE.steelDark, fryX, T + 0.1, fryZ - 0.25, 0, true);
  const oil = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.01, 0.4), toonUnique(PALETTE.oil));
  // масло чуть выше верха корпуса, чтобы не мерцало
  oil.position.set(fryX, T + 0.147, fryZ + 0.02);
  root.add(oil);
  const fryers: Slot[] = [];
  for (const dx of [-0.11, 0.11]) {
    // корзинка: решётчатая рамка и ручка
    const bx = fryX + dx;
    const bz = fryZ + 0.02;
    for (const [w, d, ox, oz] of [
      [0.18, 0.012, 0, -0.15],
      [0.18, 0.012, 0, 0.15],
      [0.012, 0.3, -0.09, 0],
      [0.012, 0.3, 0.09, 0],
    ] as const) {
      b.box(w, 0.05, d, PALETTE.steelDark, bx + ox, T + 0.15, bz + oz, 0, false);
    }
    b.box(0.025, 0.025, 0.18, PALETTE.ink, bx, T + 0.17, bz + 0.24, 0, false);
    const slot = new Slot('fryer', new THREE.Vector3(bx, T + 0.11, bz));
    fryers.push(slot);
    slots.push(slot);
  }
  surfaces.push({ minX: fryX - 0.25, maxX: fryX + 0.25, minZ: fryZ - 0.25, maxZ: fryZ + 0.25, top: T + 0.14 });
  block(fryX - 0.25, fryX + 0.25, fryZ - 0.27, fryZ + 0.25, T, T + 0.14);
  backSign('Фритюр', fryX, '#ffe27a');

  // ---------- Вертел донера (левый задний угол) ----------
  const spitPos = new THREE.Vector3(-1.45, T, -1.22);
  b.add(new THREE.CylinderGeometry(0.16, 0.18, 0.03, 18), PALETTE.steelDark, new THREE.Matrix4().makeTranslation(spitPos.x, T + 0.015, spitPos.z), true);
  b.add(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 8), PALETTE.steel, new THREE.Matrix4().makeTranslation(spitPos.x, T + 0.38, spitPos.z), false);
  b.box(0.36, 0.55, 0.05, PALETTE.steelDark, spitPos.x, T + 0.33, spitPos.z - 0.24, 0, true);
  b.box(0.3, 0.45, 0.02, PALETTE.burner, spitPos.x, T + 0.33, spitPos.z - 0.21, 0, false);
  const meat = new THREE.Group();
  const cone = new THREE.CylinderGeometry(0.12, 0.075, 0.38, 10, 4);
  const meatMesh = toonMesh(cone, toon(PALETTE.doner), 0.008);
  meatMesh.position.y = 0.24;
  meat.add(meatMesh);
  for (let i = 0; i < 4; i++) {
    const band = new THREE.TorusGeometry(0.105 - i * 0.008, 0.012, 5, 12);
    band.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(band, toon(PALETTE.donerDark));
    m.position.y = 0.1 + i * 0.09;
    meat.add(m);
  }
  meat.position.set(spitPos.x, T, spitPos.z);
  root.add(meat);
  const tray = new Slot('tray', new THREE.Vector3(-1.45, T + 0.01, -0.98));
  b.box(0.28, 0.02, 0.16, PALETTE.steel, tray.pos.x, T + 0.01, tray.pos.z, 0, true);
  slots.push(tray);
  surfaces.push({ minX: tray.pos.x - 0.14, maxX: tray.pos.x + 0.14, minZ: tray.pos.z - 0.08, maxZ: tray.pos.z + 0.08, top: T + 0.02 });
  const spitBox = new THREE.Box3(new THREE.Vector3(spitPos.x - 0.25, T + 0.05, spitPos.z - 0.2), new THREE.Vector3(spitPos.x + 0.25, T + 0.7, spitPos.z + 0.25));
  backSign('Донер', spitPos.x, '#ffb38a');
  block(spitPos.x - 0.18, spitPos.x + 0.18, spitPos.z - 0.27, spitPos.z + 0.13, T, T + 0.62);

  // ---------- Свободные места на стойках ----------
  slots.push(new Slot('counter', new THREE.Vector3(1.48, T, -1.12)));
  slots.push(new Slot('counter', new THREE.Vector3(1.48, T, -1.36)));

  // ---------- Ящики с продуктами (левая стойка, один длинный ряд до стены) ----------
  const spawners: Spawner[] = [];
  const crates: [ItemKind, string, string][] = [
    ['bun', 'Булки', '#ffd58a'],
    ['patty', 'Котлеты', '#ffb3c0'],
    ['lettuce', 'Салат', '#b8f08f'],
    ['tomato', 'Помидоры', '#ff9a8a'],
    ['cheese', 'Сыр', '#ffe27a'],
    ['potato', 'Картошка', '#e8c49a'],
    ['chicken', 'Курица', '#ffc9c0'],
    ['dough', 'Тесто', '#fff1d6'],
    ['lavash', 'Лаваш', '#f6e3b8'],
  ];
  const cw = 0.48;
  const cd = 0.34;
  const ch = 0.11;
  const cx = ROOM.minX + 0.02 + cw / 2;
  crates.forEach(([kind, label, fill], i) => {
    const z = -0.68 + i * 0.38;
    b.box(cw, 0.02, cd, PALETTE.crate, cx, T + 0.01, z, 0, true);
    b.box(cw, ch, 0.022, PALETTE.crate, cx, T + ch / 2, z - cd / 2, 0, true);
    b.box(cw, ch, 0.022, PALETTE.crate, cx, T + ch / 2, z + cd / 2, 0, true);
    b.box(0.022, ch, cd, PALETTE.crate, cx - cw / 2, T + ch / 2, z, 0, true);
    b.box(0.022, ch, cd, PALETTE.crate, cx + cw / 2, T + ch / 2, z, 0, true);
    // В ящике лежат ровно такие же продукты, какие окажутся в руке.
    for (let j = 0; j < 4; j++) {
      const it = new Item(kind);
      it.root.position.set(cx + ((j % 2) - 0.5) * 0.17, T + 0.02 + (j % 3) * 0.015, z + (Math.floor(j / 2) - 0.5) * 0.13);
      it.root.rotation.y = j * 1.3 + i;
      b.addObject(it.root, false);
    }
    const box = new THREE.Box3(new THREE.Vector3(cx - cw / 2 - 0.03, T, z - cd / 2 - 0.03), new THREE.Vector3(cx + cw / 2 + 0.03, T + 0.32, z + cd / 2 + 0.03));
    spawners.push({ kind, box, spawnPos: new THREE.Vector3(cx, T + 0.2, z) });
    surfaces.push({ minX: cx - cw / 2, maxX: cx + cw / 2, minZ: z - cd / 2, maxZ: z + cd / 2, top: T + 0.1 });
    block(cx - cw / 2, cx + cw / 2, z - cd / 2, z + cd / 2, T, T + ch);
    addSign(label, 0.28, -1.19, T - 0.15, z, Math.PI / 2, fill);
  });

  // ---------- Окно выдачи (правая стойка) ----------
  const serveZ = -0.52;
  const serveX = 1.45;
  b.box(0.42, 0.02, 0.42, PALETTE.steel, serveX, T + 0.01, serveZ, 0, true);
  b.box(0.08, 1.0, 0.08, PALETTE.bell, ROOM.maxX - 0.04, T + 0.5, serveZ - 0.3, 0, true);
  b.box(0.08, 1.0, 0.08, PALETTE.bell, ROOM.maxX - 0.04, T + 0.5, serveZ + 0.3, 0, true);
  b.box(0.1, 0.08, 0.7, PALETTE.bell, ROOM.maxX - 0.04, T + 1.02, serveZ, 0, true);
  b.box(0.02, 0.92, 0.52, PALETTE.window, ROOM.maxX - 0.005, T + 0.5, serveZ, 0, false);
  surfaces.push({ minX: serveX - 0.21, maxX: serveX + 0.21, minZ: serveZ - 0.21, maxZ: serveZ + 0.21, top: T + 0.02 });
  const serve = new Slot('serve', new THREE.Vector3(serveX, T + 0.02, serveZ));
  slots.push(serve);
  addSign('ВЫДАЧА', 0.36, ROOM.maxX - 0.1, T + 1.02, serveZ, -Math.PI / 2, '#ffd23f');
  // логотип ресторана над окном выдачи
  const logo = makeLogo(0.62);
  logo.position.set(ROOM.maxX - 0.012, T + 1.48, serveZ);
  logo.rotation.y = -Math.PI / 2;
  signs.push(logo);
  const bell = new THREE.Group();
  const bellBase = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.015, 14), toon(PALETTE.steelDark));
  const bellDome = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(PALETTE.bell));
  bellDome.position.y = 0.008;
  bell.add(bellBase, bellDome);
  bell.position.set(1.36, T + 0.008, serveZ - 0.3);
  root.add(bell);

  // ---------- Тарелки ----------
  const plateStackPos = new THREE.Vector3(1.48, T, 0.08);
  for (let i = 0; i < 5; i++) {
    if (!place('plate', plateStackPos.x, T + i * 0.022, plateStackPos.z, i * 0.4, { size: 0.24 })) {
      b.add(new THREE.CylinderGeometry(0.12, 0.09, 0.018, 20), PALETTE.plate, new THREE.Matrix4().makeTranslation(plateStackPos.x, T + 0.009 + i * 0.022, plateStackPos.z), true);
    }
  }
  block(plateStackPos.x - 0.12, plateStackPos.x + 0.12, plateStackPos.z - 0.12, plateStackPos.z + 0.12, T, T + 0.11);
  spawners.push({
    kind: 'plate',
    box: new THREE.Box3(new THREE.Vector3(plateStackPos.x - 0.16, T, plateStackPos.z - 0.16), new THREE.Vector3(plateStackPos.x + 0.16, T + 0.25, plateStackPos.z + 0.16)),
    spawnPos: new THREE.Vector3(plateStackPos.x, T + 0.12, plateStackPos.z),
  });
  surfaces.push({ minX: plateStackPos.x - 0.12, maxX: plateStackPos.x + 0.12, minZ: plateStackPos.z - 0.12, maxZ: plateStackPos.z + 0.12, top: T + 0.11 });
  addSign('Тарелки', 0.3, 1.19, T - 0.15, plateStackPos.z, -Math.PI / 2, '#d8f0ff');

  // ---------- Печь для пиццы ----------
  const ovenX = 1.52;
  const ovenZ = 0.78;
  const oh = 0.42; // высота
  const ow = 0.5; // ширина (по z)
  const od = 0.5; // глубина (по x)
  b.box(od, 0.05, ow, PALETTE.oven, ovenX, T + 0.025, ovenZ, 0, true); // дно
  b.box(od, 0.06, ow, PALETTE.oven, ovenX, T + oh - 0.03, ovenZ, 0, true); // крыша
  const wallH = oh - 0.11; // стенки между дном и крышей, без перекрытий
  const wallY = T + 0.05 + wallH / 2;
  b.box(od, wallH, 0.05, PALETTE.oven, ovenX, wallY, ovenZ - ow / 2 + 0.025, 0, true);
  b.box(od, wallH, 0.05, PALETTE.oven, ovenX, wallY, ovenZ + ow / 2 - 0.025, 0, true);
  b.box(0.05, wallH, ow - 0.1, PALETTE.oven, ovenX + od / 2 - 0.025, wallY, ovenZ, 0, true);
  b.add(new THREE.CylinderGeometry(0.05, 0.06, 0.25, 10), PALETTE.ovenDark, new THREE.Matrix4().makeTranslation(ovenX + 0.1, T + oh + 0.12, ovenZ), true); // труба
  const ovenGlow = new THREE.Mesh(new THREE.PlaneGeometry(ow - 0.1, oh - 0.12), new THREE.MeshBasicMaterial({ color: 0x3a2b3e, toneMapped: false }));
  ovenGlow.rotation.y = -Math.PI / 2;
  ovenGlow.position.set(ovenX + od / 2 - 0.055, T + oh / 2, ovenZ);
  root.add(ovenGlow);
  const oven = new Slot('oven', new THREE.Vector3(ovenX - 0.02, T + 0.05, ovenZ));
  slots.push(oven);
  surfaces.push({ minX: ovenX - od / 2, maxX: ovenX + od / 2, minZ: ovenZ - ow / 2, maxZ: ovenZ + ow / 2, top: T + oh });
  // дно печи: брошенное внутрь ложится на него, а не проваливается
  surfaces.push({ minX: ovenX - od / 2, maxX: ovenX + od / 2, minZ: ovenZ - ow / 2, maxZ: ovenZ + ow / 2, top: T + 0.05 });
  addSign('Печь', 0.26, 1.19, T - 0.15, ovenZ, -Math.PI / 2, '#ffb3a8');
  // стенки печи твёрдые, спереди — открытый проём
  block(ovenX - od / 2, ovenX + od / 2, ovenZ - ow / 2, ovenZ - ow / 2 + 0.05, T, T + oh);
  block(ovenX - od / 2, ovenX + od / 2, ovenZ + ow / 2 - 0.05, ovenZ + ow / 2, T, T + oh);
  block(ovenX + od / 2 - 0.05, ovenX + od / 2, ovenZ - ow / 2, ovenZ + ow / 2, T, T + oh);
  block(ovenX - od / 2, ovenX + od / 2, ovenZ - ow / 2, ovenZ + ow / 2, T, T + 0.05); // дно

  // ---------- Мусорка (в правом дальнем углу) ----------
  const trashPos = new THREE.Vector3(1.5, 0, ROOM.maxZ - 0.3);
  const binH = 0.72;
  // открытый бак: сразу видно, куда бросать
  b.add(new THREE.CylinderGeometry(0.2, 0.17, binH, 16, 1, true), PALETTE.bin, new THREE.Matrix4().makeTranslation(trashPos.x, binH / 2, trashPos.z), true);
  b.add(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 16), PALETTE.ink, new THREE.Matrix4().makeTranslation(trashPos.x, 0.05, trashPos.z), false);
  const rim = new THREE.TorusGeometry(0.2, 0.018, 6, 20);
  rim.rotateX(Math.PI / 2);
  b.add(rim, PALETTE.bin, new THREE.Matrix4().makeTranslation(trashPos.x, binH, trashPos.z), false);
  const trashSign = makeSign('Мусор', 0.26, '#b8f08f');
  trashSign.position.set(trashPos.x - 0.23, 0.45, trashPos.z);
  trashSign.rotation.y = -Math.PI / 2;
  signs.push(trashSign);

  // ---------- Декор ----------
  // окно на задней (открытой) стене
  const winZ = ROOM.maxZ - 0.01;
  b.box(1.2, 0.9, 0.04, PALETTE.wallTrim, 0, 1.75, winZ, 0, true);
  b.box(1.08, 0.78, 0.02, 0xc8f0ff, 0, 1.75, winZ - 0.02, 0, false);
  b.box(0.04, 0.78, 0.03, PALETTE.wallTrim, 0, 1.75, winZ - 0.03, 0, false);
  b.box(1.08, 0.04, 0.03, PALETTE.wallTrim, 0, 1.75, winZ - 0.03, 0, false);
  // полки на задней стене с банками и кастрюлями
  b.box(0.9, 0.04, 0.22, PALETTE.wood, -1.1, 2.3, ROOM.minZ + 0.11, 0, true);
  b.box(0.9, 0.04, 0.22, PALETTE.wood, 1.2, 2.3, ROOM.minZ + 0.11, 0, true);
  surfaces.push({ minX: -1.55, maxX: -0.65, minZ: ROOM.minZ, maxZ: ROOM.minZ + 0.22, top: 2.32 });
  surfaces.push({ minX: 0.75, maxX: 1.65, minZ: ROOM.minZ, maxZ: ROOM.minZ + 0.22, top: 2.32 });
  const shelfY = 2.32;
  const sz = ROOM.minZ + 0.11;
  const shelfDecor: [ModelName, number, ModelOptions][] = [
    ['bottle-ketchup', -1.45, { size: 0.07 }],
    ['bottle-musterd', -1.33, { size: 0.07 }],
    ['bottle-oil', -1.18, { size: 0.08 }],
    ['honey', -1.02, { size: 0.09 }],
    ['can', -0.86, { size: 0.08 }],
    ['can', -0.75, { size: 0.08 }],
    ['pot', 0.92, { size: 0.24 }],
    ['pot-stew', 1.2, { size: 0.22 }],
    ['loaf-round', 1.47, { size: 0.18 }],
  ];
  let decorOk = true;
  for (const [name, x, o] of shelfDecor) decorOk = place(name, x, shelfY, sz, 0, o) && decorOk;
  const jarColors = [0xff5a3c, 0xffd23f, 0x6ccf4a, 0x7fd6ff, 0xc77dff];
  for (let i = 0; i < 5 && !decorOk; i++) {
    const g = new THREE.CylinderGeometry(0.06, 0.06, 0.14 + (i % 2) * 0.05, 10);
    b.add(g, jarColors[i], new THREE.Matrix4().makeTranslation(-1.45 + i * 0.18, 2.39 + (i % 2) * 0.025, ROOM.minZ + 0.11), true);
  }
  for (let i = 0; i < 3 && !decorOk; i++) {
    const g = new THREE.CylinderGeometry(0.11, 0.1, 0.15, 14);
    b.add(g, PALETTE.steel, new THREE.Matrix4().makeTranslation(0.92 + i * 0.28, 2.395, ROOM.minZ + 0.11), true);
  }
  // висящая лампа
  b.box(0.02, 0.5, 0.02, PALETTE.ink, 0, ROOM.height - 0.25, 0.4, 0, false);
  const shade = new THREE.ConeGeometry(0.25, 0.22, 16, 1, true);
  b.add(shade, 0xffd23f, new THREE.Matrix4().makeTranslation(0, ROOM.height - 0.55, 0.4), true);
  b.add(new THREE.SphereGeometry(0.08, 12, 8), 0xfffbe0, new THREE.Matrix4().makeTranslation(0, ROOM.height - 0.66, 0.4), false);
  const clock = new THREE.CylinderGeometry(0.16, 0.16, 0.03, 20);
  clock.rotateZ(Math.PI / 2);
  b.add(clock, 0xffffff, new THREE.Matrix4().makeTranslation(ROOM.maxX - 0.02, 2.05, 1.2), true);

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
    solids,
    slots,
    spawners,
    boards,
    boardBoxes,
    pans,
    burners,
    fryers,
    oil,
    oven,
    ovenGlow,
    spit: { box: spitBox, tray, meat, pos: spitPos },
    serve,
    knifeSlots,
    pinSlots,
    trash: { pos: trashPos, radius: 0.2, top: binH },
    plateStackPos,
    orderBoardPos: new THREE.Vector3(0.3, 1.8, ROOM.minZ + 0.02),
    hudPos: new THREE.Vector3(-1.2, 1.8, ROOM.minZ + 0.02),
    bell,
    aimTargets,
  };
}
