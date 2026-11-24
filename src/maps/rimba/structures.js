import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { wall, cap, box, rectPts, signedArea } from '../build.js';

// Hand-built village and camp structures. ctx = { B, mats, collision, colliders, solids, root, shootables, posts }.

const V3 = THREE.Vector3;

/** A wall from a→b with rectangular openings: [{ s0, s1, y0, y1 }] in metres along the edge / above y0. Both faces. */
function openWall(B, a, b, y0, y1, sign, openings = [], opts = {}) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const at = (s) => [a[0] + (b[0] - a[0]) * (s / len), a[1] + (b[1] - a[1]) * (s / len)];
  const piece = (s0, s1, ya, yb) => {
    if (s1 - s0 < 0.01 || yb - ya < 0.01) return;
    wall(B, at(s0), at(s1), ya, yb, sign, { ...opts, u0: s0, vBase: y0 });
    wall(B, at(s0), at(s1), ya, yb, -sign, { ...opts, u0: s0, vBase: y0 }); // inside face
  };
  const ops = [...openings].sort((p, q) => p.s0 - q.s0);
  let s = 0;
  for (const o of ops) {
    piece(s, o.s0, y0, y1);
    piece(o.s0, o.s1, y0, y0 + o.y0);
    piece(o.s0, o.s1, y0 + o.y1, y1);
    s = o.s1;
  }
  piece(s, len, y0, y1);
  return { len, at };
}

/** Thatched gable roof with closed gable ends. Ridge runs along the longer side. */
function hutRoof(ctx, x, z, w, d, eave, ridge, gableMat) {
  const { B, mats } = ctx;
  const alongZ = d >= w;
  const L = (alongZ ? d : w) / 2 + 0.7, S = (alongZ ? w : d) / 2 + 0.8;
  const P = (along, side, y) => (alongZ ? [x + side, y, z + along] : [x + along, y, z + side]);
  const quad = (A, Bq, C, D, mat) => {
    const b = B(mat);
    const e1 = new V3(Bq[0] - A[0], Bq[1] - A[1], Bq[2] - A[2]), e2 = new V3(D[0] - A[0], D[1] - A[1], D[2] - A[2]);
    const n = new V3().crossVectors(e1, e2).normalize();
    if (n.y < 0) n.negate();
    const lu = e1.length(), lv = e2.length();
    const ids = [A, Bq, C, D].map((p, i) => b.vert(p[0], p[1], p[2], n.x, n.y, n.z, (i === 1 || i === 2 ? lu : 0) / 2.5, (i >= 2 ? lv : 0) / 2.5, p[0] / 2.5, p[2] / 2.5));
    b.tri(ids[0], ids[1], ids[2]); b.tri(ids[0], ids[2], ids[3]);
    b.tri(ids[0], ids[2], ids[1]); b.tri(ids[0], ids[3], ids[2]);
  };
  quad(P(-L, -S, eave), P(L, -S, eave), P(L, 0, ridge), P(-L, 0, ridge), mats.thatch);
  quad(P(-L, S, eave), P(L, S, eave), P(L, 0, ridge), P(-L, 0, ridge), mats.thatch);
  // gable triangles (bamboo), inset to the wall line
  const g = B(gableMat);
  const half = (alongZ ? d : w) / 2;
  for (const end of [-half, half]) {
    const a = P(end, -(S - 0.8), eave), b2 = P(end, S - 0.8, eave), c = P(end, 0, ridge);
    const n = alongZ ? new V3(0, 0, Math.sign(end)) : new V3(Math.sign(end), 0, 0);
    const ids = [a, b2, c].map((p) => g.vert(p[0], p[1], p[2], n.x, n.y, n.z, (alongZ ? p[0] : p[2]) / 2, p[1] / 2, p[0] / 2.5, p[1] / 2.5));
    g.tri(ids[0], ids[1], ids[2]); g.tri(ids[0], ids[2], ids[1]);
  }
}

const aabb = (x0, y0, z0, x1, y1, z1) => new THREE.Box3(new V3(Math.min(x0, x1), y0, Math.min(z0, z1)), new V3(Math.max(x0, x1), y1, Math.max(z0, z1)));

