import * as THREE from 'three';

const _dir = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _target = new THREE.Vector3();
const _toEnemy = new THREE.Vector3();

const TURN_SPEED = 2.4; // rad/s with A/D
const MOUSE_SENS = 0.0024;
const FIRE_KEYS = ['KeyF', 'ControlLeft', 'ControlRight', 'Enter', 'KeyJ'];
const AIM_ASSIST_ANGLE = Math.cos(THREE.MathUtils.degToRad(16));
const AIM_ASSIST_RANGE = 70;
const BOLT_SPEED = 46;

/**
 * "Tank" style control: the mech has a heading, the camera always sits behind it.
 * A/D (or the mouse) turn the mech and the camera together, W/S drive forward/back,
 * Q/E strafe. Fire with the left mouse button or F / Ctrl / Enter; bolts get a mild
 * aim assist toward the nearest enemy in front, so keyboard-only play works too.
 */
export class PlayerController {
  constructor({ canvas, camera, spider, projectiles, terrain, enemies = () => [] }) {
    this.canvas = canvas;
    this.camera = camera;
    this.spider = spider;
    this.projectiles = projectiles;
    this.terrain = terrain;
    this.enemies = enemies; // () => Spider[]
    this.keys = new Set();
    this.heading = spider.yaw;
    this.camPitch = 0.38;
    this.locked = false;
    this.fallback = false; // mouse control without pointer lock (sandboxed iframes)
    this.mouseFiring = false;
    this.fireCooldown = 0;
    this.fireRate = 0.14;
    this.enabled = true;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();

    this._onKeyDown = (e) => {
      if (e.repeat) return;
      if (e.code === 'Escape' && this.fallback && this.locked) {
        this._setActive(false);
        return;
      }
      this.keys.add(e.code);
      if (!this.locked && this.fallback === false && (e.code === 'Enter' || e.code === 'Space')) {
        // keyboard-only start when nobody clicks
        this._enterFallback();
      }
      if (/^(Key[WASDQEFJ]|Space|ShiftLeft|ShiftRight|ControlLeft|ControlRight|Arrow(Up|Down|Left|Right)|Enter)$/.test(e.code)) {
        e.preventDefault();
      }
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      this.heading -= e.movementX * MOUSE_SENS;
      this.camPitch = THREE.MathUtils.clamp(this.camPitch + e.movementY * MOUSE_SENS, -0.2, 1.2);
    };
    this._onMouseDown = (e) => {
      if (e.button !== 0) return;
      if (!this.locked) {
        if (this.fallback || !canvas.requestPointerLock) {
          this._setActive(true);
          return;
        }
        try {
          const r = canvas.requestPointerLock();
          if (r && r.catch) r.catch(() => this._enterFallback());
        } catch (err) {
          this._enterFallback();
          return;
        }
        // Some sandboxes ignore the request silently: fall back to plain mouse control.
        setTimeout(() => {
          if (!this.locked && !this.fallback) this._enterFallback();
        }, 500);
        return;
      }
      this.mouseFiring = true;
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.mouseFiring = false;
    };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.mouseFiring = false;
      canvas.dispatchEvent(new CustomEvent('pointerlock', { detail: this.locked }));
    };
    this._onLockError = () => this._enterFallback();
    this._onBlur = () => {
      this.keys.clear();
      this.mouseFiring = false;
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', this._onLockChange);
    document.addEventListener('pointerlockerror', this._onLockError);
    window.addEventListener('blur', this._onBlur);
  }

  _enterFallback() {
    if (this.fallback) return;
    this.fallback = true;
    this._setActive(true);
  }

  /** Fallback mode: emulate lock/unlock so the rest of the game sees the same events. */
  _setActive(on) {
    this.locked = on;
    if (!on) this.mouseFiring = false;
    this.canvas.dispatchEvent(new CustomEvent('pointerlock', { detail: on }));
  }

  get firing() {
    if (this.mouseFiring) return true;
    for (const k of FIRE_KEYS) if (this.keys.has(k)) return true;
    return false;
  }

