import * as THREE from 'three';
import { KIND_ACC, type Item, type ItemKind, type ItemState } from '../items/item';
import type { Kitchen } from '../world/kitchen';
import type { Order } from './orders';
import type { SlotType } from '../world/slots';
import { toon, toonMesh } from '../style/toon';

export interface Hint {
  text: string;
  target: THREE.Vector3 | null;
}

type Station = 'board' | 'pan' | 'fryer' | 'oven';
interface Step {
  from: ItemState;
  to: ItemState;
  at: Station;
}

/** Как из сырого продукта получить нужный. */
const CHAINS: Record<string, Step[]> = {
  'lettuce:chopped': [{ from: 'raw', to: 'chopped', at: 'board' }],
  'tomato:chopped': [{ from: 'raw', to: 'chopped', at: 'board' }],
  'cheese:chopped': [{ from: 'raw', to: 'chopped', at: 'board' }],
  'patty:cooked': [{ from: 'raw', to: 'cooked', at: 'pan' }],
  'chicken:cooked': [{ from: 'raw', to: 'cooked', at: 'fryer' }],
  'potato:cooked': [
    { from: 'raw', to: 'chopped', at: 'board' },
    { from: 'chopped', to: 'cooked', at: 'fryer' },
  ],
};
const RANK: Record<ItemState, number> = { raw: 0, chopped: 1, cooked: 2, burnt: 3 };
const WHERE: Record<Station, string> = { board: 'на доску', pan: 'на сковороду', fryer: 'во фритюр', oven: 'в печь' };
const CHOP_WORD: Partial<Record<ItemKind, string>> = { dough: 'Раскатайте тесто', cheese: 'Натрите сыр', potato: 'Нарежьте картошку' };

const free = (i: Item): boolean => i.mode !== 'onPlate' && i.mode !== 'dead';

function stationPos(k: Kitchen, at: Station): THREE.Vector3 {
  const list = at === 'board' ? k.boards : at === 'pan' ? k.pans : at === 'fryer' ? k.fryers : [k.oven];
  return (list.find((s) => !s.occupant) ?? list[0]).pos;
}

function chopText(kind: ItemKind, isVR: boolean): string {
  const verb = CHOP_WORD[kind] ?? 'Режьте';
  if (kind === 'dough') {
    return isVR ? `${verb}: возьмите скалку и катайте ей по доске (или держите курок)` : `${verb}: возьмите скалку, наведитесь на доску и держите E`;
  }
  return isVR ? `${verb}: возьмите нож и стучите им по доске (или держите курок)` : `${verb}: возьмите нож, наведитесь на доску и держите E`;
}

function crateHint(k: Kitchen, kind: ItemKind, isVR: boolean): Hint {
  const crate = k.spawners.find((s) => s.kind === kind);
  return { text: `Возьмите ${KIND_ACC[kind]} из ящика слева${isVR ? ' (кнопка grip)' : ' (ЛКМ)'}`, target: crate?.spawnPos ?? null };
}

function trashHint(k: Kitchen, kind: ItemKind): Hint {
  return { text: `Сгорело! Выбросьте ${KIND_ACC[kind]} в мусор и сделайте заново`, target: k.trash.pos.clone().setY(k.trash.top) };
}

/** Подсказка, как получить продукт с ключом key (когда готового ещё нет). */
function makeHint(key: string, items: Item[], k: Kitchen, isVR: boolean): Hint {
  const kind = key.split(':')[0] as ItemKind;
  if (key === 'doner') {
    return {
      text: isVR ? 'Срежьте мясо с вертела: возьмите нож и стучите им у вертела (или держите курок)' : 'Срежьте мясо с вертела: возьмите нож, наведитесь на вертел и держите E',
      target: k.spit.pos.clone().setY(k.spit.pos.y + 0.75),
    };
  }
  const chain = CHAINS[key];
  if (!chain) return crateHint(k, kind, isVR);
  const target = RANK[chain[chain.length - 1].to];
  const cands = items.filter((i) => i.kind === kind && free(i) && RANK[i.state] < target).sort((a, b) => RANK[b.state] - RANK[a.state]);
  const cand = cands[0];
  if (cand) {
    const step = chain.find((s) => s.from === cand.state) ?? chain[0];
    if (cand.slot?.type === (step.at as SlotType)) {
      if (step.at === 'board') return { text: chopText(kind, isVR), target: cand.slot.pos };
      return { text: `Готовится! Заберите, когда будет готово, пока не сгорело`, target: cand.slot.pos };
    }
    return { text: `Положите ${KIND_ACC[kind]} ${WHERE[step.at]}`, target: stationPos(k, step.at) };
  }
  if (items.some((i) => i.kind === kind && i.state === 'burnt' && free(i))) return trashHint(k, kind);
  return crateHint(k, kind, isVR);
}

function pizzaHint(items: Item[], k: Kitchen, isVR: boolean): Hint {
  const base = items.find((i) => i.kind === 'dough' && free(i) && i.state === 'chopped');
  if (base) {
    const basePos = base.root.getWorldPosition(new THREE.Vector3());
    for (const t of ['cheese:chopped', 'tomato:chopped']) {
      const tk = t.split(':')[0] as ItemKind;
      if (base.contents.some((c) => c.kind === tk)) continue;
      if (items.some((i) => i.key === t && free(i))) {
        return { text: tk === 'cheese' ? 'Положите тёртый сыр на основу пиццы' : 'Положите помидор на основу пиццы', target: basePos };
      }
      return makeHint(t, items, k, isVR);
    }
    if (base.slot?.type === 'oven') return { text: 'Пицца печётся! Достаньте, когда станет золотистой', target: k.oven.pos };
    return { text: 'Поставьте пиццу в печь (справа)', target: k.oven.pos };
  }
  const bad = items.find((i) => i.kind === 'dough' && free(i) && (i.state === 'burnt' || (i.state === 'cooked' && !i.isPizza)));
  if (bad) return bad.state === 'burnt' ? trashHint(k, 'dough') : { text: 'Без сыра и помидора это не пицца. Выбросьте и начните заново', target: k.trash.pos.clone().setY(k.trash.top) };
  const raw = items.find((i) => i.kind === 'dough' && free(i) && i.state === 'raw');
  if (raw) {
    if (raw.slot?.type === 'board') return { text: chopText('dough', isVR), target: raw.slot.pos };
    return { text: 'Положите тесто на доску', target: stationPos(k, 'board') };
  }
  return crateHint(k, 'dough', isVR);
}

/** Подсказка для заказа: что сделать дальше и куда смотреть. */
export function computeHint(order: Order, items: Item[], k: Kitchen, isVR: boolean): Hint {
  const keys = order.recipe.items;
  const plates = items.filter((i) => i.kind === 'plate' && free(i));
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
  // Сначала то, что уже готово, — сразу на тарелку.
  for (const m of missing) {
    if (!items.some((i) => i.key === m && free(i))) continue;
    if (!plates.length) return { text: 'Возьмите тарелку из стопки справа', target: k.plateStackPos.clone().setY(k.plateStackPos.y + 0.12) };
    const target = (best ?? plates[0]).root.getWorldPosition(new THREE.Vector3());
    const kind = m.split(':')[0] as ItemKind;
    return { text: `Положите ${m === 'pizza' ? 'пиццу' : KIND_ACC[kind]} на тарелку`, target };
  }
  const m = missing[0];
  return m === 'pizza' ? pizzaHint(items, k, isVR) : makeHint(m, items, k, isVR);
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
