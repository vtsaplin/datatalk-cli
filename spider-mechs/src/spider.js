import * as THREE from 'three';
import * as CANNON from 'cannon-es';

/**
 * Walking mech. Hybrid locomotion: a single physics sphere "hovers" over the terrain on a
 * spring (so it collides with crates, bolts and other mechs), while six legs are purely
 * procedural: home positions travel with the body, feet step when they drift too far,
 * alternating in two tripod groups, and a two-bone analytic IK places the knees.
 */

// Leg layout (body local: +x right, +z forward). Order: L front, L mid, L rear, R front, R mid, R rear.
const LEG_DEFS = [
  { hip: [-0.5, 0.05, 0.55], home: [-1.75, 0, 1.55] },
  { hip: [-0.6, 0.05, 0.0], home: [-2.15, 0, 0.1] },
  { hip: [-0.5, 0.05, -0.55], home: [-1.75, 0, -1.45] },
  { hip: [0.5, 0.05, 0.55], home: [1.75, 0, 1.55] },
  { hip: [0.6, 0.05, 0.0], home: [2.15, 0, 0.1] },
  { hip: [0.5, 0.05, -0.55], home: [1.75, 0, -1.45] },
];
const GROUP_OF = [0, 1, 0, 1, 0, 1]; // tripod gait groups
const L1 = 1.5; // femur
const L2 = 2.0; // tibia
const RIDE_HEIGHT = 1.45;
const STEP_DIST = 0.75;
const STEP_TIME = 0.16;
const STEP_LIFT = 0.7;
const LOOKAHEAD = 0.17;

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();

// Shared geometry
const HULL_GEO = new THREE.IcosahedronGeometry(0.85, 1);
const ABDOMEN_GEO = new THREE.IcosahedronGeometry(0.6, 1);
const HEAD_GEO = new THREE.BoxGeometry(0.62, 0.4, 0.55);
const EYE_GEO = new THREE.SphereGeometry(0.09, 8, 6);
const RING_GEO = new THREE.TorusGeometry(0.78, 0.045, 6, 28);
const HIP_GEO = new THREE.SphereGeometry(0.16, 8, 6);
const FEMUR_GEO = new THREE.CylinderGeometry(0.1, 0.13, 1, 6);
const TIBIA_GEO = new THREE.CylinderGeometry(0.035, 0.09, 1, 6);
const KNEE_GEO = new THREE.SphereGeometry(0.13, 8, 6);
const FOOT_GEO = new THREE.SphereGeometry(0.1, 8, 6);

function lerpAngle(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}
function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

