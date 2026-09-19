import * as THREE from 'three';

const _dir = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _target = new THREE.Vector3();

/** Keyboard + pointer-lock mouse control, third-person chase camera, firing. */
export class PlayerController {
  constructor({ canvas, camera, spider, projectiles, terrain }) {
    this.canvas = canvas;
    this.camera = camera;
    this.spider = spider;
    this.projectiles = projectiles;
    this.terrain = terrain;
    this.keys = new Set();
    this.camYaw = 0;
    this.camPitch = 0.42;
    this.locked = false;
    this.firing = false;
    this.fireCooldown = 0;
    this.fireRate = 0.14;
    this.enabled = true;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();

    this._onKeyDown = (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      this.camYaw -= e.movementX * 0.0024;
      this.camPitch = THREE.MathUtils.clamp(this.camPitch + e.movementY * 0.0024, -0.15, 1.25);
    };
    this._onMouseDown = (e) => {
      if (e.button !== 0) return;
      if (!this.locked) {
        canvas.requestPointerLock?.();
        return;
      }
      this.firing = true;
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.firing = false;
    };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.firing = false;
      canvas.dispatchEvent(new CustomEvent('pointerlock', { detail: this.locked }));
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('pointerlockchange', this._onLockChange);
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Movement vector in world space, relative to the camera yaw. */
  _moveVector() {
    const k = this.keys;
    let f = 0;
    let r = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) r += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) r -= 1;
    const len = Math.hypot(f, r) || 1;
    f /= len;
    r /= len;
    const s = Math.sin(this.camYaw);
    const c = Math.cos(this.camYaw);
    // camera forward = (s, 0, c), camera right = (c, 0, -s)
    return { x: f * s + r * c, z: f * c - r * s };
  }

  update(dt) {
    const spider = this.spider;
    const input = this.enabled && !spider.dead
      ? {
          move: this._moveVector(),
          sprint: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
          jump: this.keys.has('Space'),
          faceYaw: this.camYaw,
        }
      : { move: { x: 0, z: 0 } };
    spider.update(dt, input);

    // --- camera: third person, orbiting behind the mech
    const dist = 9.5;
    const s = Math.sin(this.camYaw);
    const c = Math.cos(this.camYaw);
    const cp = Math.cos(this.camPitch);
    const sp = Math.sin(this.camPitch);
    const p = spider.position;
    _target.set(p.x, p.y + 1.0, p.z);
    this.camPos.set(p.x - s * cp * dist, p.y + 1.2 + sp * dist, p.z - c * cp * dist);
    const ground = this.terrain.heightAt(this.camPos.x, this.camPos.z) + 1.2;
    if (this.camPos.y < ground) this.camPos.y = ground;
    const k = 1 - Math.exp(-14 * dt);
    this.camera.position.lerp(this.camPos, k);
    this.camLook.lerp(_target, k);
    this.camera.lookAt(this.camLook);

    // --- firing
    this.fireCooldown -= dt;
    if (this.firing && this.enabled && !spider.dead && this.fireCooldown <= 0) {
      this.fireCooldown = this.fireRate;
      this.camera.getWorldDirection(_dir);
      _aim.copy(this.camera.position).addScaledVector(_dir, 90);
      spider.forward(_muzzle).multiplyScalar(1.6);
      _muzzle.add(p).y += 0.55;
      _dir.subVectors(_aim, _muzzle).normalize();
      this.projectiles.spawn(_muzzle, _dir, spider, spider.color);
      spider.body.velocity.x -= _dir.x * 0.6; // small recoil
      spider.body.velocity.z -= _dir.z * 0.6;
    }
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }
}
