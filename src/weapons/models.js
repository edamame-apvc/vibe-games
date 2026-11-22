import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { noiseTexture, canvasTexture } from '../assets.js';

// Procedural, original weapon models. Coordinates in metres.
// Gun space: origin ≈ top of the pistol grip, barrel points toward -Z, +Y up.

let M = null;
function materials() {
  if (M) return M;
  const fine = noiseTexture(256, { base: 140, amp: 70 });
  fine.repeat.set(6, 6);
  const stipple = noiseTexture(256, { base: 128, amp: 255 });
  stipple.repeat.set(10, 10);
  const blotchy = noiseTexture(256, { base: 150, amp: 40, blobs: 60 });
  blotchy.repeat.set(2, 2);
  const wood = canvasTexture(512, (ctx, s) => {
    ctx.fillStyle = '#5b3a20'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 140; i++) {
      const y = Math.random() * s, a = 0.05 + Math.random() * 0.18;
      ctx.strokeStyle = Math.random() > 0.5 ? `rgba(30,15,5,${a})` : `rgba(140,95,55,${a})`;
      ctx.lineWidth = 0.5 + Math.random() * 3;
      ctx.beginPath(); ctx.moveTo(0, y);
      for (let x = 0; x <= s; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.01 + i) * 6 + (Math.random() - 0.5) * 3);
      ctx.stroke();
    }
  }, { srgb: true, repeat: 2 });

  M = {
    metal: new THREE.MeshStandardMaterial({ color: 0x3b3d41, metalness: 0.8, roughness: 0.42, roughnessMap: fine }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x232427, metalness: 0.75, roughness: 0.48, roughnessMap: fine }),
    steel: new THREE.MeshStandardMaterial({ color: 0x45474b, metalness: 1, roughness: 0.3, roughnessMap: fine }),
    polymer: new THREE.MeshStandardMaterial({ color: 0x2b2c2e, metalness: 0, roughness: 0.72, bumpMap: stipple, bumpScale: 0.6, roughnessMap: blotchy }),
    tan: new THREE.MeshStandardMaterial({ color: 0x7a6548, metalness: 0.05, roughness: 0.7, bumpMap: stipple, bumpScale: 0.4, roughnessMap: blotchy }),
    olive: new THREE.MeshStandardMaterial({ color: 0x3f4433, metalness: 0.05, roughness: 0.75, bumpMap: stipple, bumpScale: 0.4 }),
    wood: new THREE.MeshStandardMaterial({ map: wood, metalness: 0, roughness: 0.5, roughnessMap: fine }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0f0f10, metalness: 0, roughness: 0.95, bumpMap: stipple, bumpScale: 1 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0c2230, metalness: 0.9, roughness: 0.04, transparent: true, opacity: 0.4, depthWrite: false }),
    lensCoat: new THREE.MeshStandardMaterial({ color: 0x3a1d4a, metalness: 1, roughness: 0.05, transparent: true, opacity: 0.55 }),
    dot: new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.35, 0.25), toneMapped: false }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc39543, metalness: 1, roughness: 0.28 }),
    tritium: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.2, 0.6), toneMapped: false }),
    glove: new THREE.MeshStandardMaterial({ color: 0x23251f, metalness: 0, roughness: 0.82, bumpMap: stipple, bumpScale: 0.5 }),
    sleeve: new THREE.MeshStandardMaterial({ color: 0x4d5240, metalness: 0, roughness: 0.95, bumpMap: blotchy, bumpScale: 2 }),
    knuckle: new THREE.MeshStandardMaterial({ color: 0x111211, metalness: 0, roughness: 0.6 }),
  };
  return M;
}
export function weaponMaterials() { return materials(); }

// ── geometry helpers ────────────────────────────────────────────────────────

