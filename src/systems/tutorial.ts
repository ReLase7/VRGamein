import * as THREE from 'three';
import type { Item, ItemKind } from '../items/item';
import type { Kitchen } from '../world/kitchen';
import type { Order } from './orders';
import { toon, toonMesh } from '../style/toon';

const ACC: Record<string, string> = { bun: 'булку', patty: 'котлету', lettuce: 'салат', tomato: 'помидор' };

export interface Hint {
  text: string;
  target: THREE.Vector3 | null;
}

/** Подсказки для первого заказа: что сделать дальше и куда смотреть. */
export function computeHint(order: Order, items: Item[], k: Kitchen, isVR: boolean): Hint {
  const keys = order.recipe.items;
  const plates = items.filter((i) => i.kind === 'plate');
  // тарелка, на которой уже лежит только нужное
  let best: Item | null = null;
  for (const p of plates) {
    const left = [...keys];
    const fits = p.contents.every((c) => {
      const j = left.indexOf(c.key);
      if (j < 0) return false;
      left.splice(j, 1);
      return true;
    });
    if (fits && (!best || p.contents.length > best.contents.length)) best = p;
  }
  const missing = [...keys];
  if (best) for (const c of best.contents) missing.splice(missing.indexOf(c.key), 1);
  if (best && missing.length === 0) {
    return { text: 'Готово! Поставьте тарелку на окно ВЫДАЧИ справа', target: k.serve.pos };
  }
  const m = missing[0];
  const kind = m.split(':')[0] as ItemKind;
  const ready = items.find((i) => i.key === m);
  if (ready) {
    if (!plates.length) return { text: 'Возьмите тарелку из стопки справа', target: k.plateStackPos.clone().setY(k.plateStackPos.y + 0.12) };
    const target = (best ?? plates[0]).root.getWorldPosition(new THREE.Vector3());
    return { text: `Положите ${ACC[kind]} на тарелку`, target };
  }
  const raw = items.find((i) => i.kind === kind && i.state !== 'burnt' && i.key !== m);
  const burnt = items.find((i) => i.kind === kind && i.state === 'burnt');
  if (kind === 'patty') {
    if (raw && raw.slot?.type === 'pan') return { text: 'Котлета жарится! Снимите, когда станет коричневой', target: raw.slot.pos };
    if (raw) return { text: 'Положите котлету на сковороду', target: k.pans[0].pos };
    if (burnt) return { text: 'Котлета сгорела! Выбросьте её в мусор и возьмите новую', target: k.trash.pos.clone().setY(k.trash.top) };
  } else if (raw) {
    if (raw.slot?.type === 'board') {
      return {
        text: isVR ? 'Режьте: стучите ножом по доске или держите курок над ней' : 'Режьте: наведитесь на доску и держите E',
        target: k.board.pos,
      };
    }
    return { text: `Положите ${ACC[kind]} на разделочную доску`, target: k.board.pos };
  }
  const crate = k.spawners.find((s) => s.kind === kind);
  return { text: `Возьмите ${ACC[kind]} из ящика слева${isVR ? ' (кнопка grip)' : ' (ЛКМ)'}`, target: crate?.spawnPos ?? null };
}

/** Прыгающая стрелка над целью. */
export class HintArrow {
  readonly mesh: THREE.Group;
  private t = 0;
  constructor() {
    this.mesh = new THREE.Group();
    const cone = new THREE.ConeGeometry(0.05, 0.12, 4);
    cone.rotateX(Math.PI);
    const c = toonMesh(cone, toon(0xffd23f), 0.008);
    const shaft = toonMesh(new THREE.BoxGeometry(0.035, 0.08, 0.035), toon(0xffd23f), 0.008);
    shaft.position.y = 0.09;
    this.mesh.add(c, shaft);
    this.mesh.visible = false;
  }
  update(dt: number, target: THREE.Vector3 | null): void {
    this.t += dt;
    if (!target) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.mesh.position.set(target.x, target.y + 0.28 + Math.abs(Math.sin(this.t * 4)) * 0.06, target.z);
    this.mesh.rotation.y += dt * 2;
  }
}
