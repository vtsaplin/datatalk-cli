import * as THREE from 'three';

const _to = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _lead = new THREE.Vector3();

const CHASE_RANGE = 34;
const ATTACK_RANGE = 20;
const MAP_LIMIT = 66;

/** Simple state machine driving an enemy Spider: wander -> chase -> attack (orbit + shoot). */
export class EnemyController {
  constructor({ spider, player, projectiles, terrain, rng }) {
    this.spider = spider;
    this.player = player;
    this.projectiles = projectiles;
    this.terrain = terrain;
    this.rng = rng;
    this.state = 'wander';
    this.target = new THREE.Vector3();
    this.timer = 0;
    this.fireCooldown = 1 + rng() * 1.5;
    this.orbitDir = rng() < 0.5 ? -1 : 1;
    this.orbitTimer = 0;
    this._pickWanderTarget();
  }

  _pickWanderTarget() {
    const p = this.spider.position;
    const a = this.rng() * Math.PI * 2;
    const r = 10 + this.rng() * 20;
    this.target.set(
      THREE.MathUtils.clamp(p.x + Math.cos(a) * r, -MAP_LIMIT, MAP_LIMIT),
      0,
      THREE.MathUtils.clamp(p.z + Math.sin(a) * r, -MAP_LIMIT, MAP_LIMIT)
    );
    this.timer = 4 + this.rng() * 5;
  }

  update(dt) {
    const s = this.spider;
    if (s.dead) {
      s.update(dt, { move: { x: 0, z: 0 } });
      return;
    }
    const p = s.position;
    const pp = this.player.position;
    const toPlayer = _to.set(pp.x - p.x, 0, pp.z - p.z);
    const dist = toPlayer.length();
    const playerAlive = !this.player.dead;

    if (!playerAlive) this.state = 'wander';
    else if (dist < ATTACK_RANGE) this.state = 'attack';
    else if (dist < CHASE_RANGE) this.state = 'chase';
    else if (this.state !== 'wander') {
      this.state = 'wander';
      this._pickWanderTarget();
    }

    const move = { x: 0, z: 0 };
    let faceYaw;
    let sprint = false;

    if (this.state === 'wander') {
      this.timer -= dt;
      const dx = this.target.x - p.x;
      const dz = this.target.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.5 || this.timer <= 0) this._pickWanderTarget();
      else {
        move.x = (dx / d) * 0.55;
        move.z = (dz / d) * 0.55;
      }
    } else if (this.state === 'chase') {
      toPlayer.divideScalar(dist || 1);
      move.x = toPlayer.x;
      move.z = toPlayer.z;
      sprint = true;
    } else {
      // attack: keep a ring distance, strafe around the player, shoot
      toPlayer.divideScalar(dist || 1);
      this.orbitTimer -= dt;
      if (this.orbitTimer <= 0) {
        this.orbitDir = this.rng() < 0.5 ? -1 : 1;
        this.orbitTimer = 2 + this.rng() * 3;
      }
      const tangent = { x: -toPlayer.z * this.orbitDir, z: toPlayer.x * this.orbitDir };
      let radial = 0;
      if (dist > 14) radial = 0.9;
      else if (dist < 8) radial = -0.9;
      move.x = tangent.x * 0.7 + toPlayer.x * radial;
      move.z = tangent.z * 0.7 + toPlayer.z * radial;
      const ml = Math.hypot(move.x, move.z) || 1;
      move.x /= ml;
      move.z /= ml;
      faceYaw = Math.atan2(toPlayer.x, toPlayer.z);

      this.fireCooldown -= dt;
      if (this.fireCooldown <= 0) {
        this.fireCooldown = 1.1 + this.rng() * 0.8;
        this._shoot();
      }
    }

    s.update(dt, { move, sprint, faceYaw });
  }

  _shoot() {
    const s = this.spider;
    const p = s.position;
    // lead the target a little, then add some spread
    _lead.copy(this.player.position).addScaledVector(this.player.velocity, 0.25);
    _lead.y += 0.6;
    s.forward(_muzzle).multiplyScalar(1.6);
    _muzzle.add(p).y += 0.55;
    _dir.subVectors(_lead, _muzzle).normalize();
    _dir.x += (this.rng() - 0.5) * 0.09;
    _dir.y += (this.rng() - 0.5) * 0.05;
    _dir.z += (this.rng() - 0.5) * 0.09;
    _dir.normalize();
    this.projectiles.spawn(_muzzle, _dir, s, s.color, { speed: 34 });
  }
}
