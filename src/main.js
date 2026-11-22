import * as THREE from 'three';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { loadSettings, saveSettings } from './settings.js';
import { detectHardware, AutoQuality, PRESETS, TIERS } from './quality.js';
import { Pipeline } from './pipeline.js';
import { loadAssets, setAnisotropy } from './assets.js';
import { setupSky, updateSunShadow, horizonColor } from './environment.js';
import { buildWorld } from './world.js';
import { buildGrass } from './grass.js';
import { Effects } from './effects.js';
import { Targets } from './targets.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Hud } from './hud.js';
import { WeaponSystem } from './weapons/weaponSystem.js';
import { WEAPONS } from './weapons/data.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const $ = (id) => document.getElementById(id);
const D2R = Math.PI / 180;

async function main() {
  // ── Settings + first quality guess ──
  const settings = loadSettings();
  const hw = detectHardware();
  const manual = settings.quality !== 'auto';
  const startTier = manual ? settings.quality : hw.tier;
  const mapId = 'range';
  $('hw-line').textContent = `Graphics: ${prettyGpu(hw.gpu)} → starting at ${PRESETS[startTier].label} quality${manual ? ' (manual)' : ` (${hw.reason})`}`;

  const canvas = $('game');
  const pipeline = new Pipeline(canvas);
  const renderer = pipeline.renderer;
  renderer.setSize(innerWidth, innerHeight, false);

  // ── Load assets ──
  const assets = await loadAssets(renderer, PRESETS[startTier].texRes, (k, label) => {
    $('load-fill').style.width = `${Math.round(k * 85)}%`;
    $('load-label').textContent = label;
  }, mapId);
  $('load-label').textContent = 'Building range…';
  await nextFrame();

  // ── Scene ──
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.03, 3000);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  const sky = setupSky(scene, renderer, assets.hdr);
  scene.fog = new THREE.FogExp2(horizonColor(assets.hdr).multiplyScalar(0.85), 0.0009);

  const audio = new Audio();
  audio.volume = settings.volume;
  const world = buildWorld(scene, assets);
  const grass = buildGrass(scene);
  const effects = new Effects(scene, audio);
  const targets = new Targets(scene, audio, effects);
  const shootables = [...world.shootables, ...(targets ? targets.meshes : [])];
  const seen = new Set();
  for (const m of shootables) {
    if (!seen.has(m.geometry)) { seen.add(m.geometry); m.geometry.computeBoundsTree(); }
  }

  // Viewmodel scene: rendered on top with its own camera so guns never clip into walls.
  const weaponScene = new THREE.Scene();
  weaponScene.environment = sky.envTexture;
  weaponScene.environmentRotation.copy(sky.rotation);
  weaponScene.environmentIntensity = 0.6;
  const weaponCamera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.01, 10);
  const wSun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  weaponScene.add(wSun);
  const wFlash = new THREE.PointLight(0xffb066, 0, 1.5, 2);
  weaponScene.add(wFlash);

  // ── Player + weapons ──
  const input = new Input(canvas);
  const player = new Player(world.colliders, audio, { collision: world.collision || null, bounds: world.bounds || undefined });
  if (world.spawn) { player.pos.copy(world.spawn.pos); player.yaw = world.spawn.yaw; }
  const hud = new Hud();
  const stats = { shots: 0, hits: 0, headshots: 0, downs: 0, longest: 0 };
  const ws = new WeaponSystem({ weaponScene, camera, player, effects, audio, hud, targets, shootables, stats });
  hud.weaponChanged(ws.def);

  // ── Quality ──
  let tier = startTier, scale = 1;
  const auto = new AutoQuality({
    tier: startTier,
    onChange: (t, s, why) => {
      const tierChanged = t !== tier;
      applyQuality(t, s);
      if (tierChanged) hud.toast(`Graphics → ${PRESETS[t].label}${why === 'reverted' ? '' : ' (auto)'}`);
    },
  });
  const sceneRefs = { scene, camera, weaponScene, weaponCamera };
  function applyQuality(t, s) {
    tier = t; scale = s;
    const preset = PRESETS[t];
    pipeline.configure(preset, s, sceneRefs);
    pipeline.aoExclude = [grass?.mesh, ...(world.aoExclude || []), ...effects.aoExclude].filter(Boolean);
    grass?.setDensity(preset.grass);
    world.setPropShadows(preset.propShadows);
    setAnisotropy(assets.allTextures, renderer, preset.anisotropy);
    effects.setLimits(preset);
    updateQualityText();
  }
  function configureGovernor() {
    const isManual = settings.quality !== 'auto';
    auto.enabled = !isManual || settings.dynamicRes;
    auto.lockTier = isManual;
    auto.targetFps = settings.targetFps || 1000;
    if (isManual) { auto.tier = settings.quality; auto.scale = 1; }
  }
  configureGovernor();
  applyQuality(startTier, 1);

  // ── Pre-compile shaders so the first shot / weapon switch doesn't hitch ──
  $('load-label').textContent = 'Compiling shaders…';
  $('load-fill').style.width = '92%';
  await nextFrame();
  ws.allModels().forEach((g) => { g.visible = true; });
  camera.position.set(player.pos.x, 1.6, player.pos.z);
  try {
    if (renderer.compileAsync) {
      await renderer.compileAsync(scene, camera);
      await renderer.compileAsync(weaponScene, weaponCamera);
    } else {
      renderer.compile(scene, camera);
      renderer.compile(weaponScene, weaponCamera);
    }
  } catch (e) { console.warn('precompile', e); }
  ws.allModels().forEach((g, i) => { g.visible = i === ws.index; });
  $('load-fill').style.width = '100%';

  // ── UI / state machine ──
  let state = 'menu';
  const screens = { menu: $('menu'), paused: $('pause'), armory: $('armory') };
  function setState(s) {
    state = s;
    for (const [k, el] of Object.entries(screens)) el.classList.toggle('hidden', k !== s);
    hud.show(s === 'playing' || s === 'paused' || s === 'armory');
    if (s === 'paused') syncSettingsUI();
    if (s === 'armory') buildArmory();
  }
  $('loading').classList.add('hidden');
  setState('menu');
  $('menu-quality').textContent = $('hw-line').textContent;


  // Safety net: if a browser shortcut (e.g. Ctrl+W) tries to close the tab mid-game, ask first.
  addEventListener('beforeunload', (e) => {
    if (state === 'playing' || state === 'paused' || state === 'armory') { e.preventDefault(); e.returnValue = ''; }
  });

  input.onLockChange = (locked) => {
    if (locked) setState('playing');
    else if (state === 'playing') setState('paused');
  };
  const play = () => { audio.init(); audio.setVolume(settings.volume); input.lock(); };
  $('btn-play').onclick = play;
  $('btn-resume').onclick = play;
  $('btn-armory').onclick = () => setState('armory');
  canvas.addEventListener('click', () => { if (state === 'paused' || state === 'menu') play(); });
  addEventListener('keydown', (e) => {
    if (state === 'armory' && (e.code === 'Tab' || e.code === 'Escape')) {
      e.preventDefault();
      if (e.code === 'Tab') play(); else setState('paused');
    }
  });

  // One list of key bindings, shown on the main menu and the pause page.
  const CONTROLS = [
    ['W A S D', 'move'], ['Mouse', 'look'],
    ['LMB', 'fire'], ['RMB', 'aim down sights'],
    ['1–6 / Wheel', 'switch weapon'], ['Q', 'last weapon'],
    ['Tab', 'armory'], ['R', 'reload'],
    ['V', 'fire mode (auto / semi)'], ['Shift', 'crouch'],
    ['W', 'forward (sprints automatically)'], ['Space', 'jump · hold breath (scoped)'],
    ['T', 'restock ammo'], ['Esc', 'pause / settings'],
  ];
  const keysHtml = CONTROLS.map(([k, label]) =>
    `<div>${k.split(' / ').map((x) => x.split(' ').map((y) => `<kbd>${y}</kbd>`).join(' ')).join(' / ')} ${label}</div>`).join('');
  document.querySelectorAll('[data-controls]').forEach((el) => { el.innerHTML = keysHtml; });

  // first-run controls hint fades away
  setTimeout(() => $('keys-hint').classList.add('faded'), 14000);

  function buildArmory() {
    const grid = $('armory-grid');
    grid.innerHTML = '';
    WEAPONS.forEach((w, i) => {
      const c = document.createElement('div');
      c.className = 'card' + (i === ws.index ? ' active' : '');
      const bars = Object.entries({ Damage: w.stats.damage, 'Fire rate': w.stats.rate, Accuracy: w.stats.accuracy, Range: w.stats.range, Mobility: w.stats.mobility })
        .map(([k, v]) => `<div class="stat"><span>${k}</span><div class="bar"><i style="width:${v}%"></i></div></div>`).join('');
      c.innerHTML = `<div class="slot">${i + 1}</div><div class="cls">${w.class}</div><div class="nm">${w.name}</div>${bars}
        <div class="meta"><span>${w.caliber} · ${w.mag} rds</span><span>${w.rpm} RPM · ${w.modes.join(' / ')}</span></div>`;
      c.onclick = () => { ws.equip(i); play(); };
      grid.appendChild(c);
    });
  }

  // settings UI
  function syncSettingsUI() {
    $('set-quality').value = settings.quality;
    $('set-fps').value = String(settings.targetFps);
    $('set-dynres').checked = settings.dynamicRes;
    $('set-dynres').disabled = settings.quality === 'auto';
    $('set-perf').checked = settings.showPerf;
    $('set-fov').value = settings.fov; $('v-fov').textContent = `${settings.fov}°`;
    $('set-sens').value = settings.sensitivity; $('v-sens').textContent = settings.sensitivity.toFixed(2);
    $('set-ads').value = settings.adsSensitivity; $('v-ads').textContent = settings.adsSensitivity.toFixed(2);
    $('set-toggleads').checked = settings.toggleAds;
    $('set-vol').value = settings.volume; $('v-vol').textContent = `${Math.round(settings.volume * 100)}%`;
    updateQualityText();
  }
  function updateQualityText() {
    const el = $('auto-info');
    if (!el) return;
    const gpu = auto.lastGpuMs != null ? ` · GPU ${auto.lastGpuMs.toFixed(1)} ms` : '';
    el.textContent = settings.quality === 'auto'
      ? `Auto is running at ${PRESETS[tier].label}, ${Math.round(scale * 100)}% resolution (${Math.round(auto.lastFps || 0)} FPS${gpu}). Detected: ${prettyGpu(hw.gpu)}.`
      : `Fixed at ${PRESETS[tier].label}${settings.dynamicRes ? `, resolution ${Math.round(scale * 100)}%` : ''}.`;
  }
  const bind = (id, key, parse, after) => $(id).addEventListener('input', (e) => {
    const el = e.target;
    settings[key] = parse(el.type === 'checkbox' ? el.checked : el.value);
    saveSettings(settings);
    after?.();
    syncSettingsUI();
  });
  bind('set-quality', 'quality', String, () => {
    configureGovernor();
    applyQuality(settings.quality === 'auto' ? auto.tier : settings.quality, 1);
    auto.scale = 1;
  });
  bind('set-fps', 'targetFps', Number, configureGovernor);
  bind('set-dynres', 'dynamicRes', Boolean, () => { configureGovernor(); if (!auto.enabled) applyQuality(tier, 1); });
  bind('set-perf', 'showPerf', Boolean);
  bind('set-fov', 'fov', Number);
  bind('set-sens', 'sensitivity', Number);
  bind('set-ads', 'adsSensitivity', Number);
  bind('set-toggleads', 'toggleAds', Boolean);
  bind('set-vol', 'volume', Number, () => audio.setVolume(settings.volume));

  addEventListener('resize', () => {
    camera.aspect = weaponCamera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    weaponCamera.updateProjectionMatrix();
    pipeline.configure(PRESETS[tier], scale, sceneRefs);
  });

  // ── Helpers used every frame ──
  const groundAt = world.groundAt || ((x, z) => (Math.abs(x) < 22 && z > -2.5 && z < 12.5 ? 0.02 : 0));
  const sunRay = new THREE.Raycaster();
  sunRay.firstHitOnly = true;
  let sunVis = 1;
  let roll = 0;
  let lastFov = 0;
  const fwd = new THREE.Vector3();
  const invQ = new THREE.Quaternion();

  function restock() {
    for (const s of ws.slots) { s.ammo = s.def.mag; s.reserve = s.def.reserve; }
    hud.toast('Ammo restocked');
    audio.mech('magIn');
  }

  const debugCam = { on: false, pos: new THREE.Vector3(), yaw: 0, pitch: 0 };

  // ── Main loop ──
  let last = performance.now();
  let time = 0;
  let perfTimer = 0;
  let perfText = '';
  function frame(now) {
    requestAnimationFrame(frame);
    const frameMs = now - last;
    last = now;
    const dt = Math.min(0.05, frameMs / 1000);
    time += dt;

    if (state === 'playing') {
      player.look(input.mouse.dx, input.mouse.dy, settings.sensitivity * ws.sensitivityScale(settings));
      player.update(dt, { input, ads: ws.ads > 0.5 || input.mouse.right, mobility: ws.def.mobility, canSprint: true, scoped: ws.scoped, firing: input.mouse.left || time - ws.lastShot < 0.6 });
      ws.update(dt, { input, settings, time });
      if (input.hit('KeyT')) restock();
      if (input.hit('Tab')) { setState('armory'); input.unlock(); }
    }

    // camera (skipped when a debug free-camera is active)
    if (!debugCam.on) {
    const bob = player.bobAmount * (1 - ws.ads * 0.8);
    camera.position.set(
      player.pos.x,
      player.pos.y + player.eyeHeight - Math.abs(Math.cos(player.bobPhase)) * 0.03 * bob + player.landDip * 0.5,
      player.pos.z,
    );
    const lateral = player.vel.x * Math.cos(player.yaw) - player.vel.z * Math.sin(player.yaw);
    roll += (-lateral * 0.0035 - roll) * Math.min(1, dt * 6);
    camera.rotation.set(player.pitch + ws.scopeSway.y, player.yaw + ws.scopeSway.x, roll + Math.sin(player.bobPhase) * 0.002 * bob);
    } else { camera.position.copy(debugCam.pos); camera.rotation.set(debugCam.pitch, debugCam.yaw, 0); }

    // FOV: hip (from horizontal setting) → aimed / scoped
    const hipV = 2 * Math.atan(Math.tan(settings.fov * D2R / 2) / camera.aspect) / D2R;
    ws.hipFov = hipV;
    const a = ws.ads * ws.ads * (3 - 2 * ws.ads);
    const d = ws.def;
    let fov = d.sight === 'scope' ? (ws.scoped ? d.adsFov : hipV + (hipV * 0.85 - hipV) * a) : hipV + (d.adsFov - hipV) * a;
    fov += ws.sprintBlend * 4;
    if (Math.abs(fov - lastFov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); lastFov = fov; }
    camera.updateMatrixWorld();

    // world simulation
    world.update(time);
    grass?.update(time);
    targets?.update(dt);
    effects.update(dt, groundAt);
    effects.setViewport(renderer.getDrawingBufferSize(new THREE.Vector2()).y, camera.fov);

    camera.getWorldDirection(fwd);
    updateSunShadow(sky.sun, sky.sunDir, player.pos, fwd, PRESETS[tier]);

    // Viewmodel lighting follows the world: sun direction in camera space, dimmed in shade.
    sunRay.set(camera.position, sky.sunDir);
    sunRay.far = 120;
    const shaded = sunRay.intersectObjects(world.shootables, false).length > 0;
    sunVis += ((shaded ? 0 : 1) - sunVis) * Math.min(1, dt * 6);
    invQ.copy(camera.quaternion).invert();
    wSun.position.copy(sky.sunDir).applyQuaternion(invQ).multiplyScalar(5);
    wSun.intensity = 0.25 + 2.3 * sunVis;
    weaponScene.environmentIntensity = 0.35 + 0.3 * sunVis;
    wFlash.intensity = ws.flashTimer > 0 ? 3 : 0;
    wFlash.position.copy(ws.cur.model.muzzle.getWorldPosition(new THREE.Vector3()));

    // HUD + perf readout
    perfTimer -= dt;
    if (perfTimer <= 0) {
      perfTimer = 0.5;
      const gpu = auto.lastGpuMs != null ? ` · GPU ${auto.lastGpuMs.toFixed(1)}ms` : '';
      perfText = `${Math.round(auto.lastFps || 0)} FPS · ${PRESETS[tier].label}${settings.quality === 'auto' ? ' (Auto)' : ''} · ${Math.round(scale * 100)}% res${gpu}`;
      if (state === 'paused') updateQualityText();
    }
    if (state !== 'menu') hud.update(dt, { ws, camera, stats, perfText, showPerf: settings.showPerf });

    const gpuMs = pipeline.render(time, 0.28 + ws.ads * 0.18);
    if (state === 'playing') { auto.sample(frameMs, gpuMs); auto.update(dt); }
    input.endFrame();
  }
  requestAnimationFrame(frame);

  // Expose a few things for debugging in the browser console.
  window.__game = {
    scene, camera, player, ws, auto, settings, input, targets, stats, TIERS,
    setTier: (t) => applyQuality(t, 1),
    debugPlay: () => setState('playing'), // for automated screenshots (no pointer lock)
    debugCam,
    get tier() { return tier; }, get scale() { return scale; },
  };
}

function nextFrame() { return new Promise((r) => requestAnimationFrame(() => r())); }

function prettyGpu(s) {
  const m = /ANGLE \([^,]+,\s*([^,(]+(?:\([^)]*\))?[^,]*)/.exec(s);
  return (m ? m[1] : s).replace(/Direct3D.*$/i, '').replace(/\s+/g, ' ').trim();
}

main().catch((err) => {
  console.error(err);
  $('load-label').textContent = `Error: ${err.message}`;
});