/** Stilt hut. door: 'n' | 's' | 'e' | 'w'. Axis-aligned. Returns its footprint. */
export function stiltHut(ctx, { x, z, w = 4.6, d = 5.4, gy, floorH = 1.1, door = 's' }) {
  const { B, mats, collision, colliders, solids, posts } = ctx;
  const fy = gy + floorH, wallH = 2.3;
  // posts on a 3×3 grid
  for (const fx of [-0.5, 0, 0.5]) for (const fz of [-0.5, 0, 0.5]) {
    const px = x + fx * (w - 0.3), pz = z + fz * (d - 0.3);
    posts.push([px, gy - 0.3, pz, fy - gy + 0.3, 0.11]);
    collision.addCircle(px, pz, 0.14, gy - 1, fy);
  }
  box(B(mats.planks), x, z, w + 0.3, d + 0.3, fy - 0.16, fy);       // floor platform
  box(B(mats.bark), x, z, w + 0.4, 0.16, fy - 0.32, fy - 0.16);      // beams
  colliders.push(aabb(x - w / 2 - 0.15, gy - 1, z - d / 2 - 0.15, x + w / 2 + 0.15, fy, z + d / 2 + 0.15));
  solids.push(rectPts(x, z, w + 0.8, d + 0.8));

  // walls with a door and windows
  const pts = rectPts(x, z, w, d);
  const sign = Math.sign(signedArea(pts));
  const sideOf = (a, b) => {
    const mx = (a[0] + b[0]) / 2 - x, mz = (a[1] + b[1]) / 2 - z;
    return Math.abs(mx) > Math.abs(mz) ? (mx > 0 ? 'e' : 'w') : (mz > 0 ? 's' : 'n');
  };
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const side = sideOf(a, b);
    const ops = side === door ? [{ s0: len / 2 - 0.5, s1: len / 2 + 0.5, y0: 0, y1: 1.95 }] : [{ s0: len / 2 - 0.45, s1: len / 2 + 0.45, y0: 0.9, y1: 1.6 }];
    openWall(B(mats.bamboo), a, b, fy, fy + wallH, sign, ops, { uScale: 2, vScale: 2 });
    // collision: walls except the door gap
    const at = (s) => [a[0] + (b[0] - a[0]) * (s / len), a[1] + (b[1] - a[1]) * (s / len)];
    if (side === door) {
      const p0 = at(len / 2 - 0.5), p1 = at(len / 2 + 0.5);
      collision.addSegment(a[0], a[1], p0[0], p0[1], fy, fy + wallH);
      collision.addSegment(p1[0], p1[1], b[0], b[1], fy, fy + wallH);
    } else collision.addSegment(a[0], a[1], b[0], b[1], fy, fy + wallH);
  }
  hutRoof(ctx, x, z, w, d, fy + wallH, fy + wallH + 1.7, mats.bamboo);

  // steps up to the door
  const dir = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[door];
  const out = (door === 'n' || door === 's' ? d : w) / 2 + 0.15;
  for (let k = 0; k < 3; k++) {
    const top = gy + (floorH * (k + 1)) / 4;
    const off = out + 0.35 * (3 - k) - 0.17;
    const sx = x + dir[0] * off, sz = z + dir[1] * off;
    const sw = dir[0] ? 0.35 : 1.1, sd = dir[0] ? 1.1 : 0.35;
    box(B(mats.planks), sx, sz, sw, sd, top - 0.08, top);
    box(B(mats.bark), sx, sz, sw * 0.8, sd * 0.8, gy - 0.2, top - 0.08);
    colliders.push(aabb(sx - sw / 2, gy - 1, sz - sd / 2, sx + sw / 2, top, sz + sd / 2));
  }
  return pts;
}

/** Olive tarp A-frame tent. */
export function tent(ctx, { x, z, len = 4, wid = 3, h = 2.1, rot = 0, gy }) {
  const { B, mats, collision, solids } = ctx;
  const c = Math.cos(rot), s = Math.sin(rot);
  const P = (a, b, y) => [x + a * c - b * s, gy + y, z + a * s + b * c];
  const b = B(mats.tarp);
  const tri = (A, Bp, C) => {
    const e1 = new V3(Bp[0] - A[0], Bp[1] - A[1], Bp[2] - A[2]), e2 = new V3(C[0] - A[0], C[1] - A[1], C[2] - A[2]);
    const n = new V3().crossVectors(e1, e2).normalize();
    const ids = [A, Bp, C].map((p) => b.vert(p[0], p[1], p[2], n.x, n.y, n.z, (p[0] + p[2]) / 2, p[1] / 2, p[0] / 2.5, p[2] / 2.5));
    b.tri(ids[0], ids[1], ids[2]); b.tri(ids[0], ids[2], ids[1]);
  };
  const L = len / 2, W = wid / 2;
  for (const side of [-1, 1]) {
    tri(P(-L, side * W, 0), P(L, side * W, 0), P(L, 0, h));
    tri(P(-L, side * W, 0), P(L, 0, h), P(-L, 0, h));
  }
  tri(P(-L, -W, 0), P(-L, W, 0), P(-L, 0, h));          // closed back
  tri(P(L, -W, 0), P(L, -W * 0.25, 0), P(L, 0, h));      // front flaps, half open
  tri(P(L, W, 0), P(L, W * 0.25, 0), P(L, 0, h));
  collision.addBox(x, z, L, W, -rot, gy - 1, gy + h);
  solids.push(rectPts(x, z, len + 0.6, wid + 0.6, rot));
}

