import * as THREE from 'three';
import { pbr } from '../../assets.js';
import { CollisionWorld, pointInPolygon } from '../../collision.js';
import { GeoBuilder, ribbon, solidTexture } from '../build.js';
import { mulberry32 } from '../../noise.js';
import {
  HALF, WATER_Y, BRIDGE, CLEARINGS, riverX, heightAt, groundAt, bridgeDeck, waterDepth, mudWeight, slopeAt,
} from './terrain.js';
import { ferns, broadLeafPlants, groundClumps, palms, lianas, setDensity, foliageTime } from './foliage.js';
import { buildJungleTrees } from './jungleTrees.js';
import { stiltHut, tent, sandbags, watchtower, ropeBridge, jetty, canoe, dryingRack, lightShaft, instancedPosts } from './structures.js';

// Rimba Basin – an original jungle valley: a river with a rope bridge and a
// shallow ford, a stilt-hut village on the west bank, a mercenary camp on the
// east bank and a supply landing in the north-west. North is -Z.

export const BOUNDS = { minX: -HALF + 5, maxX: HALF - 5, minZ: -HALF + 5, maxZ: HALF - 5 };
const C = Object.fromEntries(CLEARINGS.map((c) => [c.id, c]));
const BRIDGE_X = riverX(BRIDGE.z);
const FORD_Z = -66, FORD_X = riverX(FORD_Z);

