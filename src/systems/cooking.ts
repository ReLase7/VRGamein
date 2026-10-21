import * as THREE from 'three';
import type { Kitchen } from '../world/kitchen';
import type { Hand } from '../input/hand';
import type { Sfx } from '../audio/sfx';
import type { Particles } from '../world/particles';
import type { Slot, SlotType } from '../world/slots';
import type { ItemKind, ItemState } from '../items/item';
import type { ItemWorld } from './grab';
import { ProgressBar } from '../ui/progressBar';
import { PALETTE } from '../style/toon';

const CHOP_HOLD_TIME = 1.4; // секунд удерживать курок/E
const CHOP_PER_STROKE = 0.26; // ~4 удара ножом
const SPIT_HOLD_TIME = 1.6; // срезать порцию мяса с вертела

interface Rule {
  from: ItemState;
  time: number; // секунд до готовности
}

/** Что и сколько готовится на каждой станции. После готовности — до сгорания BURN_TIME. */
const HEAT_RULES: Partial<Record<SlotType, Partial<Record<ItemKind, Rule>>>> = {
  pan: { patty: { from: 'raw', time: 7 } },
  fryer: { potato: { from: 'chopped', time: 6 }, chicken: { from: 'raw', time: 8 } },
  oven: { dough: { from: 'chopped', time: 8 } },
};
const BURN_TIME: Partial<Record<SlotType, number>> = { pan: 9, fryer: 9, oven: 10 };

const CHOP_COLOR: Partial<Record<ItemKind, number>> = {
  tomato: PALETTE.tomato,
  lettuce: PALETTE.lettuce,
  cheese: PALETTE.cheese,
  potato: PALETTE.potatoInner,
  dough: PALETTE.dough,
};

interface HeatStation {
  slot: Slot;
  bar: ProgressBar;
  barHeight: number;
}

/** Нарезка на досках, вертел донера, жарка на плите и во фритюре, печь для пиццы. */
export class Cooking {
  private boardBars: ProgressBar[];
  private spitBar = new ProgressBar();
  private heat: HeatStation[] = [];
  private strokeCooldown = 0;
  private holdTick = 0;
  private fxTimer = 0;
  private spitProgress = 0;
  private soundCenter: THREE.Vector3;
  chopsDone = 0;
  /** Что видно на станциях — по сети это повторяют у второго игрока и зрителей. */
  readonly visual = { burners: [false, false], fry: false, oven: false, sizzle: 0 };

  /** Все полоски прогресса (для передачи по сети). */
  get bars(): ProgressBar[] {
    return [...this.boardBars, this.spitBar, ...this.heat.map((h) => h.bar)];
  }

  constructor(
    scene: THREE.Scene,
    private readonly kitchen: Kitchen,
    private readonly sfx: Sfx,
    private readonly fx: Particles,
    private readonly world: ItemWorld,
  ) {
    this.boardBars = kitchen.boards.map(() => new ProgressBar());
    for (const s of kitchen.pans) this.heat.push({ slot: s, bar: new ProgressBar(), barHeight: 0.25 });
    for (const s of kitchen.fryers) this.heat.push({ slot: s, bar: new ProgressBar(), barHeight: 0.3 });
    this.heat.push({ slot: kitchen.oven, bar: new ProgressBar(), barHeight: 0.55 });
    scene.add(this.spitBar.group, ...this.boardBars.map((b) => b.group), ...this.heat.map((h) => h.bar.group));
    this.soundCenter = kitchen.pans[0].pos.clone().lerp(kitchen.fryers[0].pos, 0.5);
  }

  /** aimBox — коробка станции под прицелом мыши (на ПК). */
  update(dt: number, hands: Hand[], camPos: THREE.Vector3): void {
    this.strokeCooldown -= dt;
    this.fxTimer += dt;
    const puffNow = this.fxTimer > 0.12;
    if (puffNow) this.fxTimer = 0;
    this.kitchen.boards.forEach((slot, i) => this.updateBoard(dt, slot, this.kitchen.boardBoxes[i], this.boardBars[i], hands, camPos));
    this.updateSpit(dt, hands, camPos);
    this.updateHeat(dt, camPos, puffNow);
  }

