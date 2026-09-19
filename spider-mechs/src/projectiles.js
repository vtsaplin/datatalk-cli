import * as THREE from 'three';
import * as CANNON from 'cannon-es';

const GEO = new THREE.SphereGeometry(0.22, 8, 6);
const GRAVITY_SCALE = 0.25; // projectiles fall slower than normal bodies

/** Physical glowing bolts. Damage is applied via the entities map (body.id -> entity). */
export class Projectiles {
  constructor(scene, world, effects, entities) {
    this.scene = scene;
    this.world = world;
    this.effects = effects;
    this.entities = entities;
    this.list = [];
    this._mats = new Map();
  }

  _material(color) {
    let m = this._mats.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color });
      m.color.multiplyScalar(2.2); // over-bright so bloom picks it up
      this._mats.set(color, m);
    }
    return m;
  }

  spawn(origin, dir, owner, color, { speed = 46, damage = 1, life = 2.2 } = {}) {
    const body = new CANNON.Body({
      mass: 0.2,
      shape: new CANNON.Sphere(0.2),
      position: new CANNON.Vec3(origin.x, origin.y, origin.z),
      linearDamping: 0,
      angularDamping: 0,
    });
    body.velocity.set(dir.x * speed, dir.y * speed, dir.z * speed);
    body.allowSleep = false;
    const mesh = new THREE.Mesh(GEO, this._material(color));
    mesh.position.copy(origin);
    mesh.scale.set(1, 1, 2.2);
    mesh.lookAt(origin.x + dir.x, origin.y + dir.y, origin.z + dir.z);
    this.scene.add(mesh);

    const p = { body, mesh, owner, color, damage, life, dead: false };
    body.addEventListener('collide', (e) => {
      if (p.dead) return;
      if (owner && e.body === owner.body) return; // never hit yourself
      const target = this.entities.get(e.body.id);
      if (target && target.takeDamage) {
        if (owner && target.team === owner.team) return; // no friendly fire
        target.takeDamage(damage, body.position);
      }
      p.dead = true;
    });
    this.world.addBody(body);
    this.list.push(p);
    return p;
  }

  /** Called from the physics preStep event to reduce gravity on bolts. */
  preStep() {
    const g = this.world.gravity.y;
    for (const p of this.list) {
      p.body.force.y -= g * p.body.mass * (1 - GRAVITY_SCALE);
    }
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) p.dead = true;
      if (p.dead) {
        const pos = p.body.position;
        this.effects.burst(new THREE.Vector3(pos.x, pos.y, pos.z), p.color, {
          count: 14,
          speed: 5,
          life: 0.45,
        });
        this.world.removeBody(p.body);
        this.scene.remove(p.mesh);
        this.list.splice(i, 1);
        continue;
      }
      p.mesh.position.copy(p.body.position);
      const v = p.body.velocity;
      if (v.lengthSquared() > 1) {
        p.mesh.lookAt(p.mesh.position.x + v.x, p.mesh.position.y + v.y, p.mesh.position.z + v.z);
      }
    }
  }

  clear() {
    for (const p of this.list) {
      this.world.removeBody(p.body);
      this.scene.remove(p.mesh);
    }
    this.list.length = 0;
  }
}
