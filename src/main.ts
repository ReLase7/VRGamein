import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { Game } from './game';
import { loadModels } from './style/models';

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(1);
document.body.appendChild(renderer.domElement);

const vrButton = VRButton.createButton(renderer, { optionalFeatures: ['bounded-floor', 'layers'] });
document.body.appendChild(vrButton);

const overlay = document.getElementById('overlay')!;
const playBtn = document.getElementById('playDesktop') as HTMLButtonElement;

// Сначала загружаем модели Kenney, потом строим кухню.
playBtn.disabled = true;
await loadModels((done, total) => {
  playBtn.textContent = `Жүктелуде… ${Math.round((done / total) * 100)}%`;
});
playBtn.disabled = false;
playBtn.textContent = 'ДК-да ойнау';

const game = new Game(renderer);
const stats = document.getElementById('stats')!;

game.onOverlay = (show, paused) => {
  overlay.classList.toggle('hidden', !show);
  playBtn.textContent = paused ? 'Жалғастыру' : 'ДК-да ойнау';
};
game.onStats = (s) => {
  stats.textContent = s;
};

playBtn.addEventListener('click', () => {
  game.lockDesktop();
});

// ---- бірге ойнау: код комнаты, вход игроком или зрителем
const codeInput = document.getElementById('roomCode') as HTMLInputElement;
const notice = document.getElementById('notice')!;
const specbar = document.getElementById('specbar')!;
const specInfo = document.getElementById('specInfo')!;
const CAMS = ['Жалпы көрініс', '1-ойыншы', '2-ойыншы'];
codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 4);
  notice.textContent = '';
});
const joinAs = (role: 'player' | 'spectator'): void => {
  const code = codeInput.value.trim();
  if (!/^\d{4}$/.test(code)) {
    notice.textContent = 'Бөлме кодын енгізіңіз (4 сан)';
    return;
  }
  notice.textContent = 'Қосылуда…';
  game.joinFromDesktop(code, role);
};
document.getElementById('watchBtn')!.addEventListener('click', () => joinAs('spectator'));
document.getElementById('joinBtn')!.addEventListener('click', () => joinAs('player'));
document.getElementById('specCam')!.addEventListener('click', () => game.cycleSpectatorCam());
document.getElementById('specLeave')!.addEventListener('click', () => game.leaveSpectator());
game.onNotice = (t) => {
  notice.textContent = t;
  overlay.classList.remove('hidden');
};
game.onSpectator = (info) => {
  specbar.classList.toggle('hidden', !info);
  vrButton.style.display = info ? 'none' : '';
  if (info) {
    notice.textContent = '';
    specInfo.textContent = `👀 Көрермен · Бөлме ${info.code} · ${CAMS[info.mode]} (1/2/3)`;
  }
};
window.addEventListener('keydown', (e) => {
  if (!specbar.classList.contains('hidden') && /^Digit[123]$/.test(e.code)) {
    setTimeout(() => game.onSpectator({ code: specInfo.textContent?.match(/\d{4}/)?.[0] ?? '', mode: Number(e.code.slice(-1)) - 1 }), 0);
  }
});
// ссылка вида ?watch=1234 или ?join=1234 сразу подключает
const q = new URLSearchParams(location.search);
const auto = q.get('watch') ?? q.get('join');
if (auto && /^\d{4}$/.test(auto)) {
  codeInput.value = auto;
  if (q.has('watch')) joinAs('spectator');
}
vrButton.addEventListener('click', () => game.userGesture());
window.addEventListener('resize', () => game.resize());

// ?debug — доступ к игре из консоли браузера для отладки
if (location.search.includes('debug')) (window as unknown as { game: Game }).game = game;

const timer = new THREE.Timer();
renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 0.05);
  game.update(dt);
  // для автотестов с несколькими окнами: можно временно не рисовать кадр
  if (!(window as unknown as { __norender?: boolean }).__norender) game.render();
});
