import * as THREE from 'three';

/** Полоска прогресса над доской/сковородой, всегда повёрнута к игроку. */
export class ProgressBar {
  readonly group = new THREE.Group();
  private fill: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly w = 0.2;
  value = 0;
  color = 0;

  constructor() {
    const h = 0.035;
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(this.w + 0.02, h + 0.02), new THREE.MeshBasicMaterial({ color: 0x2b1d3a, toneMapped: false }));
    const geo = new THREE.PlaneGeometry(this.w, h);
    geo.translate(this.w / 2, 0, 0);
    this.fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x6ccf4a, toneMapped: false }));
    this.fill.position.set(-this.w / 2, 0, 0.002);
    this.group.add(bg, this.fill);
    this.group.visible = false;
  }

  set(value: number, color: number, at: THREE.Vector3, camPos: THREE.Vector3): void {
    this.group.visible = true;
    this.value = value;
    this.color = color;
    this.fill.scale.x = Math.max(0.001, Math.min(1, value));
    this.fill.material.color.setHex(color);
    this.group.position.copy(at);
    this.group.lookAt(camPos);
  }

  hide(): void {
    this.group.visible = false;
  }
}
