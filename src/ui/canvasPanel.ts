import * as THREE from 'three';

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
export const INK = '#2b1d3a';

/** Плоская 3D-панель, которая рисуется через Canvas 2D. */
export class CanvasPanel {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

  constructor(
    readonly pxW: number,
    readonly pxH: number,
    readonly worldW: number,
    transparent = true,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = pxW;
    this.canvas.height = pxH;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const worldH = (worldW * pxH) / pxW;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(worldW, worldH),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent, toneMapped: false, depthWrite: !transparent }),
    );
  }

  get worldH(): number {
    return (this.worldW * this.pxH) / this.pxW;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.pxW, this.pxH);
  }

  commit(): void {
    this.texture.needsUpdate = true;
  }
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Рисует «наклейку»: скруглённый прямоугольник с тёмной обводкой и тенью. */
export function sticker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  r = 24,
  border = 8,
): void {
  ctx.save();
  roundRect(ctx, x + border * 0.6, y + border * 1.1, w, h, r);
  ctx.fillStyle = 'rgba(43,29,58,0.9)';
  ctx.fill();
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = border;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
}

export function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  color = INK,
  align: CanvasTextAlign = 'center',
  weight = 800,
  maxWidth?: number,
): void {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(s, x, y, maxWidth);
}

/** Маленькая табличка-наклейка с надписью. */
export function makeSign(label: string, worldW: number, fill = '#fff8e7', color = INK): THREE.Mesh {
  const pxW = 512;
  const pxH = 160;
  const p = new CanvasPanel(pxW, pxH, worldW);
  sticker(p.ctx, 10, 10, pxW - 30, pxH - 34, fill, 36, 10);
  text(p.ctx, label, pxW / 2 - 8, pxH / 2 - 10, 64, color, 'center', 900, pxW - 70);
  p.commit();
  return p.mesh;
}
