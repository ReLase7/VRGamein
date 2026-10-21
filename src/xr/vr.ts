import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { Hand } from '../input/hand';
import { PLAY_AREA } from '../world/kitchen';
import { PALETTE } from '../style/toon';

interface Ctrl {
  index: number;
  target: THREE.XRTargetRaySpace;
  grip: THREE.XRGripSpace;
  source: XRInputSource | null;
  hand: Hand | null;
  rayLine: THREE.Line;
  prevButtons: boolean[];
}

/** VR: контроллеры, захват по grip, телепорт левым стиком, поворот рывками правым. */
export class VRControls {
  readonly left = new Hand('left', true);
  readonly right = new Hand('right', true);
  private ctrls: Ctrl[] = [];
  private teleportArc: THREE.Line;
  private teleportMarker: THREE.Mesh;
  private teleportTarget: THREE.Vector3 | null = null;
  private teleportActive = false;
  private turnReady = true;
  snapAngle = 45;
  uiVisible = false;
  onPause: () => void = () => {};
  onTeleport: () => void = () => {};

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
      rayLine.scale.z = 2;
      rayLine.visible = false;
      target.add(rayLine);
      rig.add(target, grip);
      const c: Ctrl = { index: i, target, grip, source: null, hand: null, rayLine, prevButtons: [] };
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

    // дуга телепорта
    const arcGeo = new THREE.BufferGeometry().setFromPoints(new Array(30).fill(0).map(() => new THREE.Vector3()));
    this.teleportArc = new THREE.Line(arcGeo, new THREE.LineBasicMaterial({ color: 0x7fd6ff }));
    this.teleportArc.frustumCulled = false;
    this.teleportArc.visible = false;
    const ring = new THREE.RingGeometry(0.16, 0.22, 24);
    ring.rotateX(-Math.PI / 2);
    this.teleportMarker = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: PALETTE.window }));
    this.teleportMarker.visible = false;
  }

  get extras(): THREE.Object3D[] {
    return [this.teleportArc, this.teleportMarker];
  }

  get hands(): Hand[] {
    return [this.left, this.right];
  }

  update(time: number): void {
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
      c.rayLine.visible = this.uiVisible;

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
      if (now(5) && !was(5)) this.onPause();
      c.prevButtons = pressed;

      const ax = gp.axes.length >= 4 ? new THREE.Vector2(gp.axes[2], gp.axes[3]) : new THREE.Vector2(gp.axes[0] ?? 0, gp.axes[1] ?? 0);
      if (h === this.left) leftStick = ax;
      else rightStick = ax;
    }

    this.updateTeleport(leftStick);
    this.updateTurn(rightStick);
  }

  private updateTeleport(stick: THREE.Vector2): void {
    const wantArc = stick.y < -0.6 && !this.uiVisible;
    if (wantArc) {
      this.teleportActive = true;
      const lc = this.ctrls.find((c) => c.hand === this.left);
      if (!lc) return;
      const origin = new THREE.Vector3();
      lc.target.getWorldPosition(origin);
      const q = new THREE.Quaternion();
      lc.target.getWorldQuaternion(q);
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      const v = dir.multiplyScalar(5);
      const g = -9.8;
      const pts: THREE.Vector3[] = [];
      let hit: THREE.Vector3 | null = null;
      const p = origin.clone();
      const step = 0.04;
      for (let i = 0; i < 30; i++) {
        pts.push(p.clone());
        if (hit) continue;
        const next = p.clone().addScaledVector(v, step);
        v.y += g * step;
        if (next.y <= 0) {
          const t = p.y / (p.y - next.y);
          hit = p.clone().lerp(next, t);
          hit.y = 0;
          p.copy(hit);
        } else p.copy(next);
      }
      const arr = this.teleportArc.geometry.getAttribute('position') as THREE.BufferAttribute;
      pts.forEach((pt, i) => arr.setXYZ(i, pt.x, pt.y, pt.z));
      arr.needsUpdate = true;
      this.teleportArc.visible = true;
      const valid = hit && hit.x > PLAY_AREA.minX && hit.x < PLAY_AREA.maxX && hit.z > PLAY_AREA.minZ && hit.z < PLAY_AREA.maxZ;
      (this.teleportArc.material as THREE.LineBasicMaterial).color.setHex(valid ? 0x7fd6ff : 0xff5a3c);
      this.teleportTarget = valid && hit ? hit : null;
      this.teleportMarker.visible = !!this.teleportTarget;
      if (this.teleportTarget) this.teleportMarker.position.copy(this.teleportTarget).setY(0.01);
    } else if (this.teleportActive) {
      this.teleportActive = false;
      this.teleportArc.visible = false;
      this.teleportMarker.visible = false;
      if (this.teleportTarget) {
        const head = new THREE.Vector3();
        this.camera.getWorldPosition(head);
        this.rig.position.x += this.teleportTarget.x - head.x;
        this.rig.position.z += this.teleportTarget.z - head.z;
        this.onTeleport();
      }
      this.teleportTarget = null;
    }
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
