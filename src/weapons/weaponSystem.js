import * as THREE from 'three';
import { WEAPONS } from './data.js';
import { buildWeaponModel } from './models.js';

const D2R = Math.PI / 180;
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const ease = (t) => t * t * (3 - 2 * t);

export class WeaponSystem {
  constructor({ weaponScene, camera, player, effects, audio, hud, targets, shootables, stats }) {
    this.scene = weaponScene;
    this.camera = camera;
    this.player = player;
    this.effects = effects;
    this.audio = audio;
    this.hud = hud;
    this.targets = targets;
    this.shootables = shootables;
    this.stats = stats;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 1500;

    this.holder = new THREE.Group(); // animated pose
    this.scene.add(this.holder);

    this.slots = WEAPONS.map((def) => {
      const model = buildWeaponModel(def.id);
      const flash = effects.makeMuzzleFlash();
      model.muzzle.add(flash);
      model.group.visible = false;
      this.holder.add(model.group);
      return { def, model, flash, ammo: def.mag, reserve: def.reserve, mode: 0 };
    });

    this.index = 2;           // start with the rifle
    this.prevIndex = 1;
    this.cur = this.slots[this.index];
    this.cur.model.group.visible = true;

    this.ads = 0;             // 0 hip … 1 aimed
    this.adsToggled = false;
    this.cooldown = 0;
    this.bloom = 0;
    this.sprintBlend = 0;
    this.shotsInSpray = 0;
    this.lastShot = -10;
    this.time = 0;
    this.recoilAccum = new THREE.Vector2(); // radians still to recover (pitch, yaw)
    this.kick = { z: 0, zv: 0, rx: 0, rxv: 0, ry: 0, ryv: 0 };
    this.sway = new THREE.Vector2();
    this.swayVel = new THREE.Vector2();
    this.reload = null;       // { t, dur, stage, empty }
    this.cycle = null;        // bolt / pump: { t, dur, kind }
    this.switching = { t: 1, phase: 'raise', target: null, dur: this.cur.def.drawTime };
    this.queuedShot = 0;
    this.flashTimer = 0;
    this.scoped = false;
    this.breath = { held: false, stamina: 1, exhausted: 0 };
    this.scopeSway = new THREE.Vector2();
    this.reloadPose = 0;
  }

  get def() { return this.cur.def; }
  get mode() { return this.def.modes[this.cur.mode]; }
  get busy() { return !!this.reload || this.switching.t < 1 || !!this.cycle; }

  allModels() { return this.slots.map((s) => s.model.group); }

  equip(i) {
    if (i === this.index && !this.switching.target) return;
    if (i < 0 || i >= this.slots.length) return;
    this.reload = null;
    this.cycle = null;
    this.switching = { t: 0, phase: 'lower', target: i, dur: 0.2 };
    this.audio.mech('switch');
  }

  currentSpreadDeg() {
    const d = this.def, s = d.spread, p = this.player;
    const adsMult = 1 + (s.ads - 1) * this.ads;
    let spread = s.base * adsMult;
    spread += s.move * Math.min(1.3, p.speed / 4.7) * (1 - 0.4 * this.ads);
    if (!p.onGround) spread += s.air;
    spread += this.bloom;
    if (p.crouching && p.onGround) spread *= s.crouch;
    return spread;
  }

