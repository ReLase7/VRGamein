import * as THREE from 'three';
import { Hand } from './hand';
import { PLAY_AREA } from '../world/kitchen';

/** Управление на ПК: мышь + WASD, указатель захвачен (pointer lock). */
export class DesktopControls {
  readonly hand = new Hand('mouse', false);
  yaw = 0;
  pitch = -0.25;
  readonly position = new THREE.Vector3(0, 1.6, 0.7);
  private keys = new Set<string>();
  private pendingClick = false;
  private pendingThrow = false;
  locked = false;
  enabled = true;
  onLockChange: (locked: boolean) => void = () => {};
  onPauseKey: () => void = () => {};

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly dom: HTMLElement,
  ) {
    document.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyQ' && this.locked) this.pendingThrow = true;
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked) {
        this.lock();
        return;
      }
      if (e.button === 0) this.pendingClick = true;
      if (e.button === 2) this.pendingThrow = true;
    });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch -= e.movementY * 0.0022;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      this.onLockChange(this.locked);
    });
  }

  lock(): void {
    const p = this.dom.requestPointerLock() as unknown as Promise<void> | undefined;
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  unlock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  update(dt: number): void {
    const h = this.hand;
    h.resetEdges();
    if (!this.enabled) return;

    // движение
    const f = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    const r = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    if (this.locked && (f || r)) {
      const speed = 2.2;
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      this.position.x += (-sin * f + cos * r) * speed * dt;
      this.position.z += (-cos * f - sin * r) * speed * dt;
      this.position.x = Math.max(PLAY_AREA.minX, Math.min(PLAY_AREA.maxX, this.position.x));
      this.position.z = Math.max(PLAY_AREA.minZ, Math.min(PLAY_AREA.maxZ, this.position.z));
    }

    this.camera.position.copy(this.position);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();

    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    h.ray.set(this.camera.position.clone(), dir);

    h.use = this.locked && (this.keys.has('KeyE') || this.keys.has('Space'));
    if (this.pendingClick) {
      h.click = true;
      if (h.held) h.release = true;
      else h.grab = true;
    }
    if (this.pendingThrow && h.held) {
      h.throw = true;
      h.release = true;
    }
    this.pendingClick = false;
    this.pendingThrow = false;
  }

  /** Куда «держит» предмет игрок на ПК: чуть ниже и правее центра экрана. */
  holdPoint(out: THREE.Vector3): THREE.Vector3 {
    out.set(0.16, -0.18, -0.5).applyQuaternion(this.camera.quaternion).add(this.camera.position);
    return out;
  }
}
