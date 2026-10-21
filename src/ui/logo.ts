import * as THREE from 'three';
import { CanvasPanel, FONT, INK } from './canvasPanel';

/**
 * Логотип ресторана «ATU Kitchen» — своя мультяшная эмблема:
 * круглый значок с поварским колпаком, вилкой и ложкой и лентой с подписью.
 */
export function makeLogo(worldW: number): THREE.Mesh {
  const size = 1024;
  const p = new CanvasPanel(size, size, worldW);
  const ctx = p.ctx;
  const cx = size / 2;
  const cy = size / 2 + 20;
  const R = 400;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // тень значка
  ctx.beginPath();
  ctx.arc(cx + 14, cy + 22, R, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(43,29,58,0.85)';
  ctx.fill();

  // внешнее кольцо
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = '#ff5a3c';
  ctx.fill();
  ctx.lineWidth = 22;
  ctx.strokeStyle = INK;
  ctx.stroke();

  // зубчатый «штамп» по краю
  ctx.fillStyle = '#ffd23f';
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * (R - 40), cy + Math.sin(a) * (R - 40), 9, 0, Math.PI * 2);
    ctx.fill();
  }

  // внутренний круг
  ctx.beginPath();
  ctx.arc(cx, cy, R - 80, 0, Math.PI * 2);
  ctx.fillStyle = '#fff8e7';
  ctx.fill();
  ctx.lineWidth = 16;
  ctx.stroke();

  // надпись по дуге сверху
  arcText(ctx, '★ ДӘМДІ · ЖЫЛДАМ · КӨҢІЛДІ ★', cx, cy, R - 58, -Math.PI / 2, 46, '#fff8e7');

  // вилка и ложка крест-накрест за колпаком
  drawFork(ctx, cx - 70, cy - 10, -0.45);
  drawSpoon(ctx, cx + 70, cy - 10, 0.45);

  // поварской колпак
  const hy = cy - 150;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(cx - 85, hy, 70, Math.PI * 0.6, Math.PI * 1.75);
  ctx.arc(cx, hy - 45, 85, Math.PI * 1.15, Math.PI * 1.85);
  ctx.arc(cx + 85, hy, 70, Math.PI * 1.25, Math.PI * 0.4);
  ctx.lineTo(cx + 85, hy + 95);
  ctx.lineTo(cx - 85, hy + 95);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(cx - 95, hy + 80, 190, 45);
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 8;
  for (const dx of [-45, 0, 45]) {
    ctx.beginPath();
    ctx.moveTo(cx + dx, hy + 40);
    ctx.lineTo(cx + dx, hy + 78);
    ctx.stroke();
  }

  // «ATU» крупно, с жёлтой объёмной тенью
  ctx.font = `900 250px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 12; i > 0; i -= 2) {
    ctx.fillStyle = i > 2 ? INK : '#ffd23f';
    ctx.fillText('ATU', cx + i, cy + 95 + i);
  }
  ctx.fillStyle = '#ffd23f';
  ctx.fillText('ATU', cx + 4, cy + 99);
  ctx.lineWidth = 14;
  ctx.strokeStyle = INK;
  ctx.strokeText('ATU', cx, cy + 95);
  ctx.fillStyle = '#ff5a3c';
  ctx.fillText('ATU', cx, cy + 95);

  // лента снизу
  const ry = cy + 270;
  const rw = 560;
  const rh = 110;
  ctx.fillStyle = '#c0281e';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 14;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + side * (rw / 2 - 30), ry - rh / 2 + 30);
    ctx.lineTo(cx + side * (rw / 2 + 90), ry - rh / 2 + 30);
    ctx.lineTo(cx + side * (rw / 2 + 50), ry + 25);
    ctx.lineTo(cx + side * (rw / 2 + 90), ry + rh / 2 + 30);
    ctx.lineTo(cx + side * (rw / 2 - 30), ry + rh / 2 + 30);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx - rw / 2, ry - rh / 2);
  ctx.quadraticCurveTo(cx, ry - rh / 2 - 40, cx + rw / 2, ry - rh / 2);
  ctx.lineTo(cx + rw / 2, ry + rh / 2);
  ctx.quadraticCurveTo(cx, ry + rh / 2 - 40, cx - rw / 2, ry + rh / 2);
  ctx.closePath();
  ctx.fillStyle = '#ff5a3c';
  ctx.fill();
  ctx.stroke();
  ctx.font = `900 76px ${FONT}`;
  ctx.fillStyle = '#fff8e7';
  ctx.fillText('KITCHEN', cx, ry - 14, rw - 60);

  p.commit();
  p.mesh.material.depthWrite = false;
  return p.mesh;
}

function arcText(ctx: CanvasRenderingContext2D, s: string, cx: number, cy: number, r: number, mid: number, size: number, color: string): void {
  ctx.save();
  ctx.font = `900 ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const chars = [...s];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0);
  let a = mid - total / r / 2;
  chars.forEach((c, i) => {
    const w = widths[i];
    a += w / r / 2;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillText(c, 0, 0);
    ctx.restore();
    a += w / r / 2;
  });
  ctx.restore();
}

function drawFork(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = '#b8c4d6';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.roundRect(-16, -10, 32, 230, 14);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(-45, -120, 90, 120, 20);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fff8e7';
  for (const dx of [-17, 17]) {
    ctx.beginPath();
    ctx.roundRect(dx - 7, -125, 14, 75, 6);
    ctx.fill();
  }
  ctx.restore();
}

function drawSpoon(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = '#b8c4d6';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.roundRect(-16, -10, 32, 230, 14);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, -60, 50, 72, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
