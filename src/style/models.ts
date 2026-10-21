import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { outlineGeometry, outlineMaterial, toonGradient } from './toon';

/**
 * Модели Kenney (Food Kit, лицензия CC0).
 * Загружаются один раз при старте, дальше из кеша выдаются копии
 * с мультяшными материалами и обводкой, как у остальной игры.
 */

const FOOD = [
  'burger',
  'meat-patty',
  'cabbage',
  'tomato',
  'tomato-slice',
  'cheese',
  'cheese-cut',
  'pizza',
  'fries',
  'plate',
  'cooking-knife',
  'cutting-board',
  'frying-pan',
  'pot',
  'pot-stew',
  'bottle-ketchup',
  'bottle-musterd',
  'bottle-oil',
  'honey',
  'can',
  'loaf-round',
  'rollingPin',
  'turkey',
  'egg',
  'cutting-board-round',
  'bacon',
  'celery-stick',
] as const;

export type ModelName = (typeof FOOD)[number];

const cache = new Map<string, THREE.Object3D>();
const toonCache = new Map<THREE.Material, THREE.MeshToonMaterial>();

function toToon(src: THREE.Material): THREE.MeshToonMaterial {
  let m = toonCache.get(src);
  if (m) return m;
  const s = src as THREE.MeshStandardMaterial;
  m = new THREE.MeshToonMaterial({
    color: s.color ? s.color.clone() : new THREE.Color(0xffffff),
    map: s.map ?? null,
    gradientMap: toonGradient(),
    transparent: s.transparent || s.opacity < 1,
    opacity: s.opacity,
  });
  if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
  toonCache.set(src, m);
  return m;
}

export async function loadModels(onProgress?: (done: number, total: number) => void): Promise<void> {
  const loader = new GLTFLoader();
  const base = import.meta.env.BASE_URL + 'models/';
  const jobs: [string, string][] = [
    ...FOOD.map((n) => [n, `${base}food/${n}.glb`] as [string, string]),
  ];
  let done = 0;
  await Promise.all(
    jobs.map(async ([name, url]) => {
      try {
        const gltf = await loader.loadAsync(url);
        gltf.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) mesh.material = Array.isArray(mesh.material) ? mesh.material.map(toToon) : toToon(mesh.material);
        });
        cache.set(name, gltf.scene);
      } catch (e) {
        console.warn('Не удалось загрузить модель', name, e);
      }
      onProgress?.(++done, jobs.length);
    }),
  );
}

export function hasModel(name: ModelName): boolean {
  return cache.has(name);
}

export interface ModelOptions {
  /** Желаемый размер по самой длинной горизонтальной стороне, м. */
  size?: number;
  /** Или точный масштаб. */
  scale?: number;
  /** Толщина обводки (0 — без обводки). */
  outline?: number;
  /** Взять только узел с таким именем (например «bun-top» из бургера). */
  node?: string;
  /** Поставить на пол (низ модели в y=0) и отцентровать по x/z. */
  center?: boolean;
  /** Растянуть по осям после масштаба (например, сплющить по высоте). */
  stretch?: [number, number, number];
  /** Своя копия материалов (чтобы подсвечивать предмет отдельно). */
  material?: (m: THREE.MeshToonMaterial) => THREE.Material;
}

/** Копия модели. Если модель не загрузилась — пустая группа (игра не падает). */
export function model(name: ModelName, opts: ModelOptions = {}): THREE.Group {
  const out = new THREE.Group();
  const src = cache.get(name);
  if (!src) return out;
  let part: THREE.Object3D = src;
  if (opts.node) {
    const n = src.getObjectByName(opts.node);
    if (!n) return out;
    part = n;
  }
  const obj = part.clone(true);
  if (opts.node) obj.position.set(0, 0, 0);
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (opts.material) {
      const conv = (m: THREE.Material) => opts.material!(m as THREE.MeshToonMaterial);
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material);
    }
    mesh.raycast = THREE.Mesh.prototype.raycast;
  });
  const holder = new THREE.Group();
  holder.add(obj);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  const sz = box.getSize(new THREE.Vector3());
  const scale = opts.scale ?? (opts.size ? opts.size / Math.max(sz.x, sz.z, 1e-6) : 1);
  holder.scale.setScalar(scale);
  if (opts.stretch) holder.scale.multiply(new THREE.Vector3(...opts.stretch));
  if (opts.center !== false) {
    const c = box.getCenter(new THREE.Vector3());
    obj.position.x -= c.x;
    obj.position.z -= c.z;
    obj.position.y -= box.min.y;
  }
  const outline = opts.outline ?? 0.005;
  if (outline > 0) {
    holder.updateMatrixWorld(true);
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.outline) return;
      // обводка в мировых единицах: делим на масштаб модели
      const ol = new THREE.Mesh(outlineGeometry(mesh.geometry), outlineMaterial(outline / scale / Math.max(1e-6, mesh.scale.x)));
      ol.userData.outline = true;
      ol.raycast = () => {};
      mesh.add(ol);
    });
  }
  out.add(holder);
  return out;
}
