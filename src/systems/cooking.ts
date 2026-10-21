import * as THREE from 'three';
import type { Kitchen } from '../world/kitchen';
import type { Hand } from '../input/hand';
import type { Sfx } from '../audio/sfx';
import type { Particles } from '../world/particles';
import { ProgressBar } from '../ui/progressBar';
import { PALETTE } from '../style/toon';

const CHOP_HOLD_TIME = 1.4; // секунд удерживать курок/E
const CHOP_PER_STROKE = 0.26; // ~4 удара ножом
const COOK_TIME = 7; // сырая → жареная
const BURN_TIME = 9; // жареная → сгоревшая

/** Нарезка на доске, жарка и сгорание на плите. */
export class Cooking {
  private boardBar = new ProgressBar();
  private panBars = [new ProgressBar(), new ProgressBar()];
  private strokeCooldown = 0;
  private holdTick = 0;
  private fxTimer = 0;
  private stoveCenter: THREE.Vector3;
  /** Сколько было нарезано (для статистики). */
  chopsDone = 0;

  constructor(
    scene: THREE.Scene,
    private readonly kitchen: Kitchen,
    private readonly sfx: Sfx,
    private readonly fx: Particles,
  ) {
    scene.add(this.boardBar.group, ...this.panBars.map((b) => b.group));
    this.stoveCenter = kitchen.pans[0].pos.clone().lerp(kitchen.pans[1].pos, 0.5);
  }

  update(dt: number, hands: Hand[], camPos: THREE.Vector3, desktopAimsBoard: boolean): void {
    this.strokeCooldown -= dt;
    this.fxTimer += dt;
    const puffNow = this.fxTimer > 0.12;
    if (puffNow) this.fxTimer = 0;
    this.updateBoard(dt, hands, camPos, desktopAimsBoard);
    this.updatePans(dt, camPos, puffNow);
  }

  private updateBoard(dt: number, hands: Hand[], camPos: THREE.Vector3, desktopAimsBoard: boolean): void {
    const k = this.kitchen;
    const item = k.board.occupant;
    if (!item || !item.choppable) {
      this.boardBar.hide();
      return;
    }
    const at = k.board.pos.clone().setY(k.board.pos.y + 0.22);
    let chopped = false;
    for (const h of hands) {
      const near = h.isVR ? k.boardBox.containsPoint(h.pos) : desktopAimsBoard;
      if (!near) continue;
      // 1) удар ножом сверху вниз
      if (h.isVR && h.held?.kind === 'knife' && h.vel.y < -0.7 && this.strokeCooldown <= 0) {
        item.chop += CHOP_PER_STROKE;
        this.strokeCooldown = 0.18;
        this.chopFx(item.kind, h);
        chopped = true;
      }
      // 2) запасной вариант: держать курок (VR) или E (ПК) над доской
      else if (h.use && (!h.held || h.held.kind === 'knife')) {
        item.chop += dt / CHOP_HOLD_TIME;
        this.holdTick += dt;
        if (this.holdTick > 0.2) {
          this.holdTick = 0;
          this.chopFx(item.kind, h);
        }
        chopped = true;
      }
    }
    if (chopped && item.chop >= 1) {
      item.chop = 0;
      item.setState('chopped');
      this.chopsDone++;
      this.sfx.play('cooked', k.board.pos);
      this.fx.splash(k.board.pos.clone().setY(k.board.pos.y + 0.05), item.kind === 'tomato' ? PALETTE.tomato : PALETTE.lettuce);
      this.boardBar.hide();
      return;
    }
    if (item.chop > 0) this.boardBar.set(item.chop, 0x6ccf4a, at, camPos);
    else this.boardBar.hide();
  }

  private chopFx(kind: string, h: Hand): void {
    const k = this.kitchen;
    this.sfx.play('chop', k.board.pos);
    this.fx.splash(k.board.pos.clone().setY(k.board.pos.y + 0.06), kind === 'tomato' ? PALETTE.tomato : PALETTE.lettuce);
    k.board.occupant?.bounce();
    h.pulse(0.7, 35);
  }

  private updatePans(dt: number, camPos: THREE.Vector3, puffNow: boolean): void {
    const k = this.kitchen;
    let sizzle = 0;
    k.pans.forEach((slot, i) => {
      const item = slot.occupant;
      const bar = this.panBars[i];
      const burner = k.burners[i];
      const top = slot.pos.clone().setY(slot.pos.y + 0.06);
      burner.material.color.setHex(item ? PALETTE.burner : 0x2a2a38);
      if (!item || item.kind !== 'patty') {
        bar.hide();
        return;
      }
      const barAt = slot.pos.clone().setY(slot.pos.y + 0.25);
      if (item.state === 'raw') {
        sizzle += 1;
        item.cook += dt / COOK_TIME;
        if (puffNow && Math.random() < 0.6) this.fx.steam(top);
        bar.set(item.cook, 0x6ccf4a, barAt, camPos);
        if (item.cook >= 1) {
          item.setState('cooked');
          this.sfx.play('cooked', slot.pos);
          this.fx.puff(top);
        }
      } else if (item.state === 'cooked') {
        sizzle += 1;
        item.burn += dt / BURN_TIME;
        if (puffNow) {
          if (item.burn > 0.5) this.fx.smoke(top);
          else if (Math.random() < 0.5) this.fx.steam(top);
        }
        if (item.burn > 0.35) {
          const blink = item.burn > 0.7 && Math.floor(performance.now() / 150) % 2 === 0;
          bar.set(item.burn, blink ? 0xffffff : 0xff5a3c, barAt, camPos);
        } else bar.hide();
        if (item.burn >= 1) {
          item.setState('burnt');
          this.sfx.play('burnt', slot.pos);
          for (let j = 0; j < 6; j++) this.fx.smoke(top);
        }
      } else {
        bar.hide();
        if (puffNow) this.fx.smoke(top);
      }
    });
    this.sfx.setSizzle(Math.min(1, sizzle * 0.6), this.stoveCenter);
  }

  reset(): void {
    this.boardBar.hide();
    for (const b of this.panBars) b.hide();
    this.sfx.setSizzle(0, this.stoveCenter);
  }
}