function rbox(parent, w, h, d, mat, x, y, z, r = 0.004) {
  const rad = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.max(rad, 0.0005)), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function cylZ(parent, r, len, mat, x, y, z, seg = 20, r2 = r) {
  const g = new THREE.CylinderGeometry(r2, r, len, seg);
  g.rotateX(Math.PI / 2); // +Y → -Z : radiusTop ends up at -Z (front)
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function cylX(parent, r, len, mat, x, y, z, seg = 16) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateZ(Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function cylY(parent, r, len, mat, x, y, z, seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
/** Side-profile extrusion. pts = [[forward, up], …] where forward = -Z. */
function profile(parent, pts, thickness, mat, x = 0, bevel = 0.003) {
  const s = new THREE.Shape();
  pts.forEach(([f, u], i) => (i ? s.lineTo(f, u) : s.moveTo(f, u)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: thickness - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8,
  });
  g.translate(0, 0, -(thickness - bevel * 2) / 2);
  g.rotateY(Math.PI / 2); // shape x(forward) → -Z
  const m = new THREE.Mesh(g, mat);
  m.position.x = x;
  parent.add(m);
  return m;
}
function marker(parent, x, y, z) {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}
function rail(parent, len, x, y, z, mat) {
  rbox(parent, 0.022, 0.006, len, mat, x, y, z, 0.001);
  const n = Math.floor(len / 0.01);
  for (let i = 0; i < n; i += 1) {
    if (i % 2) continue;
    rbox(parent, 0.021, 0.004, 0.005, mat, x, y + 0.004, z - len / 2 + (i + 0.5) * 0.01, 0.0008);
  }
}
function slots(parent, count, x, y, z0, spacing, mat) {
  for (let i = 0; i < count; i++) rbox(parent, 0.004, 0.009, 0.022, mat, x, y, z0 - i * spacing, 0.002);
}

// Red-dot / holographic sights. Returns y of the dot (sight line).
function redDot(parent, y, z, m, style = 'tube') {
  if (style === 'tube') {
    rbox(parent, 0.026, 0.012, 0.045, m.metal, 0, y + 0.006, z, 0.002);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.042, 24, 1, true), m.metal);
    tube.geometry.rotateX(Math.PI / 2);
    tube.material = m.metal;
    tube.position.set(0, y + 0.031, z);
    parent.add(tube);
    for (const dz of [-0.021, 0.021]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.0028, 8, 28), m.metal);
      ring.position.set(0, y + 0.031, z + dz);
      parent.add(ring);
    }
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.0155, 24), m.lensCoat);
    lens.position.set(0, y + 0.031, z - 0.018);
    parent.add(lens);
    cylX(parent, 0.005, 0.01, m.darkMetal, 0.021, y + 0.031, z + 0.004); // brightness knob
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0007, 8, 8), m.dot);
    dot.position.set(0, y + 0.031, z - 0.03);
    parent.add(dot);
    return y + 0.031;
  }
  // holographic window style
  rbox(parent, 0.034, 0.012, 0.075, m.metal, 0, y + 0.006, z, 0.002);
  rbox(parent, 0.034, 0.012, 0.03, m.darkMetal, 0, y + 0.018, z + 0.022, 0.002); // battery housing
  for (const sx of [-0.016, 0.016]) rbox(parent, 0.004, 0.04, 0.05, m.metal, sx, y + 0.032, z - 0.012, 0.0015);
  rbox(parent, 0.036, 0.005, 0.05, m.metal, 0, y + 0.054, z - 0.012, 0.002);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(0.028, 0.03), m.lensCoat);
  win.position.set(0, y + 0.035, z - 0.035);
  parent.add(win);
  const dot = new THREE.Mesh(new THREE.TorusGeometry(0.0022, 0.00025, 6, 24), m.dot);
  dot.position.set(0, y + 0.035, z - 0.05);
  parent.add(dot);
  const c = new THREE.Mesh(new THREE.SphereGeometry(0.00045, 6, 6), m.dot);
  c.position.copy(dot.position);
  parent.add(c);
  return y + 0.035;
}

// ── Builders ────────────────────────────────────────────────────────────────

