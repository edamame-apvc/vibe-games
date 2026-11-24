import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
const BAY = 3.6, FLOOR = 3.0; // default wall texture tile (metres)
import { mulberry32 } from '../noise.js';

// Shared geometry toolkit for hand-built maps: walls with facade UVs, caps,
// boxes, ribbons along paths, plus reusable props (trees, cars, lamps…).

export class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.uv1 = []; this.idx = []; }
  get count() { return this.pos.length / 3; }
  vert(x, y, z, nx, ny, nz, u, v, u1, v1) {
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.uv.push(u, v); this.uv1.push(u1, v1);
    return this.count - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  build() {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('uv1', new THREE.Float32BufferAttribute(this.uv1, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

export function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

/** Vertical wall quad a→b. outSign = sign of the polygon's signed area (decides the outward side). */
export function wall(B, a, b, y0, y1, outSign, { u0 = 0, uScale = BAY * 4, vScale = FLOOR * 2, vBase = y0 } = {}) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  if (len < 0.02 || y1 - y0 < 0.005) return len;
  const nx = (dz / len) * outSign, nz = (-dx / len) * outSign;
  const flipU = outSign > 0 ? -1 : 1; // keep facades/text reading left-to-right from outside
  const ua = (flipU * u0) / uScale, ub = (flipU * (u0 + len)) / uScale;
  const va = (y0 - vBase) / vScale, vb = (y1 - vBase) / vScale;
  const m = 2.5;
  const i0 = B.vert(a[0], y0, a[1], nx, 0, nz, ua, va, u0 / m, y0 / m);
  const i1 = B.vert(b[0], y0, b[1], nx, 0, nz, ub, va, (u0 + len) / m, y0 / m);
  const i2 = B.vert(b[0], y1, b[1], nx, 0, nz, ub, vb, (u0 + len) / m, y1 / m);
  const i3 = B.vert(a[0], y1, a[1], nx, 0, nz, ua, vb, u0 / m, y1 / m);
  const gx = -(y1 - y0) * dz, gz = (y1 - y0) * dx; // normal of triangle (A0,B0,B1)
  if (gx * nx + gz * nz >= 0) { B.tri(i0, i1, i2); B.tri(i0, i2, i3); } else { B.tri(i0, i2, i1); B.tri(i0, i3, i2); }
  return len;
}

/** All walls of a polygon prism. */
export function prismWalls(B, pts, y0, y1, opts = {}) {
  const sign = Math.sign(signedArea(pts));
  let u = 0;
  for (let i = 0; i < pts.length; i++) u += wall(B, pts[i], pts[(i + 1) % pts.length], y0, y1, sign, { ...opts, u0: u });
}

/** Horizontal polygon. */
export function cap(B, pts, y, up = true, tile = 4) {
  const contour = pts.map((p) => new THREE.Vector2(p[0], p[1]));
  let faces;
  try { faces = THREE.ShapeUtils.triangulateShape(contour, []); } catch { return; }
  const base = B.count;
  for (const p of pts) B.vert(p[0], y, p[1], 0, up ? 1 : -1, 0, p[0] / tile, p[1] / tile, p[0] / 2.5, p[1] / 2.5);
  for (const [a, b, c] of faces) {
    const pa = pts[a], pb = pts[b], pc = pts[c];
    const ny = (pb[1] - pa[1]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[1] - pa[1]);
    if ((ny > 0) === up) B.tri(base + a, base + b, base + c); else B.tri(base + a, base + c, base + b);
  }
}

export function rectPts(cx, cz, w, d, rot = 0) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, z]) => [cx + x * c - z * s, cz + x * s + z * c]);
}

/** Closed box (walls + top, optional bottom). Returns its footprint points. */
export function box(B, cx, cz, w, d, y0, y1, rot = 0, { bottom = false, topB = B, opts = {} } = {}) {
  const pts = rectPts(cx, cz, w, d, rot);
  prismWalls(B, pts, y0, y1, opts);
  cap(topB, pts, y1, true);
  if (bottom) cap(topB, pts, y0, false);
  return pts;
}

/** Flat strip following a polyline (roads, kerbs, linkway roofs). */
export function ribbon(B, pts, width, y, { offset = 0, vScale = 4, uScale = null, up = true } = {}) {
  if (pts.length < 2) return;
  let dist = 0;
  const L = [], R = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const nx = -tz, nz = tx;
    if (i > 0) dist += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    const hw = width / 2, ox = p[0] + nx * offset, oz = p[1] + nz * offset;
    const uw = uScale ? width / uScale : 1;
    L.push(B.vert(ox + nx * hw, y, oz + nz * hw, 0, up ? 1 : -1, 0, 0, dist / vScale, (ox + nx * hw) / 2.5, (oz + nz * hw) / 2.5));
    R.push(B.vert(ox - nx * hw, y, oz - nz * hw, 0, up ? 1 : -1, 0, uw, dist / vScale, (ox - nx * hw) / 2.5, (oz - nz * hw) / 2.5));
  }
  const P = (i) => [B.pos[i * 3], B.pos[i * 3 + 2]];
  const p0 = P(L[0]), p1 = P(R[0]), p2 = P(L[1]);
  const ny = (p1[1] - p0[1]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[1] - p0[1]);
  const flip = (ny > 0) !== up;
  for (let i = 0; i < pts.length - 1; i++) {
    if (!flip) { B.tri(L[i], R[i], L[i + 1]); B.tri(R[i], R[i + 1], L[i + 1]); } else { B.tri(L[i], L[i + 1], R[i]); B.tri(R[i], L[i + 1], R[i + 1]); }
  }
}

