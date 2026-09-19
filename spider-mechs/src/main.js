import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Terrain } from './terrain.js';
import { Spider } from './spider.js';
import { PlayerController } from './player.js';
import { EnemyController } from './enemy.js';
import { Projectiles } from './projectiles.js';
import { Effects } from './effects.js';
import { spawnProps, syncProps, removeProps } from './props.js';
import { makeRng } from './noise.js';

const ENEMY_COUNT = 8;
const PLAYER_COLOR = 0x00e5ff;
const ENEMY_COLORS = [0xff2d55, 0xff7a1c, 0xd63cff];

// ------------------------------------------------------------------ DOM
const canvas = document.getElementById('c');
const hud = {
  hp: document.getElementById('hp-fill'),
  hpText: document.getElementById('hp-text'),
  enemies: document.getElementById('enemies'),
  overlay: document.getElementById('overlay'),
  title: document.getElementById('overlay-title'),
  sub: document.getElementById('overlay-sub'),
  fps: document.getElementById('fps'),
  crosshair: document.getElementById('crosshair'),
};

// ------------------------------------------------------------------ renderer / scene
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;

const scene = new THREE.Scene();
const SKY = 0x0a0e22;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.FogExp2(SKY, 0.012);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 400);
camera.position.set(0, 12, -18);

const hemi = new THREE.HemisphereLight(0x6f83ff, 0x2a1848, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xdfe6ff, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 120;
sun.shadow.camera.left = -34;
sun.shadow.camera.right = 34;
sun.shadow.camera.top = 34;
sun.shadow.camera.bottom = -34;
sun.shadow.bias = -0.0015;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

// A pink rim light from the opposite side gives the low-poly faces some colour contrast.
const rim = new THREE.DirectionalLight(0xff4fa3, 0.8);
rim.position.set(-40, 20, -60);
scene.add(rim);

// Stars (unaffected by fog)
{
  const n = 1400;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const b = Math.acos(Math.random() * 0.9); // upper hemisphere
    const r = 330;
    pos[i * 3] = Math.cos(a) * Math.sin(b) * r;
    pos[i * 3 + 1] = Math.cos(b) * r + 5;
    pos[i * 3 + 2] = Math.sin(a) * Math.sin(b) * r;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color: 0xbfd4ff, size: 1.6, fog: false, sizeAttenuation: true });
  const stars = new THREE.Points(g, m);
  stars.frustumCulled = false;
  scene.add(stars);
}

// ------------------------------------------------------------------ physics
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
world.defaultContactMaterial.friction = 0.45;
world.defaultContactMaterial.restitution = 0.15;
world.solver.iterations = 8;

const terrain = new Terrain({ size: 160, segments: 96, amplitude: 7, seed: 3 });
scene.add(terrain.mesh, terrain.wire);
world.addBody(terrain.body);

const effects = new Effects(renderer, scene, camera);
const entities = new Map(); // body.id -> entity (anything with takeDamage/team)
const projectiles = new Projectiles(scene, world, effects, entities);

// ------------------------------------------------------------------ game state
const game = {
  player: null,
  playerCtl: null,
  enemies: [], // { spider, ctl }
  props: [],
  over: false,
  won: false,
  rng: makeRng(1234),
  time: 0,
};

world.addEventListener('preStep', () => {
  if (game.player) game.player.hover();
  for (const e of game.enemies) e.spider.hover();
  projectiles.preStep();
});

function spawnPlayer() {
  const spider = new Spider({
    scene,
    world,
    terrain,
    position: { x: 0, y: terrain.heightAt(0, 0) + 2.5, z: 0 },
    color: PLAYER_COLOR,
    team: 'player',
    hp: 10,
    speed: 7.5,
  });
  entities.set(spider.body.id, spider);
  return spider;
}

function spawnEnemies(count) {
  const list = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + game.rng() * 0.6;
    const r = 34 + game.rng() * 22;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const spider = new Spider({
      scene,
      world,
      terrain,
      position: { x, y: terrain.heightAt(x, z) + 2.5, z },
      color: ENEMY_COLORS[i % ENEMY_COLORS.length],
      team: 'enemy',
      hp: 3,
      speed: 5.2 + game.rng() * 1.2,
    });
    spider.yaw = game.rng() * Math.PI * 2;
    entities.set(spider.body.id, spider);
    const ctl = new EnemyController({ spider, player: game.player, projectiles, terrain, rng: game.rng });
    list.push({ spider, ctl });
  }
  return list;
}

function clearGame() {
  if (game.playerCtl) game.playerCtl.dispose();
  if (game.player) game.player.dispose();
  for (const e of game.enemies) e.spider.dispose();
  game.enemies.length = 0;
  removeProps(scene, world, game.props);
  projectiles.clear();
  entities.clear();
}

