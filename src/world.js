import * as THREE from 'three';
import { pbr, boxGeo, signTexture } from './assets.js';
import { fbm, smoothstep } from './noise.js';

// Player is facing -Z (down-range). Firing line is at z ≈ -1.
export const BOUNDS = { minX: -21.6, maxX: 21.6, minZ: -316, maxZ: 13.1 };
export const LANES = [-17.5, -12.5, -7.5, -2.5, 2.5, 7.5, 12.5, 17.5];

// ── Height functions (shared by meshes, grass placement and props) ──────────

export function bermHeight(x, z) {
  const xs = Math.abs(x) - 22;
  let side = -1;
  if (xs > -1) {
    side = -0.3 + 5.6 * smoothstep(0, 5.5, xs) * (1 - smoothstep(9, 23, xs)) - 0.6 * smoothstep(16, 24, xs);
    side += (fbm(x * 0.07, z * 0.07) - 0.5) * 1.6 * smoothstep(0.5, 3, xs);
    side += (fbm(x * 0.5 + 3, z * 0.5) - 0.5) * 0.3;
  }
  const zs = -318 - z;
  let back = -1;
  if (zs > -1) {
    const crest = 9.5 + (fbm(x * 0.025 + 4, 1.7) - 0.5) * 4;
    back = -0.3 + crest * smoothstep(0, 17, zs) * (1 - smoothstep(24, 40, zs));
    back += (fbm(x * 0.06 + 9, z * 0.06) - 0.5) * 2.6 * smoothstep(0.5, 5, zs);
  }
  return Math.max(side, back);
}

export function terrainHeight(x, z) {
  const dx = Math.max(0, Math.abs(x) - 44);
  const dz = Math.max(0, z - 20, -350 - z);
  const d = Math.hypot(dx, dz);
  const rise = smoothstep(0, 70, d);
  const hills = fbm(x * 0.0032 + 5, z * 0.0032 + 9, 5);
  const detail = fbm(x * 0.03, z * 0.03, 3) - 0.5;
  return -0.8 * (1 - rise) + rise * (hills * 70 - 12 + d * 0.035 + detail * 3);
}

export function groundHeightAt(x, z) {
  const inRange = Math.abs(x) < 25 && z > -324 && z < 21;
  return Math.max(inRange ? 0 : -5, bermHeight(x, z), terrainHeight(x, z));
}

// ── World builder ───────────────────────────────────────────────────────────

