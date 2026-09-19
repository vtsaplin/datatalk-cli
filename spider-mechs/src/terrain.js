import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { fbm, smoothstep } from './noise.js';

/**
 * Low-poly procedural terrain. Provides an analytic heightAt()/normalAt() used by the
 * walkers (no physics raycasts needed) plus a CANNON.Heightfield for props/projectiles.
 */
export class Terrain {
  constructor({ size = 160, segments = 96, amplitude = 7, seed = 3 } = {}) {
    this.size = size;
    this.segments = segments;
    this.cell = size / segments;
    this.amplitude = amplitude;
    this.seed = seed;

    const N = segments;
    this.heights = new Float32Array((N + 1) * (N + 1)); // index: j * (N+1) + i  (i -> x, j -> z)
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const x = -size / 2 + i * this.cell;
        const z = -size / 2 + j * this.cell;
        this.heights[j * (N + 1) + i] = this._generate(x, z);
      }
    }

    this.mesh = this._buildMesh();
    this.wire = this._buildWire();
    this.body = this._buildBody();
  }

  _generate(x, z) {
    const { size, amplitude, seed } = this;
    let h = fbm(x * 0.017 + 100, z * 0.017 + 100, { octaves: 4, seed });
    h = (h - 0.5) * 2; // -1..1
    h = Math.sign(h) * Math.pow(Math.abs(h), 1.25) * amplitude;
    h += (fbm(x * 0.09, z * 0.09, { octaves: 2, seed: seed + 11 }) - 0.5) * 1.4;

    // Flat plateau at the centre (spawn area).
    const r = Math.hypot(x, z);
    h *= smoothstep(9, 24, r);

    // Raise the edges into a rim so nobody walks off the map.
    const edge = Math.max(Math.abs(x), Math.abs(z)) / (size / 2);
    h += smoothstep(0.82, 1.0, edge) * 14;
    return h;
  }

  /** Bilinear height lookup in world coordinates. */
  heightAt(x, z) {
    const N = this.segments;
    const fx = (x + this.size / 2) / this.cell;
    const fz = (z + this.size / 2) / this.cell;
    const i = Math.min(N - 1, Math.max(0, Math.floor(fx)));
    const j = Math.min(N - 1, Math.max(0, Math.floor(fz)));
    const u = Math.min(1, Math.max(0, fx - i));
    const v = Math.min(1, Math.max(0, fz - j));
    const H = this.heights;
    const w = N + 1;
    const h00 = H[j * w + i];
    const h10 = H[j * w + i + 1];
    const h01 = H[(j + 1) * w + i];
    const h11 = H[(j + 1) * w + i + 1];
    // Match the triangle split used by the mesh (a=(i,j), b=(i,j+1), c=(i+1,j) / (i+1,j),(i,j+1),(i+1,j+1)).
    if (u + v <= 1) {
      return h00 + (h10 - h00) * u + (h01 - h00) * v;
    }
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 0.5;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  _buildMesh() {
    const N = this.segments;
    const w = N + 1;
    const positions = new Float32Array(w * w * 3);
    for (let j = 0; j < w; j++) {
      for (let i = 0; i < w; i++) {
        const k = (j * w + i) * 3;
        positions[k] = -this.size / 2 + i * this.cell;
        positions[k + 1] = this.heights[j * w + i];
        positions[k + 2] = -this.size / 2 + j * this.cell;
      }
    }
    const index = [];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = j * w + i;
        const b = (j + 1) * w + i;
        const c = j * w + i + 1;
        const d = (j + 1) * w + i + 1;
        index.push(a, b, c, c, b, d);
      }
    }
    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(index);
    geo = geo.toNonIndexed();
    geo.computeVertexNormals();

    // Per-face colours: deep blue lowlands -> violet slopes -> pale ridges; steep faces darker.
    const pos = geo.attributes.position;
    const nrm = geo.attributes.normal;
    const colors = new Float32Array(pos.count * 3);
    const low = new THREE.Color(0x14285c);
    const mid = new THREE.Color(0x4a2a86);
    const high = new THREE.Color(0xaab4d4);
    const c = new THREE.Color();
    for (let f = 0; f < pos.count; f += 3) {
      const y = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3;
      const ny = (nrm.getY(f) + nrm.getY(f + 1) + nrm.getY(f + 2)) / 3;
      const t = THREE.MathUtils.clamp((y + 6) / 16, 0, 1);
      if (t < 0.5) c.lerpColors(low, mid, t * 2);
      else c.lerpColors(mid, high, (t - 0.5) * 2);
      const shade = 0.6 + 0.4 * THREE.MathUtils.clamp(ny, 0, 1);
      c.multiplyScalar(shade);
      for (let v = 0; v < 3; v++) {
        colors[(f + v) * 3] = c.r;
        colors[(f + v) * 3 + 1] = c.g;
        colors[(f + v) * 3 + 2] = c.b;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.9,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }

  _buildWire() {
    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(this.mesh.geometry),
      new THREE.LineBasicMaterial({ color: 0x3ec8ff, transparent: true, opacity: 0.09 })
    );
    wire.position.y = 0.02;
    return wire;
  }

  _buildBody() {
    const N = this.segments;
    const w = N + 1;
    // CANNON heightfield lives in its local XY plane; after rotating -90deg about X,
    // local +y maps to world -z, so flip the z index.
    const matrix = [];
    for (let i = 0; i < w; i++) {
      const col = [];
      for (let j = 0; j < w; j++) {
        col.push(this.heights[(N - j) * w + i]);
      }
      matrix.push(col);
    }
    const shape = new CANNON.Heightfield(matrix, { elementSize: this.cell });
    const body = new CANNON.Body({ mass: 0 });
    body.addShape(shape);
    body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    body.position.set(-this.size / 2, 0, this.size / 2);
    return body;
  }
}