  update(dt, { input, settings, time }) {
    this.time = time;
    const d = this.def;
    const p = this.player;

    // ── weapon selection ──
    for (const [i, s] of this.slots.entries()) if (input.hit(s.def.key)) this.equip(i);
    if (input.hit('KeyQ')) this.equip(this.prevIndex);
    if (input.mouse.wheel) this.equip((this.index + (input.mouse.wheel > 0 ? 1 : -1) + this.slots.length) % this.slots.length);
    if ((input.hit('KeyV') || input.hit('KeyB')) && d.modes.length > 1) {
      this.cur.mode = (this.cur.mode + 1) % d.modes.length;
      this.audio.mech('switch');
      this.hud.toast(`${d.name}: ${this.mode.toUpperCase()}`);
    }

    this.updateSwitch(dt);

    // ── sprint blend ──
    const sprinting = p.sprinting;
    this.sprintBlend += ((sprinting ? 1 : 0) - this.sprintBlend) * Math.min(1, dt * 10);

    // ── ADS ──
    if (settings.toggleAds && input.mouse.rightPressed) this.adsToggled = !this.adsToggled;
    const wantAds = (settings.toggleAds ? this.adsToggled : input.mouse.right)
      && !this.reload && this.switching.t >= 1 && !sprinting;
    if (!wantAds && settings.toggleAds && (this.reload || sprinting)) this.adsToggled = false;
    const adsSpeed = 1 / d.adsTime;
    this.ads = Math.max(0, Math.min(1, this.ads + (wantAds ? adsSpeed : -adsSpeed * 1.3) * dt));
    this.scoped = d.sight === 'scope' && this.ads > 0.92;

    // ── reload ──
    if (input.hit('KeyR')) this.startReload();
    this.updateReload(dt, input);
    this.updateCycle(dt);

    // ── firing ──
    this.cooldown -= dt;
    if (input.mouse.leftPressed) this.queuedShot = 0.18;
    this.queuedShot -= dt;
    const auto = this.mode === 'auto';
    const trigger = auto ? input.mouse.left : this.queuedShot > 0;
    if (trigger && this.reload && d.shellReload && this.cur.ammo > 0) this.reload = null; // interrupt shell reload
    if (trigger && this.canFire()) {
      if (this.cur.ammo > 0) {
        this.fire();
        this.queuedShot = 0;
      } else if (input.mouse.leftPressed) {
        this.audio.dryFire();
        this.cooldown = 0.25;
        if (this.cur.reserve > 0) this.startReload();
      }
    }
    if (!input.mouse.left) this.shotsInSpray = Math.max(0, this.shotsInSpray - dt * 12);

    // ── spread bloom recovery ──
    this.bloom = Math.max(0, this.bloom - d.spread.recover * dt * (this.time - this.lastShot > 0.1 ? 1 : 0.15));

    // ── recoil recovery (pull the view back toward where you aimed) ──
    if (this.time - this.lastShot > 60 / d.rpm + 0.05) {
      const r = d.recoil.recover * D2R * dt;
      const rp = Math.min(this.recoilAccum.x, r);
      p.pitch -= rp; this.recoilAccum.x -= rp;
      const ry = Math.sign(this.recoilAccum.y) * Math.min(Math.abs(this.recoilAccum.y), r * 0.6);
      p.yaw -= ry; this.recoilAccum.y -= ry;
    }
    // Player pulling down against the recoil "uses up" the recovery.
    if (input.mouse.dy > 0 && this.recoilAccum.x > 0) {
      this.recoilAccum.x = Math.max(0, this.recoilAccum.x - input.mouse.dy * 0.0022 * settings.sensitivity * this.sensitivityScale(settings));
    }

    // ── sniper scope sway + hold breath (Shift) ──
    this.updateScope(dt, input);

    // ── viewmodel springs ──
    const k = this.kick;
    k.zv += (-k.z * 220 - k.zv * 20) * dt; k.z += k.zv * dt;
    k.rxv += (-k.rx * 200 - k.rxv * 18) * dt; k.rx += k.rxv * dt;
    k.ryv += (-k.ry * 180 - k.ryv * 18) * dt; k.ry += k.ryv * dt;

    // sway follows mouse movement (weapon lags behind your view)
    const mx = Math.max(-40, Math.min(40, input.mouse.dx)), my = Math.max(-40, Math.min(40, input.mouse.dy));
    this.swayVel.x += (-this.sway.x * 90 - this.swayVel.x * 12) * dt - mx * 0.004;
    this.swayVel.y += (-this.sway.y * 90 - this.swayVel.y * 12) * dt - my * 0.004;
    this.sway.addScaledVector(this.swayVel, dt);

    this.flashTimer -= dt;
    this.cur.flash.visible = this.flashTimer > 0;

    this.updatePose(dt);
  }

  canFire() {
    return this.cooldown <= 0 && !this.reload && !this.cycle && this.switching.t >= 1 && this.sprintBlend < 0.35;
  }

