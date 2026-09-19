import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/** Post-processing (bloom) + a pooled particle system for sparks and explosions. */
export class Effects {
  constructor(renderer, scene, camera, { maxParticles = 1200 } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(size, 0.9, 0.45, 0.62);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    // Particles
    this.max = maxParticles;
    this.count = 0;
    this.pos = new Float32Array(maxParticles * 3);
    this.vel = new Float32Array(maxParticles * 3);
    this.col = new Float32Array(maxParticles * 3);
    this.base = new Float32Array(maxParticles * 3);
    this.life = new Float32Array(maxParticles);
    this.maxLife = new Float32Array(maxParticles);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({
      size: 0.28,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this._c = new THREE.Color();
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  }

  /** Emit a burst of glowing particles at `p`. */
  burst(p, color, { count = 24, speed = 7, life = 0.7, spread = 1, up = 2 } = {}) {
    this._c.set(color);
    for (let n = 0; n < count; n++) {
      if (this.count >= this.max) return;
      const i = this.count++;
      const k = i * 3;
      this.pos[k] = p.x;
      this.pos[k + 1] = p.y;
      this.pos[k + 2] = p.z;
      const a = Math.random() * Math.PI * 2;
      const b = (Math.random() - 0.5) * Math.PI;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.vel[k] = Math.cos(a) * Math.cos(b) * s * spread;
      this.vel[k + 1] = Math.sin(b) * s + up;
      this.vel[k + 2] = Math.sin(a) * Math.cos(b) * s * spread;
      const bright = 1.2 + Math.random() * 1.5;
      this.base[k] = this._c.r * bright;
      this.base[k + 1] = this._c.g * bright;
      this.base[k + 2] = this._c.b * bright;
      this.life[i] = this.maxLife[i] = life * (0.6 + Math.random() * 0.6);
    }
  }

  update(dt) {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        const last = --this.count;
        if (i !== last) {
          const a = i * 3;
          const b = last * 3;
          for (let c = 0; c < 3; c++) {
            this.pos[a + c] = this.pos[b + c];
            this.vel[a + c] = this.vel[b + c];
            this.base[a + c] = this.base[b + c];
          }
          this.life[i] = this.life[last];
          this.maxLife[i] = this.maxLife[last];
        }
        continue;
      }
      const k = i * 3;
      this.vel[k + 1] -= 12 * dt;
      this.vel[k] *= 0.98;
      this.vel[k + 2] *= 0.98;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.col[k] = this.base[k] * t;
      this.col[k + 1] = this.base[k + 1] * t;
      this.col[k + 2] = this.base[k + 2] * t;
      i++;
    }
    this.points.geometry.setDrawRange(0, this.count);
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }

  render() {
    this.composer.render();
  }
}
