import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GpuTimer } from './quality.js';

// Camera-lens finishing: vignette + fine animated grain (applied after tone mapping).
const LensShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.28 }, uGrain: { value: 0.022 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float v = 1.0 - dot(d, d) * uVignette * 2.2;
      c.rgb *= v;
      c.rgb += (rnd(vUv * 1000.0) - 0.5) * uGrain;
      gl_FragColor = c;
    }`,
};

export class Pipeline {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.95;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.autoClear = false;
    this.gpuTimer = new GpuTimer(r.getContext());
    this.config = null;
    this.pixelRatio = 1;
    this.aoExclude = [];
  }

  /** (Re)build the post-processing chain for a preset. Cheap to call; only rebuilds when needed. */
  configure(preset, scale, { scene, camera, weaponScene, weaponCamera }) {
    const r = this.renderer;
    const pr = Math.min(window.devicePixelRatio || 1, preset.pixelCap) * scale;
    const key = `${preset.ao}|${preset.bloom}|${preset.aa}|${preset.msaa}`;
    this.pixelRatio = pr;
    r.setPixelRatio(pr);
    r.setSize(innerWidth, innerHeight, false);

    if (this.composer && this.config === key) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(innerWidth, innerHeight);
      return;
    }
    this.config = key;
    this.composer?.dispose?.();

    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: preset.msaa });
    const composer = new EffectComposer(r, rt);
    composer.setPixelRatio(pr);
    composer.setSize(innerWidth, innerHeight);

    const worldPass = new RenderPass(scene, camera);
    composer.addPass(worldPass);

    if (preset.ao > 0) {
      const ao = new GTAOPass(scene, camera, size.x, size.y);
      ao.output = GTAOPass.OUTPUT.Default;
      ao.blendIntensity = 0.85;
      ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.6, thickness: 1.2, scale: 1.0, samples: preset.ao >= 1 ? 16 : 10 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      // Half-resolution AO on "high" to save GPU time.
      const aoScale = preset.ao >= 1 ? 1 : 0.5;
      const origSetSize = ao.setSize.bind(ao);
      ao.setSize = (w, h) => origSetSize(Math.max(1, Math.floor(w * aoScale)), Math.max(1, Math.floor(h * aoScale)));
      ao.setSize(size.x, size.y);
      // Hide transparent / alpha-tested stuff (grass, particles, decals) from the AO g-buffer.
      const origRender = ao.render.bind(ao);
      ao.render = (...args) => {
        const vis = this.aoExclude.map((o) => o.visible);
        this.aoExclude.forEach((o) => { o.visible = false; });
        origRender(...args);
        this.aoExclude.forEach((o, i) => { o.visible = vis[i]; });
      };
      composer.addPass(ao);
    }

    const weaponPass = new RenderPass(weaponScene, weaponCamera);
    weaponPass.clear = false;
    weaponPass.clearDepth = true;
    composer.addPass(weaponPass);

    if (preset.bloom) {
      const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.22, 0.45, 1.6);
      composer.addPass(bloom);
    }

    composer.addPass(new OutputPass());
    this.lens = new ShaderPass(LensShader);
    composer.addPass(this.lens);
    if (preset.aa === 'smaa') composer.addPass(new SMAAPass());
    else if (preset.aa === 'fxaa') composer.addPass(new FXAAPass());

    this.composer = composer;
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.composer?.setSize(innerWidth, innerHeight);
  }

  render(time, vignette = 0.28) {
    this.lens.uniforms.uTime.value = time % 100;
    this.lens.uniforms.uVignette.value = vignette;
    this.gpuTimer.begin();
    this.renderer.clear();
    this.composer.render();
    this.gpuTimer.end();
    return this.gpuTimer.poll();
  }
}
