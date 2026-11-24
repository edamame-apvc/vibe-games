import * as THREE from 'three';

// Particles (sparks / dust / smoke / debris), bullet-hole decals, tracers,
// ejected brass with simple physics, and muzzle flash lighting.

const PARTICLE_VS = /* glsl */`
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
attribute float aSeed;
varying float vAlpha;
varying vec3 vColor;
varying float vSeed;
uniform float uScale;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(0.05, -mv.z);
  vAlpha = aAlpha; vColor = aColor; vSeed = aSeed;
}`;
const PARTICLE_FS = /* glsl */`
varying float vAlpha;
varying vec3 vColor;
varying float vSeed;
uniform float uSoft;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + vSeed * 17.0) * 43758.5453); }
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  if (d > 1.0) discard;
  float a;
  if (uSoft > 0.5) {
    // fluffy dust/smoke: soft edge broken up by a little noise
    float n = h(floor(gl_PointCoord * 6.0)) * 0.35;
    a = smoothstep(1.0, 0.2, d + n * 0.6) * vAlpha;
  } else {
    a = smoothstep(1.0, 0.0, d) * vAlpha;
  }
  gl_FragColor = vec4(vColor, a);
}`;

class ParticlePool {
  constructor(scene, max, additive) {
    this.max = max;
    this.limit = max;
    this.items = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.color = new Float32Array(max * 3);
    this.seed = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: 500 }, uSoft: { value: additive ? 0 : 1 } };
    const mat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS, uniforms: this.uniforms,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    scene.add(this.points);
  }
  spawn(p) {
    if (this.items.length >= this.limit) this.items.shift();
    p.age = 0;
    p.seed = Math.random();
    this.items.push(p);
  }
  update(dt) {
    let n = 0;
    const keep = [];
    for (const p of this.items) {
      p.age += dt;
      if (p.age >= p.life) continue;
      keep.push(p);
      p.vel.y -= (p.gravity ?? 0) * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - (p.drag ?? 0) * dt));
      p.p.addScaledVector(p.vel, dt);
      if (p.floor !== undefined && p.p.y < p.floor) { p.p.y = p.floor; p.vel.y *= -0.3; p.vel.x *= 0.5; p.vel.z *= 0.5; }
      const t = p.age / p.life;
      this.pos[n * 3] = p.p.x; this.pos[n * 3 + 1] = p.p.y; this.pos[n * 3 + 2] = p.p.z;
      this.size[n] = p.size * (1 + (p.grow ?? 0) * t);
      this.alpha[n] = p.alpha * (p.fadeIn ? Math.min(1, t * 8) : 1) * (1 - t) ** (p.fadePow ?? 1);
      this.color[n * 3] = p.color.r; this.color[n * 3 + 1] = p.color.g; this.color[n * 3 + 2] = p.color.b;
      this.seed[n] = p.seed;
      n++;
    }
    this.items = keep;
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    for (const k of ['position', 'aSize', 'aAlpha', 'aColor', 'aSeed']) g.attributes[k].needsUpdate = true;
  }
}