export function samplePolyline(pts, step, start = 0) {
  const out = [];
  let next = start, acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (seg < 1e-3) continue;
    const tx = (b[0] - a[0]) / seg, tz = (b[1] - a[1]) / seg;
    while (next <= acc + seg) { const t = next - acc; out.push({ x: a[0] + tx * t, z: a[1] + tz * t, tx, tz }); next += step; }
    acc += seg;
  }
  return out;
}

/** Pitched (gable) roof over a rectangle; ridge along the rectangle's width axis. */
export function gableRoof(B, cx, cz, w, d, eaveY, ridgeY, rot, overhang = 1) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const tp = (x, z, y) => [cx + x * c - z * s, y, cz + x * s + z * c];
  const hw = w / 2 + overhang, hd = d / 2 + overhang;
  const quad = (A, Bp, C, D) => {
    const e1 = new THREE.Vector3(Bp[0] - A[0], Bp[1] - A[1], Bp[2] - A[2]);
    const e2 = new THREE.Vector3(D[0] - A[0], D[1] - A[1], D[2] - A[2]);
    const n = new THREE.Vector3().crossVectors(e1, e2).normalize();
    if (n.y < 0) n.negate();
    const len = e1.length(), h = e2.length();
    const ids = [A, Bp, C, D].map((p, i) => B.vert(p[0], p[1], p[2], n.x, n.y, n.z, (i === 1 || i === 2 ? len : 0) / 3, (i >= 2 ? h : 0) / 3, p[0] / 2.5, p[2] / 2.5));
    // both windings so the underside is visible too (hawker roofs are seen from below)
    B.tri(ids[0], ids[1], ids[2]); B.tri(ids[0], ids[2], ids[3]);
    B.tri(ids[0], ids[2], ids[1]); B.tri(ids[0], ids[3], ids[2]);
  };
  quad(tp(-hw, -hd, eaveY), tp(hw, -hd, eaveY), tp(hw, 0, ridgeY), tp(-hw, 0, ridgeY));
  quad(tp(-hw, hd, eaveY), tp(hw, hd, eaveY), tp(hw, 0, ridgeY), tp(-hw, 0, ridgeY));
}

// ── textures for props ──────────────────────────────────────────────────────

export function leafTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const rand = mulberry32(5);
  for (let i = 0; i < 280; i++) {
    const x = 20 + rand() * 216, y = 20 + rand() * 216, r = 6 + rand() * 10, a = rand() * Math.PI;
    const g = 80 + rand() * 70;
    ctx.fillStyle = `rgb(${35 + rand() * 40},${g},${22 + rand() * 30})`;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.45, a, 0, Math.PI * 2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function solidTexture(color, speckle = 0.15) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color; ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2000; i++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * speckle})`; ctx.fillRect(Math.random() * 128, Math.random() * 128, 1, 1); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ── instanced props ─────────────────────────────────────────────────────────

const dummy = new THREE.Object3D();

/** Rain-tree style trees: instanced trunks + alpha-tested leaf-card canopies with wind. */
export function buildTrees(points, rand) {
  const leafMat = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 });
  const uniforms = { uTime: { value: 0 } };
  leafMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 iw = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float sw = sin(uTime * 1.3 + iw.x * 0.2 + position.y * 0.6) * 0.05 * max(0.0, position.y - 3.0);
        transformed.x += sw; transformed.z += sw * 0.6;`);
  };
  const barkMat = new THREE.MeshStandardMaterial({ color: 0x51443a, roughness: 0.95 });
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.22, 0.38, 4.2, 9); trunk.translate(0, 2.1, 0); parts.push(trunk);
  for (let i = 0; i < 4; i++) {
    const limb = new THREE.CylinderGeometry(0.09, 0.16, 3.2, 6);
    limb.translate(0, 1.6, 0); limb.rotateZ(0.75); limb.rotateY((i / 4) * Math.PI * 2 + 0.4); limb.translate(0, 3.7, 0);
    parts.push(limb);
  }
  const trunkGeo = mergeGeometries(parts);
  const cards = [];
  const centre = new THREE.Vector3(0, 6.2, 0);
  const r = mulberry32(9);
  for (let i = 0; i < 80; i++) {
    const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * 5.2;
    const y = 5.4 + r() * 2.4 - (rr / 5.2) * 1.2;
    const q = new THREE.PlaneGeometry(2.6, 2.6);
    q.rotateX(-Math.PI / 2 + (r() - 0.5) * 1.2); q.rotateY(r() * Math.PI); q.translate(Math.cos(a) * rr, y, Math.sin(a) * rr);
    const n = q.attributes.normal, p = q.attributes.position;
    for (let k = 0; k < n.count; k++) {
      const v = new THREE.Vector3(p.getX(k), p.getY(k), p.getZ(k)).sub(centre).normalize();
      v.y = v.y * 0.6 + 0.5; v.normalize();
      n.setXYZ(k, v.x, v.y, v.z);
    }
    cards.push(q);
  }
  const canopyGeo = mergeGeometries(cards);
  const trunks = new THREE.InstancedMesh(trunkGeo, barkMat, points.length);
  const canopy = new THREE.InstancedMesh(canopyGeo, leafMat, points.length);
  const col = new THREE.Color();
  points.forEach(([x, z, sc = 1], i) => {
    const s = (0.75 + rand() * 0.5) * sc;
    dummy.position.set(x, 0, z); dummy.rotation.set(0, rand() * Math.PI * 2, 0); dummy.scale.set(s, s * (0.85 + rand() * 0.3), s);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix); canopy.setMatrixAt(i, dummy.matrix);
    canopy.setColorAt(i, col.setHSL(0.24 + rand() * 0.06, 0.45, 0.55 + rand() * 0.15));
  });
  trunks.castShadow = canopy.castShadow = true;
  trunks.receiveShadow = canopy.receiveShadow = true;
  trunks.userData.surface = 'wood';
  return { trunks, canopy, update(t) { uniforms.uTime.value = t; } };
}