/** Sandbag wall along a polyline; about 0.65 m high (crouch cover). */
export function sandbags(ctx, pts, groundAt) {
  const { collision, solids } = ctx;
  const spots = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const n = Math.floor(len / 0.56);
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k < n; k++) {
        const t = (k + (row % 2 ? 0.5 : 0) + 0.5) / n;
        if (t > 1) continue;
        const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        spots.push([x, groundAt(x, z) + 0.08 + row * 0.155, z, ang + (Math.random() - 0.5) * 0.08]);
      }
    }
    const g = Math.min(groundAt(a[0], a[1]), groundAt(b[0], b[1]));
    collision.addSegment(a[0], a[1], b[0], b[1], g - 1, g + 0.68);
    collision.addSegment(a[0], a[1], b[0], b[1], g - 1, g + 0.68);
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    solids.push(rectPts(mx, mz, len + 0.2, 0.7, ang));
  }
  const geo = new RoundedBoxGeometry(0.56, 0.17, 0.34, 2, 0.07);
  const mat = new THREE.MeshStandardMaterial({ color: 0x9a8a62, roughness: 0.95, map: ctx.mats.tarp.map });
  const im = new THREE.InstancedMesh(geo, mat, spots.length);
  const d = new THREE.Object3D();
  spots.forEach(([x, y, z, r], i) => { d.position.set(x, y, z); d.rotation.set(0, -r, 0); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
  im.castShadow = im.receiveShadow = true;
  im.userData.surface = 'dirt';
  ctx.root.add(im);
  ctx.shootables.push(im);
}

/** Timber watchtower (not climbable). */
export function watchtower(ctx, { x, z, gy }) {
  const { B, mats, collision, posts, solids } = ctx;
  const top = gy + 5.2, hw = 1.3;
  for (const [dx, dz] of [[-hw, -hw], [hw, -hw], [-hw, hw], [hw, hw]]) {
    posts.push([x + dx, gy - 0.3, z + dz, 6.0 + 2.2, 0.13]);
    collision.addCircle(x + dx, z + dz, 0.16, gy - 1, top + 3);
  }
  box(B(mats.planks), x, z, hw * 2 + 0.5, hw * 2 + 0.5, top - 0.15, top, 0, { bottom: true });
  for (const [dx, dz, w2, d2] of [[0, -hw - 0.2, hw * 2 + 0.5, 0.08], [0, hw + 0.2, hw * 2 + 0.5, 0.08], [-hw - 0.2, 0, 0.08, hw * 2 + 0.5], [hw + 0.2, 0, 0.08, hw * 2 + 0.5]]) {
    box(B(mats.planks), x + dx, z + dz, w2, d2, top + 0.2, top + 1.0);
  }
  hutRoof(ctx, x, z, hw * 2, hw * 2, top + 2.2, top + 3.0, mats.planks);
  // diagonal bracing + ladder
  for (let k = 0; k < 8; k++) box(B(mats.bark), x + hw + 0.35, z, 0.08, 0.6, gy + 0.6 + k * 0.6, gy + 0.65 + k * 0.6);
  solids.push(rectPts(x, z, hw * 2 + 0.8, hw * 2 + 0.8));
}

/** Rope bridge deck + rails. deckAt(x) gives the deck height; span from x0 to x1 at z. */
export function ropeBridge(ctx, { x0, x1, z, width, deckAt }) {
  const { B, mats, collision, posts } = ctx;
  const n = Math.ceil((x1 - x0) / 0.3);
  for (let i = 0; i < n; i++) {
    const x = x0 + (i + 0.5) * ((x1 - x0) / n);
    const y = deckAt(x);
    box(B(mats.planks), x, z + (Math.random() - 0.5) * 0.04, 0.24, width + (Math.random() - 0.5) * 0.1, y - 0.06, y, (Math.random() - 0.5) * 0.04);
  }
  // rope rails: chains of short cylinders following the sag
  const ropeGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 5);
  ropeGeo.rotateZ(Math.PI / 2);
  const ropeSpots = [];
  for (const side of [-1, 1]) {
    const zz = z + side * (width / 2 + 0.05);
    for (let i = 0; i < n; i++) {
      const xa = x0 + i * ((x1 - x0) / n), xb = xa + (x1 - x0) / n;
      ropeSpots.push([(xa + xb) / 2, (deckAt(xa) + deckAt(xb)) / 2 + 1.0, zz, xb - xa, Math.atan2(deckAt(xb) - deckAt(xa), xb - xa)]);
      if (i % 3 === 0) ropeSpots.push([xa, deckAt(xa) + 0.5, zz, 1.0, Math.PI / 2]);
    }
    collision.addSegment(x0, zz, x1, zz, -10, 30);
  }
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0x8d7a55, roughness: 1 });
  const im = new THREE.InstancedMesh(ropeGeo, ropeMat, ropeSpots.length);
  const d = new THREE.Object3D();
  ropeSpots.forEach(([x, y, zz, len, ang], i) => { d.position.set(x, y, zz); d.rotation.set(0, 0, ang); d.scale.set(len, 1, 1); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
  im.castShadow = true;
  im.userData.noRaycast = true;
  ctx.root.add(im);
  for (const x of [x0, x1]) for (const side of [-1, 1]) posts.push([x, deckAt(x) - 1.5, z + side * (width / 2 + 0.05), 2.8, 0.12]);
}

/** Wooden jetty on posts out over the water. */
export function jetty(ctx, { x, z, len, wid = 2.2, dir = 1, y }) {
  const { B, mats, colliders, posts } = ctx;
  const cx = x + (dir * len) / 2;
  box(B(mats.planks), cx, z, len, wid, y - 0.12, y);
  colliders.push(aabb(x, y - 3, z - wid / 2, x + dir * len, y, z + wid / 2));
  for (let k = 0; k <= len; k += 2) for (const s of [-1, 1]) posts.push([x + dir * k, y - 3, z + s * (wid / 2 - 0.1), 3.1, 0.1]);
}

/** A dugout canoe floating at water level. */
export function canoe(ctx, { x, z, y, rot }) {
  const g = new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  g.scale(0.42, 0.32, 2.4);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: ctx.mats.bark.map, color: 0x7a5a3c, roughness: 0.9, side: THREE.DoubleSide }));
  m.position.set(x, y + 0.12, z);
  m.rotation.y = rot;
  m.castShadow = m.receiveShadow = true;
  m.userData.surface = 'wood';
  ctx.root.add(m);
  ctx.shootables.push(m);
}

