import * as THREE from 'three';
import { foliageMaterial } from './foliage.js';

// Rainforest trees generated with EZ-Tree (MIT, https://github.com/dgreenheck/ez-tree).
// A few variants are reshaped into tall-trunked tropical giants and understory
// trees, generated once, then drawn many times with instancing.
// Map chunks switch between detailed trees (near) and cheap stand-ins (far),
// and only nearby chunks cast shadows – the same approach as Schooled's open world.

const VARIANTS = [
  { preset: 'Ash Large', seed: 1101, height: 30, trunk: 1.7, start: 0.68, tint: 0x6d9a48, leaf: 1.7, layer: 'emergent' },
  { preset: 'Oak Large', seed: 2207, height: 24, trunk: 1.45, start: 0.6, tint: 0x5b8a3c, leaf: 1.6, layer: 'canopy' },
  { preset: 'Aspen Large', seed: 3301, height: 20, trunk: 1.3, start: 0.55, tint: 0x78a052, leaf: 1.5, layer: 'canopy' },
  { preset: 'Ash Medium', seed: 4409, height: 10, trunk: 1.0, start: 0.35, tint: 0x6a9a46, leaf: 1.4, layer: 'under' },
];
const CELL = 36;

export async function buildJungleTrees(spots, onProgress = () => {}) {
  const { Tree } = await import('@dgreenheck/ez-tree');
  const variants = [];
  for (let v = 0; v < VARIANTS.length; v++) {
    const cfg = VARIANTS[v];
    const tree = new Tree();
    tree.loadPreset(cfg.preset);
    const o = tree.options;
    o.seed = cfg.seed;
    o.branch.length[0] *= cfg.trunk;                      // taller bare trunk
    if (o.branch.start[1] !== undefined) o.branch.start[1] = cfg.start; // branches start high up
    for (const k of Object.keys(o.branch.sections)) o.branch.sections[k] = Math.max(2, Math.round(o.branch.sections[k] * 0.5));
    for (const k of Object.keys(o.branch.segments)) o.branch.segments[k] = Math.max(3, Math.round(o.branch.segments[k] * 0.6));
    o.leaves.count = Math.max(4, Math.round(o.leaves.count * 0.45));
    o.leaves.size *= cfg.leaf;
    o.leaves.tint = 0xffffff;
    o.bark.tint = 0xb8a890;
    tree.generate();

    const bm = tree.branchesMesh.material;
    const bark = new THREE.MeshStandardMaterial({ map: bm.map, normalMap: bm.normalMap, aoMap: bm.aoMap, roughnessMap: bm.roughnessMap, color: 0x9c8f7c, roughness: 1 });
    const leafMat = foliageMaterial(tree.leavesMesh.material.map, { color: cfg.tint, sway: 0.012 });
    const box = new THREE.Box3().setFromObject(tree);
    const k = cfg.height / Math.max(0.001, box.max.y - box.min.y);
    // base trunk radius (for collision): widest point in the bottom metre
    const pos = tree.branchesMesh.geometry.attributes.position;
    let r = 0.2;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) - box.min.y < 1 / k) r = Math.max(r, Math.hypot(pos.getX(i), pos.getZ(i)));
    variants.push({ cfg, branches: tree.branchesMesh.geometry, bark, leaves: tree.leavesMesh.geometry, leafMat, k, minY: box.min.y, trunkR: r * k });
    onProgress((v + 1) / VARIANTS.length);
    await new Promise((res) => setTimeout(res));
  }

  // cheap far stand-in: tapered trunk + a few dark blobs of canopy
  const farTrunk = new THREE.CylinderGeometry(0.25, 0.5, 1, 6); farTrunk.translate(0, 0.5, 0);
  const farCrown = new THREE.IcosahedronGeometry(1, 2);
  const farTrunkMat = new THREE.MeshStandardMaterial({ color: 0x4a4034, roughness: 1 });
  const farCrownMat = new THREE.MeshStandardMaterial({ color: 0x2c4620, roughness: 1 });

  // bucket spots into chunks
  const chunks = new Map();
  spots.forEach((s, i) => {
    const key = `${Math.floor(s.x / CELL)},${Math.floor(s.z / CELL)}`;
    if (!chunks.has(key)) chunks.set(key, { spots: [] });
    chunks.get(key).spots.push({ ...s, i });
  });

  const group = new THREE.Group();
  const shootables = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const list = [];
  const colliders = [];
  const leafMeshes = [];

  for (const chunk of chunks.values()) {
    const c = new THREE.Vector3();
    chunk.spots.forEach((t) => c.add(p.set(t.x, 0, t.z)));
    c.divideScalar(chunk.spots.length);
    const radius = Math.max(...chunk.spots.map((t) => Math.hypot(t.x - c.x, t.z - c.z))) + 12;

    const near = new THREE.Group(), casters = [];
    variants.forEach((V, vi) => {
      const sp = chunk.spots.filter((t) => t.v === vi);
      if (!sp.length) return;
      const br = new THREE.InstancedMesh(V.branches, V.bark, sp.length);
      const lf = new THREE.InstancedMesh(V.leaves, V.leafMat, sp.length);
      sp.forEach((t, j) => {
        q.setFromAxisAngle(up, (((t.x * 12.9898 + t.z * 78.233) % 1) + 1) * Math.PI * 2);
        m.compose(p.set(t.x, t.y - V.minY * V.k * t.s - 0.3, t.z), q, sc.setScalar(V.k * t.s));
        br.setMatrixAt(j, m); lf.setMatrixAt(j, m);
        colliders.push([t.x, t.z, Math.max(0.3, V.trunkR * t.s * 0.75), t.y]);
      });
      lf.customDepthMaterial = V.leafMat.userData.depth;
      lf.userData.noRaycast = true;
      br.userData.surface = 'wood';
      for (const inst of [br, lf]) { inst.receiveShadow = true; inst.computeBoundingSphere(); near.add(inst); casters.push(inst); }
      shootables.push(br);
      leafMeshes.push(lf);
    });

    const far = new THREE.Group();
    const ft = new THREE.InstancedMesh(farTrunk, farTrunkMat, chunk.spots.length);
    const fc = new THREE.InstancedMesh(farCrown, farCrownMat, chunk.spots.length * 3);
    chunk.spots.forEach((t, j) => {
      const V = variants[t.v];
      const h = V.cfg.height * t.s;
      m.compose(p.set(t.x, t.y, t.z), q.identity(), sc.set(1 + h * 0.02, h * 0.75, 1 + h * 0.02));
      ft.setMatrixAt(j, m);
      for (let kk = 0; kk < 3; kk++) {
        const a = kk * 2.1 + t.x, rr = h * 0.12;
        m.compose(p.set(t.x + Math.cos(a) * rr, t.y + h * (0.8 + kk * 0.06), t.z + Math.sin(a) * rr), q.identity(), sc.set(h * 0.25, h * 0.14, h * 0.25));
        fc.setMatrixAt(j * 3 + kk, m);
      }
    });
    for (const inst of [ft, fc]) { inst.receiveShadow = true; inst.computeBoundingSphere(); inst.userData.noRaycast = true; far.add(inst); }
    far.visible = false;
    group.add(near, far);
    list.push({ center: c, radius, near, far, casters, farCasters: [ft, fc], lastNear: null, lastShadow: null });
  }

  let nearDist = 60, shadowDist = 30;
  return {
    group, shootables, colliders, leafMeshes,
    setQuality(preset) {
      nearDist = { low: 35, medium: 50, high: 65, ultra: 90 }[preset.key] ?? 55;
      shadowDist = { low: 0, medium: 24, high: 34, ultra: 55 }[preset.key] ?? 30;
      for (const c of list) { c.lastNear = c.lastShadow = null; }
    },
    update(camPos) {
      for (const c of list) {
        const d = Math.hypot(camPos.x - c.center.x, camPos.z - c.center.z) - c.radius;
        const isNear = d < nearDist, shadow = d < shadowDist;
        if (isNear !== c.lastNear) { c.near.visible = isNear; c.far.visible = !isNear; c.lastNear = isNear; }
        if (shadow !== c.lastShadow) { for (const s of c.casters) s.castShadow = shadow; c.lastShadow = shadow; }
      }
    },
  };
}

export const TREE_VARIANTS = VARIANTS;