function buildPistol(m) {
  const g = new THREE.Group();
  const slide = new THREE.Group();
  g.add(slide);
  // frame
  rbox(g, 0.029, 0.026, 0.16, m.polymer, 0, 0.006, -0.06, 0.005);
  rail(g, 0.04, 0, -0.01, -0.105, m.polymer);
  profile(g, [[0.025, 0.0], [-0.022, 0.0], [-0.045, -0.105], [-0.01, -0.115], [0.008, -0.1]], 0.031, m.polymer, 0, 0.005);
  // trigger guard + trigger
  rbox(g, 0.012, 0.005, 0.05, m.polymer, 0, -0.026, -0.045, 0.002);
  rbox(g, 0.012, 0.026, 0.005, m.polymer, 0, -0.014, -0.069, 0.002);
  rbox(g, 0.006, 0.018, 0.005, m.darkMetal, 0, -0.012, -0.036, 0.002);
  // slide
  rbox(slide, 0.03, 0.03, 0.19, m.metal, 0, 0.033, -0.075, 0.004);
  for (let i = 0; i < 7; i++) {
    for (const sx of [-0.0152, 0.0152]) rbox(slide, 0.001, 0.022, 0.0025, m.darkMetal, sx, 0.033, 0.006 - i * 0.005, 0.0005);
  }
  rbox(slide, 0.008, 0.004, 0.025, m.darkMetal, 0.0152, 0.04, -0.035, 0.001); // ejection port
  cylZ(slide, 0.0065, 0.01, m.darkMetal, 0, 0.032, -0.171);
  // sights with tritium dots
  rbox(slide, 0.004, 0.007, 0.006, m.darkMetal, 0, 0.051, -0.162, 0.001);
  for (const sx of [-0.0055, 0.0055]) rbox(slide, 0.005, 0.008, 0.008, m.darkMetal, sx, 0.051, 0.008, 0.001);
  const fdot = new THREE.Mesh(new THREE.SphereGeometry(0.0011, 6, 6), m.tritium);
  fdot.position.set(0, 0.0525, -0.159); slide.add(fdot);
  // magazine (baseplate visible)
  const mag = new THREE.Group();
  g.add(mag);
  const magBody = rbox(mag, 0.022, 0.1, 0.03, m.darkMetal, 0, -0.06, -0.012, 0.003);
  magBody.rotation.x = -0.2;
  rbox(mag, 0.03, 0.008, 0.042, m.polymer, 0, -0.112, 0.0, 0.003).rotation.x = -0.2;

  return {
    group: g, slide, mag,
    muzzle: marker(g, 0, 0.032, -0.18), eject: marker(g, 0.016, 0.045, -0.035),
    sightY: 0.0545,
    hands: { right: [0.002, -0.05, 0.012], left: [-0.012, -0.065, 0.0] },
    hip: [0.13, -0.15, -0.34], ads: [0, 0, -0.29],
  };
}

