import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../noise.js';

// Procedural rainforest plants built from alpha-tested leaf cards and drawn
// with instancing: ferns, broad-leaf plants, palms, ground clumps and lianas.

const shared = { time: { value: 0 } };
export function foliageTime(t) { shared.time.value = t; }

/** Leaf material: two-sided without darkened back faces, wind sway, leaf-shaped shadows. */
export function foliageMaterial(map, { color = 0xffffff, sway = 0.08, roughness = 0.8 } = {}) {
  const m = new THREE.MeshStandardMaterial({ map, color, alphaTest: 0.45, side: THREE.DoubleSide, roughness, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec4 iw = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        #else
          vec4 iw = vec4(0.0);
        #endif
        float h = max(0.0, position.y);
        float s = sin(uTime * 1.6 + iw.x * 0.37 + iw.z * 0.29 + position.x) + 0.4 * sin(uTime * 3.3 + iw.x);
        transformed.x += s * ${sway.toFixed(3)} * h;
        transformed.z += s * ${(sway * 0.6).toFixed(3)} * h;`);
    // keep the authored (outward/up) normal on back faces instead of flipping it
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>',
      THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
  };
  m.customProgramCacheKey = () => `foliage-${sway}`;
  m.userData.depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.45 });
  return m;
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Fern frond: central stem with tapering leaflets. Texture is vertical, base at the bottom. */
export function frondTexture({ leaflets = 26, color = [62, 112, 44], width = 0.95 } = {}) {
  return canvasTex(128, 512, (x, w, h) => {
    const r = mulberry32(11);
    x.strokeStyle = 'rgb(70,90,40)'; x.lineWidth = 4;
    x.beginPath(); x.moveTo(w / 2, h); x.quadraticCurveTo(w / 2 + 6, h / 2, w / 2, 6); x.stroke();
    for (let i = 0; i < leaflets; i++) {
      const t = i / leaflets;
      const y = h - 30 - t * (h - 50);
      const len = (Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.08)) * 0.5 + 0.05) * w * width;
      for (const side of [-1, 1]) {
        const g = color[1] + (r() - 0.5) * 30;
        x.fillStyle = `rgb(${color[0] + (r() - 0.5) * 20},${g},${color[2] + (r() - 0.5) * 16})`;
        x.beginPath();
        x.moveTo(w / 2, y);
        x.quadraticCurveTo(w / 2 + side * len * 0.6, y - 14, w / 2 + side * len, y - 22);
        x.quadraticCurveTo(w / 2 + side * len * 0.5, y + 2, w / 2, y + 7);
        x.fill();
      }
    }
  });
}

/** Big broad leaf (elephant-ear / banana-like) with veins. */
export function broadLeafTexture() {
  return canvasTex(256, 384, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#5f8f3c'); g.addColorStop(1, '#3d6b2a');
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(w / 2, h - 4);
    x.bezierCurveTo(w * 0.02, h * 0.75, w * 0.05, h * 0.12, w / 2, 6);
    x.bezierCurveTo(w * 0.95, h * 0.12, w * 0.98, h * 0.75, w / 2, h - 4);
    x.fill();
    x.strokeStyle = 'rgba(190,210,140,0.55)'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(w / 2, h - 4); x.lineTo(w / 2, 10); x.stroke();
    x.lineWidth = 1.5;
    for (let i = 1; i < 11; i++) {
      const y = h - i * (h / 12);
      for (const s of [-1, 1]) { x.beginPath(); x.moveTo(w / 2, y); x.quadraticCurveTo(w / 2 + s * w * 0.22, y - 20, w / 2 + s * w * 0.4, y - 34); x.stroke(); }
    }
    // a couple of tears / holes like real tropical leaves
    x.globalCompositeOperation = 'destination-out';
    x.fillRect(w * 0.12, h * 0.42, w * 0.18, 3);
    x.fillRect(w * 0.7, h * 0.3, w * 0.2, 3);
  });
}

/** Small leafy clump for ground cover. */
export function clumpTexture() {
  return canvasTex(256, 256, (x, w, h) => {
    const r = mulberry32(3);
    for (let i = 0; i < 38; i++) {
      const bx = w * 0.2 + r() * w * 0.6, len = 60 + r() * 120, a = (r() - 0.5) * 1.3;
      const tipX = bx + Math.sin(a) * len, tipY = h - Math.cos(a) * len;
      x.strokeStyle = 'rgba(60,85,35,0.9)'; x.lineWidth = 2;
      x.beginPath(); x.moveTo(bx, h); x.lineTo(tipX, tipY); x.stroke();
      x.fillStyle = `rgb(${50 + r() * 30},${95 + r() * 45},${32 + r() * 18})`;
      x.beginPath(); x.ellipse(tipX, tipY, 9 + r() * 10, 18 + r() * 14, a, 0, Math.PI * 2); x.fill();
    }
  });
}

/** Bent card along +Y: width w, length l, bending forward (towards +Z) by `bend`. */
function bentCard(w, l, bend, segs = 6) {
  const g = new THREE.PlaneGeometry(w, l, 1, segs);
  g.translate(0, l / 2, 0);
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / l;
    p.setZ(i, p.getZ(i) + bend * t * t * l);
    p.setY(i, p.getY(i) * (1 - 0.25 * bend * t));
    n.setXYZ(i, 0, 0.7, 0.7);
  }
  return g;
}

function placeRadial(cards, count, { tilt = [0.5, 0.9], rand }) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const g = cards().clone();
    g.rotateX(tilt[0] + rand() * (tilt[1] - tilt[0]));
    g.rotateY((i / count) * Math.PI * 2 + rand() * 0.4);
    out.push(g);
  }
  return mergeGeometries(out);
}

function upNormals(g, centre = new THREE.Vector3(0, 0.3, 0)) {
  const p = g.attributes.position, n = g.attributes.normal;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i)).sub(centre).normalize();
    v.y = v.y * 0.5 + 0.6;
    v.normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

const dummy = new THREE.Object3D();
function instancedFrom(geo, mat, spots, { scale = [0.8, 1.3], colorFn, cast = false }) {
  const im = new THREE.InstancedMesh(geo, mat, spots.length);
  const col = new THREE.Color();
  spots.forEach(([x, y, z, s0 = 1, r0], i) => {
    const s = s0 * (scale[0] + Math.random() * (scale[1] - scale[0]));
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, r0 ?? Math.random() * Math.PI * 2, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    im.setMatrixAt(i, dummy.matrix);
    if (colorFn) im.setColorAt(i, colorFn(col));
  });
  im.castShadow = cast;
  im.receiveShadow = true;
  im.customDepthMaterial = mat.userData.depth;
  im.userData.noRaycast = true;
  im.userData.total = spots.length;
  return im;
}

const tint = (h, s, l, j = 0.04) => (c) => c.setHSL(h + (Math.random() - 0.5) * j, s, l + (Math.random() - 0.5) * 0.12);

export function ferns(spots) {
  const rand = mulberry32(21);
  const mat = foliageMaterial(frondTexture(), { sway: 0.06 });
  const geo = upNormals(placeRadial(() => bentCard(0.55, 1.5, 0.55), 9, { tilt: [0.55, 1.05], rand }));
  return instancedFrom(geo, mat, spots, { scale: [0.7, 1.4], colorFn: tint(0.26, 0.4, 0.55) });
}

export function broadLeafPlants(spots) {
  const rand = mulberry32(22);
  const mat = foliageMaterial(broadLeafTexture(), { sway: 0.05, roughness: 0.6 });
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const h = 0.7 + rand() * 0.9;
    const stem = new THREE.CylinderGeometry(0.018, 0.03, h, 5);
    stem.translate(0, h / 2, 0);
    const leaf = bentCard(0.75, 1.05, 0.35, 4);
    leaf.rotateX(-0.9);
    leaf.translate(0, h, 0);
    const pl = mergeGeometries([stem.toNonIndexed(), leaf.toNonIndexed()]);
    pl.rotateZ(0.25 + rand() * 0.35);
    pl.rotateY((i / 6) * Math.PI * 2 + rand() * 0.5);
    parts.push(pl);
  }
  const geo = upNormals(mergeGeometries(parts), new THREE.Vector3(0, 0.6, 0));
  return instancedFrom(geo, mat, spots, { scale: [0.8, 1.6], colorFn: tint(0.27, 0.45, 0.5), cast: true });
}

export function groundClumps(spots) {
  const mat = foliageMaterial(clumpTexture(), { sway: 0.04 });
  const quads = [0, Math.PI / 3, (2 * Math.PI) / 3].map((r) => { const g = new THREE.PlaneGeometry(0.9, 0.7); g.translate(0, 0.35, 0); g.rotateY(r); return g; });
  const geo = upNormals(mergeGeometries(quads));
  return instancedFrom(geo, mat, spots, { scale: [0.6, 1.3], colorFn: tint(0.25, 0.4, 0.5) });
}

/** Palms: curved ringed trunk + arching fronds. Returns { trunks, crowns }. */
export function palms(spots, barkSet) {
  const rand = mulberry32(23);
  const H = 9;
  // trunk: a gently curved tube
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.4, H * 0.35, 0), new THREE.Vector3(1.1, H * 0.7, 0), new THREE.Vector3(1.6, H, 0)]);
  const trunkGeo = new THREE.TubeGeometry(curve, 14, 0.2, 8, false);
  const uv = trunkGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i)); // ring texture along the trunk
  const barkMat = new THREE.MeshStandardMaterial({ map: barkSet.map, normalMap: barkSet.normalMap, roughness: 0.9 });
  // crown
  const frondMat = foliageMaterial(frondTexture({ leaflets: 40, color: [70, 120, 46], width: 1.3 }), { sway: 0.035 });
  const fronds = [];
  for (let i = 0; i < 11; i++) {
    const g = bentCard(1.0, 4.2, 0.9, 8);
    g.rotateX(0.35 + rand() * 0.5);
    g.rotateY((i / 11) * Math.PI * 2 + rand() * 0.3);
    fronds.push(g);
  }
  const crownGeo = upNormals(mergeGeometries(fronds), new THREE.Vector3(0, -0.5, 0));
  crownGeo.translate(1.6, H, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, barkMat, spots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, frondMat, spots.length);
  spots.forEach(([x, y, z, s0 = 1], i) => {
    const s = s0 * (0.8 + rand() * 0.45);
    dummy.position.set(x, y - 0.1, z); dummy.rotation.set(0, rand() * Math.PI * 2, 0); dummy.scale.set(s, s, s); dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix); crowns.setMatrixAt(i, dummy.matrix);
  });
  trunks.castShadow = crowns.castShadow = true;
  trunks.receiveShadow = crowns.receiveShadow = true;
  crowns.customDepthMaterial = frondMat.userData.depth;
  crowns.userData.noRaycast = true;
  trunks.userData.surface = 'wood';
  return { trunks, crowns };
}

/** Hanging lianas: [x, yTop, z, length]. */
export function lianas(spots) {
  const g = new THREE.CylinderGeometry(0.035, 0.045, 1, 5);
  g.translate(0, -0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x3f3a26, roughness: 0.95 });
  const im = new THREE.InstancedMesh(g, mat, spots.length);
  spots.forEach(([x, y, z, len], i) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set((Math.random() - 0.5) * 0.25, 0, (Math.random() - 0.5) * 0.25);
    dummy.scale.set(1, len, 1);
    dummy.updateMatrix();
    im.setMatrixAt(i, dummy.matrix);
  });
  im.castShadow = true;
  im.userData.noRaycast = true;
  return im;
}

/** Show only part of an instanced set (quality scaling). Spots should be shuffled. */
export function setDensity(im, f) {
  im.count = Math.max(0, Math.floor((im.userData.total ?? im.count) * f));
  im.visible = im.count > 0;
}
