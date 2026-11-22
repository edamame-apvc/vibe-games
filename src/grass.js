import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bermHeight, terrainHeight } from './world.js';
import { mulberry32 } from './noise.js';

const MAX = 48000;

/** Wind-animated grass tufts. Quality controls how many instances are drawn. */
export function buildGrass(scene) {
  const tex = bladeTexture();
  const mat = new THREE.MeshStandardMaterial({
    map: tex, alphaTest: 0.45, side: THREE.FrontSide, roughness: 0.92, metalness: 0,
  });
  const uniforms = { uTime: { value: 0 } };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 iw = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float gust = sin(uTime * 0.6 + iw.x * 0.02 + iw.z * 0.015) * 0.5 + 0.5;
        float sway = sin(uTime * 1.9 + iw.x * 0.35 + iw.z * 0.27) * (0.5 + gust) + sin(uTime * 3.7 + iw.x * 1.3) * 0.15;
        float k = uv.y * uv.y;
        transformed.x += sway * 0.09 * k;
        transformed.z += sway * 0.05 * k;`);
  };

  // Two crossed quads, base at y = 0, normals pointing up for soft, even lighting.
  // Each quad is duplicated facing the other way (instead of DoubleSide, which would flip
  // the normal on back faces and render half of every tuft black).
  const quads = [0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((r) => {
    const g = new THREE.PlaneGeometry(0.7, 0.55);
    g.translate(0, 0.275, 0);
    g.rotateY(r);
    return g;
  });
  const geo = mergeGeometries(quads);
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);

  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  mesh.userData.noRaycast = true;

  const rand = mulberry32(1337);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const c = new THREE.Color();
  const dry = new THREE.Color(0xc2ad74), green = new THREE.Color(0x8e9a52), dark = new THREE.Color(0x6f7440);
  const placed = [];
  let guard = 0;
  while (placed.length < MAX && guard++ < MAX * 6) {
    const zone = rand();
    let x, z, y;
    if (zone < 0.38) {        // side berms
      x = (rand() < 0.5 ? -1 : 1) * (22.5 + rand() * 22);
      z = -335 + rand() * 348;
      y = bermHeight(x, z);
    } else if (zone < 0.45) { // backstop
      x = (rand() - 0.5) * 90;
      z = -320 - rand() * 30;
      y = bermHeight(x, z);
    } else if (zone < 0.9) {  // surrounding hills
      x = (rand() - 0.5) * 320;
      z = -480 + rand() * 600;
      if (Math.abs(x) < 46 && z > -350 && z < 22) continue;
      y = Math.max(terrainHeight(x, z), bermHeight(x, z));
    } else {                  // weeds at the lane edges / berm toe
      x = (rand() < 0.5 ? -1 : 1) * (14 + rand() * 9);
      z = -315 + rand() * 300;
      y = Math.max(0, bermHeight(x, z));
    }
    if (y < -0.2) continue;
    const scale = 0.55 + rand() * 0.95;
    p.set(x, y - 0.03, z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
    s.set(scale, scale * (0.7 + rand() * 0.6), scale);
    m.compose(p, q, s);
    c.copy(dry).lerp(rand() < 0.6 ? green : dark, rand() * 0.8);
    placed.push({ m: m.clone(), c: c.clone() });
  }
  // Shuffle so any prefix (lower quality = fewer instances) is spread evenly.
  for (let i = placed.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [placed[i], placed[j]] = [placed[j], placed[i]];
  }
  placed.forEach((e, i) => { mesh.setMatrixAt(i, e.m); mesh.setColorAt(i, e.c); });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);

  const total = placed.length;
  return {
    mesh,
    setDensity(f) { mesh.count = Math.floor(total * f); mesh.visible = mesh.count > 0; },
    update(time) { uniforms.uTime.value = time; },
  };
}

function bladeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 46; i++) {
    const x = 128 + (Math.random() - 0.5) * 190;
    const h = 120 + Math.random() * 130;
    const lean = (Math.random() - 0.5) * 70;
    const w = 3 + Math.random() * 4;
    const tone = Math.random();
    const r = 205 + tone * 50, g = 200 + tone * 50, b = 150 + tone * 60;
    const grad = ctx.createLinearGradient(0, 256, 0, 256 - h);
    grad.addColorStop(0, `rgb(${r * 0.7},${g * 0.7},${b * 0.62})`);
    grad.addColorStop(1, `rgb(${r},${g},${b})`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x - w, 256);
    ctx.quadraticCurveTo(x + lean * 0.4, 256 - h * 0.6, x + lean, 256 - h);
    ctx.quadraticCurveTo(x + lean * 0.4 + w * 0.3, 256 - h * 0.6, x + w, 256);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