  sensitivityScale(settings) {
    const hip = this.hipFov ?? 70;
    const fov = this.camera.fov;
    return this.ads > 0.5 ? settings.adsSensitivity * Math.tan(fov * D2R / 2) / Math.tan(hip * D2R / 2) : 1;
  }

  fire() {
    const d = this.def, p = this.player, cam = this.camera;
    this.cur.ammo--;
    this.cooldown = 60 / d.rpm;
    this.lastShot = this.time;
    this.shotsInSpray++;
    this.stats.shots++;

    const spread = this.currentSpreadDeg();
    cam.updateMatrixWorld();
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const forward = cam.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(forward, cam.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();

    const muzzleWorld = this.muzzleWorldPos();
    let anyHit = false;
    for (let i = 0; i < d.pellets; i++) {
      const cone = (d.pellets > 1 ? d.spread.base * (1 + (d.spread.ads - 1) * this.ads) + spread * 0.25 : spread) * D2R;
      // uniform-in-disc sampling inside the cone (bias toward centre like a real group)
      const r = Math.tan(cone) * Math.sqrt(Math.random()) * (d.pellets > 1 ? 1 : (0.55 + 0.45 * Math.random()));
      const a = Math.random() * Math.PI * 2;
      const dir = forward.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      const hit = this.traceBullet(origin, dir, d);
      if (hit?.target) anyHit = true;
      const tracerEvery = d.tracerEvery;
      if (tracerEvery && this.stats.shots % tracerEvery === 0 && i === 0) {
        this.effects.tracer(muzzleWorld, hit ? hit.point : origin.clone().addScaledVector(dir, 800), d.id === 'sniper' ? 900 : 780);
      }
    }
    if (anyHit) this.stats.hits++;

    // recoil: mostly vertical, horizontal wander follows a learnable pattern
    const adsR = 1 - 0.2 * this.ads;
    const crouchR = p.crouching ? 0.85 : 1;
    const n = this.shotsInSpray;
    const pattern = d.auto ? Math.sin(n * 0.55 + 0.8) * (n > 4 ? 1 : 0.35) : (Math.random() - 0.5) * 2;
    const vk = d.recoil.v * (0.85 + Math.random() * 0.3) * adsR * crouchR * D2R;
    const hk = (d.recoil.h * pattern + (Math.random() - 0.5) * d.recoil.h * 0.5) * adsR * crouchR * D2R;
    p.pitch += vk; p.yaw += hk;
    this.recoilAccum.x += vk; this.recoilAccum.y += hk;
    this.bloom = Math.min(d.spread.bloomMax, this.bloom + d.spread.bloom);

    const k = this.kick;
    const adsKick = 1 - 0.55 * this.ads;
    k.zv += d.recoil.kickZ * 60 * adsKick;
    k.rxv += d.recoil.kickRot * 60 * adsKick;
    k.ryv += (Math.random() - 0.5) * d.recoil.kickRot * 30 * adsKick;

    // muzzle flash, light, smoke, sound, brass
    this.flashTimer = 0.045;
    const f = this.cur.flash;
    f.rotation.z = Math.random() * Math.PI;
    f.scale.setScalar((d.id === 'shotgun' || d.id === 'sniper' ? 1.5 : d.id === 'pistol' ? 0.8 : 1) * (0.8 + Math.random() * 0.4));
    this.effects.flashLight(muzzleWorld);
    this.effects.muzzleSmoke(muzzleWorld, forward, d.id === 'shotgun' || d.id === 'sniper' ? 2 : 1);
    this.audio.gunshot(d.sound);
    this.hud.shotFired();

    if (d.id === 'sniper') {
      this.cycle = { t: -0.15, dur: d.boltTime, kind: 'bolt', ejected: false };
    } else if (d.id === 'shotgun') {
      this.cycle = { t: -0.1, dur: d.pumpTime, kind: 'pump', ejected: false };
    } else {
      this.ejectBrass();
    }
  }

  traceBullet(origin, dir, d) {
    this.raycaster.set(origin, dir);
    const hits = this.raycaster.intersectObjects(this.shootables, false);
    let power = d.pen;
    let dmgScale = 1;
    let last = null;
    for (const h of hits) {
      const surf = h.object.userData.surface || 'dirt';
      const normal = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : dir.clone().negate();
      if (normal.dot(dir) > 0) normal.negate();
      const dist = h.distance;
      last = h;

      const t = h.object.userData.target;
      if (t) {
        const zone = h.object.userData.zone;
        const f = d.falloff;
        const fall = dist <= f.start ? 1 : dist >= f.end ? f.min : 1 - (1 - f.min) * (dist - f.start) / (f.end - f.start);
        const zoneMult = zone === 'head' ? d.headMult : zone === 'legs' ? 0.75 : 1;
        const dmg = Math.round(d.damage * fall * zoneMult * dmgScale);
        const res = this.targets.hit(t, zone, dmg, dist);
        this.effects.impact('steel', h.point, normal, dist, { decalOn: h.object });
        if (res.counted) {
          const head = zone === 'head';
          this.hud.hitmarker(head, res.killed);
          this.hud.damageNumber(h.point, dmg, head);
          this.audio.hitmarker(head);
          if (head) this.stats.headshots++;
          this.stats.longest = Math.max(this.stats.longest, dist);
          if (res.killed) {
            this.stats.downs++;
            this.hud.feed(`${head ? 'HEADSHOT' : t.type === 'plate' ? 'PLATE DOWN' : 'TARGET DOWN'} · ${dist.toFixed(0)} m`, head);
          }
        }
        return { point: h.point, target: t };
      }

      this.effects.impact(surf, h.point, normal, dist);
      if (h.object.userData.penetrable && power >= 1) {
        power -= 1;
        dmgScale *= 0.6;
        continue; // bullet punches through thin wood / plastic
      }
      return { point: h.point };
    }
    return last ? { point: last.point } : null;
  }

  muzzleWorldPos() {
    this.holder.updateMatrixWorld(true);
    const local = this.cur.model.muzzle.getWorldPosition(new THREE.Vector3()); // in weapon-camera space
    // Viewmodel uses a narrower FOV – pull the point toward the view axis a bit.
    local.x *= 0.8; local.y *= 0.8;
    return this.camera.localToWorld(local);
  }

  ejectBrass(kind) {
    const d = this.def;
    this.holder.updateMatrixWorld(true);
    const local = this.cur.model.eject.getWorldPosition(new THREE.Vector3());
    const world = this.camera.localToWorld(local);
    const shellKind = kind || { pistol: 'pistol', smg: 'pistol', rifle: 'rifle', lmg: 'rifle', sniper: 'big', shotgun: 'shotgun' }[d.id];
    this.effects.ejectShell(world, this.camera.getWorldQuaternion(tmpQ), shellKind, d.id === 'shotgun' ? 0.7 : 1);
  }

  startReload() {
    const d = this.def, s = this.cur;
    if (this.reload || this.switching.t < 1 || s.ammo >= d.mag || s.reserve <= 0) return;
    if (this.cycle && this.cycle.kind === 'bolt') return;
    const empty = s.ammo === 0;
    if (d.shellReload) {
      this.reload = { t: 0, dur: 0.35, stage: 0, shell: true, empty };
    } else {
      this.reload = { t: 0, dur: empty ? d.reloadEmpty : d.reload, stage: 0, empty };
    }
    this.hud.reloadStarted(this.reload.dur);
  }

  updateReload(dt) {
    const r = this.reload;
    const target = r ? 1 : 0;
    this.reloadPose += (target - this.reloadPose) * Math.min(1, dt * 7);
    if (!r) return;
    const d = this.def, s = this.cur, mdl = s.model;
    r.t += dt;
    const k = r.t / r.dur;

    if (r.shell) {
      // shotgun: insert shells one at a time
      const per = d.reload;
      if (r.stage === 0 && r.t >= r.dur) { r.stage = 1; r.t = 0; r.dur = per; }
      if (r.stage >= 1) {
        mdl.mag.visible = true;
        const t = r.t / per;
        mdl.mag.position.set(0.0, -0.06 + t * 0.06, 0.04 - t * 0.06);
        if (r.t >= per) {
          s.ammo++; s.reserve--;
          this.audio.mech('shell');
          r.t = 0;
          if (s.ammo >= d.mag || s.reserve <= 0) {
            mdl.mag.visible = false;
            this.reload = null;
            if (r.empty) this.cycle = { t: 0, dur: d.pumpTime, kind: 'pump', ejected: true };
          }
        }
      }
      this.hud.reloadProgress(s.ammo / d.mag);
      return;
    }

    // magazine weapons
    if (mdl.mag && mdl.magHome) {
      let drop = 0;
      if (k > 0.2 && k < 0.62) drop = Math.min(1, (k - 0.2) / 0.12);
      else if (k >= 0.62) drop = Math.max(0, 1 - (k - 0.62) / 0.1);
      mdl.mag.position.copy(mdl.magHome).add(tmpV.set(0, -0.28 * drop, 0.05 * drop));
      mdl.mag.visible = drop < 0.95;
    }
    if (r.stage === 0 && k > 0.2) { r.stage = 1; this.audio.mech('magOut'); }
    if (r.stage === 1 && k > 0.66) { r.stage = 2; this.audio.mech('magIn'); }
    if (r.stage === 2 && r.empty && k > 0.86) { r.stage = 3; this.audio.mech('bolt'); }
    this.hud.reloadProgress(k);
    if (r.t >= r.dur) {
      const need = d.mag - s.ammo;
      const take = Math.min(need, s.reserve);
      s.ammo += take; s.reserve -= take;
      if (mdl.mag && mdl.magHome) { mdl.mag.position.copy(mdl.magHome); mdl.mag.visible = true; }
      this.reload = null;
      this.hud.reloadDone();
    }
  }

  updateCycle(dt) {
    const c = this.cycle;
    const mdl = this.cur.model;
    if (!c) {
      if (mdl.bolt) mdl.bolt.position.z = 0, mdl.bolt.rotation.z = 0;
      if (mdl.pump) mdl.pump.position.z = 0;
      return;
    }
    c.t += dt;
    const k = Math.max(0, c.t / c.dur);
    if (c.kind === 'bolt' && mdl.bolt) {
      // lift → pull back → push forward → lock down
      const lift = k < 0.2 ? k / 0.2 : k > 0.8 ? (1 - k) / 0.2 : 1;
      const back = k < 0.2 ? 0 : k < 0.45 ? (k - 0.2) / 0.25 : k < 0.65 ? 1 - (k - 0.45) / 0.2 : 0;
      mdl.bolt.rotation.z = lift * 0.9;
      mdl.bolt.position.z = back * 0.09;
      if (k > 0.05 && !c.sound1) { c.sound1 = true; this.audio.mech('bolt'); }
      if (k > 0.42 && !c.ejected) { c.ejected = true; this.ejectBrass('big'); }
    } else if (c.kind === 'pump' && mdl.pump) {
      const back = k < 0.45 ? ease(k / 0.45) : 1 - ease((k - 0.45) / 0.55);
      mdl.pump.position.z = back * 0.085;
      if (k > 0.02 && !c.sound1) { c.sound1 = true; this.audio.mech('pump'); }
      if (k > 0.4 && !c.ejected) { c.ejected = true; this.ejectBrass('shotgun'); }
    }
    if (c.t >= c.dur) this.cycle = null;
  }

  updateSwitch(dt) {
    const s = this.switching;
    if (s.t >= 1) return;
    s.t = Math.min(1, s.t + dt / s.dur);
    if (s.phase === 'lower' && s.t >= 1) {
      this.cur.model.group.visible = false;
      this.cur.flash.visible = false;
      this.prevIndex = this.index;
      this.index = s.target;
      this.cur = this.slots[this.index];
      this.cur.model.group.visible = true;
      this.ads = 0;
      this.bloom = 0;
      this.switching = { t: 0, phase: 'raise', target: null, dur: this.def.drawTime };
      this.audio.mech(this.def.id === 'sniper' ? 'bolt' : 'magIn');
      this.hud.weaponChanged(this.def);
    }
  }

  updateScope(dt, input) {
    const b = this.breath;
    const p = this.player;
    if (this.scoped) {
      const wantHold = input.down('ShiftLeft') && b.exhausted <= 0 && b.stamina > 0;
      b.held = wantHold;
      if (b.held) {
        b.stamina -= dt / 4.5;
        if (b.stamina <= 0) { b.exhausted = 2.5; b.held = false; }
      } else b.stamina = Math.min(1, b.stamina + dt / 3);
      if (b.exhausted > 0) b.exhausted -= dt;
      const amp = (b.held ? 0.08 : b.exhausted > 0 ? 1.8 : 1) * (p.crouching ? 0.55 : 1) * (1 + Math.min(2, p.speed / 2));
      const t = this.time;
      const tx = (Math.sin(t * 0.9) * 0.6 + Math.sin(t * 2.3 + 1) * 0.25) * amp;
      const ty = (Math.sin(t * 1.3 + 2) * 0.5 + Math.cos(t * 0.7) * 0.4) * amp;
      this.scopeSway.x += (tx * 0.0035 - this.scopeSway.x) * Math.min(1, dt * 6);
      this.scopeSway.y += (ty * 0.0035 - this.scopeSway.y) * Math.min(1, dt * 6);
    } else {
      b.held = false;
      b.stamina = Math.min(1, b.stamina + dt / 3);
      if (b.exhausted > 0) b.exhausted -= dt;
      this.scopeSway.multiplyScalar(Math.max(0, 1 - dt * 8));
    }
  }

  updatePose() {
    const mdl = this.cur.model;
    const p = this.player;
    const a = ease(this.ads);
    const hip = mdl.hip, ads = mdl.ads;
    const pos = new THREE.Vector3(
      hip[0] + (ads[0] - hip[0]) * a,
      hip[1] + (-mdl.sightY - hip[1]) * a,
      hip[2] + (ads[2] - hip[2]) * a,
    );
    const rot = new THREE.Euler(0, 0, 0);

    // bob
    const bob = p.bobAmount * (1 - a * 0.85);
    const ph = p.bobPhase;
    pos.x += Math.sin(ph) * 0.011 * bob;
    pos.y += -Math.abs(Math.cos(ph)) * 0.012 * bob;
    rot.z += Math.sin(ph) * 0.012 * bob;

    // idle breathing
    const breathe = (1 - a * 0.9) * 0.0025;
    pos.y += Math.sin(this.time * 1.6) * breathe;
    rot.x += Math.sin(this.time * 1.6 + 0.6) * breathe * 0.6;

    // sway from mouse
    const sw = 1 - a * 0.7;
    pos.x += this.sway.x * 0.02 * sw;
    pos.y += this.sway.y * 0.02 * sw;
    rot.y += this.sway.x * 0.05 * sw;
    rot.x += this.sway.y * 0.05 * sw;
    rot.z += this.sway.x * 0.04 * sw;

    // recoil punch
    pos.z += this.kick.z;
    rot.x += this.kick.rx;
    rot.y += this.kick.ry;

    // landing dip
    pos.y += p.landDip * 0.25;

    // sprint pose
    const sp = ease(this.sprintBlend);
    pos.x += -0.04 * sp; pos.y += -0.04 * sp; pos.z += 0.03 * sp;
    rot.x += -0.25 * sp; rot.y += 0.65 * sp; rot.z += 0.2 * sp;

    // reload pose: tilt the gun to present the magazine well
    const rp = ease(this.reloadPose);
    rot.z += 0.45 * rp; rot.x += 0.18 * rp; pos.y -= 0.03 * rp; pos.x -= 0.02 * rp;

    // bolt / pump: small lift of the gun
    if (this.cycle) {
      const k = Math.max(0, this.cycle.t / this.cycle.dur);
      const w = Math.sin(Math.PI * Math.min(1, k));
      rot.z += 0.12 * w * (1 - a * 0.6);
      pos.y -= 0.01 * w;
    }

    // switching
    const s = this.switching;
    const sw2 = s.phase === 'lower' ? ease(s.t) : 1 - ease(s.t);
    pos.y -= 0.3 * sw2;
    rot.x -= 0.6 * sw2;

    // crouch: slight cant
    rot.z += 0.04 * p.crouch * (1 - a);

    this.holder.position.copy(pos);
    this.holder.rotation.copy(rot);
    this.holder.visible = !this.scoped;
  }
}
