import * as THREE from 'three';
import { buildKitchen, ROOM, type Kitchen } from './world/kitchen';
import { Particles } from './world/particles';
import { ItemWorld, type GrabTarget } from './systems/grab';
import { Cooking } from './systems/cooking';
import { Orders, RECIPES, type Order } from './systems/orders';
import { Score, EXPIRE_PENALTY, WRONG_PENALTY, STAR_THRESHOLDS } from './systems/score';
import { computeHint, HintArrow } from './systems/tutorial';
import { Sfx, type SfxName } from './audio/sfx';
import { DesktopControls } from './input/desktop';
import { VRControls } from './xr/vr';
import { Hand } from './input/hand';
import type { Item } from './items/item';
import { HudBoard, MenuPanel, OrderBoard, type MenuButton, type MenuSpec } from './ui/hud';
import { PALETTE } from './style/toon';
import { ClientSession, HostSession, netError, type RemoteConn } from './net/session';
import { r3, type ClientMsg, type HandInput, type HostMsg, type Phase, type PlayerSnap, type Pose, type Role, type Snapshot } from './net/protocol';
import { Mirror } from './net/mirror';
import { Avatar } from './net/avatar';
import { SpectatorCam } from './net/spectator';

export const ROUND_LENGTH = 180;
const REACH = 2.6;
const SNAP_RATE = 1 / 20; // снимки состояния — 20 раз в секунду
const INPUT_RATE = 1 / 30; // ввод второго игрока — 30 раз в секунду

/**
 * menu    — главное меню (одиночная игра)
 * lobby   — хост открыл комнату и ждёт второго игрока
 * playing / paused / results — раунд (и в одиночку, и у хоста)
 * net     — второй игрок или зритель: всё происходящее приходит от хоста
 */
type State = 'menu' | 'lobby' | 'playing' | 'paused' | 'results' | 'net';
type NetRole = 'solo' | 'host' | 'client' | 'spectator';

interface Settings {
  snapAngle: number;
  sound: boolean;
  tutorial: boolean;
  /** Блюда, которые игрок уже хоть раз выдал — для них подсказки не нужны. */
  learned: string[];
}

const SETTINGS_KEY = 'kitchen-chaos-vr:settings';

function loadSettings(): Settings {
  const def: Settings = { snapAngle: 45, sound: true, tutorial: true, learned: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
    // В старых версиях подсказки выключались после первого заказа — для новых блюд включаем снова.
    if (!saved.learned) delete saved.tutorial;
    return { ...def, ...saved };
  } catch {
    return def;
  }
}

const pose = (p: THREE.Vector3, q: THREE.Quaternion): Pose => [r3(p.x), r3(p.y), r3(p.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w)];
const v3 = (v: THREE.Vector3): number[] => [r3(v.x), r3(v.y), r3(v.z)];

/** Второй игрок глазами хоста: его руки участвуют в симуляции как обычные. */
class RemotePlayer {
  readonly vr = [new Hand('left', true), new Hand('right', true)];
  readonly mouse = new Hand('mouse', false);
  isVR = false;
  active = false;
  head: Pose = [0, 1.6, 1, 0, 0, 0, 1];
  rays: number[] = [0, 0];
  private pending = new Map<string, { grab: boolean; release: boolean; throw: boolean; use: boolean }>();

  constructor(onPulse: (hand: string, i: number, ms: number) => void) {
    for (const h of this.all) {
      h.player = 1;
      h.pulse = (i, ms) => onPulse(h.id, i, ms);
    }
  }

  get all(): Hand[] {
    return [...this.vr, this.mouse];
  }

  get hands(): Hand[] {
    return this.isVR ? this.vr : [this.mouse];
  }

  /** Пришёл ввод по сети. Нажатия копим до следующего кадра, чтобы не потерять. */
  receive(msg: Extract<ClientMsg, { t: 'input' }>): void {
    this.isVR = msg.vr;
    this.head = msg.head;
    this.active = true;
    for (const hi of msg.hands) {
      const h = hi.id === 'mouse' ? this.mouse : hi.id === 'left' ? this.vr[0] : this.vr[1];
      const p = new THREE.Vector3(hi.pose[0], hi.pose[1], hi.pose[2]);
      h.pos.copy(p);
      h.holdPos.copy(p);
      h.quat.set(hi.pose[3], hi.pose[4], hi.pose[5], hi.pose[6]);
      h.vel.set(hi.vel[0], hi.vel[1], hi.vel[2]);
      h.ray.origin.set(hi.ray[0], hi.ray[1], hi.ray[2]);
      h.ray.direction.set(hi.ray[3], hi.ray[4], hi.ray[5]).normalize();
      const pend = this.pending.get(h.id) ?? { grab: false, release: false, throw: false, use: false };
      pend.grab ||= hi.grab;
      pend.release ||= hi.release;
      pend.throw ||= hi.throw;
      pend.use = hi.use;
      this.pending.set(h.id, pend);
    }
  }

  /** В начале кадра хоста: превратить накопленные нажатия в события этого кадра. */
  applyFrame(): void {
    for (const h of this.all) {
      h.resetEdges();
      const p = this.pending.get(h.id);
      if (!p) continue;
      h.grab = p.grab;
      h.release = p.release;
      h.throw = p.throw;
      h.use = p.use;
      p.grab = p.release = p.throw = false;
    }
  }
}

export class Game {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly rig = new THREE.Group();
  private kitchen: Kitchen;
  private fx = new Particles();
  private sfx: Sfx;
  private world: ItemWorld;
  private cooking: Cooking;
  private orders = new Orders();
  private score = new Score();
  private desktop: DesktopControls;
  private vr: VRControls;
  private orderBoard = new OrderBoard();
  private hud = new HudBoard();
  private menu = new MenuPanel();
  private arrow = new HintArrow();
  private raycaster = new THREE.Raycaster();
  private settings = loadSettings();

  private state: State = 'menu';
  private timeLeft = ROUND_LENGTH;
  private lastTick = 0;
  private time = 0;
  private departing: { item: Item; t: number }[] = [];
  private highlighted = new Set<Item>();
  private bellT = 1;
  private fps = 60;
  private pauseReason: 'vr' | 'unlock' | null = null;
  private hint = '';
  private hintAt: THREE.Vector3 | null = null;
  private results: Snapshot['results'];