  update(dt) {
    const spider = this.spider;
    const k = this.keys;
    const active = this.enabled && !spider.dead;

    let input = { move: { x: 0, z: 0 } };
    if (active) {
      // turning
      let turn = 0;
      if (k.has('KeyA') || k.has('ArrowLeft')) turn += 1;
      if (k.has('KeyD') || k.has('ArrowRight')) turn -= 1;
      this.heading += turn * TURN_SPEED * dt;
      if (k.has('ArrowUp')) this.camPitch = Math.max(-0.2, this.camPitch - 1.2 * dt);
      if (k.has('ArrowDown')) this.camPitch = Math.min(1.2, this.camPitch + 1.2 * dt);

      // driving relative to the heading
      let f = 0;
      let r = 0;
      if (k.has('KeyW')) f += 1;
      if (k.has('KeyS')) f -= 1;
      if (k.has('KeyE')) r += 1;
      if (k.has('KeyQ')) r -= 1;
      const len = Math.hypot(f, r) || 1;
      f /= len;
      r /= len;
      const s = Math.sin(this.heading);
      const c = Math.cos(this.heading);
      input = {
        move: { x: f * s + r * c, z: f * c - r * s },
        sprint: k.has('ShiftLeft') || k.has('ShiftRight'),
        jump: k.has('Space'),
        yaw: this.heading,
      };
    }
    spider.update(dt, input);

    // --- camera: sits behind the mech, always looking along its heading
    const dist = 9.5;
    const s = Math.sin(this.heading);
    const c = Math.cos(this.heading);
    const cp = Math.cos(this.camPitch);
    const sp = Math.sin(this.camPitch);
    const p = spider.position;
    _target.set(p.x + s * 3, p.y + 1.0, p.z + c * 3);
    this.camPos.set(p.x - s * cp * dist, p.y + 1.2 + sp * dist, p.z - c * cp * dist);
    const ground = this.terrain.heightAt(this.camPos.x, this.camPos.z) + 1.2;
    if (this.camPos.y < ground) this.camPos.y = ground;
    const lerpK = 1 - Math.exp(-14 * dt);
    this.camera.position.lerp(this.camPos, lerpK);
    this.camLook.lerp(_target, lerpK);
    this.camera.lookAt(this.camLook);

    // --- firing
    this.fireCooldown -= dt;
    if (active && this.firing && this.fireCooldown <= 0) {
      this.fireCooldown = this.fireRate;
      spider.forward(_muzzle).multiplyScalar(1.6);
      _muzzle.add(p).y += 0.55;
      this._aimPoint(_aim, _muzzle);
      _dir.subVectors(_aim, _muzzle).normalize();
      this._aimAssist(_muzzle, _dir);
      this.projectiles.spawn(_muzzle, _dir, spider, spider.color, { speed: BOLT_SPEED });
      spider.body.velocity.x -= _dir.x * 0.6; // small recoil
      spider.body.velocity.z -= _dir.z * 0.6;
    }
  }

  /**
   * Where the crosshair points: the camera ray marched against the terrain. If the ray hits
   * the ground too close (the camera looks down at the mech itself), shoot level instead.
   */
  _aimPoint(out, muzzle) {
    this.camera.getWorldDirection(_dir);
    const o = this.camera.position;
    const maxT = 120;
    let t = 0;
    let hit = -1;
    let prev = o.y - this.terrain.heightAt(o.x, o.z);
    for (t = 1; t <= maxT; t += 1) {
      const x = o.x + _dir.x * t;
      const y = o.y + _dir.y * t;
      const z = o.z + _dir.z * t;
      const above = y - this.terrain.heightAt(x, z);
      if (above <= 0) {
        // linear refine between the last two samples
        hit = t - 1 + prev / (prev - above);
        break;
      }
      prev = above;
    }
    if (hit < 0) hit = maxT;
    const camToMech = o.distanceTo(muzzle);
    if (hit < camToMech + 2.5) {
      // Looking at the ground right in front: fire straight ahead, level.
      this.spider.forward(out).multiplyScalar(60).add(muzzle);
      return out;
    }
    return out.copy(o).addScaledVector(_dir, hit);
  }

  /**
   * Bend the shot toward the closest living enemy inside a narrow horizontal cone in front.
   * Only the yaw is compared (the camera looks down from above, so pitch is unreliable);
   * a hit takes the full 3D direction to the enemy.
   */
  _aimAssist(origin, dir) {
    const hx = dir.x;
    const hz = dir.z;
    const hl = Math.hypot(hx, hz) || 1;
    let best = null;
    let bestDot = AIM_ASSIST_ANGLE;
    for (const e of this.enemies()) {
      if (e.dead) continue;
      _toEnemy.copy(e.position).sub(origin);
      const d = Math.hypot(_toEnemy.x, _toEnemy.z);
      if (d > AIM_ASSIST_RANGE || d < 1) continue;
      const dot = (_toEnemy.x * hx + _toEnemy.z * hz) / (d * hl);
      if (dot > bestDot) {
        bestDot = dot;
        best = e;
      }
    }
    if (best) {
      // lead the target by its current velocity over the bolt's flight time
      dir.copy(best.position).sub(origin);
      const flight = dir.length() / BOLT_SPEED;
      dir.addScaledVector(best.velocity, flight);
      dir.y += 0.3;
      dir.normalize();
    }
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    document.removeEventListener('pointerlockerror', this._onLockError);
    window.removeEventListener('blur', this._onBlur);
  }
}