function buildSMG(m) {
  const g = new THREE.Group();
  rbox(g, 0.044, 0.05, 0.27, m.metal, 0, 0.032, -0.1, 0.005);       // upper
  rbox(g, 0.04, 0.035, 0.2, m.polymer, 0, -0.004, -0.08, 0.005);    // lower
  rbox(g, 0.05, 0.046, 0.13, m.polymer, 0, 0.026, -0.3, 0.008);     // handguard
  slots(g, 4, 0.025, 0.026, -0.255, 0.026, m.darkMetal);
  slots(g, 4, -0.025, 0.026, -0.255, 0.026, m.darkMetal);
  cylZ(g, 0.008, 0.07, m.steel, 0, 0.03, -0.395);
  cylZ(g, 0.012, 0.04, m.darkMetal, 0, 0.03, -0.44, 12);
  rail(g, 0.2, 0, 0.06, -0.12, m.metal);
  rbox(g, 0.01, 0.012, 0.03, m.darkMetal, 0.024, 0.04, -0.06, 0.002); // charging handle
  rbox(g, 0.004, 0.014, 0.03, m.darkMetal, 0.0225, 0.03, -0.12, 0.001); // ejection port
  profile(g, [[0.022, 0.0], [-0.016, 0.0], [-0.04, -0.1], [-0.006, -0.108], [0.012, -0.095]], 0.03, m.polymer, 0, 0.005);
  rbox(g, 0.012, 0.005, 0.05, m.polymer, 0, -0.03, -0.045, 0.002);
  rbox(g, 0.006, 0.016, 0.005, m.darkMetal, 0, -0.016, -0.035, 0.002);
  // folding wire stock
  for (const y of [0.04, 0.0]) cylZ(g, 0.0045, 0.2, m.darkMetal, 0, y, 0.12, 10);
  rbox(g, 0.035, 0.1, 0.018, m.rubber, 0, 0.01, 0.225, 0.006);
  // magazine
  const mag = new THREE.Group();
  g.add(mag);
  const mb = rbox(mag, 0.024, 0.17, 0.038, m.darkMetal, 0, -0.085, -0.16, 0.004);
  mb.rotation.x = 0.06;
  rbox(mag, 0.03, 0.01, 0.045, m.polymer, 0, -0.172, -0.165, 0.003);
  const sightY = redDot(g, 0.064, -0.1, m, 'tube');
  return {
    group: g, mag, muzzle: marker(g, 0, 0.03, -0.465), eject: marker(g, 0.024, 0.035, -0.11),
    sightY,
    hands: { right: [0.002, -0.05, 0.012], left: [0, -0.005, -0.29] },
    hip: [0.14, -0.155, -0.36], ads: [0, 0, -0.12],
  };
}

function buildRifle(m) {
  const g = new THREE.Group();
  rbox(g, 0.05, 0.055, 0.26, m.metal, 0, 0.04, -0.08, 0.005);       // upper receiver
  rbox(g, 0.046, 0.045, 0.2, m.metal, 0, -0.005, -0.07, 0.006);     // lower receiver
  rbox(g, 0.004, 0.018, 0.05, m.darkMetal, 0.0255, 0.038, -0.07, 0.001); // ejection port cover
  rbox(g, 0.018, 0.012, 0.02, m.darkMetal, 0.026, 0.045, -0.02, 0.003);  // forward assist
  rbox(g, 0.03, 0.01, 0.03, m.darkMetal, 0, 0.06, 0.06, 0.003);          // charging handle
  rail(g, 0.25, 0, 0.071, -0.08, m.metal);
  // handguard with slots
  rbox(g, 0.058, 0.058, 0.33, m.metal, 0, 0.04, -0.375, 0.01);
  for (const sx of [0.0292, -0.0292]) slots(g, 7, sx, 0.035, -0.25, 0.04, m.darkMetal);
  for (let i = 0; i < 7; i++) rbox(g, 0.008, 0.004, 0.022, m.darkMetal, 0, 0.0095, -0.25 - i * 0.04, 0.0015);
  rail(g, 0.3, 0, 0.073, -0.37, m.metal);
  cylZ(g, 0.0085, 0.16, m.steel, 0, 0.04, -0.615);
  cylZ(g, 0.013, 0.055, m.darkMetal, 0, 0.04, -0.72, 10);           // flash hider
  // folding front sight
  rbox(g, 0.012, 0.012, 0.016, m.darkMetal, 0, 0.083, -0.52, 0.002);
  // pistol grip
  profile(g, [[0.03, -0.02], [-0.016, -0.02], [-0.045, -0.125], [-0.008, -0.132], [0.012, -0.118]], 0.032, m.polymer, 0, 0.006);
  rbox(g, 0.012, 0.005, 0.06, m.metal, 0, -0.04, -0.05, 0.002);   // trigger guard
  rbox(g, 0.006, 0.018, 0.005, m.darkMetal, 0, -0.028, -0.04, 0.002);
  // stock
  cylZ(g, 0.015, 0.2, m.metal, 0, 0.03, 0.14);
  profile(g, [[-0.1, 0.055], [-0.3, 0.05], [-0.31, -0.07], [-0.27, -0.072], [-0.12, -0.005], [-0.095, 0.01]], 0.042, m.polymer, 0, 0.006);
  rbox(g, 0.044, 0.125, 0.02, m.rubber, 0, -0.008, 0.31, 0.006);
  // curved magazine
  const mag = new THREE.Group();
  g.add(mag);
  profile(mag, [[-0.005, -0.02], [-0.045, -0.02], [-0.065, -0.11], [-0.09, -0.2], [-0.052, -0.21], [-0.028, -0.115]], 0.026, m.polymer, 0, 0.003);
  mag.position.z = -0.075;
  const sightY = redDot(g, 0.075, -0.06, m, 'holo');
  return {
    group: g, mag, muzzle: marker(g, 0, 0.04, -0.75), eject: marker(g, 0.027, 0.04, -0.07),
    sightY,
    hands: { right: [0.002, -0.06, 0.006], left: [0, 0.01, -0.36] },
    hip: [0.14, -0.16, -0.36], ads: [0, 0, -0.15],
  };
}

