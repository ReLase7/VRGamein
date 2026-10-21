import * as THREE from 'three';
import { toon, toonMesh } from '../style/toon';
import { makeSign } from '../ui/canvasPanel';
import type { PlayerSnap } from './protocol';

const SKIN = 0xffcf9e;
const COLORS = [0xff5a3c, 0x3c9bff];

/** Повар-аватар другого игрока: голова в колпаке, две перчатки, табличка с именем. */
export class Avatar {
  readonly group = new THREE.Group();
  private head = new THREE.Group();
  private hands: THREE.Object3D[] = [];
  private targetHead = new THREE.Vector3();
  private targetQ = new THREE.Quaternion();
  private targetHands: { p: THREE.Vector3; q: THREE.Quaternion }[] = [];
  private seen = false;

  constructor(index: number, label: string) {
    const color = COLORS[index % COLORS.length];
    // голова
    const face = toonMesh(new THREE.SphereGeometry(0.11, 16, 12), toon(SKIN), 0.008);
    this.head.add(face);
    const eyeMat = toon(0x2b1d3a);
    for (const dx of [-0.038, 0.038]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), eyeMat);
      eye.position.set(dx, 0.02, -0.1);
      this.head.add(eye);
    }
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 12, Math.PI), eyeMat);
    smile.position.set(0, -0.03, -0.102);
    smile.rotation.z = Math.PI;
    this.head.add(smile);
    // поварской колпак цвета игрока по ободку
    const band = toonMesh(new THREE.CylinderGeometry(0.105, 0.105, 0.05, 16), toon(color), 0.006);
    band.position.y = 0.09;
    const hat = toonMesh(new THREE.CylinderGeometry(0.12, 0.1, 0.12, 16), toon(0xffffff), 0.006);
    hat.position.y = 0.17;
    const puff = toonMesh(new THREE.SphereGeometry(0.13, 14, 10), toon(0xffffff), 0.006);
    puff.position.y = 0.25;
    puff.scale.y = 0.6;
    this.head.add(band, hat, puff);
    const tag = makeSign(label, 0.3, index === 0 ? '#ffb3a8' : '#a8d4ff');
    tag.position.y = 0.42;
    this.head.add(tag);
    this.group.add(this.head);
    // перчатки
    for (let i = 0; i < 2; i++) {
      const glove = toonMesh(new THREE.SphereGeometry(0.045, 12, 10), toon(color), 0.006);
      glove.scale.set(1, 0.8, 1.25);
      this.group.add(glove);
      this.hands.push(glove);
      this.targetHands.push({ p: new THREE.Vector3(), q: new THREE.Quaternion() });
    }
    this.group.visible = false;
  }

  /** Новые данные о позе (приходят по сети 20 раз в секунду). */
  set(p: PlayerSnap): void {
    this.targetHead.set(p.head[0], p.head[1], p.head[2]);
    this.targetQ.set(p.head[3], p.head[4], p.head[5], p.head[6]);
    this.hands.forEach((h, i) => {
      const hp = p.hands[i];
      h.visible = !!hp;
      if (!hp) return;
      this.targetHands[i].p.set(hp[0], hp[1], hp[2]);
      this.targetHands[i].q.set(hp[3], hp[4], hp[5], hp[6]);
    });
    if (!this.seen) {
      this.seen = true;
      this.snap();
    }
    this.group.visible = true;
  }

  private snap(): void {
    this.head.position.copy(this.targetHead);
    this.head.quaternion.copy(this.targetQ);
    this.hands.forEach((h, i) => {
      h.position.copy(this.targetHands[i].p);
      h.quaternion.copy(this.targetHands[i].q);
    });
  }

  /** Плавно догоняем последнюю позу. */
  update(dt: number, camPos?: THREE.Vector3): void {
    const k = 1 - Math.exp(-dt * 18);
    this.head.position.lerp(this.targetHead, k);
    this.head.quaternion.slerp(this.targetQ, k);
    this.hands.forEach((h, i) => {
      h.position.lerp(this.targetHands[i].p, k);
      h.quaternion.slerp(this.targetHands[i].q, k);
    });
    // табличка с именем всегда смотрит на зрителя
    const tag = this.head.children[this.head.children.length - 1];
    if (camPos && tag) {
      // как Object3D.lookAt: лицевая сторона (+z) таблички — к камере
      const at = tag.getWorldPosition(new THREE.Vector3());
      const world = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(camPos, at, new THREE.Vector3(0, 1, 0)));
      tag.quaternion.copy(this.head.quaternion).invert().multiply(world);
    }
  }

  /** Скрыть голову (камера зрителя смотрит «из-за плеча» этого игрока). */
  setHeadVisible(on: boolean): void {
    this.head.visible = on;
  }

  hide(): void {
    this.group.visible = false;
    this.seen = false;
  }

  get headPos(): THREE.Vector3 {
    return this.head.position;
  }

  get headQuat(): THREE.Quaternion {
    return this.head.quaternion;
  }
}
