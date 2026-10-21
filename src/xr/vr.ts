import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { Hand } from '../input/hand';
import { PLAY_AREA } from '../world/kitchen';

interface Ctrl {
  target: THREE.XRTargetRaySpace;
  grip: THREE.XRGripSpace;
  source: XRInputSource | null;
  hand: Hand | null;
  rayLine: THREE.Line;
  prevButtons: boolean[];
}

const WALK_SPEED = 1.6; // м/с
const DEADZONE = 0.15;

/** VR: контроллеры, захват по grip, ходьба левым стиком, поворот рывками правым. */
export class VRControls {
  readonly left = new Hand('left', true);
  readonly right = new Hand('right', true);
  private ctrls: Ctrl[] = [];
  private turnReady = true;
  snapAngle = 45;
  uiVisible = false;
  onPause: () => void = () => {};
  /** Нажата A/X — «главная» кнопка меню. */
  onPrimary: () => void = () => {};

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly rig: THREE.Group,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    const factory = new XRControllerModelFactory();
    for (let i = 0; i < 2; i++) {
      const target = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      grip.add(factory.createControllerModel(grip));
      // маленькая «ладонь» — видно, где хватает рука
      const palm = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
      grip.add(palm);
      const rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
      const rayLine = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({ color: 0xffffff }));
      rayLine.visible = false;
      target.add(rayLine);
      rig.add(target, grip);
      const c: Ctrl = { target, grip, source: null, hand: null, rayLine, prevButtons: [] };
      target.addEventListener('connected', (e) => {
        const src = (e as unknown as { data: XRInputSource }).data;
        c.source = src;
        c.hand = src.handedness === 'left' ? this.left : this.right;
        c.hand.pulse = (intensity, ms) => {
          const gp = src.gamepad as (Gamepad & { hapticActuators?: { pulse: (v: number, d: number) => void }[] }) | undefined;
          try {
            gp?.hapticActuators?.[0]?.pulse(intensity, ms);
          } catch {
            /* нет вибрации — не страшно */
          }
        };
      });
      target.addEventListener('disconnected', () => {
        c.source = null;
        c.hand = null;
      });
      this.ctrls.push(c);
    }
  }

  get hands(): Hand[] {
    return [this.left, this.right];
  }

  /** Показать луч руки длиной len (null — спрятать). В меню луч виден всегда. */
  setRay(hand: Hand, len: number | null): void {
    const c = this.ctrls.find((x) => x.hand === hand);
    if (!c) return;
    if (this.uiVisible) len = len ?? 2;
    c.rayLine.visible = len !== null;
    if (len !== null) c.rayLine.scale.z = len;
  }

  update(dt: number, time: number): void {
    this.left.resetEdges();
    this.right.resetEdges();
    let leftStick = new THREE.Vector2();
    let rightStick = new THREE.Vector2();

    for (const c of this.ctrls) {
      if (!c.source || !c.hand) continue;
      const h = c.hand;
      const p = new THREE.Vector3();
      c.grip.getWorldPosition(p);
      h.track(p, time);
      c.grip.getWorldQuaternion(h.quat);
      // луч
      const origin = new THREE.Vector3();
      c.target.getWorldPosition(origin);
      const q = new THREE.Quaternion();
      c.target.getWorldQuaternion(q);
      h.ray.set(origin, new THREE.Vector3(0, 0, -1).applyQuaternion(q));

      const gp = c.source.gamepad;
      if (!gp) continue;
      const pressed = gp.buttons.map((b) => b.pressed);
      const was = (i: number) => c.prevButtons[i] ?? false;
      const now = (i: number) => pressed[i] ?? false;
      // 0 — курок, 1 — grip, 4 — A/X, 5 — B/Y
      if (now(1) && !was(1)) h.grab = true;
      if (!now(1) && was(1)) h.release = true;
      h.use = now(0);
      if (now(0) && !was(0)) h.click = true;
      if (now(4) && !was(4)) this.onPrimary();
      if (now(5) && !was(5)) this.onPause();
      c.prevButtons = pressed;

      const ax = gp.axes.length >= 4 ? new THREE.Vector2(gp.axes[2], gp.axes[3]) : new THREE.Vector2(gp.axes[0] ?? 0, gp.axes[1] ?? 0);
      if (h === this.left) leftStick = ax;
      else rightStick = ax;
    }

    this.updateWalk(leftStick, dt);
    this.updateTurn(rightStick);
  }

  /** Плавная ходьба туда, куда смотрит голова. */
  private updateWalk(stick: THREE.Vector2, dt: number): void {
    const len = stick.length();
    if (len < DEADZONE) return;
    const k = Math.min(1, (len - DEADZONE) / (1 - DEADZONE)) / len;
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) return;
    fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const move = new THREE.Vector3()
      .addScaledVector(fwd, -stick.y * k)
      .addScaledVector(right, stick.x * k)
      .multiplyScalar(WALK_SPEED * dt);
    const head = new THREE.Vector3();
    this.camera.getWorldPosition(head);
    // не даём уйти в стойки и стены: ограничиваем положение головы
    const nx = Math.max(PLAY_AREA.minX, Math.min(PLAY_AREA.maxX, head.x + move.x));
    const nz = Math.max(PLAY_AREA.minZ, Math.min(PLAY_AREA.maxZ, head.z + move.z));
    this.rig.position.x += nx - Math.max(PLAY_AREA.minX, Math.min(PLAY_AREA.maxX, head.x));
    this.rig.position.z += nz - Math.max(PLAY_AREA.minZ, Math.min(PLAY_AREA.maxZ, head.z));
  }

  private updateTurn(stick: THREE.Vector2): void {
    if (Math.abs(stick.x) < 0.3) {
      this.turnReady = true;
      return;
    }
    if (!this.turnReady || Math.abs(stick.x) < 0.7) return;
    this.turnReady = false;
    const angle = (-Math.sign(stick.x) * this.snapAngle * Math.PI) / 180;
    const head = new THREE.Vector3();
    this.camera.getWorldPosition(head);
    // вращаем «риг» вокруг головы игрока
    const offset = this.rig.position.clone().sub(head);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    this.rig.position.copy(head).add(offset);
    this.rig.position.y = 0;
    this.rig.rotation.y += angle;
  }

  /** Сбрасывает положение игрока в центр кухни. */
  reset(): void {
    this.rig.position.set(0, 0, 0.35);
    this.rig.rotation.set(0, 0, 0);
  }
}
