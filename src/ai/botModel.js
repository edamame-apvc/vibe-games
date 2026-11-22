import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Original procedural "mercenary" character: helmet, plate carrier with
// pouches, camo fatigues, gloves, boots and a carbine. Rigid body parts on a
// simple bone hierarchy, animated in code (walk / run / crouch / aim / death).

let SHARED = null;

function camoTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#7a7356'; x.fillRect(0, 0, 256, 256);
  const cols = ['#5c5a3f', '#9a8f6a', '#4a4232', '#6f7a4e', '#a89f7c'];
  for (let i = 0; i < 90; i++) {
    x.fillStyle = cols[i % cols.length];
    x.beginPath();
    const cx = Math.random() * 256, cy = Math.random() * 256;
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2, r = 8 + Math.random() * 22;
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r * 0.7;
      k ? x.lineTo(px, py) : x.moveTo(px, py);
    }
    x.closePath(); x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(2, 2);
  return t;
}

function shared() {
  if (SHARED) return SHARED;
  const camo = camoTexture();
  const mats = {
    fatigues: new THREE.MeshStandardMaterial({ map: camo, roughness: 0.92 }),
    vest: new THREE.MeshStandardMaterial({ color: 0x4d4a37, roughness: 0.85 }),
    gear: new THREE.MeshStandardMaterial({ color: 0x2d2c25, roughness: 0.8 }),
    helmet: new THREE.MeshStandardMaterial({ color: 0x55553f, roughness: 0.7, metalness: 0.1 }),
    glove: new THREE.MeshStandardMaterial({ color: 0x1c1c1a, roughness: 0.8 }),
    boot: new THREE.MeshStandardMaterial({ color: 0x3a2e22, roughness: 0.85 }),
    gun: new THREE.MeshStandardMaterial({ color: 0x1e1f21, roughness: 0.5, metalness: 0.6 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.1, metalness: 0.8 }),
    skins: [0xc89f7e, 0x9c7256, 0x6e4a33, 0xe0bc9a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 })),
  };
  const cap = (r, len) => new THREE.CapsuleGeometry(r, len, 4, 10);
  const geo = {
    pelvis: new RoundedBoxGeometry(0.34, 0.2, 0.22, 2, 0.06),
    torso: new RoundedBoxGeometry(0.38, 0.5, 0.23, 2, 0.08),
    vest: mergeGeometries([
      new RoundedBoxGeometry(0.42, 0.36, 0.3, 2, 0.04),
      ...[-0.12, 0, 0.12].map((x) => { const g = new RoundedBoxGeometry(0.1, 0.12, 0.06, 1, 0.02); g.translate(x, -0.1, -0.17); return g; }),
      (() => { const g = new RoundedBoxGeometry(0.3, 0.12, 0.1, 1, 0.03); g.translate(0, 0.02, 0.18); return g; })(), // back pack
    ]),
    head: new THREE.SphereGeometry(0.11, 16, 12),
    helmet: (() => { const g = new THREE.SphereGeometry(0.135, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55); g.scale(1, 0.95, 1.08); return g; })(),
    glasses: new RoundedBoxGeometry(0.17, 0.045, 0.04, 1, 0.015),
    neck: new THREE.CylinderGeometry(0.055, 0.06, 0.1, 10),
    upperArm: (() => { const g = cap(0.058, 0.2); g.translate(0, -0.15, 0); return g; })(),
    forearm: (() => { const g = cap(0.05, 0.2); g.translate(0, -0.14, 0); return g; })(),
    hand: (() => { const g = new RoundedBoxGeometry(0.08, 0.1, 0.05, 1, 0.02); g.translate(0, -0.3, 0); return g; })(),
    thigh: (() => { const g = cap(0.078, 0.3); g.translate(0, -0.21, 0); return g; })(),
    shin: (() => { const g = cap(0.062, 0.32); g.translate(0, -0.21, 0); return g; })(),
    boot: (() => { const g = new RoundedBoxGeometry(0.12, 0.1, 0.27, 2, 0.03); g.translate(0, -0.44, -0.05); return g; })(),
    gun: mergeGeometries([
      (() => { const g = new RoundedBoxGeometry(0.05, 0.08, 0.36, 1, 0.01); return g; })(),
      (() => { const g = new THREE.CylinderGeometry(0.011, 0.011, 0.3, 8); g.rotateX(Math.PI / 2); g.translate(0, 0.01, -0.32); return g; })(),
      (() => { const g = new RoundedBoxGeometry(0.04, 0.1, 0.22, 1, 0.01); g.translate(0, -0.02, 0.27); return g; })(),
      (() => { const g = new RoundedBoxGeometry(0.03, 0.14, 0.05, 1, 0.01); g.rotateX(0.25); g.translate(0, -0.1, -0.06); return g; })(),
      (() => { const g = new RoundedBoxGeometry(0.03, 0.09, 0.04, 1, 0.01); g.rotateX(-0.3); g.translate(0, -0.08, 0.06); return g; })(),
      (() => { const g = new RoundedBoxGeometry(0.035, 0.04, 0.08, 1, 0.01); g.translate(0, 0.065, -0.02); return g; })(),
    ]),
  };
  for (const g of Object.values(geo)) g.computeBoundsTree?.();
  SHARED = { mats, geo };
  return SHARED;
}

