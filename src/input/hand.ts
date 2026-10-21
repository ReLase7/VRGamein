import * as THREE from 'three';
import type { Item } from '../items/item';

/**
 * Единый интерфейс «руки»: VR-контроллер или мышь.
 * Игровые системы работают только с ним и не знают, откуда пришёл ввод.
 */
export class Hand {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  /** Поворот руки (для предмета в руке). */
  readonly quat = new THREE.Quaternion();
  /** Луч для меню и прицеливания. */
  readonly ray = new THREE.Ray();
  held: Item | null = null;
  hover: Item | null = null;

  /** Нажали «взять» в этом кадре. */
  grab = false;
  /** Отпустили «взять» в этом кадре (VR) / нажали положить (ПК). */
  release = false;
  /** Бросок (ПК). */
  throw = false;
  /** Удерживается «действие» (курок / E) — нарезка. */
  use = false;
  /** Нажатие по меню в этом кадре. */
  click = false;

  private history: { p: THREE.Vector3; t: number }[] = [];

  constructor(
    readonly id: 'left' | 'right' | 'mouse',
    readonly isVR: boolean,
  ) {}

  /** Обновляет скорость руки по последним кадрам (для броска). */
  track(p: THREE.Vector3, time: number): void {
    this.pos.copy(p);
    this.history.push({ p: p.clone(), t: time });
    while (this.history.length > 6) this.history.shift();
    if (this.history.length >= 2) {
      const a = this.history[0];
      const b = this.history[this.history.length - 1];
      const dt = Math.max(1e-3, b.t - a.t);
      this.vel.subVectors(b.p, a.p).divideScalar(dt);
    }
  }

  resetEdges(): void {
    this.grab = false;
    this.release = false;
    this.throw = false;
    this.click = false;
  }

  /** Вибрация (переопределяется для VR). */
  pulse: (intensity: number, ms: number) => void = () => {};
}
