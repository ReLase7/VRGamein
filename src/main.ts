import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { Game } from './game';

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

const game = new Game(renderer);

const overlay = document.getElementById('overlay')!;
const playBtn = document.getElementById('playDesktop') as HTMLButtonElement;
const stats = document.getElementById('stats')!;

game.onOverlay = (show, paused) => {
  overlay.classList.toggle('hidden', !show);
  playBtn.textContent = paused ? 'Продолжить' : 'Играть на ПК';
};
game.onStats = (s) => {
  stats.textContent = s;
};

playBtn.addEventListener('click', () => {
  game.lockDesktop();
});
vrButton.addEventListener('click', () => game.userGesture());
window.addEventListener('resize', () => game.resize());

// ?debug — доступ к игре из консоли браузера для отладки
if (location.search.includes('debug')) (window as unknown as { game: Game }).game = game;

const timer = new THREE.Timer();
renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 0.05);
  game.update(dt);
  game.render();
});