export class Spider {
  constructor({ scene, world, terrain, position, color = 0x00e5ff, team = 'enemy', hp = 3, speed = 7 }) {
    this.scene = scene;
    this.world = world;
    this.terrain = terrain;
    this.team = team;
    this.hp = hp;
    this.maxHp = hp;
    this.speed = speed;
    this.color = color;
    this.dead = false;
    this.deadTime = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.airTime = 0;
    this.jumpCooldown = 0;
    this.grounded = true;
    this.flash = 0;
    this.lastGroup = 1;
    this.turn = 0;
    this.time = Math.random() * 10;
    this.velocity = new THREE.Vector3();

    // --- physics body
    this.body = new CANNON.Body({
      mass: 5,
      shape: new CANNON.Sphere(0.9),
      position: new CANNON.Vec3(position.x, position.y, position.z),
      fixedRotation: true,
      linearDamping: 0.05,
      angularDamping: 0.4,
    });
    this.body.allowSleep = false;
    world.addBody(this.body);

    // --- materials
    this.hullMat = new THREE.MeshStandardMaterial({
      color: 0x38405a,
      flatShading: true,
      roughness: 0.45,
      metalness: 0.55,
      emissive: 0x000000,
    });
    this.legMat = new THREE.MeshStandardMaterial({
      color: 0x8a94b8,
      flatShading: true,
      roughness: 0.5,
      metalness: 0.45,
      emissive: color,
      emissiveIntensity: 0.12,
    });
    this.glowMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: color,
      emissiveIntensity: 2.6,
      roughness: 1,
    });

    // --- body visuals
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    this.group = g;
    const hull = new THREE.Mesh(HULL_GEO, this.hullMat);
    hull.scale.set(1.1, 0.72, 1.3);
    hull.castShadow = true;
    g.add(hull);
    const abdomen = new THREE.Mesh(ABDOMEN_GEO, this.hullMat);
    abdomen.position.set(0, 0.2, -1.0);
    abdomen.scale.set(1.05, 0.85, 1.25);
    abdomen.castShadow = true;
    g.add(abdomen);
    const head = new THREE.Mesh(HEAD_GEO, this.hullMat);
    head.position.set(0, 0.02, 1.0);
    head.castShadow = true;
    g.add(head);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(EYE_GEO, this.glowMat);
      eye.position.set(sx * 0.17, 0.1, 1.28);
      g.add(eye);
    }
    const ring = new THREE.Mesh(RING_GEO, this.glowMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.18;
    ring.scale.set(1.2, 1.35, 1);
    g.add(ring);
    scene.add(g);

    // --- legs
    this.legs = LEG_DEFS.map((def, i) => {
      const hip = new THREE.Vector3(...def.hip);
      const home = new THREE.Vector3(...def.home);
      const hipMesh = new THREE.Mesh(HIP_GEO, this.legMat);
      hipMesh.position.copy(hip);
      g.add(hipMesh);
      const femur = new THREE.Mesh(FEMUR_GEO, this.legMat);
      const tibia = new THREE.Mesh(TIBIA_GEO, this.legMat);
      const knee = new THREE.Mesh(KNEE_GEO, this.legMat);
      const foot = new THREE.Mesh(FOOT_GEO, this.glowMat);
      femur.castShadow = tibia.castShadow = true;
      scene.add(femur, tibia, knee, foot);
      return {
        i,
        hip,
        home,
        foot: new THREE.Vector3(),
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        target: new THREE.Vector3(),
        needsStep: false,
        turn: -1,
        stepping: false,
        t: 0,
        meshes: { femur, tibia, knee, foot },
      };
    });
    // Plant feet at their home spots.
    this._syncGroup();
    for (const leg of this.legs) {
      this._homeWorld(leg, _a, 0);
      leg.foot.copy(_a);
    }
    this._updateLegVisuals();
  }

  // ---------------------------------------------------------------- physics
  /** Called from world 'preStep': hover spring keeps the body at RIDE_HEIGHT above terrain. */
  hover() {
    if (this.dead) return;
    const b = this.body;
    const ground = this.terrain.heightAt(b.position.x, b.position.z);
    const h = b.position.y - ground;
    this.grounded = h < RIDE_HEIGHT + 0.45;
    if (this.airTime > 0) return;
    if (h < RIDE_HEIGHT * 1.9) {
      const err = RIDE_HEIGHT - h;
      const K = 900;
      const C = 110;
      const F = K * err - C * b.velocity.y - this.world.gravity.y * b.mass;
      b.force.y += F;
    }
  }

  // ---------------------------------------------------------------- per-frame
  /**
   * @param {number} dt
   * @param {{move:{x:number,z:number}, sprint?:boolean, jump?:boolean, faceYaw?:number}} input
   */
  update(dt, input) {
    this.time += dt;
    this.jumpCooldown -= dt;
    this.airTime = Math.max(0, this.airTime - dt);
    if (this.flash > 0) {
      this.flash -= dt;
      const f = Math.max(0, this.flash) / 0.12;
      this.hullMat.emissive.setScalar(f * 0.9);
    }

    const b = this.body;
    if (this.dead) {
      this.deadTime += dt;
      this.group.position.copy(b.position);
      this.group.quaternion.copy(b.quaternion);
      this.group.updateMatrixWorld(true);
      // legs go limp: feet drop to the ground under wherever they are
      for (const leg of this.legs) {
        leg.stepping = false;
        leg.foot.y += (this.terrain.heightAt(leg.foot.x, leg.foot.z) - leg.foot.y) * Math.min(1, dt * 6);
      }
      this._updateLegVisuals();
      return;
    }

    // --- movement
    const mv = input.move || { x: 0, z: 0 };
    const mlen = Math.hypot(mv.x, mv.z);
    const spd = this.speed * (input.sprint ? 1.55 : 1);
    const k = 1 - Math.exp(-9 * dt);
    b.velocity.x += (mv.x * spd - b.velocity.x) * k;
    b.velocity.z += (mv.z * spd - b.velocity.z) * k;

    let targetYaw = this.yaw;
    if (mlen > 0.1) targetYaw = Math.atan2(mv.x, mv.z);
    else if (input.faceYaw !== undefined) targetYaw = input.faceYaw;
    this.yaw = lerpAngle(this.yaw, targetYaw, 1 - Math.exp(-7 * dt));

    if (input.jump && this.grounded && this.jumpCooldown <= 0) {
      b.velocity.y = 9.5;
      this.airTime = 0.35;
      this.jumpCooldown = 0.7;
    }

    this.velocity.set(b.velocity.x, 0, b.velocity.z);

    // --- legs (tripod gait: the two groups strictly alternate so neither can starve the other)
    this._syncGroup();
    const stepping = [false, false];
    const wants = [false, false];
    for (const leg of this.legs) {
      const grp = GROUP_OF[leg.i];
      this._homeWorld(leg, leg.target, LOOKAHEAD);
      if (leg.stepping) stepping[grp] = true;
      else {
        const d = Math.hypot(leg.foot.x - leg.target.x, leg.foot.z - leg.target.z);
        leg.needsStep = d > STEP_DIST || !this.grounded;
        if (leg.needsStep) wants[grp] = true;
      }
    }
    // Which group may start new steps this frame? A "turn" is one group's stepping phase; every
    // leg may step at most once per turn, so the groups strictly alternate and nobody starves.
    let active = -1;
    if (stepping[0]) active = 0;
    else if (stepping[1]) active = 1;
    else {
      const other = 1 - this.lastGroup;
      if (wants[other]) active = other;
      else if (wants[this.lastGroup]) active = this.lastGroup;
      if (active >= 0) {
        this.lastGroup = active;
        this.turn++;
      }
    }
    const speed = this.velocity.length();
    const stepTime = THREE.MathUtils.clamp((STEP_TIME * 6) / Math.max(speed, 1), 0.09, STEP_TIME);

    for (const leg of this.legs) {
      const grp = GROUP_OF[leg.i];
      if (!leg.stepping && grp === active && leg.needsStep && leg.turn !== this.turn) {
        leg.stepping = true;
        leg.needsStep = false;
        leg.turn = this.turn;
        leg.t = 0;
        leg.from.copy(leg.foot);
        leg.to.copy(leg.target);
      }
      if (leg.stepping) {
        leg.t += dt / stepTime;
        const t = Math.min(1, leg.t);
        leg.to.lerp(leg.target, 0.35); // keep tracking the moving target
        leg.foot.lerpVectors(leg.from, leg.to, smoothstep(t));
        leg.foot.y += Math.sin(t * Math.PI) * STEP_LIFT;
        if (t >= 1) {
          leg.stepping = false;
          leg.foot.copy(leg.to);
        }
      }
    }

    // --- body tilt follows the feet
    const fy = (i) => this.legs[i].foot.y;
    const pitch = Math.atan2((fy(0) + fy(3)) / 2 - (fy(2) + fy(5)) / 2, 3.0);
    const roll = Math.atan2((fy(3) + fy(4) + fy(5)) / 3 - (fy(0) + fy(1) + fy(2)) / 3, 4.3);
    const tk = 1 - Math.exp(-6 * dt);
    this.pitch += (THREE.MathUtils.clamp(pitch, -0.5, 0.5) - this.pitch) * tk;
    this.roll += (THREE.MathUtils.clamp(roll, -0.5, 0.5) - this.roll) * tk;

    this._syncGroup();
    this._updateLegVisuals();
  }

  _syncGroup() {
    const g = this.group;
    g.position.copy(this.body.position);
    g.position.y += Math.sin(this.time * 2.2) * 0.04; // idle breathing
    g.rotation.set(-this.pitch, this.yaw, this.roll);
    g.updateMatrixWorld(true);
  }

  /** World-space home target of a leg (yaw only, projected onto the terrain). */
  _homeWorld(leg, out, lookahead) {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    const hx = leg.home.x * c + leg.home.z * s;
    const hz = -leg.home.x * s + leg.home.z * c;
    out.x = this.body.position.x + hx + this.velocity.x * lookahead;
    out.z = this.body.position.z + hz + this.velocity.z * lookahead;
    out.y = this.terrain.heightAt(out.x, out.z);
    return out;
  }

  _updateLegVisuals() {
    const center = this.group.position;
    for (const leg of this.legs) {
      const H = _b.copy(leg.hip).applyMatrix4(this.group.matrixWorld);
      const F = leg.foot;
      const dir = _c.subVectors(F, H);
      let d = dir.length();
      const reach = (L1 + L2) * 0.985;
      if (d > reach) {
        dir.multiplyScalar(reach / d);
        d = reach;
      }
      dir.divideScalar(d);
      // Knee pole: up + outward from body centre so knees arch above the body.
      const pole = _d.set(F.x - center.x, 0, F.z - center.z).normalize().multiplyScalar(0.55).add(UP);
      pole.addScaledVector(dir, -pole.dot(dir));
      if (pole.lengthSq() < 1e-4) pole.copy(UP);
      pole.normalize();
      const cosA = THREE.MathUtils.clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
      const sinA = Math.sqrt(1 - cosA * cosA);
      const K = _a.copy(H).addScaledVector(dir, L1 * cosA).addScaledVector(pole, L1 * sinA);

      this._placeSegment(leg.meshes.femur, H, K);
      this._placeSegment(leg.meshes.tibia, K, F);
      leg.meshes.knee.position.copy(K);
      leg.meshes.foot.position.copy(F);
    }
  }

  _placeSegment(mesh, from, to) {
    const dir = _d.subVectors(to, from);
    const len = dir.length();
    mesh.position.copy(from).addScaledVector(dir, 0.5);
    mesh.scale.set(1, Math.max(0.01, len), 1);
    mesh.quaternion.copy(_q.setFromUnitVectors(UP, dir.divideScalar(len || 1)));
  }

  // ---------------------------------------------------------------- damage
  takeDamage(n) {
    if (this.dead) return;
    this.hp -= n;
    this.flash = 0.12;
    if (this.hp <= 0) this.die();
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.hp = 0;
    const b = this.body;
    b.fixedRotation = false;
    b.updateMassProperties();
    b.velocity.y += 4;
    b.angularVelocity.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 8);
    this.glowMat.emissiveIntensity = 0.35;
    this.hullMat.emissive.setScalar(0);
  }

  get position() {
    return this.group.position;
  }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  dispose() {
    this.world.removeBody(this.body);
    this.scene.remove(this.group);
    for (const leg of this.legs) {
      const m = leg.meshes;
      this.scene.remove(m.femur, m.tibia, m.knee, m.foot);
    }
    this.hullMat.dispose();
    this.legMat.dispose();
    this.glowMat.dispose();
  }
}