function holeTexture(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const cx = 64;
  if (kind === 'scorch') {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 42;
      const g = x.createRadialGradient(cx + Math.cos(a) * r * 0.4, cx + Math.sin(a) * r * 0.4, 0, cx, cx, r);
      g.addColorStop(0, 'rgba(12,10,8,0.55)'); g.addColorStop(1, 'rgba(20,16,12,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    }
  } else if (kind === 'metal') {
    const g = x.createRadialGradient(cx, cx, 2, cx, cx, 40);
    g.addColorStop(0, 'rgba(40,40,40,1)'); g.addColorStop(0.25, 'rgba(210,210,205,0.95)');
    g.addColorStop(0.5, 'rgba(150,150,145,0.6)'); g.addColorStop(1, 'rgba(120,120,120,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  } else if (kind === 'paint') { // lead splash on painted steel targets
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 46;
      x.strokeStyle = `rgba(95,95,100,${0.4 + Math.random() * 0.4})`;
      x.lineWidth = 1 + Math.random() * 3;
      x.beginPath(); x.moveTo(cx, cx); x.lineTo(cx + Math.cos(a) * r, cx + Math.sin(a) * r); x.stroke();
    }
    const g = x.createRadialGradient(cx, cx, 0, cx, cx, 16);
    g.addColorStop(0, 'rgba(70,70,75,1)'); g.addColorStop(1, 'rgba(110,110,115,0)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cx, 16, 0, 7); x.fill();
  } else {
    const rim = kind === 'wood' ? '120,85,50' : kind === 'concrete' ? '170,165,155' : '60,45,30';
    const g = x.createRadialGradient(cx, cx, 0, cx, cx, 60);
    g.addColorStop(0, 'rgba(5,5,5,1)'); g.addColorStop(0.18, 'rgba(15,12,10,1)');
    g.addColorStop(0.3, `rgba(${rim},0.85)`); g.addColorStop(1, `rgba(${rim},0)`);
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    x.strokeStyle = 'rgba(20,15,10,0.6)';
    for (let i = 0; i < (kind === 'concrete' ? 9 : 6); i++) {
      const a = Math.random() * Math.PI * 2, r = 14 + Math.random() * 30;
      x.lineWidth = 1 + Math.random();
      x.beginPath(); x.moveTo(cx + Math.cos(a) * 8, cx + Math.sin(a) * 8);
      x.lineTo(cx + Math.cos(a + 0.2) * r, cx + Math.sin(a + 0.2) * r); x.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,240,1)'); g.addColorStop(0.15, 'rgba(255,220,140,0.9)');
  g.addColorStop(0.45, 'rgba(255,140,40,0.35)'); g.addColorStop(1, 'rgba(255,90,20,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  x.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + Math.random() * 0.3;
    x.strokeStyle = 'rgba(255,200,120,0.5)'; x.lineWidth = 3 + Math.random() * 4;
    x.beginPath(); x.moveTo(64, 64); x.lineTo(64 + Math.cos(a) * 60, 64 + Math.sin(a) * 60); x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const SURF_DECAL = { dirt: 'dirt', concrete: 'concrete', wood: 'wood', metal: 'metal', plastic: 'concrete', rubber: 'dirt', steel: 'paint' };

export class Effects {
  constructor(scene, audio) {
    this.scene = scene;
    this.audio = audio;
    this.sparks = new ParticlePool(scene, 1600, true);
    this.dust = new ParticlePool(scene, 1600, false);
    this.decalLimit = 200;

    this.decalMats = {};
    for (const k of ['dirt', 'concrete', 'wood', 'metal', 'paint', 'scorch']) {
      this.decalMats[k] = new THREE.MeshStandardMaterial({
        map: holeTexture(k), transparent: true, depthWrite: false, roughness: k === 'metal' ? 0.3 : 0.95,
        metalness: k === 'metal' ? 0.8 : 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      });
    }
    this.decalGeo = new THREE.PlaneGeometry(1, 1);
    this.decals = [];
    this.decalGroup = new THREE.Group();
    scene.add(this.decalGroup);

    this.tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 4.2, 1.6), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const tg = new THREE.CylinderGeometry(0.012, 0.012, 1, 6, 1, true);
    tg.rotateX(Math.PI / 2);
    this.tracerGeo = tg;
    this.tracers = [];
    this.tracerGroup = new THREE.Group();
    scene.add(this.tracerGroup);

    this.shellMats = {
      brass: new THREE.MeshStandardMaterial({ color: 0xc39543, metalness: 1, roughness: 0.3 }),
      red: new THREE.MeshStandardMaterial({ color: 0x8e1b16, roughness: 0.5 }),
    };
    this.shellGeos = {
      pistol: new THREE.CylinderGeometry(0.0048, 0.0048, 0.019, 10),
      rifle: new THREE.CylinderGeometry(0.0048, 0.0058, 0.045, 10),
      big: new THREE.CylinderGeometry(0.0065, 0.0075, 0.07, 10),
      shotgun: new THREE.CylinderGeometry(0.0095, 0.0095, 0.068, 12),
    };
    this.shells = [];
    this.shellGroup = new THREE.Group();
    scene.add(this.shellGroup);

    this.boomLight = new THREE.PointLight(0xffa050, 0, 45, 2);
    scene.add(this.boomLight);
    this.muzzleLight = new THREE.PointLight(0xffb066, 0, 9, 2);
    scene.add(this.muzzleLight);
    this.flashTex = flashTexture();

    // AO pass would treat these as solid geometry – hide them during the AO g-buffer.
    this.aoExclude = [this.sparks.points, this.dust.points, this.decalGroup, this.tracerGroup, this.shellGroup];
  }

  setLimits(preset) {
    this.sparks.limit = Math.min(this.sparks.max, preset.particles);
    this.dust.limit = Math.min(this.dust.max, preset.particles);
    this.decalLimit = preset.decals;
    while (this.decals.length > this.decalLimit) this.decalGroup.remove(this.decals.shift());
  }

  setViewport(height, fovDeg) {
    const s = height / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    this.sparks.uniforms.uScale.value = s;
    this.dust.uniforms.uScale.value = s;
  }

  /** Flash mesh attached to a weapon's muzzle marker (viewmodel scene). */
  makeMuzzleFlash() {
    const mat = new THREE.MeshBasicMaterial({
      map: this.flashTex, color: new THREE.Color(3.5, 2.6, 1.6), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
    });
    const grp = new THREE.Group();
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), mat);
    grp.add(front);
    for (const r of [0, Math.PI / 2]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.3), mat);
      side.rotation.set(Math.PI / 2, r, 0);
      side.position.z = -0.12;
      grp.add(side);
    }
    grp.visible = false;
    grp.userData.mat = mat;
    return grp;
  }

  flashLight(pos) {
    this.muzzleLight.position.copy(pos);
    this.muzzleLight.intensity = 30 + Math.random() * 15;
  }

  muzzleSmoke(pos, dir, amount = 1) {
    for (let i = 0; i < 3 * amount; i++) {
      this.dust.spawn({
        p: pos.clone().addScaledVector(dir, 0.05 + Math.random() * 0.2),
        vel: dir.clone().multiplyScalar(0.6 + Math.random()).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.25 + Math.random() * 0.3, (Math.random() - 0.5) * 0.3)),
        life: 0.9 + Math.random() * 0.8, size: 0.09, grow: 4, alpha: 0.12, drag: 1.6, fadeIn: true,
        color: new THREE.Color(0.55, 0.55, 0.55),
      });
    }
  }

  tracer(from, to, speed = 850) {
    const len = Math.min(6, from.distanceTo(to) * 0.5);
    const m = new THREE.Mesh(this.tracerGeo, this.tracerMat);
    m.scale.set(1, 1, len);
    m.lookAt(to.clone().sub(from).add(m.position));
    this.tracerGroup.add(m);
    this.tracers.push({ m, from: from.clone(), to: to.clone(), dist: from.distanceTo(to), len, t: 0, speed });
  }

  ejectShell(pos, camQuat, kind, velScale = 1) {
    const isShotgun = kind === 'shotgun';
    const m = new THREE.Mesh(this.shellGeos[kind], isShotgun ? this.shellMats.red : this.shellMats.brass);
    m.castShadow = true;
    m.position.copy(pos);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camQuat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camQuat);
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(camQuat);
    const vel = right.multiplyScalar((2.2 + Math.random() * 1.2) * velScale)
      .add(up.multiplyScalar(1.4 + Math.random() * 0.9))
      .add(back.multiplyScalar(0.4 + Math.random() * 0.6));
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    this.shellGroup.add(m);
    this.shells.push({ m, vel, spin: new THREE.Vector3((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 40), age: 0, bounced: 0, isShotgun, rest: false });
    if (this.shells.length > 80) { const s = this.shells.shift(); this.shellGroup.remove(s.m); }
  }

  /** Bullet impact. surface: dirt | concrete | wood | metal | plastic | rubber | steel */
  impact(surface, point, normal, distance, { decalOn = null, size = 1 } = {}) {
    const far = Math.max(1, distance / 35); // keep distant impacts readable
    const n = normal.clone();
    const rnd = (s) => (Math.random() - 0.5) * s;
    const along = (speed, spreadAmt) => n.clone().multiplyScalar(speed).add(new THREE.Vector3(rnd(spreadAmt), rnd(spreadAmt) + spreadAmt * 0.3, rnd(spreadAmt)));

    if (surface === 'flesh') {
      for (let i = 0; i < 7; i++) {
        this.dust.spawn({
          p: point.clone().addScaledVector(n, 0.05), vel: along(0.6 + Math.random() * 1.5, 1.2), life: 0.35 + Math.random() * 0.3,
          size: (0.08 + Math.random() * 0.1) * far, grow: 2.2, alpha: 0.7, drag: 3, gravity: 2,
          color: new THREE.Color(0.32, 0.03, 0.025),
        });
      }
      this.audio.impact('rubber', distance);
      return;
    }
    if (surface === 'metal' || surface === 'steel') {
      const count = surface === 'steel' ? 16 : 10;
      for (let i = 0; i < count; i++) {
        this.sparks.spawn({
          p: point.clone(), vel: along(3 + Math.random() * 6, 7), life: 0.15 + Math.random() * 0.35,
          size: 0.025 * far, alpha: 1, gravity: 9, drag: 1.2, fadePow: 0.6, floor: 0.01,
          color: new THREE.Color(5, 2.6 + Math.random(), 0.8),
        });
      }
      this.dust.spawn({ p: point.clone().addScaledVector(n, 0.05), vel: along(0.4, 0.3), life: 0.8, size: 0.12 * far, grow: 3, alpha: 0.25, drag: 2, color: new THREE.Color(0.55, 0.55, 0.55) });
    } else {
      const col = {
        dirt: [0.47, 0.4, 0.31], concrete: [0.66, 0.64, 0.6], wood: [0.55, 0.42, 0.28], plastic: [0.4, 0.4, 0.4], rubber: [0.15, 0.15, 0.15],
      }[surface] || [0.5, 0.45, 0.38];
      const puffs = surface === 'dirt' ? 7 : 5;
      for (let i = 0; i < puffs; i++) {
        this.dust.spawn({
          p: point.clone().addScaledVector(n, 0.03), vel: along(0.8 + Math.random() * 2.2, 1.4),
          life: 0.9 + Math.random() * 1.3, size: (0.1 + Math.random() * 0.12) * far, grow: 3.5, alpha: 0.45, drag: 2.4, gravity: -0.15, fadeIn: true,
          color: new THREE.Color(col[0] * (0.9 + Math.random() * 0.2), col[1], col[2]),
        });
      }
      // debris chunks
      for (let i = 0; i < 6; i++) {
        this.dust.spawn({
          p: point.clone(), vel: along(2 + Math.random() * 3, 4), life: 0.6 + Math.random() * 0.5,
          size: 0.012 * far, alpha: 0.95, gravity: 9.8, drag: 0.5, floor: point.y - 0.5,
          color: new THREE.Color(col[0] * 0.5, col[1] * 0.5, col[2] * 0.5),
        });
      }
    }
    this.audio.impact(surface === 'steel' ? 'metal' : surface, distance);

    // decal
    if (this.decalLimit > 0) {
      const kind = SURF_DECAL[surface] || 'dirt';
      const m = new THREE.Mesh(this.decalGeo, this.decalMats[kind]);
      const s = (kind === 'paint' ? 0.09 : kind === 'dirt' ? 0.08 : 0.045) * size * (0.85 + Math.random() * 0.3);
      m.scale.set(s, s, s);
      m.position.copy(point).addScaledVector(n, 0.003);
      m.lookAt(point.clone().add(n));
      m.rotateZ(Math.random() * Math.PI * 2);
      m.receiveShadow = true;
      if (decalOn) decalOn.attach(m); // follow moving/falling targets
      else this.decalGroup.add(m);
      this.decals.push(m);
      while (this.decals.length > this.decalLimit) {
        const old = this.decals.shift();
        old.parent?.remove(old);
      }
    }
  }

  /** Grenade / frag explosion. */
  explosion(pos, normal, distance) {
    const n = normal.clone();
    const rnd = (s) => (Math.random() - 0.5) * s;
    const far = Math.max(1, distance / 60);
    this.boomLight.position.copy(pos).addScaledVector(n, 0.8);
    this.boomLight.intensity = 1600;
    // fireball
    for (let i = 0; i < 26; i++) {
      const dir = new THREE.Vector3(rnd(2), rnd(2) + 0.6, rnd(2)).normalize();
      this.sparks.spawn({
        p: pos.clone().addScaledVector(n, 0.3).add(new THREE.Vector3(rnd(0.6), rnd(0.4), rnd(0.6))),
        vel: dir.multiplyScalar(2 + Math.random() * 6).addScaledVector(n, 2), life: 0.16 + Math.random() * 0.22,
        size: (0.9 + Math.random() * 1.4) * far, grow: 1.3, alpha: 1, drag: 5, fadePow: 0.6,
        color: new THREE.Color(7, 3 + Math.random() * 1.5, 0.8),
      });
    }
    // embers / fragments
    for (let i = 0; i < 40; i++) {
      const dir = new THREE.Vector3(rnd(2), Math.random() * 1.2, rnd(2)).normalize();
      this.sparks.spawn({
        p: pos.clone().addScaledVector(n, 0.15), vel: dir.multiplyScalar(8 + Math.random() * 22), life: 0.3 + Math.random() * 0.8,
        size: 0.03 * far, alpha: 1, gravity: 9.8, drag: 1.5, fadePow: 0.5, floor: pos.y - 0.2,
        color: new THREE.Color(5, 2.2, 0.6),
      });
    }
    // smoke column
    for (let i = 0; i < 20; i++) {
      const s = 0.32 + Math.random() * 0.12;
      this.dust.spawn({
        p: pos.clone().addScaledVector(n, 0.5).add(new THREE.Vector3(rnd(1.2), Math.random() * 0.8, rnd(1.2))),
        vel: new THREE.Vector3(rnd(2.5), 1.2 + Math.random() * 2.4, rnd(2.5)), life: 3 + Math.random() * 3.5,
        size: (1.3 + Math.random() * 1.3) * far, grow: 2.6, alpha: 0.55, drag: 1.1, gravity: -0.35, fadeIn: true,
        color: new THREE.Color(s, s * 0.97, s * 0.93),
      });
    }
    // ground dust ring
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      this.dust.spawn({
        p: pos.clone().add(new THREE.Vector3(0, 0.2, 0)), vel: new THREE.Vector3(Math.cos(a) * 7, 0.6, Math.sin(a) * 7),
        life: 1.4 + Math.random(), size: 0.8 * far, grow: 3, alpha: 0.4, drag: 2.2, fadeIn: true,
        color: new THREE.Color(0.5, 0.43, 0.34),
      });
    }
    // dirt debris thrown up
    for (let i = 0; i < 26; i++) {
      this.dust.spawn({
        p: pos.clone(), vel: n.clone().multiplyScalar(5 + Math.random() * 8).add(new THREE.Vector3(rnd(9), 0, rnd(9))),
        life: 1 + Math.random() * 0.7, size: (0.05 + Math.random() * 0.06) * far, alpha: 1, gravity: 9.8, drag: 0.3,
        floor: pos.y - 0.05, color: new THREE.Color(0.22, 0.18, 0.13),
      });
    }
    // scorch mark
    if (this.decalLimit > 0) {
      const m = new THREE.Mesh(this.decalGeo, this.decalMats.scorch);
      m.scale.setScalar(3.2 + Math.random());
      m.position.copy(pos).addScaledVector(n, 0.01);
      m.lookAt(pos.clone().add(n));
      m.rotateZ(Math.random() * Math.PI * 2);
      m.receiveShadow = true;
      this.decalGroup.add(m);
      this.decals.push(m);
      while (this.decals.length > this.decalLimit) { const old = this.decals.shift(); old.parent?.remove(old); }
    }
  }

  update(dt, groundAt) {
    this.boomLight.intensity *= Math.max(0, 1 - dt * 14);
    this.sparks.update(dt);
    this.dust.update(dt);
    this.muzzleLight.intensity *= Math.max(0, 1 - dt * 45);

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.t += dt * tr.speed;
      if (tr.t - tr.len > tr.dist) { this.tracerGroup.remove(tr.m); this.tracers.splice(i, 1); continue; }
      const head = Math.min(tr.t, tr.dist), tail = Math.max(0, tr.t - tr.len);
      const dir = tr.to.clone().sub(tr.from).normalize();
      const mid = (head + tail) / 2;
      tr.m.position.copy(tr.from).addScaledVector(dir, mid);
      tr.m.scale.z = Math.max(0.01, head - tail);
      tr.m.lookAt(tr.m.position.clone().add(dir));
    }

    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.age += dt;
      if (s.age > 8) { this.shellGroup.remove(s.m); this.shells.splice(i, 1); continue; }
      if (s.rest) continue;
      s.vel.y -= 9.8 * dt;
      s.m.position.addScaledVector(s.vel, dt);
      s.m.rotation.x += s.spin.x * dt; s.m.rotation.y += s.spin.y * dt; s.m.rotation.z += s.spin.z * dt;
      const floor = groundAt(s.m.position.x, s.m.position.z) + 0.006;
      if (s.m.position.y < floor) {
        s.m.position.y = floor;
        if (s.bounced < 3 && Math.abs(s.vel.y) > 0.6) this.audio.casing(Math.min(1, Math.abs(s.vel.y) / 3), s.isShotgun);
        s.vel.y *= -0.35; s.vel.x *= 0.45; s.vel.z *= 0.45; s.spin.multiplyScalar(0.5);
        s.bounced++;
        if (Math.abs(s.vel.y) < 0.3) { s.rest = true; s.m.rotation.x = Math.PI / 2; s.m.rotation.z = 0; }
      }
    }
  }
}
