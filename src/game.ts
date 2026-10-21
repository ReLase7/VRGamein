import * as THREE from 'three';
import { buildKitchen, ROOM, type Kitchen } from './world/kitchen';
import { Particles } from './world/particles';
import { ItemWorld, type GrabTarget } from './systems/grab';
import { Cooking } from './systems/cooking';
import { Orders } from './systems/orders';
import { Score, EXPIRE_PENALTY, WRONG_PENALTY, STAR_THRESHOLDS } from './systems/score';
import { computeHint, HintArrow } from './systems/tutorial';
import { Sfx } from './audio/sfx';
import { DesktopControls } from './input/desktop';
import { VRControls } from './xr/vr';
import type { Hand } from './input/hand';
import type { Item } from './items/item';
import { HudBoard, MenuPanel, OrderBoard, type MenuSpec } from './ui/hud';
import { PALETTE } from './style/toon';

export const ROUND_LENGTH = 180;
const REACH = 2.6;

type State = 'menu' | 'playing' | 'paused' | 'results';

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

const playingNow = (s: State): boolean => s === 'playing';

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
  private desktopAimPoint: THREE.Vector3 | null = null;
  private desktopAimBox: THREE.Box3 | null = null;
  private pauseReason: 'vr' | 'unlock' | null = null;

  /** Вызывается, когда нужно показать/спрятать HTML-оверлей на ПК. */
  onOverlay: (show: boolean, paused: boolean) => void = () => {};
  onStats: (s: string) => void = () => {};

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
      this.bellT = 0;
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

  /** Первое действие пользователя — разрешаем звук. */
  userGesture(): void {
    this.sfx.resume();
  }

  lockDesktop(): void {
    this.sfx.resume();
    this.desktop.lock();
  }

  resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ------------------------------------------------------------ состояния

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
        { id: 'turn', label: `Бұрылу: ${this.settings.snapAngle}°` },
        { id: 'sound', label: `Дыбыс: ${this.settings.sound ? 'қосулы' : 'өшірулі'}` },
        { id: 'tutorial', label: `Кеңестер: ${this.settings.tutorial ? 'қосулы' : 'өшірулі'}` },
        { id: 'records', label: 'Рекордтар', color: '#b8f08f' },
      ],
    });
  }

  private showRecords(): void {
    const list = Score.load();
    this.showMenu({
      title: 'Рекордтар',
      lines: list.length ? list.map((h, i) => `${i + 1}.  ${h.score} ұпай  ${'★'.repeat(h.stars)}${'☆'.repeat(3 - h.stars)}  ${h.date}`) : ['Әзірге бос — бір раунд ойнаңыз!'],
      buttons: [{ id: 'back', label: 'Артқа' }],
    });
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
    this.showMenu({
      title: 'Уақыт бітті!',
      subtitle: place === 0 ? 'Жаңа рекорд!' : `${s.score} ұпай`,
      stars: s.stars,
      lines: [
        place === 0 ? `${s.score} ұпай` : `Үздік нәтиже: ${Score.load()[0]?.score ?? s.score}`,
        `Берілген тағам: ${s.served}   Кешіккен тапсырыс: ${s.expired}`,
        next ? `Келесі жұлдызға дейін: ${next - s.score}` : 'Барлық жұлдыз жиналды!',
      ],
      buttons: [
        { id: 'start', label: '↻  Тағы да', color: '#ff8a5c' },
        { id: 'menu', label: 'Мәзірге' },
      ],
    });
  }

  private togglePause(): void {
    if (this.state === 'playing') this.pause('vr');
    else if (this.state === 'paused') this.resume();
  }

  private pause(reason: 'vr' | 'unlock'): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.pauseReason = reason;
    this.cooking.reset();
    const buttons = [
      { id: 'resume', label: '▶  Жалғастыру', color: '#ff8a5c' },
      { id: 'start', label: '↻  Қайта бастау' },
      { id: 'menu', label: 'Мәзірге' },
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

  private onMenuButton(id: string): void {
    this.sfx.play('click');
    switch (id) {
      case 'start':
        this.startRound();
        break;
      case 'resume':
        this.resume();
        break;
      case 'menu':
        this.world.clearAll();
        this.orders.reset();
        this.orders.list = [];
        this.score.reset();
        this.timeLeft = ROUND_LENGTH;
        this.showMainMenu();
        break;
      case 'turn': {
        const options = [30, 45, 90];
        this.settings.snapAngle = options[(options.indexOf(this.settings.snapAngle) + 1) % options.length];
        this.vr.snapAngle = this.settings.snapAngle;
        this.saveSettings();
        this.showMainMenu();
        break;
      }
      case 'sound':
        this.settings.sound = !this.settings.sound;
        this.sfx.setEnabled(this.settings.sound);
        this.saveSettings();
        this.showMainMenu();
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

  private onLockChange(locked: boolean): void {
    document.getElementById('crosshair')?.classList.toggle('hidden', !locked);
    if (this.inVR) return;
    if (!locked) {
      if (this.state === 'playing') this.pause('unlock');
      this.onOverlay(true, this.state === 'paused');
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
    this.sfx.resume();
    this.onOverlay(false, false);
    // меню появится перед глазами после первого кадра с позой головы
    setTimeout(() => this.menu.mesh.visible && this.placeMenu(), 300);
  }

  private onSessionEnd(): void {
    this.desktop.enabled = true;
    this.rig.position.set(0, 0, 0);
    this.rig.rotation.set(0, 0, 0);
    this.vr.uiVisible = false;
    if (this.state === 'playing') this.pause('unlock');
    this.onOverlay(true, this.state === 'paused');
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
      this.bellT = 0;
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

  private get hands(): Hand[] {
    return this.inVR ? this.vr.hands : [this.desktop.hand];
  }

  update(dt: number): void {
    this.time += dt;
    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;

    if (this.inVR) this.vr.update(dt, this.time);
    else this.desktop.update(dt);
    const hands = this.hands;
    const menuVisible = this.menu.mesh.visible;
    this.vr.uiVisible = menuVisible;
    if (this.inVR && !playingNow(this.state)) for (const h of hands) this.vr.setRay(h, menuVisible ? 2 : null);

    // ---- меню
    if (menuVisible) {
      this.menu.update(dt);
      let hoverId: string | null = null;
      for (const h of hands) {
        this.raycaster.ray.copy(h.ray);
        this.raycaster.far = 4;
        const hit = this.raycaster.intersectObject(this.menu.mesh, false)[0];
        if (!hit?.uv) continue;
        const id = this.menu.hitTest(hit.uv);
        if (id) hoverId = id;
        if (h.click) {
          h.grab = false;
          if (id) {
            h.pulse(0.5, 30);
            this.onMenuButton(id);
            break;
          }
        }
      }
      this.menu.setHover(hoverId);
    }

    const playing = this.state === 'playing';

    // ---- руки: захват и отпускание
    if (playing) {
      if (!this.inVR) this.updateDesktopAim();
      for (const h of hands) this.handleHand(h, hands);
      this.updateHighlights(hands);
    }

    if (this.state !== 'paused') {
      this.world.update(playing ? dt : 0, hands, (h, pos, quat) => {
        if (h.isVR) {
          pos.copy(h.pos);
          quat.copy(h.quat);
        } else {
          this.desktop.holdPoint(pos);
          quat.setFromEuler(new THREE.Euler(0, this.desktop.yaw, 0));
        }
      });
    }

    if (playing) {
      const camPos = new THREE.Vector3();
      this.camera.getWorldPosition(camPos);
      this.cooking.update(dt, hands, camPos, this.desktopAimBox);
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

    // ---- звонок прыгает
    if (this.bellT < 1) {
      this.bellT = Math.min(1, this.bellT + dt / 0.4);
      const s = 1 + Math.sin(this.bellT * Math.PI * 4) * (1 - this.bellT) * 0.4;
      this.kitchen.bell.scale.set(1, s, 1);
    }

    // ---- подсказки
    let hint = '';
    let target: THREE.Vector3 | null = null;
    if (playing && this.settings.tutorial) {
      // подсказываем по первому заказу с блюдом, которое игрок ещё ни разу не выдавал
      const first = this.orders.active.find((o) => !this.settings.learned.includes(o.recipe.id));
      if (first) {
        const h = computeHint(first, this.world.items, this.kitchen, this.inVR);
        hint = h.text;
        target = h.target;
      }
    }
    this.arrow.update(dt, target);

    // ---- табло
    this.orderBoard.draw(this.orders.list, this.time);
    this.hud.draw(this.timeLeft, this.score.score, this.score.lastDelta, this.score.lastDeltaAge, hint, this.fps);

    this.fx.update(dt);
  }

  private updateDesktopAim(): void {
    const h = this.desktop.hand;
    this.raycaster.ray.copy(h.ray);
    this.raycaster.far = REACH;
    const hit = this.raycaster.intersectObjects(this.kitchen.aimTargets, false)[0];
    this.desktopAimPoint = hit ? hit.point.clone() : null;
    const target = this.world.findByRay(h.ray, REACH, this.raycaster);
    h.hover = target?.item ?? null;
    // какая станция (доска или вертел) под прицелом — для нарезки клавишей E
    const k = this.kitchen;
    const boxes = [...k.boardBoxes, k.spit.box];
    this.desktopAimBox = null;
    let bestD = REACH;
    boxes.forEach((box, i) => {
      const occupant = i < k.boards.length ? k.boards[i].occupant : null;
      const p = h.ray.intersectBox(box, new THREE.Vector3());
      const d = occupant && h.hover === occupant ? 0 : p ? p.distanceTo(h.ray.origin) : Infinity;
      if (d < bestD) {
        bestD = d;
        this.desktopAimBox = box;
      }
    });
    const p = new THREE.Vector3();
    this.desktop.holdPoint(p);
    h.track(p, this.time);
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
      } else if (this.desktopAimPoint) {
        this.world.release(h, new THREE.Vector3(), this.desktopAimPoint, 0.35);
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
    if (this.state === 'results' || this.state === 'menu') this.onMenuButton('start');
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
      for (const h of hands) {
        const t = !h.held ? this.vrTarget(h) : null;
        this.vr.setRay(h, t && t.dist > 0.2 ? t.dist : null);
      }
    }
    for (const it of this.highlighted) if (!now.has(it)) it.setHighlight(false);
    for (const it of now) it.setHighlight(true);
    this.highlighted = now;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
    if (location.search.includes('debug')) {
      const info = this.renderer.info.render;
      this.onStats(`${Math.round(this.fps)} fps · ${info.calls} draw calls · ${info.triangles} tris`);
    }
  }
}