function buildShotgun(m) {
  const g = new THREE.Group();
  rbox(g, 0.05, 0.068, 0.22, m.metal, 0, 0.03, -0.06, 0.007);
  rbox(g, 0.004, 0.024, 0.07, m.darkMetal, 0.0252, 0.04, -0.07, 0.002); // ejection port
  cylZ(g, 0.0115, 0.52, m.steel, 0, 0.052, -0.43);
  cylZ(g, 0.0125, 0.43, m.metal, 0, 0.018, -0.385);
  rbox(g, 0.022, 0.034, 0.02, m.metal, 0, 0.036, -0.62, 0.004);  // barrel clamp
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 8, 8), m.brass);
  bead.position.set(0, 0.066, -0.685); g.add(bead);
  rbox(g, 0.008, 0.006, 0.16, m.darkMetal, 0, 0.066, -0.06, 0.002); // receiver groove
  // pump
  const pump = new THREE.Group();
  g.add(pump);
  rbox(pump, 0.054, 0.046, 0.19, m.wood, 0, 0.02, -0.33, 0.012);
  for (let i = 0; i < 9; i++) rbox(pump, 0.056, 0.004, 0.006, m.darkMetal, 0, 0.0, -0.255 - i * 0.018, 0.001);
  // wooden stock with integrated grip
  profile(g, [[0.04, 0.05], [0.0, 0.045], [-0.02, -0.01], [-0.06, -0.11], [-0.03, -0.12], [-0.01, -0.08], [-0.06, -0.06], [-0.34, -0.09], [-0.36, 0.05], [-0.1, 0.05]], 0.042, m.wood, 0, 0.007);
  rbox(g, 0.044, 0.15, 0.022, m.rubber, 0, -0.02, 0.37, 0.007);
  rbox(g, 0.012, 0.005, 0.06, m.metal, 0, -0.008, -0.04, 0.002);
  rbox(g, 0.006, 0.018, 0.005, m.darkMetal, 0, 0.004, -0.03, 0.002);
  const mag = new THREE.Group(); // shells are loaded into the tube – use a single shell for the animation
  g.add(mag);
  const shell = cylZ(mag, 0.0095, 0.065, new THREE.MeshStandardMaterial({ color: 0x8e1b16, roughness: 0.5 }), 0, -0.01, -0.06);
  cylZ(mag, 0.0098, 0.014, m.brass, 0, -0.01, -0.02);
  shell.visible = true;
  mag.visible = false;
  return {
    group: g, pump, mag, muzzle: marker(g, 0, 0.052, -0.7), eject: marker(g, 0.027, 0.04, -0.07),
    sightY: 0.068,
    hands: { right: [0.0, -0.065, 0.025], left: [0, -0.01, -0.33] },
    hip: [0.14, -0.165, -0.34], ads: [0, 0, -0.26],
  };
}