  /**
   * Работает ли рука у станции. Нужен инструмент в руке: нож (резать) или скалка (тесто).
   * Ножом — удары сверху вниз, скалкой — катать туда-сюда; или просто держать курок/E.
   * Возвращает прибавку прогресса.
   */
  private work(dt: number, h: Hand, box: THREE.Box3, holdTime: number, tool: 'knife' | 'pin'): number {
    if (h.held?.kind !== tool) return 0;
    const near = h.isVR ? box.containsPoint(h.pos) : h.aimBox === box;
    if (!near) return 0;
    if (h.isVR && tool === 'knife' && h.vel.y < -0.7 && this.strokeCooldown <= 0) {
      this.strokeCooldown = 0.18;
      return CHOP_PER_STROKE;
    }
    if (h.isVR && tool === 'pin' && Math.hypot(h.vel.x, h.vel.z) > 0.35) return (dt / holdTime) * 1.6;
    if (h.use) return dt / holdTime;
    return 0;
  }

  private updateBoard(dt: number, slot: Slot, box: THREE.Box3, bar: ProgressBar, hands: Hand[], camPos: THREE.Vector3): void {
    const item = slot.occupant;
    if (!item || !item.choppable) {
      bar.hide();
      return;
    }
    let worked = false;
    for (const h of hands) {
      const add = this.work(dt, h, box, CHOP_HOLD_TIME, item.kind === 'dough' ? 'pin' : 'knife');
      if (add <= 0) continue;
      worked = true;
      item.chop += add;
      this.holdTick += add >= CHOP_PER_STROKE ? 1 : dt;
      if (this.holdTick > 0.2) {
        this.holdTick = 0;
        this.sfx.play('chop', slot.pos);
        this.fx.splash(slot.pos.clone().setY(slot.pos.y + 0.06), CHOP_COLOR[item.kind] ?? 0xffffff);
        item.bounce();
        h.pulse(0.7, 35);
      }
    }
    if (worked && item.chop >= 1) {
      item.chop = 0;
      item.setState('chopped');
      this.chopsDone++;
      this.sfx.play('cooked', slot.pos);
      this.fx.splash(slot.pos.clone().setY(slot.pos.y + 0.05), CHOP_COLOR[item.kind] ?? 0xffffff);
      bar.hide();
      return;
    }
    if (item.chop > 0) bar.set(item.chop, 0x6ccf4a, slot.pos.clone().setY(slot.pos.y + 0.22), camPos);
    else bar.hide();
  }

  private updateSpit(dt: number, hands: Hand[], camPos: THREE.Vector3): void {
    const sp = this.kitchen.spit;
    sp.meat.rotation.y += dt * 0.7;
    if (sp.tray.occupant) {
      this.spitBar.hide();
      return;
    }
    for (const h of hands) {
      const add = this.work(dt, h, sp.box, SPIT_HOLD_TIME, 'knife');
      if (add <= 0) continue;
      this.spitProgress += add;
      this.holdTick += add >= CHOP_PER_STROKE ? 1 : dt;
      if (this.holdTick > 0.2) {
        this.holdTick = 0;
        this.sfx.play('chop', sp.pos);
        this.fx.splash(sp.pos.clone().add(new THREE.Vector3(0, 0.3, 0.12)), PALETTE.doner);
        h.pulse(0.6, 30);
      }
    }
    if (this.spitProgress >= 1) {
      this.spitProgress = 0;
      const meat = this.world.spawn('doner', sp.tray.pos);
      meat.setState('cooked');
      this.world.snap(meat, sp.tray);
      this.sfx.play('cooked', sp.tray.pos);
      this.fx.puff(sp.tray.pos.clone().setY(sp.tray.pos.y + 0.05), PALETTE.doner);
    }
    if (this.spitProgress > 0) this.spitBar.set(this.spitProgress, 0x6ccf4a, sp.pos.clone().add(new THREE.Vector3(0, 0.82, 0.1)), camPos);
    else this.spitBar.hide();
  }

