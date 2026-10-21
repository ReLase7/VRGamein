export const STAR_THRESHOLDS = [60, 140, 240];
export const EXPIRE_PENALTY = 10;
export const WRONG_PENALTY = 5;

export interface HighScore {
  score: number;
  stars: number;
  date: string;
}

const KEY = 'kitchen-chaos-vr:highscores';

/** Очки за раунд, звёзды и таблица рекордов в localStorage. */
export class Score {
  score = 0;
  served = 0;
  expired = 0;
  wrong = 0;
  /** Последнее изменение очков — для «прыгающей» цифры на табло. */
  lastDelta = 0;
  lastDeltaAge = 99;

  reset(): void {
    this.score = 0;
    this.served = 0;
    this.expired = 0;
    this.wrong = 0;
    this.lastDelta = 0;
    this.lastDeltaAge = 99;
  }

  add(points: number): void {
    this.score = Math.max(0, this.score + points);
    this.lastDelta = points;
    this.lastDeltaAge = 0;
  }

  update(dt: number): void {
    this.lastDeltaAge += dt;
  }

  get stars(): number {
    return STAR_THRESHOLDS.filter((t) => this.score >= t).length;
  }

  static load(): HighScore[] {
    try {
      const raw = localStorage.getItem(KEY);
      const list = raw ? (JSON.parse(raw) as HighScore[]) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  /** Сохраняет результат, возвращает место в таблице (0 — лучший) или -1. */
  saveResult(): number {
    const list = Score.load();
    const entry: HighScore = { score: this.score, stars: this.stars, date: new Date().toLocaleDateString('kk-KZ') };
    list.push(entry);
    list.sort((a, b) => b.score - a.score);
    const top = list.slice(0, 5);
    try {
      localStorage.setItem(KEY, JSON.stringify(top));
    } catch {
      /* приватный режим — просто не сохраняем */
    }
    return top.indexOf(entry);
  }
}
