import type { Item } from '../items/item';

export interface Recipe {
  id: string;
  name: string;
  items: string[]; // ключи ингредиентов
  points: number;
  time: number; // секунд на заказ
  unlockAt: number; // с какой секунды раунда появляется
}

export const RECIPES: Recipe[] = [
  { id: 'salad', name: 'Салат', items: ['lettuce:chopped', 'tomato:chopped'], points: 20, time: 50, unlockAt: 0 },
  { id: 'burger', name: 'Бургер', items: ['bun', 'patty:cooked', 'lettuce:chopped'], points: 30, time: 70, unlockAt: 0 },
  { id: 'bigburger', name: 'Биг-бургер', items: ['bun', 'patty:cooked', 'lettuce:chopped', 'tomato:chopped'], points: 45, time: 85, unlockAt: 60 },
];

export interface Order {
  id: number;
  recipe: Recipe;
  timeLeft: number;
  /** Сколько секунд заказ уже висит (для анимации появления). */
  age: number;
  /** Анимация ухода: >0 — заказ уходит (выполнен или сгорел). */
  leaving: number;
  result: 'done' | 'expired' | null;
}

export type ServeResult = { ok: true; order: Order; points: number } | { ok: false; reason: 'empty' | 'wrong' };

const MAX_ACTIVE = 4;

function sameItems(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((v, i) => v === y[i]);
}

/** Очередь заказов: появление, таймеры, проверка тарелки. */
export class Orders {
  list: Order[] = [];
  private nextId = 1;
  private spawnTimer = 0;
  private roundTime = 0;
  private spawnedCount = 0;
  onNew: (o: Order) => void = () => {};
  onExpired: (o: Order) => void = () => {};

  reset(): void {
    this.list = [];
    this.spawnTimer = 2; // первый заказ почти сразу
    this.roundTime = 0;
    this.spawnedCount = 0;
  }

  get active(): Order[] {
    return this.list.filter((o) => !o.result);
  }

  update(dt: number, roundLength: number): void {
    this.roundTime += dt;
    for (const o of this.list) {
      o.age += dt;
      if (o.result) {
        o.leaving += dt;
        continue;
      }
      o.timeLeft -= dt;
      if (o.timeLeft <= 0) {
        o.timeLeft = 0;
        o.result = 'expired';
        this.onExpired(o);
      }
    }
    this.list = this.list.filter((o) => o.leaving < 0.6);

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.active.length < MAX_ACTIVE) {
      this.spawn();
      // Усложнение: чем дальше раунд, тем чаще заказы (с 24 до 12 секунд).
      const k = Math.min(1, this.roundTime / roundLength);
      this.spawnTimer = 24 - 12 * k + Math.random() * 4;
    }
    // если заказов нет совсем — не заставляем ждать
    if (this.active.length === 0 && this.spawnTimer > 3) this.spawnTimer = 3;
  }

  private spawn(): void {
    let recipe: Recipe;
    if (this.spawnedCount === 0) recipe = RECIPES[0];
    else if (this.spawnedCount === 1) recipe = RECIPES[1];
    else {
      const pool = RECIPES.filter((r) => r.unlockAt <= this.roundTime);
      recipe = pool[Math.floor(Math.random() * pool.length)];
    }
    this.spawnedCount++;
    const o: Order = { id: this.nextId++, recipe, timeLeft: recipe.time, age: 0, leaving: 0, result: null };
    this.list.push(o);
    this.onNew(o);
  }

  /** Проверяет тарелку на окне выдачи. */
  serve(plate: Item): ServeResult {
    const keys = plate.contents.map((c) => c.key);
    if (keys.length === 0) return { ok: false, reason: 'empty' };
    // из подходящих заказов выбираем тот, что сгорит раньше всех
    const match = this.active.filter((o) => sameItems(o.recipe.items, keys)).sort((a, b) => a.timeLeft - b.timeLeft)[0];
    if (!match) return { ok: false, reason: 'wrong' };
    match.result = 'done';
    const tip = Math.round(match.recipe.points * 0.5 * (match.timeLeft / match.recipe.time));
    return { ok: true, order: match, points: match.recipe.points + tip };
  }
}
