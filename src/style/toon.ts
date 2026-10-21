import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Цветовая палитра игры. */
export const PALETTE = {
  ink: 0x2b1d3a,
  floorA: 0xffe6b3,
  floorB: 0xf7c97e,
  wall: 0x9fe0d0,
  wallTrim: 0x5fb8a8,
  counter: 0xff8a5c,
  counterTop: 0xfff1d6,
  counterDark: 0xd9653f,
  steel: 0xb8c4d6,
  steelDark: 0x6d7a90,
  wood: 0xc98a4b,
  woodLight: 0xe8b67a,
  crate: 0xb5763c,
  plate: 0xffffff,
  bunTop: 0xe9a24d,
  bunBottom: 0xf2c27a,
  pattyRaw: 0xf28b9a,
  pattyCooked: 0x8a4b2a,
  pattyBurnt: 0x2a2224,
  lettuce: 0x6ccf4a,
  lettuceDark: 0x3f9a2e,
  tomato: 0xf2463c,
  tomatoInner: 0xff8a6a,
  stem: 0x3f9a2e,
  stove: 0x45475e,
  burner: 0xff6b3d,
  window: 0x7fd6ff,
  bin: 0x4a9e6b,
  bell: 0xffd23f,
  sky: 0x8fd3ff,
};

let gradientMap: THREE.DataTexture | null = null;

/** Трёхступенчатая карта освещения — даёт «мультяшные» резкие тени. */
function getGradientMap(): THREE.DataTexture {
  if (gradientMap) return gradientMap;
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  gradientMap = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.generateMipmaps = false;
  gradientMap.needsUpdate = true;
  return gradientMap;
}

const toonCache = new Map<number, THREE.MeshToonMaterial>();

/** Общий (кешированный) toon-материал. Не менять у него параметры! */
export function toon(color: number): THREE.MeshToonMaterial {
  let m = toonCache.get(color);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: getGradientMap() });
    toonCache.set(color, m);
  }
  return m;
}

/** Отдельный toon-материал (можно подсвечивать emissive). */
export function toonUnique(color: number): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: getGradientMap() });
}

const outlineMaterials = new Map<number, THREE.ShaderMaterial>();

/**
 * Материал обводки: вершины выдавливаются по нормали, рисуются только задние грани.
 * Это классический приём «вывернутой геометрии» без пост-обработки.
 */
export function outlineMaterial(thickness: number): THREE.ShaderMaterial {
  const key = Math.round(thickness * 10000);
  let m = outlineMaterials.get(key);
  if (!m) {
    m = new THREE.ShaderMaterial({
      uniforms: { thickness: { value: thickness }, color: { value: new THREE.Color(PALETTE.ink) } },
      vertexShader: /* glsl */ `
        uniform float thickness;
        void main() {
          vec3 p = position + normal * thickness;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        void main() { gl_FragColor = vec4(color, 1.0); }`,
      side: THREE.BackSide,
    });
    outlineMaterials.set(key, m);
  }
  return m;
}

/** Геометрия для обводки: сглаженные нормали, чтобы на углах не было разрывов. */
export function outlineGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.clone();
  g.deleteAttribute('normal');
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  if (g.getAttribute('uv1')) g.deleteAttribute('uv1');
  const merged = mergeVertices(g, 1e-4);
  merged.computeVertexNormals();
  return merged;
}

/** Меш с toon-материалом и обводкой (обводка — дочерний объект). */
export function toonMesh(
  geo: THREE.BufferGeometry,
  material: THREE.Material,
  outline = 0.006,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, material);
  if (outline > 0) {
    const o = new THREE.Mesh(outlineGeometry(geo), outlineMaterial(outline));
    o.raycast = () => {};
    mesh.add(o);
  }
  return mesh;
}

/**
 * Собирает статическую геометрию: все куски одного цвета сливаются в один меш,
 * все обводки — в один меш. Так кухня рисуется за ~15 draw calls.
 */
export class StaticBatcher {
  private byColor = new Map<number, THREE.BufferGeometry[]>();
  private outlines: THREE.BufferGeometry[] = [];

  add(geo: THREE.BufferGeometry, color: number, matrix: THREE.Matrix4, outline = true): void {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(matrix);
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    const list = this.byColor.get(color) ?? [];
    list.push(g);
    this.byColor.set(color, list);
    if (outline) {
      const og = outlineGeometry(geo);
      og.applyMatrix4(matrix);
      this.outlines.push(og.index ? og.toNonIndexed() : og);
    }
  }

  box(w: number, h: number, d: number, color: number, x: number, y: number, z: number, rotY = 0, outline = true): void {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
      new THREE.Vector3(1, 1, 1),
    );
    this.add(new THREE.BoxGeometry(w, h, d), color, m, outline);
  }

  build(outlineThickness = 0.012): THREE.Group {
    const group = new THREE.Group();
    for (const [color, geos] of this.byColor) {
      const merged = mergeList(geos);
      const mesh = new THREE.Mesh(merged, toon(color));
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    if (this.outlines.length) {
      const merged = mergeList(this.outlines);
      const mesh = new THREE.Mesh(merged, outlineMaterial(outlineThickness));
      mesh.matrixAutoUpdate = false;
      mesh.raycast = () => {};
      group.add(mesh);
    }
    return group;
  }
}

function mergeList(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Простое слияние неиндексированных геометрий с position+normal.
  let count = 0;
  for (const g of geos) count += g.getAttribute('position').count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let off = 0;
  for (const g of geos) {
    const ng = g.index ? g.toNonIndexed() : g;
    const p = ng.getAttribute('position');
    const n = ng.getAttribute('normal');
    pos.set(p.array as Float32Array, off * 3);
    if (n) nor.set(n.array as Float32Array, off * 3);
    off += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}
