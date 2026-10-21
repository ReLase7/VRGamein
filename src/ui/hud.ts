import * as THREE from 'three';
import { CanvasPanel, INK, roundRect, sticker, text, FONT } from './canvasPanel';
import type { Order } from '../systems/orders';
import { STAR_THRESHOLDS } from '../systems/score';

const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** Маленький рисунок ингредиента для карточки заказа. */
export function drawIngredient(ctx: CanvasRenderingContext2D, key: string, x: number, y: number, r: number): void {
  ctx.save();
  ctx.lineWidth = Math.max(3, r * 0.18);
  ctx.strokeStyle = INK;
  const circle = (cx: number, cy: number, rr: number, fill: string) => {
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.stroke();
  };
  switch (key) {
    case 'bun':
      ctx.beginPath();
      ctx.ellipse(x, y + r * 0.1, r, r * 0.75, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fillStyle = '#e9a24d';
      ctx.fill();
      ctx.stroke();
      roundRect(ctx, x - r, y + r * 0.25, r * 2, r * 0.45, r * 0.2);
      ctx.fillStyle = '#f2c27a';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff6d8';
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.ellipse(x + i * r * 0.4, y - r * 0.25, r * 0.08, r * 0.14, 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'patty:cooked':
      roundRect(ctx, x - r, y - r * 0.35, r * 2, r * 0.7, r * 0.35);
      ctx.fillStyle = '#8a4b2a';
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#5a2e18';
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(x - r * 0.6, y + i * r * 0.18);
        ctx.lineTo(x + r * 0.6, y + i * r * 0.18);
        ctx.stroke();
      }
      break;
    case 'lettuce:chopped':
      circle(x - r * 0.35, y + r * 0.1, r * 0.55, '#3f9a2e');
      circle(x + r * 0.3, y - r * 0.1, r * 0.6, '#6ccf4a');
      break;
    case 'tomato:chopped':
      circle(x, y, r * 0.85, '#f2463c');
      ctx.beginPath();
      ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = '#ff8a6a';
      ctx.fill();
      ctx.fillStyle = '#fff1d6';
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.3, r * 0.1, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'potato:cooked': {
      // фри в красном кульке
      ctx.fillStyle = '#ffc83d';
      for (let i = -2; i <= 2; i++) {
        ctx.save();
        ctx.translate(x + i * r * 0.22, y - r * 0.2);
        ctx.rotate(i * 0.12);
        ctx.fillRect(-r * 0.09, -r * 0.75, r * 0.18, r * 0.9);
        ctx.strokeRect(-r * 0.09, -r * 0.75, r * 0.18, r * 0.9);
        ctx.restore();
      }
      ctx.beginPath();
      ctx.moveTo(x - r * 0.75, y - r * 0.1);
      ctx.lineTo(x + r * 0.75, y - r * 0.1);
      ctx.lineTo(x + r * 0.55, y + r * 0.85);
      ctx.lineTo(x - r * 0.55, y + r * 0.85);
      ctx.closePath();
      ctx.fillStyle = '#e8402f';
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'chicken:cooked': {
      // ножка: кость + мясо
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-0.6);
      roundRect(ctx, r * 0.2, -r * 0.12, r * 0.75, r * 0.24, r * 0.1);
      ctx.fillStyle = '#fff6e6';
      ctx.fill();
      ctx.stroke();
      circle(r * 0.95, -r * 0.12, r * 0.16, '#fff6e6');
      circle(r * 0.95, r * 0.12, r * 0.16, '#fff6e6');
      ctx.beginPath();
      ctx.ellipse(-r * 0.15, 0, r * 0.62, r * 0.48, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#d9822b';
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'lavash':
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.55, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#f2d9a0';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#d9b06a';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(x + Math.cos(i * 1.6) * r * 0.5, y + Math.sin(i * 1.6) * r * 0.25, r * 0.1, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'doner':
      for (let i = 0; i < 4; i++) {
        ctx.save();
        ctx.translate(x + (i - 1.5) * r * 0.32, y + ((i % 2) - 0.5) * r * 0.3);
        ctx.rotate(0.4 - i * 0.25);
        roundRect(ctx, -r * 0.45, -r * 0.13, r * 0.9, r * 0.26, r * 0.1);
        ctx.fillStyle = i % 2 ? '#9a5427' : '#6e3616';
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      break;
    case 'pizza': {
      circle(x, y, r * 0.95, '#e6a24a');
      ctx.beginPath();
      ctx.arc(x, y, r * 0.72, 0, Math.PI * 2);
      ctx.fillStyle = '#ffb92e';
      ctx.fill();
      ctx.fillStyle = '#d8321e';
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(x + Math.cos(i * 1.26 + 0.3) * r * 0.42, y + Math.sin(i * 1.26 + 0.3) * r * 0.42, r * 0.15, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.lineWidth = Math.max(2, r * 0.08);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI;
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(a) * r * 0.9, y - Math.sin(a) * r * 0.9);
        ctx.lineTo(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9);
        ctx.stroke();
      }
      break;
    }
    default:
      circle(x, y, r * 0.7, '#ccc');
  }
  ctx.restore();
}

/** Табло заказов над стойкой. */
export class OrderBoard {
  readonly panel = new CanvasPanel(1024, 400, 1.75);
  private lastDraw = 0;

  draw(orders: Order[], time: number, force = false): void {
    const animating = orders.some((o) => o.age < 0.6 || o.result);
    if (!force && !animating && time - this.lastDraw < 0.25) return;
    this.lastDraw = time;
    const ctx = this.panel.ctx;
    this.panel.clear();
    sticker(ctx, 16, 10, 260, 64, '#ff5a3c', 22, 7);
    text(ctx, 'ЗАКАЗЫ', 146, 42, 40, '#fff');

    const cardW = 236;
    const cardH = 290;
    orders.slice(0, 4).forEach((o, i) => {
      let x = 16 + i * (cardW + 12);
      let y = 92;
      const enter = Math.min(1, o.age / 0.5);
      x += (1 - easeOutBack(enter)) * 700;
      let alpha = 1;
      if (o.result) {
        const t = Math.min(1, o.leaving / 0.6);
        y += o.result === 'done' ? -t * 80 : t * 120;
        alpha = 1 - t;
      }
      const frac = o.timeLeft / o.recipe.time;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.translate(x + cardW / 2, y + cardH / 2);
      ctx.rotate(((o.id % 3) - 1) * 0.02);
      ctx.translate(-cardW / 2, -cardH / 2);
      const fill = o.result === 'done' ? '#b8f08f' : o.result === 'expired' ? '#ff9a8a' : frac < 0.25 ? '#ffb3a8' : '#fff8e7';
      sticker(ctx, 0, 0, cardW, cardH, fill, 22, 7);
      text(ctx, o.recipe.name, cardW / 2, 38, 38, INK, 'center', 900, cardW - 24);
      // ингредиенты
      const n = o.recipe.items.length;
      const cols = Math.min(n, 2);
      o.recipe.items.forEach((key, j) => {
        const cx = cardW / 2 + ((j % cols) - (cols - 1) / 2) * 92;
        const cy = 110 + Math.floor(j / cols) * 72;
        drawIngredient(ctx, key, cx, cy, 30);
      });
      // таймер
      const barY = cardH - 52;
      roundRect(ctx, 18, barY, cardW - 36, 30, 15);
      ctx.fillStyle = '#2b1d3a';
      ctx.fill();
      const col = frac > 0.5 ? '#6ccf4a' : frac > 0.25 ? '#ffd23f' : '#ff5a3c';
      roundRect(ctx, 22, barY + 4, Math.max(22, (cardW - 44) * frac), 22, 11);
      ctx.fillStyle = col;
      ctx.fill();
      if (o.result === 'done') text(ctx, '✔', cardW - 34, 34, 44, '#2e8a2e');
      if (o.result === 'expired') text(ctx, '✖', cardW - 34, 34, 44, '#c0281e');
      ctx.restore();
    });
    if (orders.length === 0) {
      ctx.save();
      ctx.font = `700 34px ${FONT}`;
      text(ctx, 'Ждём заказы…', 512, 230, 40, '#fff8e7', 'center', 800);
      ctx.restore();
    }
    this.panel.commit();
  }
}

/** Табло: время, очки, звёзды и подсказка обучения. */
export class HudBoard {
  readonly panel = new CanvasPanel(512, 400, 0.85);
  private lastKey = '';

  draw(timeLeft: number, score: number, delta: number, deltaAge: number, hint: string, fps: number): void {
    const secs = Math.ceil(timeLeft);
    const key = `${secs}|${score}|${deltaAge < 1 ? Math.floor(deltaAge * 10) : 'x'}|${hint}|${Math.round(fps / 5)}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const ctx = this.panel.ctx;
    this.panel.clear();
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    sticker(ctx, 14, 10, 230, 110, secs <= 15 ? '#ff5a3c' : '#ffd23f', 22, 7);
    text(ctx, `${m}:${s.toString().padStart(2, '0')}`, 129, 66, 64, secs <= 15 ? '#fff' : INK, 'center', 900);
    sticker(ctx, 262, 10, 230, 110, '#7fd6ff', 22, 7);
    text(ctx, `${score}`, 377, 60, 60, INK, 'center', 900);
    text(ctx, 'очков', 377, 103, 22, INK, 'center', 700);
    // звёзды
    for (let i = 0; i < 3; i++) {
      drawStar(ctx, 300 + i * 78, 160, 26, score >= STAR_THRESHOLDS[i]);
    }
    if (deltaAge < 1) {
      const t = deltaAge;
      ctx.save();
      ctx.globalAlpha = 1 - t;
      text(ctx, delta >= 0 ? `+${delta}` : `${delta}`, 377, 150 - t * 40, 50, delta >= 0 ? '#2e8a2e' : '#c0281e', 'center', 900);
      ctx.restore();
    }
    if (hint) {
      sticker(ctx, 14, 210, 478, 170, '#fff8e7', 22, 7);
      text(ctx, 'ПОДСКАЗКА', 40, 240, 22, '#ff5a3c', 'left', 900);
      wrapText(ctx, hint, 40, 278, 430, 34, 30);
    }
    text(ctx, `${Math.round(fps)} fps`, 120, 165, 18, 'rgba(43,29,58,0.6)', 'center', 600);
    this.panel.commit();
  }
}

export function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, filled: boolean): void {
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = filled ? '#ffd23f' : 'rgba(255,255,255,0.35)';
  ctx.fill();
  ctx.lineWidth = Math.max(3, r * 0.18);
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

export function wrapText(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, maxW: number, lineH: number, size: number, color = INK, align: CanvasTextAlign = 'left'): number {
  ctx.font = `700 ${size}px ${FONT}`;
  const words = s.split(' ');
  let line = '';
  let yy = y;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      text(ctx, line, x, yy, size, color, align, 700);
      line = w;
      yy += lineH;
    } else line = test;
  }
  if (line) text(ctx, line, x, yy, size, color, align, 700);
  return yy + lineH;
}

export interface MenuButton {
  id: string;
  label: string;
  color?: string;
}

export interface MenuSpec {
  title: string;
  subtitle?: string;
  lines?: string[];
  stars?: number;
  buttons: MenuButton[];
}

/** Большая панель меню / паузы / результатов с кнопками. */
export class MenuPanel {
  readonly panel = new CanvasPanel(1024, 900, 1.0);
  private spec: MenuSpec | null = null;
  private rects: { id: string; x: number; y: number; w: number; h: number }[] = [];
  private hover: string | null = null;
  private appearT = 0;

  get mesh(): THREE.Mesh {
    return this.panel.mesh;
  }

  show(spec: MenuSpec): void {
    this.spec = spec;
    this.appearT = 0;
    this.redraw();
  }

  update(dt: number): void {
    if (this.appearT < 1) {
      this.appearT = Math.min(1, this.appearT + dt / 0.35);
      const s = easeOutBack(this.appearT);
      this.panel.mesh.scale.setScalar(Math.max(0.01, s));
    }
  }

  setHover(id: string | null): void {
    if (id === this.hover) return;
    this.hover = id;
    this.redraw();
  }

  hitTest(uv: THREE.Vector2): string | null {
    const px = uv.x * this.panel.pxW;
    const py = (1 - uv.y) * this.panel.pxH;
    for (const r of this.rects) if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return r.id;
    return null;
  }

  private redraw(): void {
    const spec = this.spec;
    if (!spec) return;
    const ctx = this.panel.ctx;
    const W = this.panel.pxW;
    this.panel.clear();
    sticker(ctx, 20, 20, W - 50, 850, '#fff8e7', 48, 12);
    text(ctx, spec.title, W / 2, 110, 84, INK, 'center', 900, W - 120);
    let y = 185;
    if (spec.subtitle) {
      text(ctx, spec.subtitle, W / 2, y, 38, '#ff5a3c', 'center', 800, W - 120);
      y += 60;
    }
    if (spec.stars !== undefined) {
      for (let i = 0; i < 3; i++) drawStar(ctx, W / 2 + (i - 1) * 130, y + 50, 52, i < spec.stars);
      y += 130;
    }
    for (const l of spec.lines ?? []) {
      text(ctx, l, W / 2, y, 34, INK, 'center', 700, W - 140);
      y += 48;
    }
    y += 20;
    this.rects = [];
    const bh = 92;
    const bw = 560;
    const remaining = 860 - y;
    const gap = Math.min(24, Math.max(8, (remaining - spec.buttons.length * bh) / Math.max(1, spec.buttons.length)));
    for (const b of spec.buttons) {
      const x = (W - bw) / 2;
      const hovered = this.hover === b.id;
      sticker(ctx, x, y, bw, bh, hovered ? '#ffd23f' : (b.color ?? '#7fd6ff'), 30, 9);
      text(ctx, b.label, W / 2, y + bh / 2, 42, INK, 'center', 900, bw - 40);
      this.rects.push({ id: b.id, x, y, w: bw, h: bh });
      y += bh + gap;
    }
    this.panel.commit();
  }
}