  private updateHeat(dt: number, camPos: THREE.Vector3, puffNow: boolean): void {
    const k = this.kitchen;
    let active = 0;
    let fryerActive = false;
    let ovenActive = false;
    k.pans.forEach((slot, i) => (this.visual.burners[i] = !!slot.occupant));

    for (const st of this.heat) {
      const { slot, bar } = st;
      const item = slot.occupant;
      const rule = item ? HEAT_RULES[slot.type]?.[item.kind] : undefined;
      if (!item || !rule) {
        bar.hide();
        continue;
      }
      const top = slot.pos.clone().setY(slot.pos.y + 0.06);
      const barAt = slot.pos.clone().setY(slot.pos.y + st.barHeight);
      const emit = (): void => {
        if (slot.type === 'fryer') this.fx.spawn(top, { vel: new THREE.Vector3(0, 0.25, 0), spread: 0.15, life: 0.4, size: 0.01, color: PALETTE.oil });
        else if (slot.type === 'oven') this.fx.steam(slot.pos.clone().add(new THREE.Vector3(-0.28, 0.3, 0)));
        else this.fx.steam(top);
      };
      if (item.state === rule.from) {
        active++;
        if (slot.type === 'fryer') fryerActive = true;
        if (slot.type === 'oven') ovenActive = true;
        item.cook += dt / rule.time;
        if (puffNow && Math.random() < 0.6) emit();
        bar.set(item.cook, 0x6ccf4a, barAt, camPos);
        if (item.cook >= 1) {
          item.setState('cooked');
          this.sfx.play('cooked', slot.pos);
          this.fx.puff(top);
        }
      } else if (item.state === 'cooked') {
        active++;
        if (slot.type === 'fryer') fryerActive = true;
        if (slot.type === 'oven') ovenActive = true;
        item.burn += dt / (BURN_TIME[slot.type] ?? 9);
        if (puffNow) {
          if (item.burn > 0.5) this.fx.smoke(top);
          else if (Math.random() < 0.5) emit();
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
        if (item.state === 'burnt' && puffNow) this.fx.smoke(top);
      }
    }
    // масло во фритюре «кипит», печь светится
    this.visual.fry = fryerActive;
    this.visual.oven = ovenActive;
    this.visual.sizzle = Math.min(1, active * 0.45);
    Cooking.applyVisual(k, this.visual, this.sfx, this.soundCenter);
  }

  /** Показать состояние станций (горелки, масло, печь, шипение). */
  static applyVisual(k: Kitchen, v: Cooking['visual'], sfx: Sfx, soundAt?: THREE.Vector3): void {
    const t = performance.now() / 1000;
    k.pans.forEach((_, i) => k.burners[i].material.color.setHex(v.burners[i] ? PALETTE.burner : 0x2a2a38));
    k.oil.material.color.setHex(v.fry ? 0xffc23d : PALETTE.oil);
    k.ovenGlow.material.color.setHex(v.oven ? (Math.sin(t * 6) > 0 ? 0xff7a2e : 0xff9a3e) : 0x3a2b3e);
    sfx.setSizzle(v.sizzle, soundAt ?? k.pans[0].pos.clone().lerp(k.fryers[0].pos, 0.5));
  }

  reset(): void {
    this.visual.burners = [false, false];
    this.visual.fry = false;
    this.visual.oven = false;
    this.visual.sizzle = 0;
    for (const b of this.boardBars) b.hide();
    this.spitBar.hide();
    this.spitProgress = 0;
    for (const h of this.heat) h.bar.hide();
    this.sfx.setSizzle(0, this.soundCenter);
  }
}