/** Creates one mercenary. Returns { root, meshes, muzzle, pose(state) }. */
export function createMercenary(variant = 0) {
  const { mats, geo } = shared();
  const skin = mats.skins[variant % mats.skins.length];
  const meshes = [];
  const mk = (g, m, zone, parent, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.zone = zone;
    parent.add(mesh);
    meshes.push(mesh);
    return mesh;
  };
  const grp = (parent, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };

  const root = new THREE.Group();          // at the feet, faces -Z
  const body = grp(root);                  // used for death fall
  const hips = grp(body, 0, 0.95, 0);
  mk(geo.pelvis, mats.fatigues, 'torso', hips, 0, 0, 0);
  const spine = grp(hips, 0, 0.08, 0);
  mk(geo.torso, mats.fatigues, 'torso', spine, 0, 0.27, 0);
  mk(geo.vest, mats.vest, 'torso', spine, 0, 0.3, 0);
  const neck = grp(spine, 0, 0.55, 0);
  mk(geo.neck, skin, 'head', neck, 0, 0.03, 0);
  const head = grp(neck, 0, 0.14, 0);
  mk(geo.head, skin, 'head', head, 0, 0, 0);
  mk(geo.helmet, mats.helmet, 'head', head, 0, 0.02, 0.005);
  mk(geo.glasses, mats.lens, 'head', head, 0, 0.015, -0.095);

  const arm = (side) => {
    const sh = grp(spine, side * 0.23, 0.47, 0);
    mk(geo.upperArm, mats.fatigues, 'arms', sh);
    const el = grp(sh, 0, -0.3, 0);
    mk(geo.forearm, mats.fatigues, 'arms', el);
    mk(geo.hand, mats.glove, 'arms', el);
    return { sh, el };
  };
  const armR = arm(1), armL = arm(-1);
  const leg = (side) => {
    const th = grp(hips, side * 0.1, -0.06, 0);
    mk(geo.thigh, mats.fatigues, 'legs', th);
    const kn = grp(th, 0, -0.42, 0);
    mk(geo.shin, mats.fatigues, 'legs', kn);
    mk(geo.boot, mats.boot, 'legs', kn);
    return { th, kn };
  };
  const legR = leg(1), legL = leg(-1);

  // carbine held at the shoulder
  const gunMount = grp(spine, 0.08, 0.36, -0.2);
  mk(geo.gun, mats.gun, 'arms', gunMount);
  const muzzle = grp(gunMount, 0, 0.01, -0.48);

  // static aiming arm pose
  armR.sh.rotation.set(-1.05, 0, 0.18); armR.el.rotation.set(-1.0, 0, 0);
  armL.sh.rotation.set(-1.25, 0, -0.55); armL.el.rotation.set(-0.55, 0, 0);

  /** s: { phase, speed(m/s), crouch 0..1, aimPitch, dead 0..1, deadDir ±1 } */
  function pose(s) {
    const run = Math.min(1, s.speed / 4.5);
    const amp = Math.min(1, s.speed / 1.6) * (0.5 + 0.35 * run);
    const ph = s.phase;
    const cr = s.crouch;
    // legs
    const swing = Math.sin(ph) * amp * (1 - cr * 0.6);
    legR.th.rotation.x = swing - cr * 1.05;
    legL.th.rotation.x = -swing - cr * 1.05;
    legR.kn.rotation.x = Math.max(0, Math.sin(ph + 1.3)) * amp * 1.2 + cr * 1.75;
    legL.kn.rotation.x = Math.max(0, Math.sin(ph + 1.3 + Math.PI)) * amp * 1.2 + cr * 1.75;
    // hips: bob, crouch, slight forward lean when running
    hips.position.y = 0.95 - cr * 0.38 + Math.abs(Math.cos(ph)) * 0.03 * amp;
    spine.rotation.x = -0.12 * run - cr * 0.25 + s.aimPitch * 0.7;
    hips.rotation.y = Math.sin(ph) * 0.08 * amp;
    spine.rotation.y = -hips.rotation.y;
    head.rotation.x = s.aimPitch * 0.3;
    // death: topple over
    const d = s.dead;
    body.rotation.x = d * (Math.PI / 2 - 0.05) * s.deadDir;
    body.position.y = d * 0.12;
    body.position.z = d * 0.25 * s.deadDir;
    if (d > 0) {
      armR.sh.rotation.x = -1.05 + d * 0.8; armL.sh.rotation.x = -1.25 + d * 1.0;
      legR.kn.rotation.x += d * 0.4;
    }
  }

  root.traverse((o) => { o.matrixAutoUpdate = true; });
  return { root, meshes, muzzle, pose, gunMount };
}
