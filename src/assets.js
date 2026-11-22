import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { TEXTURES, HDRI, MODELS, MAP_ASSETS } from './assetList.js';

const BASE = './assets/';

/** Loads every texture / HDRI / model. onProgress(0..1, label) */
export async function loadAssets(renderer, texRes, onProgress, mapId = 'range') {
  const need = MAP_ASSETS[mapId] || MAP_ASSETS.range;
  const manager = new THREE.LoadingManager();
  manager.onProgress = (url, loaded, total) => onProgress?.(loaded / total, url.split('/').slice(-3).join('/'));

  const texLoader = new THREE.TextureLoader(manager);
  const hdrLoader = new HDRLoader(manager);
  const gltfLoader = new GLTFLoader(manager);

  const textures = {};
  const allTextures = [];
  const promises = [];

  for (const key of need.textures) {
    textures[key] = {};
    for (const [slot, file] of [['map', 'diff'], ['normalMap', 'nor'], ['armMap', 'arm']]) {
      promises.push(texLoader.loadAsync(`${BASE}textures/${key}/${texRes}/${file}.jpg`).then((t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = slot === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = 4;
        textures[key][slot] = t;
        allTextures.push(t);
      }));
    }
  }

  let hdr;
  const hdrRes = texRes === '1k' ? '1k' : '2k';
  promises.push(hdrLoader.loadAsync(`${BASE}hdri/sky_${hdrRes}.hdr`).then((t) => {
    t.mapping = THREE.EquirectangularReflectionMapping;
    hdr = t;
  }));

  const models = {};
  for (const name of need.models || MODELS) {
    promises.push(gltfLoader.loadAsync(`${BASE}models/${name}/${name}.gltf`).then((g) => {
      g.scene.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = o.receiveShadow = true;
          for (const m of [o.material].flat()) {
            for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (m[k]) allTextures.push(m[k]);
          }
        }
      });
      models[name] = g.scene;
    }));
  }

  await Promise.all(promises);
  return { textures, hdr, models, allTextures };
}

export function setAnisotropy(allTextures, renderer, value) {
  const max = renderer.capabilities.getMaxAnisotropy();
  for (const t of allTextures) {
    const a = Math.min(value, max);
    if (t.anisotropy !== a) { t.anisotropy = a; t.needsUpdate = true; }
  }
}

/** Standard PBR material from a Poly Haven texture set. Geometry UVs are in metres / tileSize. */
export function pbr(set, opts = {}) {
  const m = new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    aoMap: set.armMap,
    roughnessMap: set.armMap,
    metalnessMap: set.armMap,
    roughness: opts.roughness ?? 1,
    metalness: opts.metalness ?? 1, // multiplied by the texture's blue channel
    color: opts.color ?? 0xffffff,
    aoMapIntensity: opts.ao ?? 1,
    normalScale: new THREE.Vector2(opts.normal ?? 1, opts.normal ?? 1),
    side: opts.side ?? THREE.FrontSide,
  });
  if (opts.antiTile) addAntiTiling(m, opts.antiTile);
  return m;
}

/**
 * Hides obvious texture repetition on large surfaces: re-samples the texture at
 * a second, rotated scale and blends with low-frequency world-space noise,
 * plus a subtle large-scale brightness variation (like patches of damp / dry ground).
 */
export function addAntiTiling(material, { macro = 0.18, blend = 0.5, scale = 0.37 } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMacro = { value: macro };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos;
uniform float uMacro;
float vnHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vNoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(vnHash(i), vnHash(i+vec2(1,0)), f.x), mix(vnHash(i+vec2(0,1)), vnHash(i+vec2(1,1)), f.x), f.y); }
float fbm2(vec2 p){ return vNoise(p)*0.6 + vNoise(p*2.13+7.1)*0.3 + vNoise(p*4.7+3.3)*0.1; }`)
      .replace('#include <map_fragment>', `
#ifdef USE_MAP
  vec4 tA = texture2D( map, vMapUv );
  vec2 uvB = mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * ${scale.toFixed(3)} + vec2(0.31, 0.67);
  vec4 tB = texture2D( map, uvB );
  float nB = smoothstep(0.35, 0.65, fbm2(vWPos.xz * 0.045));
  vec4 sampledDiffuseColor = mix(tA, tB, nB * ${blend.toFixed(3)});
  diffuseColor *= sampledDiffuseColor;
#endif
  float macroN = fbm2(vWPos.xz * 0.012 + 11.0);
  diffuseColor.rgb *= mix(1.0 - uMacro, 1.0 + uMacro * 0.6, macroN);
`);
  };
  material.customProgramCacheKey = () => `antitile-${macro}-${blend}-${scale}`;
}

/** Box with UVs in world metres (divided by tile size) so textures keep real-world scale. */
export function boxGeo(w, h, d, tile = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // Face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const spans = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, uv.getX(idx) * spans[f][0] / tile, uv.getY(idx) * spans[f][1] / tile);
    }
  }
  return g;
}

// ── Procedural textures (used for weapons and small details) ────────────────

export function canvasTexture(size, draw, { srgb = false, repeat = 1 } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

export function noiseTexture(size = 256, { base = 128, amp = 60, blobs = 0 } = {}) {
  return canvasTexture(size, (ctx, s) => {
    const img = ctx.createImageData(s, s);
    for (let i = 0; i < s * s; i++) {
      const v = base + (Math.random() - 0.5) * amp;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    for (let i = 0; i < blobs; i++) {
      const x = Math.random() * s, y = Math.random() * s, r = 4 + Math.random() * s * 0.12;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const l = Math.random() > 0.5 ? 255 : 0;
      g.addColorStop(0, `rgba(${l},${l},${l},0.12)`);
      g.addColorStop(1, `rgba(${l},${l},${l},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }
  });
}

/** Text sign texture (distance markers, lane numbers). */
export function signTexture(text, { bg = '#e8e2d0', fg = '#1d1d1d', w = 256, h = 128, font = 'bold 84px Arial' } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  // weathering
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(80,60,40,${Math.random() * 0.06})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 6, 1 + Math.random() * 3);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, w - 6, h - 6);
  ctx.fillStyle = fg; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
