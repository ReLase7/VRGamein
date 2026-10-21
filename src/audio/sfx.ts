import * as THREE from 'three';

export type SfxName =
  | 'pick'
  | 'drop'
  | 'chop'
  | 'order'
  | 'serve'
  | 'fail'
  | 'trash'
  | 'burnt'
  | 'cooked'
  | 'click'
  | 'tick'
  | 'fanfare'
  | 'teleport'
  | 'start';

/**
 * Все звуки синтезируются Web Audio — не нужны файлы.
 * Звуки с позицией идут через PannerNode, слушатель — three.js AudioListener на камере.
 */
export class Sfx {
  readonly listener: THREE.AudioListener;
  private ctx: AudioContext;
  private master: GainNode;
  private noise: AudioBuffer;
  private sizzleGain: GainNode | null = null;
  private sizzlePanner: PannerNode | null = null;
  enabled = true;

  constructor(camera: THREE.Camera) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.ctx = this.listener.context;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.listener.getInput());
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  /** Браузер разрешает звук только после действия пользователя. */
  resume(): void {
    if (this.ctx.state !== 'running') void this.ctx.resume();
    if (!this.sizzleGain) this.startSizzle();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.02);
  }

  private out(pos?: THREE.Vector3): AudioNode {
    if (!pos) return this.master;
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 0.8;
    p.rolloffFactor = 1;
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
    p.connect(this.master);
    return p;
  }

  private tone(freq: number, start: number, dur: number, type: OscillatorType, vol: number, dest: AudioNode, slideTo?: number): void {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(dest);
    o.start(start);
    o.stop(start + dur + 0.02);
  }

  private burst(start: number, dur: number, vol: number, dest: AudioNode, filterFreq: number, type: BiquadFilterType = 'bandpass'): void {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    f.Q.value = 1.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(start, Math.random() * 0.5);
    s.stop(start + dur + 0.02);
  }

  play(name: SfxName, pos?: THREE.Vector3): void {
    if (!this.enabled || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const out = this.out(pos);
    switch (name) {
      case 'pick':
        this.tone(520, t, 0.08, 'triangle', 0.25, out, 820);
        break;
      case 'drop':
        this.tone(300, t, 0.1, 'sine', 0.3, out, 160);
        this.burst(t, 0.05, 0.15, out, 1200);
        break;
      case 'chop':
        this.burst(t, 0.06, 0.5, out, 2600);
        this.tone(180, t, 0.05, 'square', 0.12, out, 90);
        break;
      case 'order':
        this.tone(1320, t, 0.5, 'sine', 0.35, out);
        this.tone(1980, t, 0.35, 'sine', 0.12, out);
        this.tone(1320, t + 0.18, 0.6, 'sine', 0.3, out);
        break;
      case 'serve':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, t + i * 0.07, 0.25, 'triangle', 0.28, out));
        this.tone(1568, t, 0.6, 'sine', 0.2, out);
        break;
      case 'fail':
        this.tone(330, t, 0.25, 'sawtooth', 0.18, out, 220);
        this.tone(220, t + 0.22, 0.4, 'sawtooth', 0.18, out, 110);
        break;
      case 'trash':
        this.burst(t, 0.25, 0.4, out, 400, 'lowpass');
        this.tone(140, t, 0.2, 'sine', 0.3, out, 60);
        break;
      case 'burnt':
        this.burst(t, 0.6, 0.35, out, 800, 'lowpass');
        this.tone(200, t, 0.4, 'square', 0.1, out, 70);
        break;
      case 'cooked':
        this.tone(880, t, 0.12, 'triangle', 0.25, out);
        this.tone(1175, t + 0.1, 0.18, 'triangle', 0.25, out);
        break;
      case 'click':
        this.tone(700, t, 0.05, 'square', 0.12, out, 900);
        break;
      case 'tick':
        this.tone(1000, t, 0.05, 'square', 0.1, out);
        break;
      case 'teleport':
        this.tone(400, t, 0.15, 'sine', 0.15, out, 900);
        break;
      case 'start':
        [392, 523, 659].forEach((f, i) => this.tone(f, t + i * 0.1, 0.2, 'triangle', 0.25, out));
        break;
      case 'fanfare':
        [523, 659, 784, 659, 784, 1046].forEach((f, i) => this.tone(f, t + i * 0.13, i === 5 ? 0.8 : 0.2, 'triangle', 0.3, out));
        this.tone(261, t + 0.65, 0.8, 'sine', 0.25, out);
        break;
    }
  }

  private startSizzle(): void {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 3500;
    this.sizzleGain = this.ctx.createGain();
    this.sizzleGain.gain.value = 0;
    this.sizzlePanner = this.ctx.createPanner();
    this.sizzlePanner.panningModel = 'HRTF';
    this.sizzlePanner.refDistance = 0.8;
    s.connect(f).connect(this.sizzleGain).connect(this.sizzlePanner).connect(this.master);
    s.start();
  }

  /** Громкость шипения сковородок (0 — тишина). */
  setSizzle(level: number, pos: THREE.Vector3): void {
    if (!this.sizzleGain || !this.sizzlePanner) return;
    const t = this.ctx.currentTime;
    this.sizzleGain.gain.setTargetAtTime(level * 0.12 * (0.85 + Math.random() * 0.3), t, 0.05);
    this.sizzlePanner.positionX.value = pos.x;
    this.sizzlePanner.positionY.value = pos.y;
    this.sizzlePanner.positionZ.value = pos.z;
  }
}