/** Parked cars (instanced). spots: [x, z, rotY]. */
export function buildCars(spots, rand) {
  const body = mergeGeometries([
    (() => { const g = new RoundedBoxGeometry(1.78, 0.6, 4.45, 3, 0.09); g.translate(0, 0.63, 0); return g; })(),
    (() => { const g = new RoundedBoxGeometry(1.5, 0.48, 2.2, 3, 0.12); g.translate(0, 1.15, 0.15); return g; })(),
  ]);
  const glass = (() => { const g = new RoundedBoxGeometry(1.53, 0.38, 2.05, 2, 0.1); g.translate(0, 1.17, 0.15); return g; })();
  const wheels = mergeGeometries([[-0.82, 1.4], [0.82, 1.4], [-0.82, -1.35], [0.82, -1.35]].map(([wx, wz]) => {
    const g = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 16); g.rotateZ(Math.PI / 2); g.translate(wx, 0.33, wz); return g;
  }));
  const lights = mergeGeometries([
    ...[-0.6, 0.6].map((lx) => { const g = new THREE.BoxGeometry(0.4, 0.12, 0.05); g.translate(lx, 0.8, 2.22); return g; }),
    ...[-0.6, 0.6].map((lx) => { const g = new THREE.BoxGeometry(0.42, 0.1, 0.05); g.translate(lx, 0.8, -2.22); return g; }),
  ]);
  const paint = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.6, roughness: 0.3 });
  const meshes = [
    new THREE.InstancedMesh(body, paint, spots.length),
    new THREE.InstancedMesh(glass, new THREE.MeshStandardMaterial({ color: 0x0e1216, metalness: 0.9, roughness: 0.06 }), spots.length),
    new THREE.InstancedMesh(wheels, new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 }), spots.length),
    new THREE.InstancedMesh(lights, new THREE.MeshStandardMaterial({ color: 0x9a2020, roughness: 0.3 }), spots.length),
  ];
  const paints = [0xf2f2f0, 0xf2f2f0, 0xc0c2c4, 0x1b1c1e, 0x8e9295, 0x9b1b1b, 0x22406e, 0xe8e2d4, 0x2a2b2d];
  const col = new THREE.Color();
  spots.forEach(([x, z, r], i) => {
    dummy.position.set(x, 0, z); dummy.rotation.set(0, r, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
    for (const m of meshes) m.setMatrixAt(i, dummy.matrix);
    meshes[0].setColorAt(i, col.setHex(paints[Math.floor(rand() * paints.length)]));
  });
  for (const m of meshes) { m.castShadow = m.receiveShadow = true; m.userData.surface = 'metal'; }
  return meshes;
}

/** Generic instanced prop from a geometry list of [x, z, rotY]. */
export function instanced(geo, mat, spots, surface = 'metal', { y = 0, cast = true } = {}) {
  const im = new THREE.InstancedMesh(geo, mat, spots.length);
  spots.forEach(([x, z, r = 0], i) => { dummy.position.set(x, y, z); dummy.rotation.set(0, r, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
  im.castShadow = cast; im.receiveShadow = true;
  im.userData.surface = surface;
  return im;
}

export function lampGeometry() {
  const pole = new THREE.CylinderGeometry(0.07, 0.11, 8, 8); pole.translate(0, 4, 0);
  const arm = new THREE.BoxGeometry(1.6, 0.08, 0.08); arm.translate(-0.75, 7.9, 0);
  const head = new THREE.BoxGeometry(0.7, 0.14, 0.3); head.translate(-1.5, 7.82, 0);
  return mergeGeometries([pole, arm, head]);
}