function startGame() {
  clearGame();
  game.rng = makeRng(1234 + Math.floor(Math.random() * 1000));
  game.over = false;
  game.won = false;
  game.time = 0;
  game.player = spawnPlayer();
  game.playerCtl = new PlayerController({
    canvas,
    camera,
    spider: game.player,
    projectiles,
    terrain,
    enemies: () => game.enemies.map((e) => e.spider),
  });
  game.enemies = spawnEnemies(ENEMY_COUNT);
  game.props = spawnProps(scene, world, terrain, game.rng);
  showOverlay('SPIDER MECHS', 'Кликни по экрану или нажми Enter, чтобы начать');
}

function showOverlay(title, sub) {
  hud.title.textContent = title;
  hud.sub.innerHTML = sub;
  hud.overlay.classList.remove('hidden');
  hud.crosshair.classList.add('hidden');
}
function hideOverlay() {
  hud.overlay.classList.add('hidden');
  hud.crosshair.classList.remove('hidden');
}

canvas.addEventListener('pointerlock', (e) => {
  if (e.detail) {
    if (game.over) startGame();
    hideOverlay();
  } else if (!game.over) {
    showOverlay('ПАУЗА', 'Кликни, чтобы продолжить');
  }
});

function endGame(won) {
  game.over = true;
  game.won = won;
  game.playerCtl.enabled = false;
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  showOverlay(
    won ? 'ПОБЕДА' : 'МЕХ УНИЧТОЖЕН',
    won
      ? `Все ${ENEMY_COUNT} вражеских пауков выведены из строя за ${game.time.toFixed(1)} с.<br>Кликни, чтобы сыграть ещё раз`
      : 'Кликни, чтобы попробовать снова'
  );
}

// ------------------------------------------------------------------ loop
const clock = new THREE.Clock();
const _v = new THREE.Vector3();
let fpsAcc = 0;
let fpsN = 0;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  const paused = !game.playerCtl.locked && !game.over && game.time > 0.5;
  const step = paused ? 0 : dt;
  game.time += step;

  if (step > 0) {
    game.playerCtl.update(step);
    for (const e of game.enemies) e.ctl.update(step);
    world.step(1 / 60, step, 3);
    projectiles.update(step);
    syncProps(game.props);
    effects.update(step);

    // Remove enemies that have been dead for a while.
    for (let i = game.enemies.length - 1; i >= 0; i--) {
      const e = game.enemies[i];
      if (e.spider.dead && e.spider.deadTime > 3.5) {
        effects.burst(e.spider.position, e.spider.color, { count: 40, speed: 9, life: 0.9 });
        entities.delete(e.spider.body.id);
        e.spider.dispose();
        game.enemies.splice(i, 1);
      }
    }
    // Deaths spawn a burst once.
    for (const e of game.enemies) {
      if (e.spider.dead && !e.spider._boomed) {
        e.spider._boomed = true;
        effects.burst(e.spider.position, e.spider.color, { count: 90, speed: 12, life: 1.1, up: 4 });
        effects.burst(e.spider.position, 0xffffff, { count: 25, speed: 6, life: 0.5 });
      }
    }
    if (game.player.dead && !game.player._boomed) {
      game.player._boomed = true;
      effects.burst(game.player.position, game.player.color, { count: 120, speed: 12, life: 1.2, up: 4 });
    }

    if (!game.over) {
      if (game.player.dead) endGame(false);
      else if (game.enemies.length === 0 || game.enemies.every((e) => e.spider.dead)) endGame(true);
    }
  } else {
    // While paused keep the player camera & legs still but let the scene render.
  }

  // Shadow camera follows the player.
  const p = game.player.position;
  sun.position.set(p.x + 26, p.y + 42, p.z + 14);
  sun.target.position.set(p.x, p.y, p.z);
  sun.target.updateMatrixWorld();

  // HUD
  const hp = Math.max(0, game.player.hp) / game.player.maxHp;
  hud.hp.style.width = `${hp * 100}%`;
  hud.hp.style.background = hp > 0.5 ? '#00e5ff' : hp > 0.25 ? '#ffb01c' : '#ff2d55';
  hud.hpText.textContent = `${Math.max(0, game.player.hp)} / ${game.player.maxHp}`;
  hud.enemies.textContent = String(game.enemies.filter((e) => !e.spider.dead).length);
  fpsAcc += dt;
  fpsN++;
  if (fpsAcc > 0.5) {
    hud.fps.textContent = `${Math.round(fpsN / fpsAcc)} fps`;
    fpsAcc = 0;
    fpsN = 0;
  }

  effects.render();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  effects.setSize(window.innerWidth, window.innerHeight);
});

startGame();
frame();

// Debug handle for tests / console tinkering.
window.__game = { game, world, scene, terrain, projectiles, camera, renderer, THREE, CANNON };