  // ---- сеть
  private role: NetRole = 'solo';
  private host: HostSession | null = null;
  private client: ClientSession | null = null;
  private remote: RemotePlayer;
  private events: unknown[][] = [];
  private snapTimer = 0;
  private inputTimer = 0;
  private mirror: Mirror;
  private avatars = [new Avatar(0, 'Ойыншы 1'), new Avatar(1, 'Ойыншы 2')];
  private spectator: SpectatorCam;
  private snap: Snapshot | null = null;
  private lastPhase: Phase | null = null;
  private joinCode = '';
  private outEdges = new Map<string, { grab: boolean; release: boolean; throw: boolean }>();

  /** Вызывается, когда нужно показать/спрятать HTML-оверлей на ПК. */
  onOverlay: (show: boolean, paused: boolean) => void = () => {};
  onStats: (s: string) => void = () => {};
  /** Зритель: показать/обновить нижнюю строку с кодом и камерами. */
  onSpectator: (info: { code: string; mode: number } | null) => void = () => {};
  /** Сообщение для экрана на ПК (ошибка сети и т. п.). */
  onNotice: (text: string) => void = () => {};

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 50);
    this.rig.add(this.camera);
    this.scene.add(this.rig);
    this.scene.background = new THREE.Color(PALETTE.sky);

    // свет: без теней в реальном времени
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9fe0d0, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(1.2, 3, 2.2);
    this.scene.add(sun);

    this.kitchen = buildKitchen();
    this.scene.add(this.kitchen.group);
    this.scene.add(this.fx.mesh);
    this.scene.add(this.arrow.mesh);

    this.sfx = new Sfx(this.camera);
    this.sfx.setEnabled(this.settings.sound);
    this.world = new ItemWorld(this.scene, this.kitchen, this.sfx, this.fx);
    this.cooking = new Cooking(this.scene, this.kitchen, this.sfx, this.fx, this.world);
    this.world.ensureTools();
    this.mirror = new Mirror(this.scene, this.kitchen, this.fx, this.sfx);
    for (const a of this.avatars) this.scene.add(a.group);
    this.spectator = new SpectatorCam(this.camera, this.avatars);
    this.remote = new RemotePlayer((hand, i, ms) => this.events.push(['h', hand, i, ms]));
    this.recordEvents();

    // табло на задней стене
    const ob = this.orderBoard.panel.mesh;
    ob.position.copy(this.kitchen.orderBoardPos);
    this.scene.add(ob);
    const hud = this.hud.panel.mesh;
    hud.position.copy(this.kitchen.hudPos);
    this.scene.add(hud);
    this.scene.add(this.menu.mesh);
    // меню всегда поверх всего, даже если игрок стоит вплотную к стойке или стене
    this.menu.mesh.renderOrder = 999;
    (this.menu.mesh.material as THREE.MeshBasicMaterial).depthTest = false;

    this.desktop = new DesktopControls(this.camera, renderer.domElement);
    this.desktop.onLockChange = (locked) => this.onLockChange(locked);
    this.vr = new VRControls(renderer, this.rig, this.camera);
    this.vr.snapAngle = this.settings.snapAngle;
    this.vr.onPause = () => this.togglePause();
    this.vr.onPrimary = () => this.pressPrimary();

    this.world.onPlaced = (item, slot) => {
      if (slot.type === 'serve' && item.kind === 'plate') this.serve(item);
    };
    this.orders.onNew = () => {
      this.sfx.play('order', this.kitchen.orderBoardPos);
      this.ringBell();
    };
    this.orders.onExpired = () => {
      this.score.add(-EXPIRE_PENALTY);
      this.score.expired++;
      this.sfx.play('fail', this.kitchen.orderBoardPos);
    };

    renderer.xr.addEventListener('sessionstart', () => this.onSessionStart());
    renderer.xr.addEventListener('sessionend', () => this.onSessionEnd());

    this.desktop.update(0);
    this.showMainMenu();
    this.orderBoard.draw([], 0, true);
    this.hud.draw(ROUND_LENGTH, 0, 0, 99, '', 60);
  }

  get inVR(): boolean {
    return this.renderer.xr.isPresenting;
  }

  get isRemote(): boolean {
    return this.role === 'client' || this.role === 'spectator';
  }

  /** Первое действие пользователя — разрешаем звук. */
  userGesture(): void {
    this.sfx.resume();
  }

  lockDesktop(): void {
    this.sfx.resume();
    if (this.role === 'spectator') return;
    this.desktop.lock();
  }

  resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /** Хост записывает звуки, частицы и вибрацию, чтобы повторить их у второго игрока и зрителей. */
  private recordEvents(): void {
    const play = this.sfx.play.bind(this.sfx);
    this.sfx.play = (name: SfxName, p?: THREE.Vector3) => {
      play(name, p);
      if (this.role === 'host' && this.host?.conns.size) this.events.push(['s', name, p ? v3(p) : null]);
    };
    const spawn = this.fx.spawn.bind(this.fx);
    this.fx.spawn = (p, opts) => {
      spawn(p, opts);
      if (this.role === 'host' && this.host?.conns.size) {
        const o: Record<string, unknown> = { ...opts };
        if (opts.vel) o.vel = v3(opts.vel);
        this.events.push(['f', v3(p), o]);
      }
    };
  }

  private ringBell(): void {
    this.bellT = 0;
    if (this.role === 'host') this.events.push(['b']);
  }

  // ------------------------------------------------------------ меню

  private saveSettings(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* без сохранения */
    }
  }

  private showMenu(spec: MenuSpec): void {
    this.menu.show(spec);
    this.menu.mesh.visible = true;
    this.placeMenu();
  }

  private hideMenu(): void {
    this.menu.mesh.visible = false;
  }

  private settingsButtons(): MenuButton[] {
    return [
      { id: 'turn', label: `Бұрылу: ${this.settings.snapAngle}°` },
      { id: 'sound', label: `Дыбыс: ${this.settings.sound ? 'қосулы' : 'өшірулі'}` },
    ];
  }

  private showMainMenu(): void {
    this.state = 'menu';
    this.world.spawnEnabled = false;
    const best = Score.load()[0];
    this.showMenu({
      title: 'Kitchen Chaos',
      subtitle: 'Тамақ күйгенше үлгеріңіз!',
      lines: best ? [`Рекорд: ${best.score} ұпай`] : ['3 минутта барынша көп тапсырыс орындаңыз'],
      buttons: [
        { id: 'start', label: '▶  Ойнау', color: '#ff8a5c' },
        { id: 'coop', label: '👥  Бірге ойнау', color: '#ffd23f' },
        ...this.settingsButtons(),
        { id: 'tutorial', label: `Кеңестер: ${this.settings.tutorial ? 'қосулы' : 'өшірулі'}` },
        { id: 'records', label: 'Рекордтар', color: '#b8f08f' },
      ],
    });
  }

  private showCoopMenu(): void {
    this.state = 'menu';
    this.showMenu({
      title: 'Бірге ойнау',
      lines: ['Бір ойыншы бөлме ашады,', 'екіншісі оның кодымен кіреді.', 'ДК-да көрермен де кіре алады.'],
      buttons: [
        { id: 'host', label: 'Бөлме ашу', color: '#ff8a5c' },
        { id: 'join', label: 'Бөлмеге кіру', color: '#ffd23f' },
        { id: 'back', label: 'Артқа' },
      ],
    });
  }

  private showKeypad(): void {
    this.state = 'menu';
    const shown = (this.joinCode + '____').slice(0, 4).split('').join(' ');
    const digits: MenuButton[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => ({ id: `d${d}`, label: d }));
    this.showMenu({
      title: 'Бөлме коды',
      big: shown,
      columns: 3,
      buttons: [...digits, { id: 'del', label: '⌫', color: '#ffb3c0' }, { id: 'd0', label: '0' }, { id: 'go', label: '✔', color: this.joinCode.length === 4 ? '#b8f08f' : '#d8d8d8' }],
      footer: [{ id: 'coop', label: 'Артқа' }],
    });
  }

  private showMessage(title: string, line: string, back = 'coop'): void {
    this.state = 'menu';
    this.showMenu({ title, lines: [line], buttons: [{ id: back, label: 'Артқа' }] });
  }

  private showRecords(): void {
    const list = Score.load();
    this.showMenu({
      title: 'Рекордтар',
      lines: list.length ? list.map((h, i) => `${i + 1}.  ${h.score} ұпай  ${'★'.repeat(h.stars)}${'☆'.repeat(3 - h.stars)}  ${h.date}`) : ['Әзірге бос — бір раунд ойнаңыз!'],
      buttons: [{ id: 'back', label: 'Артқа' }],
    });
  }

  /** Хост: экран комнаты с кодом. */
  private showLobby(): void {
    this.state = 'lobby';
    this.world.spawnEnabled = false;
    const h = this.host;
    if (!h) return;
    const player = h.player;
    this.showMenu({
      title: 'Бөлме коды',
      big: h.code.split('').join(' '),
      lines: [
        player ? '2-ойыншы қосылды ✔' : '2-ойыншы күтілуде…',
        `Көрермендер: ${h.spectators}`,
        'Екінші шлемде: «Бірге ойнау» → «Бөлмеге кіру»',
      ],
      buttons: [
        { id: 'start', label: '▶  Ойнау', color: '#ff8a5c' },
        { id: 'close', label: 'Бөлмені жабу', color: '#ffb3c0' },
      ],
    });
  }

  /** Второй игрок: меню зависит от того, что сейчас у хоста. */
  private showClientMenu(phase: Phase): void {
    const code = this.client?.code ?? '';
    if (phase === 'playing') {
      this.hideMenu();
      return;
    }
    if (phase === 'lobby') {
      this.showMenu({
        title: `Бөлме ${code}`,
        lines: ['Қосылдыңыз!', 'Ойынды бөлме иесі бастайды'],
        buttons: [...this.settingsButtons(), { id: 'leave', label: 'Бөлмеден шығу', color: '#ffb3c0' }],
      });
    } else if (phase === 'paused') {
      this.showMenu({
        title: 'Үзіліс',
        lines: [`Қалды: ${Math.ceil(this.snap?.timeLeft ?? 0)} с`],
        buttons: [{ id: 'c_resume', label: '▶  Жалғастыру', color: '#ff8a5c' }, { id: 'leave', label: 'Бөлмеден шығу', color: '#ffb3c0' }],
      });
    } else if (phase === 'results') {
      const r = this.snap?.results;
      this.showMenu({
        title: 'Уақыт бітті!',
        subtitle: r?.subtitle,
        stars: r?.stars ?? 0,
        lines: r?.lines ?? [],
        buttons: [{ id: 'c_again', label: '↻  Тағы да', color: '#ff8a5c' }, { id: 'leave', label: 'Бөлмеден шығу', color: '#ffb3c0' }],
      });
    }
  }

  private placeMenu(): void {
    const head = new THREE.Vector3();
    this.camera.getWorldPosition(head);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.y = 0;
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
    dir.normalize();
    const dist = this.inVR ? 0.75 : 0.9;
    const m = this.menu.mesh;
    m.position.copy(head).addScaledVector(dir, dist);
    // меню не должно уйти в стену
    m.position.x = Math.max(ROOM.minX + 0.3, Math.min(ROOM.maxX - 0.3, m.position.x));
    m.position.z = Math.max(ROOM.minZ + 0.3, Math.min(ROOM.maxZ - 0.3, m.position.z));
    m.position.y = Math.max(1.0, head.y - (this.inVR ? 0.1 : 0.05));
    m.lookAt(head.x, m.position.y, head.z);
  }

  // ------------------------------------------------------------ раунд (одиночная игра и хост)

  private startRound(): void {
    this.world.clearAll();
    this.world.ensureTools();
    this.cooking.reset();
    this.fx.clear();
    this.orders.reset();
    this.score.reset();
    this.departing = [];
    this.timeLeft = ROUND_LENGTH;
    this.lastTick = 0;
    this.results = undefined;
    this.state = 'playing';
    this.world.spawnEnabled = true;
    this.hideMenu();
    this.sfx.play('start');
  }

  private endRound(): void {
    this.state = 'results';
    this.world.spawnEnabled = false;
    this.cooking.reset();
    for (const h of this.hands) if (h.held) this.world.release(h, new THREE.Vector3());
    const place = this.score.saveResult();
    this.sfx.play('fanfare');
    const s = this.score;
    const next = STAR_THRESHOLDS.find((t) => t > s.score);
    const subtitle = place === 0 ? 'Жаңа рекорд!' : `${s.score} ұпай`;
    const lines = [
      place === 0 ? `${s.score} ұпай` : `Үздік нәтиже: ${Score.load()[0]?.score ?? s.score}`,
      `Берілген тағам: ${s.served}   Кешіккен тапсырыс: ${s.expired}`,
      next ? `Келесі жұлдызға дейін: ${next - s.score}` : 'Барлық жұлдыз жиналды!',
    ];
    this.results = { subtitle, lines, stars: s.stars };
    this.showMenu({
      title: 'Уақыт бітті!',
      subtitle,
      stars: s.stars,
      lines,
      buttons: [
        { id: 'start', label: '↻  Тағы да', color: '#ff8a5c' },
        this.role === 'host' ? { id: 'lobby', label: 'Бөлмеге оралу' } : { id: 'menu', label: 'Мәзірге' },
      ],
    });
  }

  private togglePause(): void {
    if (this.role === 'client') {
      this.client?.send({ t: 'cmd', id: 'pause' });
      return;
    }
    if (this.state === 'playing') this.pause('vr');
    else if (this.state === 'paused') this.resume();
  }

  private pause(reason: 'vr' | 'unlock'): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.pauseReason = reason;
    this.cooking.reset();
    const buttons: MenuButton[] = [
      { id: 'resume', label: '▶  Жалғастыру', color: '#ff8a5c' },
      { id: 'start', label: '↻  Қайта бастау' },
      this.role === 'host' ? { id: 'lobby', label: 'Бөлмеге оралу' } : { id: 'menu', label: 'Мәзірге' },
    ];
    if (this.inVR) buttons.push({ id: 'exitvr', label: 'VR-дан шығу', color: '#ffb3c0' });
    this.showMenu({ title: 'Үзіліс', lines: [`Қалды: ${Math.ceil(this.timeLeft)} с,  ${this.score.score} ұпай`], buttons });
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.pauseReason = null;
    this.hideMenu();
  }

  /** Сбросить раунд (вернуться в меню или в комнату). */
  private resetRound(): void {
    this.world.clearAll();
    this.orders.reset();
    this.orders.list = [];
    this.score.reset();
    this.cooking.reset();
    this.timeLeft = ROUND_LENGTH;
  }

  private onMenuButton(id: string): void {
    this.sfx.play('click');
    if (id.startsWith('d') && id.length === 2) {
      if (this.joinCode.length < 4) this.joinCode += id[1];
      this.showKeypad();
      return;
    }
    switch (id) {
      case 'start':
        if (this.isRemote) this.client?.send({ t: 'cmd', id: 'start' });
        else this.startRound();
        break;
      case 'resume':
        this.resume();
        break;
      case 'menu':
        this.resetRound();
        this.showMainMenu();
        break;
      case 'lobby':
        this.resetRound();
        this.showLobby();
        break;
      case 'coop':
        this.showCoopMenu();
        break;
      case 'host':
        void this.openRoom();
        break;
      case 'close':
        this.closeRoom();
        this.showMainMenu();
        break;
      case 'join':
        this.joinCode = '';
        this.showKeypad();
        break;
      case 'del':
        this.joinCode = this.joinCode.slice(0, -1);
        this.showKeypad();
        break;
      case 'go':
        if (this.joinCode.length === 4) void this.joinRoom(this.joinCode, 'player');
        break;
      case 'leave':
        this.leaveRoom();
        this.showMainMenu();
        break;
      case 'c_resume':
        this.client?.send({ t: 'cmd', id: 'resume' });
        break;
      case 'c_again':
        this.client?.send({ t: 'cmd', id: 'start' });
        break;
      case 'turn': {
        const options = [30, 45, 90];
        this.settings.snapAngle = options[(options.indexOf(this.settings.snapAngle) + 1) % options.length];
        this.vr.snapAngle = this.settings.snapAngle;
        this.saveSettings();
        this.refreshMenu();
        break;
      }
      case 'sound':
        this.settings.sound = !this.settings.sound;
        this.sfx.setEnabled(this.settings.sound);
        this.saveSettings();
        this.refreshMenu();
        break;
      case 'tutorial':
        this.settings.tutorial = !this.settings.tutorial;
        if (this.settings.tutorial) this.settings.learned = [];
        this.saveSettings();
        this.showMainMenu();
        break;
      case 'records':
        this.showRecords();
        break;
      case 'back':
        this.showMainMenu();
        break;
      case 'exitvr':
        void this.renderer.xr.getSession()?.end();
        break;
    }
  }

  /** Перерисовать текущее меню после смены настройки. */
  private refreshMenu(): void {
    if (this.role === 'client' && this.snap) this.showClientMenu(this.snap.phase);
    else this.showMainMenu();
  }

  private onLockChange(locked: boolean): void {
    document.getElementById('crosshair')?.classList.toggle('hidden', !locked);
    if (this.inVR) return;
    if (!locked) {
      // у второго игрока ставить на паузу общий раунд из-за Esc не будем
      if (this.state === 'playing' && this.role !== 'client') this.pause('unlock');
      this.onOverlay(true, this.state === 'paused' || this.role === 'client');
    } else {
      this.onOverlay(false, false);
      if (this.state === 'paused' && this.pauseReason === 'unlock') this.resume();
      if (this.menu.mesh.visible) this.placeMenu();
    }
  }

  private onSessionStart(): void {
    this.desktop.enabled = false;
    this.desktop.unlock();
    this.camera.position.set(0, 0, 0);
    this.camera.rotation.set(0, 0, 0);
    this.vr.reset();
    // второй игрок появляется в другом конце кухни, чтобы не стоять друг в друге
    if (this.role === 'client') this.rig.position.set(0, 0, 1.6);
    this.sfx.resume();
    this.onOverlay(false, false);
    // меню появится перед глазами после первого кадра с позой головы
    setTimeout(() => this.menu.mesh.visible && this.placeMenu(), 300);
  }

  private onSessionEnd(): void {
    this.desktop.enabled = this.role !== 'spectator';
    this.rig.position.set(0, 0, 0);
    this.rig.rotation.set(0, 0, 0);
    this.vr.uiVisible = false;
    if (this.state === 'playing') this.pause('unlock');
    this.onOverlay(true, this.state === 'paused');
  }

  // ------------------------------------------------------------ сеть: хост

  private async openRoom(): Promise<void> {
    this.showMenu({ title: 'Бірге ойнау', lines: ['Бөлме ашылуда…'], buttons: [{ id: 'coop', label: 'Артқа' }] });
    try {
      const h = await HostSession.open();
      this.host = h;
      this.role = 'host';
      h.onJoin = (c) => this.onPeerJoin(c);
      h.onLeave = (c) => this.onPeerLeave(c);
      h.onMessage = (c, msg) => this.onPeerMessage(c, msg);
      this.sfx.play('start');
      this.showLobby();
    } catch (e) {
      this.showMessage('Бөлме ашылмады', netError(e));
    }
  }

  private closeRoom(): void {
    this.dropRemoteItems();
    this.host?.close();
    this.host = null;
    this.role = 'solo';
    this.remote.active = false;
    this.avatars[1].hide();
    this.resetRound();
  }

  private onPeerJoin(c: RemoteConn): void {
    this.sfx.play('order');
    if (c.role === 'player') this.remote.active = false; // включится с первым вводом
    if (this.state === 'lobby') this.showLobby();
  }

  private onPeerLeave(c: RemoteConn): void {
    if (c.role === 'player') {
      this.dropRemoteItems();
      this.remote.active = false;
      this.avatars[1].hide();
    }
    if (this.state === 'lobby') this.showLobby();
  }

  /** Второй игрок ушёл — то, что было у него в руках, падает. */
  private dropRemoteItems(): void {
    for (const h of this.remote.all) if (h.held) this.world.release(h, new THREE.Vector3());
  }

  private onPeerMessage(c: RemoteConn, msg: ClientMsg): void {
    if (msg.t === 'input' && c.role === 'player') {
      this.remote.receive(msg);
    } else if (msg.t === 'cmd' && c.role === 'player') {
      if (msg.id === 'start' && (this.state === 'lobby' || this.state === 'results' || this.state === 'paused')) this.startRound();
      else if (msg.id === 'resume') this.resume();
      else if (msg.id === 'pause') {
        if (this.state === 'playing') this.pause('vr');
        else if (this.state === 'paused') this.resume();
      }
    }
  }

  private get phase(): Phase {
    if (this.state === 'playing' || this.state === 'paused' || this.state === 'results') return this.state;
    return 'lobby';
  }

  private holderOf(it: Item, hands: Hand[]): string {
    const h = hands.find((x) => x.held === it);
    return h ? `${h.player}:${h.id}` : '';
  }

  private contentsSnap(it: Item): unknown[] {
    return it.contents.map((c) => [c.id, c.kind, c.state, c.contents.length ? this.contentsSnap(c) : undefined]);
  }

  private buildSnapshot(hands: Hand[]): Snapshot {
    const items: unknown[][] = [];
    const all = new Set<Item>([...this.world.items, ...this.departing.map((d) => d.item)]);
    for (const it of all) {
      const p = it.root.position;
      const q = it.root.quaternion;
      items.push([it.id, it.kind, it.state, r3(p.x), r3(p.y), r3(p.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w), r3(it.root.scale.x), this.holderOf(it, hands), it.contents.length ? this.contentsSnap(it) : undefined]);
    }
    const head = new THREE.Vector3();
    const headQ = new THREE.Quaternion();
    this.camera.getWorldPosition(head);
    this.camera.getWorldQuaternion(headQ);
    const me: PlayerSnap = {
      head: pose(head, headQ),
      hands: this.inVR ? this.vr.hands.map((h) => pose(h.pos, h.quat)) : [pose(this.desktop.hand.holdPos, headQ)],
      vr: this.inVR,
      rays: [],
    };
    const players: PlayerSnap[] = [me];
    if (this.remote.active) {
      players.push({
        head: this.remote.head,
        hands: this.remote.hands.map((h) => pose(h.isVR ? h.pos : h.holdPos, h.quat)),
        vr: this.remote.isVR,
        rays: this.remote.rays.map(r3),
      });
    }
    const bars = this.cooking.bars.filter((b) => b.group.visible).map((b) => [...v3(b.group.position), r3(b.value), b.color]);
    const ev = this.events;
    this.events = [];
    return {
      t: 's',
      phase: this.phase,
      timeLeft: r3(this.timeLeft),
      score: this.score.score,
      delta: this.score.lastDelta,
      deltaAge: r3(this.score.lastDeltaAge),
      hint: this.hint,
      hintAt: this.hintAt ? v3(this.hintAt) : null,
      orders: this.orders.list.map((o) => [o.id, o.recipe.id, r3(o.timeLeft), r3(o.age), r3(o.leaving), o.result === 'done' ? 1 : o.result === 'expired' ? 2 : 0]),
      items,
      hl: [...this.highlighted].map((i) => i.id),
      bars,
      st: { ...this.cooking.visual, burners: [...this.cooking.visual.burners] },
      ev,
      players,
      results: this.state === 'results' ? this.results : undefined,
      code: this.host?.code ?? '',
    };
  }

  // ------------------------------------------------------------ сеть: второй игрок и зритель

  private async joinRoom(code: string, role: Role): Promise<void> {
    if (this.inVR || this.state !== 'net') this.showMenu({ title: `Бөлме ${code}`, lines: ['Қосылуда…'], buttons: [{ id: 'coop', label: 'Артқа' }] });
    try {
      const c = await ClientSession.join(code, role);
      this.client = c;
      this.role = role === 'player' ? 'client' : 'spectator';
      this.enterNet();
      c.onMessage = (m) => this.onHostMessage(m);
      c.onClose = () => {
        this.leaveRoom();
        this.showMessage('Байланыс үзілді', 'Бөлме жабылды немесе желі жоғалды', 'back');
        this.onNotice('Байланыс үзілді');
        this.onSpectator(null);
      };
      if (this.role === 'spectator') this.onSpectator({ code, mode: this.spectator.mode });
    } catch (e) {
      this.showMessage('Кіру мүмкін болмады', netError(e));
      this.onNotice(netError(e));
    }
  }

  /** Публичный вход с экрана ПК (кнопки на стартовой карточке). */
  joinFromDesktop(code: string, role: Role): void {
    this.sfx.resume();
    void this.joinRoom(code, role);
    if (role === 'player') this.desktop.lock();
  }

  private enterNet(): void {
    this.state = 'net';
    this.world.removeEverything();
    this.cooking.reset();
    this.fx.clear();
    this.orders.list = [];
    this.lastPhase = null;
    this.snap = null;
    this.hideMenu();
    if (this.role === 'spectator') {
      this.desktop.enabled = false;
      this.desktop.unlock();
      this.spectator.enabled = true;
      this.onOverlay(false, false);
    } else {
      // второй игрок встаёт в другом конце кухни, а не внутри аватара хоста
      if (!this.inVR) {
        this.desktop.position.set(0.3, 1.6, 1.8);
        this.desktop.yaw = 0;
      }
      this.showMenu({ title: `Бөлме ${this.client?.code}`, lines: ['Қосылуда…'], buttons: [{ id: 'leave', label: 'Бөлмеден шығу', color: '#ffb3c0' }] });
    }
  }

  private leaveRoom(): void {
    const c = this.client;
    this.client = null;
    c?.close();
    this.role = 'solo';
    this.state = 'menu';
    this.mirror.clear();
    for (const a of this.avatars) a.hide();
    this.spectator.enabled = false;
    this.desktop.enabled = !this.inVR;
    this.desktop.hand.held = null;
    for (const h of this.vr.hands) h.held = null;
    this.snap = null;
    this.hint = '';
    this.hintAt = null;
    this.orders.list = [];
    Cooking.applyVisual(this.kitchen, { burners: [false, false], fry: false, oven: false, sizzle: 0 }, this.sfx);
    this.world.ensureTools();
    this.onSpectator(null);
  }

  private onHostMessage(m: HostMsg): void {
    if (m.t === 'welcome') {
      if (m.role === 'spectator' && this.role === 'client') {
        // второй игрок уже есть — смотрим как зритель
        this.role = 'spectator';
        this.enterNet();
        this.onSpectator({ code: this.client?.code ?? '', mode: this.spectator.mode });
      }
      return;
    }
    if (m.t === 'full') return;
    this.snap = m;
    this.mirror.apply(
      m,
      (hand, i, ms) => {
        if (this.role !== 'client') return;
        const h = hand === 'left' ? this.vr.left : hand === 'right' ? this.vr.right : null;
        h?.pulse(i, ms);
      },
      () => (this.bellT = 0),
    );
    if (m.phase !== this.lastPhase) {
      this.lastPhase = m.phase;
      if (this.role === 'client') this.showClientMenu(m.phase);
    }
  }

  /** Отправить хосту наши руки и голову. */
  private sendInput(): void {
    const c = this.client;
    if (!c || this.role !== 'client') return;
    const head = new THREE.Vector3();
    const headQ = new THREE.Quaternion();
    this.camera.getWorldPosition(head);
    this.camera.getWorldQuaternion(headQ);
    const hands: HandInput[] = this.localHands.map((h) => {
      const e = this.outEdges.get(h.id) ?? { grab: false, release: false, throw: false };
      const p = h.isVR ? h.pos : h.holdPos;
      const q = h.isVR ? h.quat : new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.desktop.yaw, 0));
      return { id: h.id, pose: pose(p, q), vel: v3(h.vel), ray: [...v3(h.ray.origin), ...v3(h.ray.direction)], use: h.use, ...e };
    });
    this.outEdges.clear();
    c.send({ t: 'input', vr: this.inVR, head: pose(head, headQ), hands });
  }

  /** Копим нажатия между отправками (30 в секунду), чтобы ни одно не потерялось. */
  private collectEdges(): void {
    for (const h of this.localHands) {
      const e = this.outEdges.get(h.id) ?? { grab: false, release: false, throw: false };
      e.grab ||= h.grab;
      e.release ||= h.release;
      e.throw ||= h.throw;
      this.outEdges.set(h.id, e);
    }
  }

  // ------------------------------------------------------------ выдача

  private serve(plate: Item): void {
    if (this.state !== 'playing') return;
    const res = this.orders.serve(plate);
    const at = this.kitchen.serve.pos.clone().setY(this.kitchen.serve.pos.y + 0.1);
    if (res.ok) {
      this.score.add(res.points);
      this.score.served++;
      this.sfx.play('serve', at);
      this.fx.confetti(at);
      this.ringBell();
      for (const h of this.hands) h.pulse(0.8, 120);
      if (!this.settings.learned.includes(res.order.recipe.id)) {
        this.settings.learned.push(res.order.recipe.id);
        this.saveSettings();
      }
      this.depart(plate);
    } else if (res.reason === 'wrong') {
      this.score.add(-WRONG_PENALTY);
      this.score.wrong++;
      this.sfx.play('fail', at);
      this.fx.puff(at, 0x888888);
      this.depart(plate);
    }
  }

  /** Тарелка улетает в окно выдачи. */
  private depart(plate: Item): void {
    if (plate.slot) {
      plate.slot.occupant = null;
      plate.slot = null;
    }
    plate.mode = 'dead';
    this.departing.push({ item: plate, t: 0 });
  }

  // ------------------------------------------------------------ кадр

  private get localHands(): Hand[] {
    return this.inVR ? this.vr.hands : [this.desktop.hand];
  }

  /** Все руки в симуляции: свои + руки второго игрока у хоста. */
  private get hands(): Hand[] {
    const local = this.localHands;
    if (this.role === 'host' && this.remote.active) return [...local, ...this.remote.hands];
    return local;
  }

  update(dt: number): void {
    this.time += dt;
    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;

    if (this.role === 'spectator') {
      this.updateSpectator(dt);
      return;
    }

    if (this.inVR) this.vr.update(dt, this.time);
    else this.desktop.update(dt);
    if (!this.inVR) {
      // ПК: где держится предмет и куда направлен поворот руки
      this.desktop.holdPoint(this.desktop.hand.holdPos);
      this.desktop.hand.quat.setFromEuler(new THREE.Euler(0, this.desktop.yaw, 0));
      this.desktop.hand.track(this.desktop.hand.holdPos, this.time);
    }
    if (this.role === 'host') this.remote.applyFrame();
    const hands = this.hands;
    const local = this.localHands;
    const menuVisible = this.menu.mesh.visible;
    this.vr.uiVisible = menuVisible;
    if (this.inVR && (this.state !== 'playing' || this.role === 'client')) for (const h of local) this.vr.setRay(h, menuVisible ? 2 : null);

    // ---- меню (только своими руками)
    if (menuVisible) {
      this.menu.update(dt);
      let hoverId: string | null = null;
      for (const h of local) {
        this.raycaster.ray.copy(h.ray);
        this.raycaster.far = 4;
        const hit = this.raycaster.intersectObject(this.menu.mesh, false)[0];
        if (!hit?.uv) continue;
        const id = this.menu.hitTest(hit.uv);
        if (id) hoverId = id;
        if (h.click) {
          h.grab = false;
          h.release = false;
          if (id) {
            h.pulse(0.5, 30);
            this.onMenuButton(id);
            break;
          }
        }
      }
      this.menu.setHover(hoverId);
    }

    if (this.role === 'client') {
      this.updateClient(dt);
      return;
    }

    const playing = this.state === 'playing';

    // ---- руки: захват и отпускание
    if (playing) {
      for (const h of hands) if (!h.isVR) this.updateAim(h);
      for (const h of hands) this.handleHand(h, hands);
      this.updateHighlights(hands);
    }

    if (this.state !== 'paused') {
      this.world.update(playing ? dt : 0, hands, (h, pos, quat) => {
        pos.copy(h.isVR ? h.pos : h.holdPos);
        quat.copy(h.quat);
      });
    }

    if (playing) {
      const camPos = new THREE.Vector3();
      this.camera.getWorldPosition(camPos);
      this.cooking.update(dt, hands, camPos);
      this.orders.update(dt, ROUND_LENGTH);
      this.score.update(dt);
      this.timeLeft -= dt;
      const secs = Math.ceil(this.timeLeft);
      if (secs <= 10 && secs !== this.lastTick && secs > 0) {
        this.lastTick = secs;
        this.sfx.play('tick', this.kitchen.hudPos);
      }
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.endRound();
      }
    }

    // ---- улетающие тарелки
    for (const d of this.departing) {
      d.t += dt;
      d.item.root.position.y += dt * 1.2;
      d.item.root.position.x += dt * 1.0;
      d.item.root.scale.setScalar(Math.max(0.01, 1 - d.t * 1.5));
    }
    for (const d of this.departing.filter((x) => x.t > 0.65)) this.world.remove(d.item);
    this.departing = this.departing.filter((x) => x.t <= 0.65);

    this.updateBell(dt);

    // ---- подсказки
    this.hint = '';
    this.hintAt = null;
    if (playing && this.settings.tutorial) {
      // подсказываем по первому заказу с блюдом, которое игрок ещё ни разу не выдавал
      const first = this.orders.active.find((o) => !this.settings.learned.includes(o.recipe.id));
      if (first) {
        const h = computeHint(first, this.world.items, this.kitchen, this.inVR);
        this.hint = h.text;
        this.hintAt = h.target;
      }
    }
    this.arrow.update(dt, this.hintAt);

    // ---- табло
    this.orderBoard.draw(this.orders.list, this.time);
    this.hud.draw(this.timeLeft, this.score.score, this.score.lastDelta, this.score.lastDeltaAge, this.hint, this.fps);

    // ---- второй игрок и зрители
    if (this.role === 'host' && this.host) {
      if (this.remote.active) {
        const p = this.remote;
        this.avatars[1].set({ head: p.head, hands: p.hands.map((h) => pose(h.isVR ? h.pos : h.holdPos, h.quat)), vr: p.isVR, rays: [] });
      }
      const camPos = this.camera.getWorldPosition(new THREE.Vector3());
      this.avatars[1].update(dt, camPos);
      this.snapTimer += dt;
      if (this.snapTimer >= SNAP_RATE && this.host.conns.size) {
        this.snapTimer = 0;
        this.host.broadcast(this.buildSnapshot(hands));
      }
    }

    this.fx.update(dt);
  }

  private updateBell(dt: number): void {
    if (this.bellT < 1) {
      this.bellT = Math.min(1, this.bellT + dt / 0.4);
      const s = 1 + Math.sin(this.bellT * Math.PI * 4) * (1 - this.bellT) * 0.4;
      this.kitchen.bell.scale.set(1, s, 1);
    }
  }

  /** Кадр второго игрока: кухня повторяет хоста, а мы отправляем свои руки. */
  private updateClient(dt: number): void {
    const s = this.snap;
    // ПК: решить «взять» или «положить» можно, только зная, держим ли мы что-то
    this.desktop.hand.held = this.mirror.heldBy('1:mouse');
    this.vr.left.held = this.mirror.heldBy('1:left');
    this.vr.right.held = this.mirror.heldBy('1:right');
    if (!this.menu.mesh.visible) this.collectEdges();
    this.inputTimer += dt;
    if (this.inputTimer >= INPUT_RATE) {
      this.inputTimer = 0;
      this.sendInput();
    }
    const camPos = this.camera.getWorldPosition(new THREE.Vector3());
    this.mirror.update(dt, camPos, (holder, p, q) => {
      if (holder === '1:mouse' && !this.inVR) {
        p.copy(this.desktop.hand.holdPos);
        q.copy(this.desktop.hand.quat);
        return true;
      }
      const h = holder === '1:left' ? this.vr.left : holder === '1:right' ? this.vr.right : null;
      if (h && this.inVR) {
        p.copy(h.pos);
        q.copy(h.quat);
        return true;
      }
      return false;
    });
    if (s) {
      if (s.players[0]) this.avatars[0].set(s.players[0]);
      const mine = s.players[1];
      if (mine && this.inVR) this.vr.hands.forEach((h, i) => this.vr.setRay(h, this.menu.mesh.visible ? 2 : mine.rays[i] > 0.2 ? mine.rays[i] : null));
      this.drawRemoteBoards(s);
    }
    this.avatars[0].update(dt, camPos);
    this.updateBell(dt);
    this.fx.update(dt);
  }

  /** Кадр зрителя: только смотрим. */
  private updateSpectator(dt: number): void {
    const s = this.snap;
    this.spectator.update(dt);
    const camPos = this.camera.getWorldPosition(new THREE.Vector3());
    this.mirror.update(dt, camPos, () => false);
    if (s) {
      s.players.forEach((p, i) => this.avatars[i]?.set(p));
      if (s.players.length < 2) this.avatars[1].hide();
      this.drawRemoteBoards(s);
    }
    for (const a of this.avatars) a.update(dt, camPos);
    this.updateBell(dt);
    this.fx.update(dt);
  }

  /** Табло заказов, счёт и подсказка — по данным хоста. */
  private drawRemoteBoards(s: Snapshot): void {
    const orders: Order[] = [];
    for (const o of s.orders) {
      const recipe = RECIPES.find((r) => r.id === o[1]);
      if (!recipe) continue;
      orders.push({ id: o[0] as number, recipe, timeLeft: o[2] as number, age: o[3] as number, leaving: o[4] as number, result: o[5] === 1 ? 'done' : o[5] === 2 ? 'expired' : null });
    }
    this.orderBoard.draw(orders, this.time);
    this.hud.draw(s.timeLeft, s.score, s.delta, s.deltaAge, s.hint, this.fps);
    this.arrow.update(1 / 60, s.hintAt ? new THREE.Vector3(s.hintAt[0], s.hintAt[1], s.hintAt[2]) : null);
  }

  /** Зритель: сменить камеру (кнопка на экране). */
  cycleSpectatorCam(): void {
    this.spectator.cycle();
    this.onSpectator({ code: this.client?.code ?? '', mode: this.spectator.mode });
  }

  leaveSpectator(): void {
    this.leaveRoom();
    this.showMainMenu();
    this.onOverlay(true, false);
  }

  /** ПК-рука: что под прицелом — предмет, место на столе, станция для нарезки. */
  private updateAim(h: Hand): void {
    this.raycaster.ray.copy(h.ray);
    this.raycaster.far = REACH;
    const hit = this.raycaster.intersectObjects(this.kitchen.aimTargets, false)[0];
    h.aimPoint = hit ? hit.point.clone() : null;
    const target = this.world.findByRay(h.ray, REACH, this.raycaster);
    h.hover = target?.item ?? null;
    const k = this.kitchen;
    const boxes = [...k.boardBoxes, k.spit.box];
    h.aimBox = null;
    let bestD = REACH;
    boxes.forEach((box, i) => {
      const occupant = i < k.boards.length ? k.boards[i].occupant : null;
      const p = h.ray.intersectBox(box, new THREE.Vector3());
      const d = occupant && h.hover === occupant ? 0 : p ? p.distanceTo(h.ray.origin) : Infinity;
      if (d < bestD) {
        bestD = d;
        h.aimBox = box;
      }
    });
  }

  private handleHand(h: Hand, hands: Hand[]): void {
    if (h.grab && !h.held) {
      let target: GrabTarget | null;
      if (h.isVR) target = this.vrTarget(h);
      else target = this.world.findByRay(h.ray, REACH, this.raycaster);
      if (target) this.world.grab(h, target, hands);
    }
    if (h.release && h.held) {
      if (h.isVR) {
        this.world.release(h, h.vel.clone());
      } else if (h.throw) {
        const v = h.ray.direction.clone().multiplyScalar(6);
        v.y += 1.5;
        this.world.release(h, v);
      } else if (h.aimPoint) {
        this.world.release(h, new THREE.Vector3(), h.aimPoint, 0.35);
      } else {
        this.world.release(h, new THREE.Vector3());
      }
    }
  }

  /**
   * Что возьмёт VR-рука: предмет рядом с ладонью, а если рядом ничего нет —
   * предмет на луче контроллера (так можно поднять еду с пола, не приседая).
   */
  private vrTarget(h: Hand): GrabTarget | null {
    const near = this.world.findNear(h);
    if (near) return { ...near, dist: 0 };
    const far = this.world.findByRay(h.ray, 3.5, this.raycaster);
    return far?.item ? far : null;
  }

  private pressPrimary(): void {
    if (!this.menu.mesh.visible) return;
    if (this.role === 'client') {
      if (this.lastPhase === 'paused') this.onMenuButton('c_resume');
      else if (this.lastPhase === 'results') this.onMenuButton('c_again');
      return;
    }
    if (this.state === 'results' || this.state === 'lobby') this.onMenuButton('start');
    else if (this.state === 'menu' && this.menu.mesh.visible && this.joinCode === '' && this.role === 'solo') this.onMenuButton('start');
    else if (this.state === 'paused') this.onMenuButton('resume');
  }

  private updateHighlights(hands: Hand[]): void {
    const now = new Set<Item>();
    for (const h of hands) {
      if (h.held) continue;
      const t = h.isVR ? this.vrTarget(h) : h.hover ? { item: h.hover, dist: 0 } : null;
      if (t?.item) now.add(t.item);
    }
    if (this.inVR) {
      for (const h of this.vr.hands) {
        const t = !h.held ? this.vrTarget(h) : null;
        this.vr.setRay(h, t && t.dist > 0.2 ? t.dist : null);
      }
    }
    // лучи второго игрока считает хост и отправляет ему
    if (this.remote.active && this.remote.isVR) {
      this.remote.rays = this.remote.vr.map((h) => {
        const t = !h.held ? this.vrTarget(h) : null;
        return t && t.dist > 0.2 ? t.dist : 0;
      });
    }
    for (const it of this.highlighted) if (!now.has(it)) it.setHighlight(false);
    for (const it of now) it.setHighlight(true);
    this.highlighted = now;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
    if (location.search.includes('debug')) {
      const info = this.renderer.info.render;
      this.onStats(`${Math.round(this.fps)} fps · ${info.calls} draw calls · ${info.triangles} tris · ${this.role}`);
    }
  }
}
