/** Сообщения между хостом и вторым игроком / зрителями. Всё — простой JSON. */

export type Role = 'player' | 'spectator';

/** Поза: x, y, z, qx, qy, qz, qw. */
export type Pose = number[];

export interface HandInput {
  id: 'left' | 'right' | 'mouse';
  /** позиция + поворот руки (ПК: точка, где держится предмет) */
  pose: Pose;
  vel: number[];
  /** луч: начало + направление */
  ray: number[];
  use: boolean;
  grab: boolean;
  release: boolean;
  throw: boolean;
}

export type ClientMsg =
  | { t: 'hello'; role: Role }
  | { t: 'input'; vr: boolean; head: Pose; hands: HandInput[] }
  /** команды меню: start, resume, pause, lobby */
  | { t: 'cmd'; id: string };

/** Предмет: id, вид, состояние, поза, масштаб, кто держит («1:left»), что лежит сверху. */
export type ItemSnap = [number, string, string, ...number[]] | unknown[];

export interface PlayerSnap {
  head: Pose;
  hands: Pose[];
  vr: boolean;
  /** длина луча к цели для каждой руки (0 — не показывать) */
  rays: number[];
}

export type Phase = 'lobby' | 'playing' | 'paused' | 'results';

export interface Snapshot {
  t: 's';
  phase: Phase;
  timeLeft: number;
  score: number;
  delta: number;
  deltaAge: number;
  hint: string;
  hintAt: number[] | null;
  /** [id, рецепт, осталось, возраст, уход, результат 0/1/2] */
  orders: (number | string)[][];
  items: unknown[][];
  /** подсвеченные предметы */
  hl: number[];
  /** полоски прогресса: x, y, z, значение, цвет */
  bars: number[][];
  st: { burners: boolean[]; fry: boolean; oven: boolean; sizzle: number };
  /** события: звуки, частицы, вибрация, звонок */
  ev: unknown[][];
  players: PlayerSnap[];
  results?: { subtitle: string; lines: string[]; stars: number };
  code: string;
}

export type HostMsg = { t: 'welcome'; role: Role } | { t: 'full' } | Snapshot;

export const r3 = (v: number): number => Math.round(v * 1000) / 1000;