function buildSniper(m) {
  const g = new THREE.Group();
  // chassis
  rbox(g, 0.06, 0.05, 0.36, m.tan, 0, 0.005, -0.12, 0.008);
  rbox(g, 0.064, 0.06, 0.34, m.tan, 0, 0.025, -0.45, 0.012);       // handguard
  for (const sx of [0.0322, -0.0322]) slots(g, 6, sx, 0.025, -0.33, 0.045, m.darkMetal);
  // receiver + bolt
  cylZ(g, 0.02, 0.24, m.metal, 0, 0.042, -0.06, 24);
  const bolt = new THREE.Group();
  g.add(bolt);
  cylZ(bolt, 0.008, 0.06, m.steel, 0, 0.042, 0.085);
  const boltArm = cylX(bolt, 0.0045, 0.055, m.steel, 0.03, 0.042, 0.07);
  boltArm.rotation.z = Math.PI / 2 - 0.5;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.011, 16, 12), m.darkMetal);
  knob.position.set(0.055, 0.028, 0.07);
  bolt.add(knob);
  // fluted heavy barrel + brake
  cylZ(g, 0.0135, 0.5, m.darkMetal, 0, 0.042, -0.62, 24);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    rbox(g, 0.003, 0.003, 0.3, m.steel, Math.cos(a) * 0.0128, 0.042 + Math.sin(a) * 0.0128, -0.7, 0.001);
  }
  rbox(g, 0.036, 0.03, 0.08, m.darkMetal, 0, 0.042, -0.9, 0.006);
  for (const sx of [0.0182, -0.0182]) for (let i = 0; i < 3; i++) rbox(g, 0.002, 0.018, 0.012, m.knuckle, sx, 0.042, -0.875 - i * 0.022, 0.001);
  // scope
  const sy = 0.112;
  cylZ(g, 0.016, 0.27, m.darkMetal, 0, sy, -0.07, 28);
  cylZ(g, 0.016, 0.09, m.darkMetal, 0, sy, -0.24, 28, 0.026);   // objective bell
  cylZ(g, 0.026, 0.05, m.darkMetal, 0, sy, -0.31, 28);
  cylZ(g, 0.021, 0.06, m.darkMetal, 0, sy, 0.1, 28, 0.016);     // eyepiece
  cylZ(g, 0.021, 0.03, m.rubber, 0, sy, 0.14, 28);
  cylY(g, 0.012, 0.03, m.darkMetal, 0, sy + 0.025, -0.06);      // elevation turret
  cylX(g, 0.012, 0.03, m.darkMetal, 0.025, sy, -0.06);          // windage turret
  cylX(g, 0.009, 0.026, m.darkMetal, -0.022, sy, -0.02);        // parallax knob
  for (const z of [-0.14, 0.01]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0175, 0.004, 8, 28), m.metal);
    ring.position.set(0, sy, z); g.add(ring);
    rbox(g, 0.022, 0.05, 0.02, m.metal, 0, (sy + 0.062) / 2 + 0.005, z, 0.003);
  }
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.025, 28), m.lensCoat);
  lens.position.set(0, sy, -0.336); lens.rotation.y = Math.PI; g.add(lens);
  const eyeLens = new THREE.Mesh(new THREE.CircleGeometry(0.02, 28), m.glass);
  eyeLens.position.set(0, sy, 0.156); g.add(eyeLens);
  rail(g, 0.22, 0, 0.066, -0.06, m.metal);
  // grip, trigger
  profile(g, [[0.035, -0.015], [-0.012, -0.015], [-0.04, -0.12], [-0.004, -0.128], [0.016, -0.11]], 0.034, m.tan, 0, 0.006);
  rbox(g, 0.012, 0.005, 0.06, m.metal, 0, -0.035, -0.05, 0.002);
  rbox(g, 0.006, 0.018, 0.005, m.darkMetal, 0, -0.023, -0.04, 0.002);
  // skeleton stock with cheek riser
  profile(g, [[-0.07, 0.03], [-0.36, 0.035], [-0.37, -0.1], [-0.33, -0.1], [-0.3, -0.03], [-0.12, -0.03], [-0.07, -0.01]], 0.04, m.tan, 0, 0.006);
  rbox(g, 0.036, 0.022, 0.15, m.tan, 0, 0.065, 0.24, 0.008);
  for (const y of [0.04, 0.052]) cylZ(g, 0.003, 0.08, m.steel, 0, y, 0.17, 8);
  rbox(g, 0.044, 0.14, 0.024, m.rubber, 0, -0.03, 0.375, 0.008);
  // folded bipod
  for (const sx of [0.014, -0.014]) cylZ(g, 0.005, 0.2, m.darkMetal, sx, -0.012, -0.47, 10);
  rbox(g, 0.05, 0.02, 0.03, m.darkMetal, 0, -0.002, -0.6, 0.004);
  // detachable box magazine
  const mag = new THREE.Group();
  g.add(mag);
  rbox(mag, 0.034, 0.075, 0.09, m.darkMetal, 0, -0.035, -0.12, 0.004);
  return {
    group: g, bolt, mag, muzzle: marker(g, 0, 0.042, -0.95), eject: marker(g, 0.022, 0.05, -0.04),
    sightY: sy,
    hands: { right: [0.002, -0.058, 0.02], left: [0, -0.005, -0.42] },
    hip: [0.15, -0.165, -0.38], ads: [0, 0, -0.14],
  };
}

