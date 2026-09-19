import * as THREE from 'three';
import * as CANNON from 'cannon-es';

const BOX_GEO = new THREE.BoxGeometry(1, 1, 1);
const BOX_EDGES = new THREE.EdgesGeometry(BOX_GEO);
const ROCK_GEO = new THREE.IcosahedronGeometry(1, 0);
const HULL_MAT = new THREE.MeshStandardMaterial({
  color: 0x2f3852,
  flatShading: true,
  roughness: 0.55,
  metalness: 0.5,
});
const ROCK_MAT = new THREE.MeshStandardMaterial({
  color: 0x5c5678,
  flatShading: true,
  roughness: 0.95,
  metalness: 0.0,
});
const EDGE_COLORS = [0x00e5ff, 0xff9f1c, 0x9b5cff, 0x3dff8f];

/** Dynamic crates and boulders scattered over the terrain. */
export function spawnProps(scene, world, terrain, rng, { boxes = 34, rocks = 14 } = {}) {
  const props = [];
  const place = (minR, maxR) => {
    const a = rng() * Math.PI * 2;
    const r = minR + rng() * (maxR - minR);
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  };

  for (let i = 0; i < boxes; i++) {
    const s = 0.8 + rng() * 0.9;
    const { x, z } = place(5, 62);
    const y = terrain.heightAt(x, z) + s / 2 + 0.6 + rng() * 2;
    const mesh = new THREE.Mesh(BOX_GEO, HULL_MAT);
    mesh.scale.setScalar(s);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const edges = new THREE.LineSegments(
      BOX_EDGES,
      new THREE.LineBasicMaterial({ color: EDGE_COLORS[i % EDGE_COLORS.length] })
    );
    edges.material.color.multiplyScalar(1.6);
    mesh.add(edges);
    const body = new CANNON.Body({
      mass: 2 * s,
      shape: new CANNON.Box(new CANNON.Vec3(s / 2, s / 2, s / 2)),
      position: new CANNON.Vec3(x, y, z),
      linearDamping: 0.15,
      angularDamping: 0.3,
    });
    body.quaternion.setFromEuler(0, rng() * Math.PI, 0);
    body.sleepSpeedLimit = 0.3;
    world.addBody(body);
    scene.add(mesh);
    props.push({ mesh, body });
  }

  for (let i = 0; i < rocks; i++) {
    const s = 0.9 + rng() * 1.4;
    const { x, z } = place(14, 68);
    const y = terrain.heightAt(x, z) + s + 0.3;
    const mesh = new THREE.Mesh(ROCK_GEO, ROCK_MAT);
    mesh.scale.set(s, s * (0.7 + rng() * 0.5), s);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const body = new CANNON.Body({
      mass: 6 * s,
      shape: new CANNON.Sphere(s * 0.85),
      position: new CANNON.Vec3(x, y, z),
      linearDamping: 0.3,
      angularDamping: 0.5,
    });
    body.sleepSpeedLimit = 0.3;
    world.addBody(body);
    scene.add(mesh);
    props.push({ mesh, body });
  }
  return props;
}

export function syncProps(props) {
  for (const p of props) {
    p.mesh.position.copy(p.body.position);
    p.mesh.quaternion.copy(p.body.quaternion);
  }
}

export function removeProps(scene, world, props) {
  for (const p of props) {
    world.removeBody(p.body);
    scene.remove(p.mesh);
  }
  props.length = 0;
}