/** Drying rack with hanging cloth. */
export function dryingRack(ctx, { x, z, gy, rot = 0 }) {
  const { B, mats, posts, collision } = ctx;
  const c = Math.cos(rot), s = Math.sin(rot);
  for (const a of [-1.3, 1.3]) {
    posts.push([x + a * c, gy - 0.2, z + a * s, 2.1, 0.05]);
    collision.addCircle(x + a * c, z + a * s, 0.08, gy - 1, gy + 2);
  }
  const bar = box(B(mats.bark), x, z, 2.7, 0.07, gy + 1.82, gy + 1.88, rot);
  void bar;
  const cloths = [0xb8423a, 0x3c5f9a, 0xd8c070, 0xe8e0d0];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.9), new THREE.MeshStandardMaterial({ color: cloths[i], roughness: 0.95, side: THREE.DoubleSide }));
    const a = -0.95 + i * 0.63;
    m.position.set(x + a * c, gy + 1.4, z + a * s);
    m.rotation.y = -rot;
    m.castShadow = true;
    m.userData.noRaycast = true;
    ctx.root.add(m);
  }
}

/** Light shaft: a soft additive beam slanting along the sun direction. */
export function lightShaft(root, pos, sunDir, height = 22, width = 3.5) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, 'rgba(255,240,200,0)'); g.addColorStop(0.5, 'rgba(255,240,200,0.9)'); g.addColorStop(1, 'rgba(255,240,200,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 256);
  const v = x.createLinearGradient(0, 0, 0, 256);
  v.addColorStop(0, 'rgba(0,0,0,0.6)'); v.addColorStop(0.3, 'rgba(0,0,0,0)'); v.addColorStop(0.85, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,1)');
  x.globalCompositeOperation = 'destination-out';
  x.fillStyle = v; x.fillRect(0, 0, 64, 256);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.11, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const grp = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    m.rotation.y = i * Math.PI / 2;
    grp.add(m);
  }
  const dir = sunDir.clone().normalize();
  grp.position.copy(pos).addScaledVector(dir, height / 2);
  grp.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir);
  grp.traverse((o) => { o.userData.noRaycast = true; });
  root.add(grp);
  return grp;
}

export function instancedPosts(posts, mat) {
  const g = new THREE.CylinderGeometry(1, 1, 1, 8);
  g.translate(0, 0.5, 0);
  const im = new THREE.InstancedMesh(g, mat, posts.length);
  const d = new THREE.Object3D();
  posts.forEach(([x, y, z, h, r], i) => { d.position.set(x, y, z); d.rotation.set((Math.random() - 0.5) * 0.04, 0, (Math.random() - 0.5) * 0.04); d.scale.set(r, h, r); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
  im.castShadow = im.receiveShadow = true;
  im.userData.surface = 'wood';
  return im;
}

export { cap };