function buildLMG(m) {
  const g = new THREE.Group();
  rbox(g, 0.07, 0.085, 0.32, m.metal, 0, 0.035, -0.08, 0.008);
  rbox(g, 0.074, 0.022, 0.2, m.darkMetal, 0, 0.088, -0.09, 0.005);   // feed tray cover
  rbox(g, 0.008, 0.03, 0.06, m.darkMetal, 0.036, 0.03, -0.06, 0.002); // ejection port
  rbox(g, 0.014, 0.014, 0.03, m.darkMetal, 0.04, 0.06, -0.18, 0.003); // charging handle
  // heavy barrel + heat shield + carry handle
  cylZ(g, 0.0135, 0.48, m.darkMetal, 0, 0.045, -0.47, 20);
  rbox(g, 0.036, 0.018, 0.3, m.metal, 0, 0.066, -0.42, 0.004);
  for (let i = 0; i < 8; i++) rbox(g, 0.037, 0.006, 0.012, m.knuckle, 0, 0.0675, -0.3 - i * 0.034, 0.002);
  cylZ(g, 0.02, 0.06, m.darkMetal, 0, 0.045, -0.73, 12);
  for (const z of [-0.3, -0.46]) cylY(g, 0.005, 0.05, m.darkMetal, 0.0, 0.1, z, 8);
  cylZ(g, 0.006, 0.18, m.polymer, 0, 0.125, -0.38, 10);
  // iron sights
  rbox(g, 0.006, 0.05, 0.008, m.darkMetal, 0, 0.09, -0.66, 0.0015);
  rbox(g, 0.02, 0.012, 0.012, m.darkMetal, 0, 0.068, -0.66, 0.002);
  for (const sx of [-0.0045, 0.0045]) rbox(g, 0.004, 0.022, 0.006, m.darkMetal, sx, 0.108, 0.045, 0.001);
  rbox(g, 0.022, 0.006, 0.02, m.darkMetal, 0, 0.098, 0.045, 0.002);
  // bipod folded
  for (const sx of [0.012, -0.012]) cylZ(g, 0.006, 0.26, m.darkMetal, sx, 0.012, -0.5, 10);
  // grip, trigger, stock
  profile(g, [[0.03, -0.006], [-0.018, -0.006], [-0.048, -0.125], [-0.008, -0.132], [0.014, -0.115]], 0.034, m.polymer, 0, 0.006);
  rbox(g, 0.012, 0.005, 0.06, m.metal, 0, -0.03, -0.05, 0.002);
  rbox(g, 0.006, 0.018, 0.005, m.darkMetal, 0, -0.018, -0.04, 0.002);
  profile(g, [[-0.07, 0.075], [-0.33, 0.06], [-0.34, -0.09], [-0.3, -0.09], [-0.1, -0.02], [-0.07, -0.005]], 0.048, m.polymer, 0, 0.007);
  rbox(g, 0.05, 0.15, 0.022, m.rubber, 0, -0.012, 0.345, 0.007);
  // ammo box + belt
  const mag = new THREE.Group();
  g.add(mag);
  rbox(mag, 0.09, 0.11, 0.13, m.olive, -0.01, -0.06, -0.15, 0.006);
  rbox(mag, 0.092, 0.008, 0.06, m.darkMetal, -0.01, -0.02, -0.15, 0.003);
  for (let i = 0; i < 6; i++) {
    const r = cylX(mag, 0.0045, 0.05, m.brass, 0.03 - i * 0.0, 0.0 + i * 0.012, -0.12 - (i % 2) * 0.003, 8);
    r.position.x = 0.032;
    r.position.y = -0.005 + i * 0.011;
    r.position.z = -0.11;
    r.rotation.y = 0;
  }
  return {
    group: g, mag, muzzle: marker(g, 0, 0.045, -0.77), eject: marker(g, 0.04, 0.03, -0.06),
    sightY: 0.111,
    hands: { right: [0.002, -0.06, 0.006], left: [0, 0.03, -0.3] },
    hip: [0.15, -0.17, -0.38], ads: [0, 0, -0.25],
  };
}