// Mud trails (also kept clear of undergrowth so they read as paths and sight lines).
const TRAILS = [
  [[C.spawn.x, C.spawn.z], [-74, 70], [-62, 52], [-54, 40]],                                  // spawn → village
  [[-46, 31], [-30, 22], [-14, 12], [BRIDGE_X - BRIDGE.half - 1, BRIDGE.z]],                  // village → bridge
  [[BRIDGE_X + BRIDGE.half + 1, BRIDGE.z], [36, 0], [44, -20], [51, -36]],                    // bridge → camp
  [[-56, 26], [-66, 0], [-72, -30], [-71, -52]],                                              // village → landing
  [[-63, -61], [-44, -64], [FORD_X - 8, FORD_Z]],                                             // landing → ford
  [[FORD_X + 8, FORD_Z], [18, -60], [36, -54], [47, -48]],                                    // ford → camp
  [[-42, 36], [-22, 33], [riverX(30) - 10, 30]],                                              // village → jetty
];
const trailSegs = [];
for (const t of TRAILS) for (let i = 1; i < t.length; i++) trailSegs.push([t[i - 1], t[i]]);
function trailDist(x, z) {
  let best = Infinity;
  for (const [a, b] of trailSegs) {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
  }
  return best;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const groundMud = (x, z) => Math.max(mudWeight(x, z), (1 - smooth(1.2, 2.8, trailDist(x, z))) * 0.85);

/** Forest floor with mud blended in from a per-vertex weight, plus large-scale tone variation. */
function terrainMaterial(T) {
  const m = pbr(T.forestFloor, { color: 0xc4c0b0, normal: 1.1 });
  const mud = T.mud.map;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uMud = { value: mud };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aMud;\nvarying float vMud;\nvarying vec2 vWorldXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMud = aMud;\nvWorldXZ = (modelMatrix * vec4(position, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uMud;\nvarying float vMud;\nvarying vec2 vWorldXZ;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 mudC = texture2D(uMud, vMapUv * 0.8).rgb * vec3(0.92, 0.86, 0.78);
        float macro = texture2D(map, vWorldXZ * 0.011).g;
        diffuseColor.rgb *= 0.78 + macro * 0.5;
        diffuseColor.rgb = mix(diffuseColor.rgb, mudC * diffuse, smoothstep(0.15, 0.75, vMud));`);
  };
  m.customProgramCacheKey = () => 'rimba-terrain';
  return m;
}

function buildTerrain(T) {
  const EXT = HALF + 90, N = 320;
  const g = new THREE.PlaneGeometry(EXT * 2, EXT * 2, N, N);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, uv = g.attributes.uv;
  const mud = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, heightAt(x, z));
    uv.setXY(i, x / 4, -z / 4);
    mud[i] = groundMud(x, z);
  }
  g.setAttribute('aMud', new THREE.BufferAttribute(mud, 1));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, terrainMaterial(T));
  mesh.receiveShadow = true;
  mesh.userData.surface = 'dirt';
  return mesh;
}

function buildRiver(T) {
  const pts = [];
  for (let z = -HALF - 60; z <= HALF + 60; z += 2) pts.push([riverX(z), z]);
  const B = new GeoBuilder();
  ribbon(B, pts, 26, WATER_Y, { vScale: 7, uScale: 7 });
  const g = B.build();
  const normal = T.mud.normalMap.clone();
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  normal.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({
    color: 0x34402c, roughness: 0.06, metalness: 0.15, transparent: true, opacity: 0.88,
    normalMap: normal, normalScale: new THREE.Vector2(0.22, 0.22), envMapIntensity: 1.1,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.userData.noRaycast = true;
  return { mesh, normal };
}

export async function buildRimba(scene, assets, { camera, sunDir, onProgress = () => {} } = {}) {
  const T = assets.textures;
  const rand = mulberry32(7342);
  const root = new THREE.Group();
  root.name = 'rimba-basin';
  scene.add(root);
  const collision = new CollisionWorld(6);
  const colliders = [];       // Box3s the player can stand on (hut floors, steps, jetty, crates)
  const shootables = [];
  const smallProps = [];
  const aoExclude = [];
  const solids = [];          // footprints bots treat as blocked
  const posts = [];
  const occupied = [];        // [x, z, r] areas kept free of trees and undergrowth

  const mats = {
    planks: pbr(T.planks, { color: 0xb8a990 }),
    bark: pbr(T.bark, { color: 0xa89a88 }),
    bamboo: pbr(T.bamboo, { color: 0xd8c8a0, side: THREE.DoubleSide }),
    thatch: pbr(T.thatch, { color: 0xb8a888, side: THREE.DoubleSide }),
    tarp: new THREE.MeshStandardMaterial({ map: solidTexture('#5d6444', 0.25), roughness: 0.95, side: THREE.DoubleSide }),
  };
  const builders = new Map();
  const B = (m) => { if (!builders.has(m)) builders.set(m, new GeoBuilder()); return builders.get(m); };
  const ctx = { B, mats, collision, colliders, solids, root, shootables, posts };
  const occupy = (x, z, r) => occupied.push([x, z, r]);

  // ── ground + river ──
  onProgress(0.05, 'Shaping the valley…');
  const terrain = buildTerrain(T);
  root.add(terrain);
  shootables.push(terrain);
  const river = buildRiver(T);
  root.add(river.mesh);
  aoExclude.push(river.mesh);

  // ── props from Poly Haven models ──
  function prop(name, x, z, { rot = rand() * Math.PI * 2, scale = 1, sink = 0, solid = 'box', stand = false, surface } = {}) {
    const src = assets.models[name];
    if (!src) return null;
    const o = src.clone(true);
    o.scale.setScalar(scale);
    o.rotation.y = rot;
    o.position.set(x, 0, z);
    root.add(o);
    o.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(o);
    o.position.y = groundAt(x, z) - bb.min.y - sink;
    o.updateMatrixWorld(true);
    bb.setFromObject(o);
    const surf = surface || (/rock|fire_pit/.test(name) ? 'concrete' : /barrel|jerrycan|ammo/.test(name) ? 'metal' : 'wood');
    o.traverse((m) => { if (m.isMesh) { m.userData.surface = surf; shootables.push(m); smallProps.push(m); } });
    if (solid === 'box') {
      const c = bb.getCenter(new THREE.Vector3()), s = bb.getSize(new THREE.Vector3());
      collision.addBox(c.x, c.z, s.x / 2, s.z / 2, 0, bb.min.y - 1, bb.max.y);
      if (stand) colliders.push(bb.clone());
    } else if (solid === 'parts') { // one box per mesh (rock sets are several separate rocks)
      o.traverse((m) => {
        if (!m.isMesh) return;
        const mb = new THREE.Box3().setFromObject(m), c = mb.getCenter(new THREE.Vector3()), s = mb.getSize(new THREE.Vector3());
        if (s.y > 0.25) collision.addBox(c.x, c.z, s.x / 2 * 0.85, s.z / 2 * 0.85, 0, mb.min.y - 1, mb.max.y);
      });
    }
    return o;
  }

  // ── village (west bank) ──
  onProgress(0.12, 'Building the village…');
  {
    const v = C.village;
    const huts = [
      { x: v.x - 10, z: v.z - 3, door: 'e' },
      { x: v.x - 6, z: v.z + 10, door: 'n' },
      { x: v.x + 8, z: v.z + 10, door: 'n' },
      { x: v.x + 12, z: v.z - 4, door: 'w' },
      { x: v.x + 1, z: v.z - 12, door: 's', w: 5.6, d: 7.5 },
    ];
    for (const h of huts) {
      const w = h.w || 4.6, d = h.d || 5.4;
      const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => heightAt(h.x + a * w / 2, h.z + b * d / 2));
      const gy = Math.min(...corners);
      stiltHut(ctx, { x: h.x, z: h.z, w, d, gy, floorH: Math.max(...corners) - gy + 1.1, door: h.door });
      occupy(h.x, h.z, Math.max(w, d) * 0.75 + 1.5);
    }
    prop('stone_fire_pit', v.x, v.z, { solid: 'box' });
    occupy(v.x, v.z, 4);
    dryingRack(ctx, { x: v.x + 5, z: v.z + 3, gy: groundAt(v.x + 5, v.z + 3), rot: 0.4 });
    dryingRack(ctx, { x: v.x - 6, z: v.z - 7, gy: groundAt(v.x - 6, v.z - 7), rot: -0.3 });
    for (const [n, dx, dz] of [['wooden_bucket_01', 2, 1.5], ['wicker_basket_01', -1.8, 2.2], ['wicker_basket_01', -2.2, 1.6], ['wooden_crate_01', 3.5, -2.5],
      ['wooden_lantern_01', 1.4, -1.8], ['tree_stump_01', -3, -1.5], ['tree_stump_01', 2.6, 3.4]]) {
      prop(n, v.x + dx, v.z + dz, { solid: n === 'tree_stump_01' ? 'box' : 'none', stand: n === 'tree_stump_01' });
    }
    // jetty + canoes on the river
    const jz = 30, jx = riverX(jz) - 9.5;
    jetty(ctx, { x: jx, z: jz, len: 6.5, dir: 1, y: WATER_Y + 0.75 });
    occupy(jx + 3, jz, 5);
    canoe(ctx, { x: riverX(jz + 3.2) - 3.6, z: jz + 3.2, y: WATER_Y, rot: 0.15 });
    canoe(ctx, { x: riverX(jz - 3) - 3.2, z: jz - 3, y: WATER_Y, rot: -0.1 });
  }

  // ── rope bridge ──
  ropeBridge(ctx, {
    x0: BRIDGE_X - BRIDGE.half, x1: BRIDGE_X + BRIDGE.half, z: BRIDGE.z, width: BRIDGE.width,
    deckAt: (x) => bridgeDeck(x, BRIDGE.z),
  });
  for (const s of [-1, 1]) occupy(BRIDGE_X + s * BRIDGE.half, BRIDGE.z, 4);

  // ── mercenary camp (east bank) ──
  onProgress(0.2, 'Building the camp…');
  {
    const c = C.camp;
    for (const t of [{ x: c.x - 8, z: c.z - 6, rot: 0.2 }, { x: c.x + 6, z: c.z - 8, rot: -0.3 }, { x: c.x - 6, z: c.z + 8, rot: 1.5 }, { x: c.x + 9, z: c.z + 5, rot: 1.2 }]) {
      tent(ctx, { ...t, gy: groundAt(t.x, t.z) });
      occupy(t.x, t.z, 4);
    }
    watchtower(ctx, { x: c.x + 10, z: c.z - 1, gy: groundAt(c.x + 10, c.z - 1) });
    occupy(c.x + 10, c.z - 1, 3.5);
    const bags = [
      [[c.x - 12, c.z + 2], [c.x - 13, c.z - 4], [c.x - 11.5, c.z - 10]],
      [[c.x + 2, c.z + 13], [c.x + 8, c.z + 12]],
      [[c.x + 4, c.z - 14], [c.x - 2, c.z - 15]],
      [[c.x - 2, c.z + 1], [c.x + 1.5, c.z + 2.2]],
    ];
    for (const pts of bags) {
      sandbags(ctx, pts, groundAt);
      for (const [x, z] of pts) occupy(x, z, 2);
    }
    const piles = [
      ['wooden_military_crate', c.x + 1, c.z - 3, 0.2, true], ['wooden_military_crate', c.x + 1.2, c.z - 3.9, 0.1, true],
      ['old_military_crate', c.x - 1, c.z - 4.5, 1.4, true], ['ammo_box', c.x + 0.4, c.z - 2.2, 0.6, false],
      ['barrel_03', c.x + 4, c.z + 3, 0, true], ['barrel_03', c.x + 4.7, c.z + 3.6, 0, true], ['barrel_03', c.x + 3.5, c.z + 3.9, 0, true],
      ['metal_jerrycan_green', c.x + 5.4, c.z + 2.6, 0.4, false], ['wooden_military_crate', c.x - 4, c.z + 4, 1.0, true],
      ['old_military_crate', c.x + 6, c.z - 3.5, -0.4, true], ['wooden_lantern_01', c.x - 2.5, c.z + 2.5, 0, false],
      ['stone_fire_pit', c.x - 3, c.z - 1, 0, true],
    ];
    for (const [n, x, z, rot, stand] of piles) { prop(n, x, z, { rot, solid: stand ? 'box' : 'none', stand }); occupy(x, z, 1.5); }
    occupy(c.x, c.z, 9);
  }

  // ── supply landing (north-west) ──
  {
    const l = C.landing;
    for (const [n, dx, dz, rot] of [['wooden_military_crate', 0, 0, 0.1], ['wooden_military_crate', 0.1, 0.9, -0.05], ['old_military_crate', 2.2, -0.6, 1.2],
      ['barrel_03', -2, 1.5, 0], ['barrel_03', -2.6, 0.8, 0], ['ammo_box', 0.8, -1.2, 0.3], ['metal_jerrycan_green', -1.5, -1.3, 1]]) {
      prop(n, l.x + dx, l.z + dz, { rot, solid: n === 'ammo_box' || n.includes('jerry') ? 'none' : 'box', stand: !n.includes('ammo') });
    }
    sandbags(ctx, [[l.x - 5, l.z - 5], [l.x + 1, l.z - 6.5]], groundAt);
    sandbags(ctx, [[l.x + 5, l.z + 3], [l.x + 6, l.z - 3]], groundAt);
    occupy(l.x, l.z, 8);
  }
  occupy(C.spawn.x, C.spawn.z, 5);

  // ── rocks, logs and stumps scattered through the jungle (cover) ──
  onProgress(0.26, 'Scattering cover…');
  const isFree = (x, z, pad = 0) =>
    occupied.every(([ox, oz, r]) => Math.hypot(x - ox, z - oz) > r + pad) && trailDist(x, z) > 2.2 + pad && waterDepth(x, z) <= 0 && bridgeDeck(x, z) === -Infinity;
  {
    let placed = 0;
    for (let i = 0; i < 400 && placed < 70; i++) {
      const x = BOUNDS.minX + 4 + rand() * (BOUNDS.maxX - BOUNDS.minX - 8), z = BOUNDS.minZ + 4 + rand() * (BOUNDS.maxZ - BOUNDS.minZ - 8);
      if (!isFree(x, z, 2) || slopeAt(x, z) > 0.5) continue;
      const k = rand();
      if (k < 0.3) { prop(rand() < 0.5 ? 'rock_moss_set_01' : 'rock_moss_set_02', x, z, { scale: 0.7 + rand() * 0.6, sink: 0.15, solid: 'parts' }); occupy(x, z, 4.5); }
      else if (k < 0.7) { prop('dead_tree_trunk', x, z, { scale: 2.2 + rand() * 0.8, sink: 0.08, solid: 'box', stand: true }); occupy(x, z, 3.5); }
      else { prop('tree_stump_01', x, z, { scale: 1 + rand() * 0.5, solid: 'box', stand: true }); occupy(x, z, 1.6); }
      placed++;
    }
  }

  // ── structure posts, light shafts ──
  {
    const im = instancedPosts(posts, mats.bark);
    root.add(im);
    shootables.push(im);
  }
  if (sunDir) {
    for (const [x, z] of [[C.village.x + 3, C.village.z + 2], [C.camp.x - 4, C.camp.z + 6], [-20, 20], [30, -30], [-60, -20], [0, 60], [60, 40], [-30, -45]]) {
      lightShaft(root, new THREE.Vector3(x, groundAt(x, z), z), sunDir, 26, 3 + rand() * 2);
    }
  }

  // ── merge hand-built geometry per material ──
  for (const [mat, b] of builders) {
    const g = b.build();
    if (!g) continue;
    const m = new THREE.Mesh(g, mat);
    m.castShadow = m.receiveShadow = true;
    m.userData.surface = mat === mats.tarp ? 'dirt' : 'wood';
    root.add(m);
    shootables.push(m);
  }

  // ── jungle trees (EZ-Tree) ──
  const treeSpots = [];
  const treeOk = (x, z) => isFree(x, z, 1.5) && Math.abs(x - riverX(z)) > 9 && treeSpots.every((t) => Math.hypot(t.x - x, t.z - z) > 5.5);
  const pickVariant = () => { const r = rand(); return r < 0.16 ? 0 : r < 0.42 ? 1 : r < 0.66 ? 2 : 3; };
  for (let gx = -HALF - 70; gx <= HALF + 70; gx += 8.5) {
    for (let gz = -HALF - 70; gz <= HALF + 70; gz += 8.5) {
      const x = gx + (rand() - 0.5) * 7, z = gz + (rand() - 0.5) * 7;
      const outside = Math.max(Math.abs(x), Math.abs(z)) > HALF - 4;
      if (outside && rand() < 0.2) continue;
      if (!treeOk(x, z)) continue;
      treeSpots.push({ x, z, y: heightAt(x, z), s: 0.8 + rand() * 0.45, v: pickVariant() });
    }
  }
  const trees = await buildJungleTrees(treeSpots, (k) => onProgress(0.3 + k * 0.5, 'Growing the rainforest…'));
  root.add(trees.group);
  shootables.push(...trees.shootables);
  aoExclude.push(...trees.leafMeshes);
  for (const [x, z, r, y] of trees.colliders) if (Math.max(Math.abs(x), Math.abs(z)) < HALF + 2) collision.addCircle(x, z, r, y - 1, y + 14);

  // ── undergrowth ──
  onProgress(0.85, 'Planting undergrowth…');
  const scatter = (n, test) => {
    const out = [];
    for (let i = 0; i < n * 4 && out.length < n; i++) {
      const x = -HALF - 20 + rand() * (HALF * 2 + 40), z = -HALF - 20 + rand() * (HALF * 2 + 40);
      if (test(x, z)) out.push([x, heightAt(x, z), z, 1]);
    }
    return out;
  };
  const underOk = (pad) => (x, z) => occupied.every(([ox, oz, r]) => Math.hypot(x - ox, z - oz) > r * 0.8) && trailDist(x, z) > pad && heightAt(x, z) > WATER_Y + 0.15 && bridgeDeck(x, z) === -Infinity;
  const fernSet = ferns(scatter(4200, underOk(1.6)));
  const leafSet = broadLeafPlants(scatter(1100, underOk(2.2)));
  const clumpSet = groundClumps(scatter(5200, underOk(1.1)));
  const bankPalms = [];
  for (let i = 0; i < 400 && bankPalms.length < 46; i++) {
    const z = -HALF + rand() * HALF * 2, side = rand() < 0.5 ? -1 : 1, x = riverX(z) + side * (9 + rand() * 6);
    if (isFree(x, z, 0.5) && bankPalms.every(([a, , b]) => Math.hypot(a - x, b - z) > 5)) bankPalms.push([x, heightAt(x, z), z, 1]);
  }
  for (const v of [C.village, C.landing]) {
    for (let i = 0; i < 7; i++) {
      const a = rand() * Math.PI * 2, r = v.r * (0.75 + rand() * 0.25), x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r;
      if (isFree(x, z, 0.5)) bankPalms.push([x, heightAt(x, z), z, 1]);
    }
  }
  const palmSet = palms(bankPalms, T.palmBark);
  for (const [x, , z] of bankPalms) if (Math.max(Math.abs(x), Math.abs(z)) < HALF) collision.addCircle(x, z, 0.24, heightAt(x, z) - 1, heightAt(x, z) + 8);
  const vines = [];
  for (const t of treeSpots) {
    if (t.v === 3 || rand() > 0.35) continue;
    const top = t.y + [30, 24, 20, 10][t.v] * t.s * 0.72;
    for (let k = 0; k < 2; k++) vines.push([t.x + (rand() - 0.5) * 6, top, t.z + (rand() - 0.5) * 6, 5 + rand() * 10]);
  }
  const vineSet = lianas(vines);
  root.add(fernSet, leafSet, clumpSet, palmSet.trunks, palmSet.crowns, vineSet);
  shootables.push(palmSet.trunks);
  aoExclude.push(fernSet, leafSet, clumpSet, palmSet.crowns, vineSet);
  const undergrowth = [fernSet, leafSet, clumpSet];
  const casters = [leafSet, palmSet.trunks, palmSet.crowns, vineSet];

  // ── navigation ──
  const inB = (x, z, m = 0) => x > BOUNDS.minX - m && x < BOUNDS.maxX + m && z > BOUNDS.minZ - m && z < BOUNDS.maxZ + m;
  const insideSolid = (x, z) => solids.some((p) => pointInPolygon(x, z, p));
  const walkable = (x, z, r = 0.45) => {
    if (!inB(x, z, -1)) return false;
    if (bridgeDeck(x, z) > -Infinity) return Math.abs(z - BRIDGE.z) < 0.7;
    if (waterDepth(x, z) > 0.55 || slopeAt(x, z) > 0.75 || insideSolid(x, z)) return false;
    const g = heightAt(x, z);
    return !collision.blocked(x, z, r, g + 0.3, g + 1.8);
  };

  const spawnPos = new THREE.Vector3(C.spawn.x, groundAt(C.spawn.x, C.spawn.z), C.spawn.z);
  const DENSITY = { low: 0.4, medium: 0.65, high: 0.85, ultra: 1 };
  let waterT = 0;
  onProgress(1, 'Done');

  return {
    id: 'rimba', root, collision, colliders, shootables, smallProps, aoExclude, bounds: BOUNDS,
    spawn: { pos: spawnPos, yaw: Math.atan2(-(0 - C.spawn.x), -(0 - C.spawn.z)) },
    fog: { color: 0x8d9a86, density: 0.0085 },
    walkable, insideSolid,
    groundAt,
    speedAt: (x, z) => (waterDepth(x, z) > 0.35 ? 0.6 : 1),
    update(time) {
      foliageTime(time);
      if (camera) trees.update(camera.position);
      waterT = time;
      river.normal.offset.set(waterT * 0.012, -waterT * 0.035);
    },
    setPropShadows(on) {
      for (const m of smallProps) m.castShadow = on;
      for (const m of casters) m.castShadow = on;
    },
    setQuality(preset, tier) {
      trees.setQuality({ ...preset, key: tier });
      for (const im of undergrowth) setDensity(im, DENSITY[tier] ?? 0.8);
    },
  };
}