export function buildWorld(scene, assets) {
  const T = assets.textures;
  const mats = {
    ground: pbr(T.ground, { color: 0xd2cdc8, antiTile: { macro: 0.3, blend: 0.7, scale: 0.29 } }),
    pad: pbr(T.pad, { antiTile: { macro: 0.12, blend: 0.4 } }),
    wall: pbr(T.wall),
    wood: pbr(T.wood),
    roof: pbr(T.roof, { metalness: 1 }),
    terrain: pbr(T.terrain, { color: 0xb3a487, antiTile: { macro: 0.4, blend: 0.65, scale: 0.21 } }),
    berm: pbr(T.berm, { antiTile: { macro: 0.2, blend: 0.5 } }),
    plywood: pbr(T.plywood),
    steel: new THREE.MeshStandardMaterial({ color: 0x55585c, metalness: 1, roughness: 0.45 }),
    flag: new THREE.MeshStandardMaterial({ color: 0xb3171b, roughness: 0.85, side: THREE.DoubleSide }),
  };

  const colliders = [];   // THREE.Box3 – player collision
  const shootables = [];  // meshes bullets can hit
  const smallProps = [];  // meshes whose shadows are optional (quality)
  const root = new THREE.Group();
  root.name = 'world';
  scene.add(root);

  function add(mesh, surface, { collide = true, cast = true, receive = true, penetrable = false } = {}) {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    mesh.userData.surface = surface;
    mesh.userData.penetrable = penetrable;
    root.add(mesh);
    mesh.updateMatrixWorld(true);
    shootables.push(mesh);
    if (collide) colliders.push(new THREE.Box3().setFromObject(mesh));
    return mesh;
  }
  const box = (w, h, d, tile, mat, x, y, z, surface, opts) => {
    const m = new THREE.Mesh(boxGeo(w, h, d, tile), mat);
    m.position.set(x, y, z);
    return add(m, surface, opts);
  };

  // Range floor
  {
    const g = new THREE.PlaneGeometry(50, 345, 1, 1);
    g.rotateX(-Math.PI / 2);
    scaleUV(g, 50 / 4.5, 345 / 4.5);
    const m = new THREE.Mesh(g, mats.ground);
    m.position.set(0, 0, -151.5);
    add(m, 'dirt', { collide: false, cast: false });
  }

  // Berms + backstop (one heightfield)
  {
    const w = 96, d = 372, sx = 64, sz = 248;
    const g = new THREE.PlaneGeometry(w, d, sx, sz);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i) - 166;
      p.setY(i, Math.max(-0.6, bermHeight(x, z)));
    }
    g.computeVertexNormals();
    scaleUV(g, w / 4, d / 4);
    const m = new THREE.Mesh(g, mats.berm);
    m.position.z = -166;
    add(m, 'dirt', { collide: false });
  }

  // Outer terrain (rolling hills out to the horizon)
  {
    const size = 1800, seg = 180;
    const g = new THREE.PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i) - 160;
      p.setY(i, terrainHeight(x, z));
    }
    g.computeVertexNormals();
    scaleUV(g, size / 5, size / 5);
    const m = new THREE.Mesh(g, mats.terrain);
    m.position.z = -160;
    add(m, 'dirt', { collide: false, cast: false });
  }

  // Firing-line slab and perimeter walls
  box(44, 0.25, 15, 2.5, mats.pad, 0, -0.105, 5, 'concrete', { collide: false, cast: false });
  box(44.6, 2.8, 0.3, 2, mats.wall, 0, 1.4, 13.65, 'concrete');
  box(0.3, 2.8, 16, 2, mats.wall, -22.15, 1.4, 5.5, 'concrete');
  box(0.3, 2.8, 16, 2, mats.wall, 22.15, 1.4, 5.5, 'concrete');

  // Covered shelter: posts, beams, rafters, corrugated roof
  const frontZ = -1.7, backZ = 11.3, frontY = 3.55, backY = 3.05;
  for (const x of [-20, -10, 0, 10, 20]) {
    box(0.2, frontY, 0.2, 1, mats.wood, x, frontY / 2, frontZ, 'wood');
    box(0.2, backY, 0.2, 1, mats.wood, x, backY / 2, backZ, 'wood');
  }
  box(42.4, 0.26, 0.2, 1.5, mats.wood, 0, frontY - 0.1, frontZ, 'wood', { collide: false });
  box(42.4, 0.26, 0.2, 1.5, mats.wood, 0, backY - 0.1, backZ, 'wood', { collide: false });
  const slope = Math.atan2(frontY - backY, backZ - frontZ);
  for (let x = -20; x <= 20.01; x += 2.5) {
    const r = box(0.1, 0.18, 13.6, 1, mats.wood, x, (frontY + backY) / 2 + 0.11, (frontZ + backZ) / 2, 'wood', { collide: false });
    r.rotation.x = slope;
    r.updateMatrixWorld();
  }
  {
    const roof = box(43.2, 0.04, 14.6, 2, mats.roof, 0, (frontY + backY) / 2 + 0.23, (frontZ + backZ) / 2, 'metal', { collide: false });
    roof.rotation.x = slope;
    roof.updateMatrixWorld();
  }

  // Lane benches, partitions, lane numbers
  LANES.forEach((cx, i) => {
    box(1.5, 0.07, 0.75, 1, mats.wood, cx, 0.93, -0.9, 'wood', { penetrable: true });
    for (const [dx, dz] of [[-0.66, -0.3], [0.66, -0.3], [-0.66, 0.3], [0.66, 0.3]]) {
      box(0.07, 0.9, 0.07, 1, mats.wood, cx + dx, 0.45, -0.9 + dz, 'wood', { collide: false });
    }
    box(1.36, 0.04, 0.6, 1, mats.wood, cx, 0.25, -0.9, 'wood', { collide: false }); // shelf
    colliders.push(new THREE.Box3(new THREE.Vector3(cx - 0.76, 0, -1.29), new THREE.Vector3(cx + 0.76, 0.97, -0.51)));

    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.34),
      new THREE.MeshStandardMaterial({ map: signTexture(String(i + 1), { font: 'bold 96px Arial' }), roughness: 0.8 }));
    sign.position.set(cx, frontY - 0.42, frontZ + 0.11);
    root.add(sign);
  });
  for (const x of [-15, -10, -5, 0, 5, 10, 15]) {
    box(0.035, 1.9, 2.6, 1.2, mats.plywood, x, 1.05, -0.75, 'wood', { penetrable: true });
  }

  // Distance markers on the left berm toe
  for (let d = 25; d <= 300; d += 25) {
    box(0.1, 1.2, 0.1, 1, mats.wood, -20.9, 0.6, -d, 'wood', { collide: false });
    const s = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.5),
      new THREE.MeshStandardMaterial({ map: signTexture(`${d} m`, { font: 'bold 70px Arial' }), roughness: 0.8 }));
    s.position.set(-20.9, 1.45, -d + 0.06);
    s.castShadow = true;
    root.add(s);
    shootables.push(s);
    s.userData.surface = 'wood';
  }

  // Range flag (animated cloth)
  box(0.08, 6.5, 0.08, 1, mats.steel, 21.3, 3.25, -2.3, 'metal', { collide: false });
  const flagGeo = new THREE.PlaneGeometry(1.5, 0.95, 24, 12);
  flagGeo.translate(0.75, 0, 0);
  const flagBase = flagGeo.attributes.position.array.slice();
  const flag = new THREE.Mesh(flagGeo, mats.flag);
  flag.position.set(21.34, 5.95, -2.3);
  flag.rotation.y = Math.PI * 0.85;
  flag.castShadow = true;
  root.add(flag);

  // ── glTF props (Poly Haven, real-world scale) ──
  const SURFACE = {
    barrel_03: 'metal', metal_jerrycan_green: 'metal', portable_searchlight: 'metal',
    wooden_military_crate: 'wood', old_military_crate: 'wood', wooden_crate_02: 'wood', ammo_box: 'metal',
    dead_tree_trunk: 'wood', concrete_road_barrier: 'concrete', old_tyre: 'rubber',
    plastic_crate_01: 'plastic', rock_face_01: 'concrete',
  };
  const SMALL = new Set(['ammo_box', 'metal_jerrycan_green', 'plastic_crate_01', 'portable_searchlight', 'old_tyre']);
  const prop = (name, x, y, z, rotY = 0, scale = 1, { collide = true, groundAlign = false } = {}) => {
    const src = assets.models[name];
    const o = src.clone(true);
    o.scale.setScalar(scale);
    o.rotation.y = rotY;
    o.position.set(x, y, z);
    root.add(o);
    o.updateMatrixWorld(true);
    if (groundAlign) {
      const b = new THREE.Box3().setFromObject(o);
      o.position.y += y - b.min.y;
      o.updateMatrixWorld(true);
    }
    o.traverse((m) => {
      if (!m.isMesh) return;
      m.userData.surface = SURFACE[name] || 'wood';
      m.userData.penetrable = name === 'plastic_crate_01';
      shootables.push(m);
      if (SMALL.has(name)) smallProps.push(m);
    });
    if (collide) colliders.push(new THREE.Box3().setFromObject(o));
    return o;
  };
  const topOf = (o) => new THREE.Box3().setFromObject(o).max.y;

  // Behind the firing line
  const c1 = prop('wooden_military_crate', -18.6, 0, 12.7, 0.05, 1, { groundAlign: true });
  prop('wooden_military_crate', -18.4, topOf(c1), 12.65, -0.08, 1, { groundAlign: true });
  prop('old_military_crate', -12.5, 0, 12.85, 0, 1, { groundAlign: true });
  const pc = prop('plastic_crate_01', 15.2, 0, 12.6, 0.2, 1, { groundAlign: true });
  prop('plastic_crate_01', 15.25, topOf(pc), 12.55, -0.15, 1, { groundAlign: true });
  prop('plastic_crate_01', 15.9, 0, 12.0, 1.3, 1, { groundAlign: true });
  prop('barrel_03', -20.9, 0, 9.4, 0.3, 1, { groundAlign: true });
  prop('barrel_03', -20.95, 0, 8.45, 1.1, 1, { groundAlign: true });
  prop('barrel_03', -20.05, 0, 8.95, 2.0, 1, { groundAlign: true });
  prop('metal_jerrycan_green', -19.8, 0, 10.3, 0.6, 1, { groundAlign: true });
  prop('metal_jerrycan_green', -19.55, 0, 10.55, 0.2, 1, { groundAlign: true });
  prop('barrel_03', 21.0, 0, 3.0, 0.7, 1, { groundAlign: true });
  prop('portable_searchlight', 20.6, 0, 0.2, Math.PI + 0.3, 1, { groundAlign: true });

  // On the benches
  prop('ammo_box', LANES[1] + 0.45, 0.965, -0.95, 0.2, 1, { collide: false, groundAlign: true });
  prop('ammo_box', LANES[4] - 0.5, 0.965, -0.85, -0.3, 1, { collide: false, groundAlign: true });
  prop('ammo_box', LANES[6] + 0.4, 0.965, -0.9, 1.5, 1, { collide: false, groundAlign: true });

  // Down-range cover
  prop('concrete_road_barrier', -9.2, 0, -30, 0, 1, { groundAlign: true });
  prop('concrete_road_barrier', -7.6, 0, -30.1, 0.04, 1, { groundAlign: true });
  prop('concrete_road_barrier', 8.5, 0, -72, 0.25, 1, { groundAlign: true });
  prop('wooden_crate_02', -4.8, 0, -48, 0.35, 1, { groundAlign: true });
  prop('wooden_crate_02', -3.7, 0, -48.6, 0.1, 1, { groundAlign: true });
  let ty = 0;
  for (let i = 0; i < 3; i++) {
    const t = prop('old_tyre', 12.3, ty, -55, i * 1.7, 1, { groundAlign: true });
    ty = topOf(t) - 0.03;
  }
  prop('old_tyre', -14.5, 0, -22, 0.4, 1, { groundAlign: true });
  prop('old_tyre', -13.8, 0, -22.7, 2.1, 1, { groundAlign: true });
  prop('dead_tree_trunk', 27.5, bermHeight(27.5, -120) - 0.35, -120, 1.25, 1, { collide: false });
  prop('dead_tree_trunk', -28, bermHeight(-28, -205) - 0.3, -205, -0.4, 1, { collide: false });

  // Distant rock outcrops on the hills
  for (const [x, z, s, r] of [[-150, -230, 5, 0.3], [170, -90, 4, 1.9], [-110, 70, 3.5, 2.6], [70, -460, 6, 0.9], [-230, -420, 5, 4.1], [240, -300, 4.5, 3.3]]) {
    prop('rock_face_01', x, terrainHeight(x, z) - 2, z, r, s, { collide: false });
  }

  // Shadow-only optimisation: big static terrain never casts shadows.
  return {
    root, colliders, shootables, smallProps, mats,
    update(time) {
      // Flag ripple: travelling wave, stronger toward the free edge.
      const p = flagGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = flagBase[i * 3], y = flagBase[i * 3 + 1];
        const k = x / 1.5;
        p.setZ(i, Math.sin(x * 4.2 - time * 7.5 + y * 1.3) * 0.13 * k + Math.sin(x * 9 - time * 13) * 0.03 * k);
        p.setY(i, y - k * k * 0.12 + Math.sin(time * 3 + x * 2) * 0.02 * k);
      }
      p.needsUpdate = true;
      flagGeo.computeVertexNormals();
    },
    setPropShadows(on) { for (const m of smallProps) m.castShadow = on; },
  };
}

function scaleUV(g, su, sv) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
}