const BUILDERS = { pistol: buildPistol, smg: buildSMG, rifle: buildRifle, shotgun: buildShotgun, sniper: buildSniper, lmg: buildLMG };

/** Builds the gun + gloved hands/sleeves. */
export function buildWeaponModel(id) {
  const m = materials();
  const model = BUILDERS[id](m);
  model.hands.right = new THREE.Vector3(...model.hands.right);
  model.hands.left = new THREE.Vector3(...model.hands.left);
  addArms(model, m, id);
  model.group.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
  model.magHome = model.mag ? model.mag.position.clone() : null;
  return model;
}

function addArms(model, m, id) {
  const g = model.group;
  const shoulderR = new THREE.Vector3(0.12, -0.3, 0.45);
  const shoulderL = new THREE.Vector3(-0.2, -0.3, id === 'pistol' ? 0.22 : 0.16);

  const arm = (hand, shoulder, side) => {
    const grp = new THREE.Group();
    // forearm sleeve: capsule from wrist toward shoulder
    const wrist = hand.clone().add(new THREE.Vector3(side * 0.005, -0.02, 0.05));
    const dir = shoulder.clone().sub(wrist);
    const len = dir.length();
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.036, len, 6, 14), m.sleeve);
    sleeve.position.copy(wrist).addScaledVector(dir, 0.5);
    sleeve.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    grp.add(sleeve);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.05, 14), m.glove);
    cuff.position.copy(wrist).addScaledVector(dir.clone().normalize(), 0.02);
    cuff.quaternion.copy(sleeve.quaternion);
    grp.add(cuff);
    // gloved hand wrapping the grip
    const palm = rbox(grp, 0.045, 0.085, 0.07, m.glove, hand.x + side * 0.012, hand.y, hand.z + 0.008, 0.018);
    palm.rotation.x = side > 0 ? -0.25 : 0.1;
    const fingers = rbox(grp, 0.05, 0.075, 0.03, m.glove, hand.x - side * 0.02, hand.y - 0.005, hand.z - 0.028, 0.012);
    fingers.rotation.x = side > 0 ? -0.25 : 0.1;
    rbox(grp, 0.012, 0.06, 0.012, m.knuckle, hand.x - side * 0.042, hand.y - 0.005, hand.z - 0.03, 0.005);
    const thumb = rbox(grp, 0.02, 0.02, 0.055, m.glove, hand.x + side * 0.025, hand.y + 0.038, hand.z - 0.01, 0.009);
    thumb.rotation.y = side * 0.25;
    g.add(grp);
    return grp;
  };
  model.rightArm = arm(model.hands.right, shoulderR, 1);
  model.leftArm = arm(model.hands.left, shoulderL, -1);
  model.leftArmHome = model.leftArm.position.clone();
}
