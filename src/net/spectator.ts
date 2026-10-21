import * as THREE from 'three';
import type { Avatar } from './avatar';

/**
 * Камера зрителя на ПК.
 *  1 — общий план кухни сверху (медленно «дышит»)
 *  2 — за спиной первого игрока
 *  3 — за спиной второго игрока
 * Колесо мыши — приблизить/отдалить общий план.
 */
export class SpectatorCam {
  mode = 0;
  private zoom = 0;
  private pos = new THREE.Vector3(0, 2.5, 2.5);
  private look = new THREE.Vector3(0, 1.0, -0.3);
  private t = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly avatars: Avatar[],
  ) {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.code === 'Digit1') this.mode = 0;
      if (e.code === 'Digit2') this.mode = 1;
      if (e.code === 'Digit3') this.mode = 2;
    });
    window.addEventListener('wheel', (e) => {
      if (this.enabled) this.zoom = THREE.MathUtils.clamp(this.zoom + Math.sign(e.deltaY) * 0.15, -0.6, 0.6);
    });
  }

  enabled = false;

  cycle(): void {
    this.mode = (this.mode + 1) % 3;
  }

  update(dt: number): void {
    this.t += dt;
    const wantPos = new THREE.Vector3();
    const wantLook = new THREE.Vector3();
    const av = this.mode > 0 ? this.avatars[this.mode - 1] : null;
    this.avatars.forEach((a) => a.setHeadVisible(a !== av));
    if (av && av.group.visible) {
      // чуть выше и позади головы игрока (саму голову прячем), смотрим туда же, куда он
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(av.headQuat);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
      fwd.normalize();
      wantPos.copy(av.headPos).addScaledVector(fwd, -0.3).add(new THREE.Vector3(0, 0.2, 0));
      wantLook.copy(av.headPos).addScaledVector(fwd, 1.2).add(new THREE.Vector3(0, -0.5, 0));
    } else {
      wantPos.set(Math.sin(this.t * 0.15) * 0.35, 2.45 - this.zoom * 0.5, 2.45 - this.zoom);
      wantLook.set(0, 0.95, -0.35);
    }
    const k = 1 - Math.exp(-dt * 4);
    this.pos.lerp(wantPos, k);
    this.look.lerp(wantLook, k);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    this.camera.updateMatrixWorld();
  }
}
