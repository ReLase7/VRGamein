import * as THREE from 'three';
import { toonUnique } from '../style/toon';

interface P {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  grow: number;
  gravity: number;
  color: THREE.Color;
}

/** Все частицы (пар, дым, брызги, конфетти) — один InstancedMesh, один draw call. */
export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private list: P[] = [];
  private readonly max = 320;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();

  constructor() {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = toonUnique(0xffffff);
    this.mesh = new THREE.InstancedMesh(geo, mat, this.max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  spawn(pos: THREE.Vector3, opts: { vel?: THREE.Vector3; spread?: number; life?: number; size?: number; grow?: number; gravity?: number; color?: number; count?: number }): void {
    const count = opts.count ?? 1;
    for (let i = 0; i < count; i++) {
      if (this.list.length >= this.max) this.list.shift();
      const spread = opts.spread ?? 0.3;
      const v = (opts.vel ?? new THREE.Vector3()).clone();
      v.x += (Math.random() - 0.5) * spread;
      v.y += (Math.random() - 0.5) * spread;
      v.z += (Math.random() - 0.5) * spread;
      const life = (opts.life ?? 1) * (0.7 + Math.random() * 0.6);
      this.list.push({
        pos: pos.clone(),
        vel: v,
        life,
        max: life,
        size: (opts.size ?? 0.02) * (0.7 + Math.random() * 0.6),
        grow: opts.grow ?? 0,
        gravity: opts.gravity ?? 0,
        color: new THREE.Color(opts.color ?? 0xffffff),
      });
    }
  }

  steam(pos: THREE.Vector3, color = 0xffffff): void {
    this.spawn(pos, { vel: new THREE.Vector3(0, 0.35, 0), spread: 0.12, life: 1.1, size: 0.018, grow: 0.04, color });
  }

  smoke(pos: THREE.Vector3): void {
    this.spawn(pos, { vel: new THREE.Vector3(0, 0.45, 0), spread: 0.15, life: 1.6, size: 0.025, grow: 0.06, color: 0x2a2224 });
  }

  splash(pos: THREE.Vector3, color: number): void {
    this.spawn(pos, { vel: new THREE.Vector3(0, 0.9, 0), spread: 1.4, life: 0.5, size: 0.012, gravity: -6, color, count: 7 });
  }

  confetti(pos: THREE.Vector3): void {
    const colors = [0xff5a3c, 0xffd23f, 0x6ccf4a, 0x7fd6ff, 0xc77dff];
    for (const c of colors) this.spawn(pos, { vel: new THREE.Vector3(0, 2.2, 0), spread: 2.2, life: 1.2, size: 0.018, gravity: -5, color: c, count: 5 });
  }

  puff(pos: THREE.Vector3, color = 0xffffff): void {
    this.spawn(pos, { vel: new THREE.Vector3(0, 0.3, 0), spread: 0.9, life: 0.45, size: 0.025, grow: -0.03, color, count: 8 });
  }

  update(dt: number): void {
    let n = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.list.splice(i, 1);
        continue;
      }
      p.vel.y += p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(1 - dt * 1.2);
      if (p.pos.y < 0.01) {
        p.pos.y = 0.01;
        p.vel.set(0, 0, 0);
      }
    }
    for (const p of this.list) {
      const t = 1 - p.life / p.max;
      const sz = Math.max(0.001, (p.size + p.grow * t) * (t > 0.75 ? (1 - t) * 4 : 1));
      this.s.set(sz, sz, sz);
      this.m.compose(p.pos, this.q, this.s);
      this.mesh.setMatrixAt(n, this.m);
      this.mesh.setColorAt(n, p.color);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear(): void {
    this.list = [];
    this.mesh.count = 0;
  }
}
