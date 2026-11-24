import * as THREE from 'three';
import { weaponMaterials } from './models.js';

// Fragmentation grenades: hold G to pull the pin and cook, release to throw.
// Hold right mouse while releasing for a short underhand lob.

const FUSE = 3.5;          // seconds from pin pull to detonation
const MAX_GRENADES = 3;
const LETHAL_RADIUS = 7;   // full damage falls off to zero at this distance
const RADIUS = 0.04;
const D2R = Math.PI / 180;

function grenadeMesh(m) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4b5233, roughness: 0.6, metalness: 0.2 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.032, 18, 14), bodyMat);
  body.scale.set(1, 1.2, 1);
  g.add(body);
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.03, 12), m.steel);
  fuse.position.y = 0.045;
  g.add(fuse);
  const spoon = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.075, 0.006), m.steel);
  spoon.position.set(0, 0.022, 0.034);
  spoon.rotation.x = -0.12;
  g.add(spoon);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0022, 6, 16), m.steel);
  ring.position.set(0.02, 0.058, 0);
  ring.rotation.y = Math.PI / 2;
  ring.name = 'ring';
  g.add(ring);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export class GrenadeSystem {
  constructor({ scene, weaponScene, camera, player, effects, audio, hud, targets, shootables, ws, stats, onExplosion }) {
    Object.assign(this, { scene, camera, player, effects, audio, hud, targets, shootables, ws, stats, onExplosion });
    this.count = MAX_GRENADES;
    this.live = [];
    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true;
    this.state = 'idle';   // idle → raise → cook → throw → recover
    this.t = 0;
    this.fuseLeft = 0;
    this.pinPulled = false;
    this.underhand = false;

    const m = weaponMaterials();
    this.template = grenadeMesh(m);

    // viewmodel: gloved hand holding a grenade
    this.hand = new THREE.Group();
    // fingers wrap the lower half of the grenade, thumb holds the spoon
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.07), m.glove);
    palm.position.set(0.012, -0.035, 0.015);
    const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.03, 0.045), m.glove);
    fingers.position.set(-0.006, -0.012, -0.03);
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.045, 0.018), m.glove);
    thumb.position.set(0.018, 0.012, 0.03);
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.034, 0.32, 4, 10), m.sleeve);
    sleeve.position.set(0.04, -0.13, 0.19);
    sleeve.rotation.set(1.1, 0, -0.25);
    const glove = new THREE.Group();
    glove.add(palm, fingers, thumb);
    this.handGrenade = this.template.clone(true);
    this.handGrenade.position.set(0, 0.02, -0.025);
    this.hand.add(glove, sleeve, this.handGrenade);
    this.hand.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
    this.hand.visible = false;
    weaponScene.add(this.hand);
  }

  get busy() { return this.state !== 'idle'; }

  restock() { this.count = MAX_GRENADES; }

  update(dt, input) {
    // ── state machine ──
    // idle → raise (G) → ready (grenade in hand) → cook (hold LMB / RMB, pin pulled)
    //      → throw (release) → recover → idle.   G again / weapon keys in "ready" = put away.
    this.t += dt;
    const pressG = input.hit('KeyG');
    const pressQ = input.hit('KeyQ');
    const switchKey = input.mouse.wheel !== 0 ||
      ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'].some((k) => input.hit(k));

    const wantGrenade = pressG || (pressQ && this.ws.qToGrenade);
    if (this.state === 'idle' && wantGrenade) {
      if (this.count > 0 && this.ws.switching.t >= 1) {
        this.state = 'raise'; this.t = 0; this.pinPulled = false;
        this.ws.reload = null;
        this.audio.mech('switch');
      } else if (this.count === 0) this.hud.toast('No grenades — press T to restock');
    } else if ((this.state === 'raise' || this.state === 'ready') && (pressG || pressQ || switchKey)) {
      this.state = 'putaway'; this.t = 0;                      // changed your mind
      this.ws.qToGrenade = true;   // grenade was the last thing held, so Q brings it back out
    }

    if (this.state === 'raise' && this.t > 0.3) { this.state = 'ready'; this.t = 0; }
    if (this.state === 'putaway' && this.t > 0.25) this.state = 'idle';

    if (this.state === 'ready' && (input.mouse.leftPressed || input.mouse.rightPressed)) {
      this.underhand = input.mouse.rightPressed && !input.mouse.leftPressed;
      this.throwButton = this.underhand ? 'right' : 'left';
      this.state = 'cook'; this.t = 0;
      this.pinPulled = true;
      this.fuseLeft = FUSE;
      this.audio.mech('pin');
      this.handGrenade.getObjectByName('ring').visible = false;
    }
    if (this.pinPulled && this.state === 'cook') {
      this.fuseLeft -= dt;
      if (this.fuseLeft <= 0) {
        // held too long – it goes off in your hand
        this.count--;
        const p = this.camera.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.3, 0));
        this.explode(p, new THREE.Vector3(0, 1, 0));
        this.state = 'recover'; this.t = 0;
        this.hud.feed('COOKED TOO LONG', true);
      }
    }
    if (this.state === 'cook' && !input.mouse[this.throwButton]) {
      this.state = 'throw'; this.t = 0; this.thrown = false;
    }
    if (this.state === 'throw') {
      if (!this.thrown && this.t > 0.11) { this.thrown = true; this.launch(); }
      if (this.t > 0.28) { this.state = 'recover'; this.t = 0; }
    }
    if (this.state === 'recover' && this.t > 0.3) {
      this.state = 'idle';
      this.ws.qToGrenade = this.count > 0;
      this.pinPulled = false;
      this.handGrenade.getObjectByName('ring').visible = true;
    }
    this.ws.grenadeBusy = this.state !== 'idle';
    this.animateHand();

    // ── live grenades ──
    for (let i = this.live.length - 1; i >= 0; i--) {
      const g = this.live[i];
      g.fuse -= dt;
      if (g.fuse <= 0) {
        this.explode(g.mesh.position.clone(), g.restNormal || new THREE.Vector3(0, 1, 0));
        this.scene.remove(g.mesh);
        this.live.splice(i, 1);
        continue;
      }
      this.simulate(g, dt);
    }
  }

  launch() {
    const cam = this.camera;
    cam.updateMatrixWorld();
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize();
    const start = cam.getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, 0.4).addScaledVector(right, 0.18);
    start.y -= this.underhand ? 0.35 : 0.05;
    const speed = this.underhand ? 8.5 : 17;
    const vel = fwd.multiplyScalar(speed).add(new THREE.Vector3(0, this.underhand ? 2.2 : 3.2, 0));
    vel.x += this.player.vel.x; vel.z += this.player.vel.z;
    const mesh = this.template.clone(true);
    mesh.getObjectByName('ring').visible = false;
    mesh.position.copy(start);
    this.scene.add(mesh);
    this.live.push({ mesh, vel, fuse: this.fuseLeft, spin: new THREE.Vector3(8 + Math.random() * 6, Math.random() * 4, Math.random() * 3), resting: false });
    this.count--;
    this.stats.grenades = (this.stats.grenades || 0) + 1;
    this.audio.mech('throw');
  }

  simulate(g, dt) {
    if (g.resting) return;
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      g.vel.y -= 9.81 * h;
      g.vel.multiplyScalar(1 - 0.05 * h); // air drag
      const move = g.vel.clone().multiplyScalar(h);
      const len = move.length();
      if (len < 1e-6) continue;
      this.raycaster.set(g.mesh.position, move.clone().divideScalar(len));
      this.raycaster.far = len + RADIUS;
      const hit = this.raycaster.intersectObjects(this.shootables, false)[0];
      if (hit) {
        const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
        if (n.dot(g.vel) > 0) n.negate();
        g.mesh.position.copy(hit.point).addScaledVector(n, RADIUS + 0.002);
        const vn = n.clone().multiplyScalar(g.vel.dot(n));
        const vt = g.vel.clone().sub(vn);
        const impact = vn.length();
        g.vel.copy(vt.multiplyScalar(0.72)).addScaledVector(vn, -0.33);
        g.spin.multiplyScalar(0.6);
        if (impact > 1.2) this.audio.grenadeBounce(Math.min(1, impact / 8), this.camera.position.distanceTo(g.mesh.position));
        if (n.y > 0.7 && g.vel.length() < 0.35) { g.resting = true; g.restNormal = n; g.vel.set(0, 0, 0); break; }
        // rolling friction on the ground
        if (n.y > 0.7 && impact < 1) g.vel.multiplyScalar(1 - 2.5 * h);
      } else {
        g.mesh.position.add(move);
      }
    }
    g.mesh.rotation.x += g.spin.x * dt;
    g.mesh.rotation.y += g.spin.y * dt;
    g.mesh.rotation.z += g.spin.z * dt;
    if (g.mesh.position.y < -5) g.fuse = 0;
  }

  explode(pos, normal) {
    const listener = this.camera.getWorldPosition(new THREE.Vector3());
    const dist = listener.distanceTo(pos);
    this.effects.explosion(pos, normal, dist);
    this.audio.explosion(dist);
    this.onExplosion?.(pos, dist);

    // blast damage to targets (cover between blast and target reduces it)
    const clearLine = (from, to) => {
      const dir = to.clone().sub(from);
      const d = dir.length();
      this.raycaster.set(from, dir.divideScalar(d));
      this.raycaster.far = d - 0.3;
      const hit = this.raycaster.intersectObjects(this.shootables, false)[0];
      return !hit || hit.object.userData.target; // clear, or the first thing hit is a target
    };
    const results = [this.targets, ...(this.extraTargets || [])].filter(Boolean)
      .flatMap((h) => h.explosion(pos, LETHAL_RADIUS, clearLine, listener) || []);
    let downs = 0;
    for (const r of results) {
      if (!r.counted) continue;
      this.hud.damageNumber(r.point, r.damage, false);
      if (r.killed) downs++;
    }
    if (downs) {
      this.stats.downs += downs;
      this.hud.hitmarker(false, true);
      this.hud.feed(`GRENADE · ${downs} DOWN`, false);
    }
  }

  animateHand() {
    const h = this.hand;
    const s = this.state, t = this.t;
    h.visible = s === 'raise' || s === 'ready' || s === 'cook' || s === 'putaway' || (s === 'throw' && !this.thrown);
    if (!h.visible) return;
    // "ready": held low in front, pin still in
    let x = 0.13, y = -0.13, z = -0.4, rx = 0.15, rz = 0;
    const breathe = Math.sin(performance.now() / 600) * 0.003;
    if (s === 'raise') {
      const k = Math.min(1, t / 0.3);
      y = -0.42 + k * 0.29; rx = 0.6 - k * 0.45;
    } else if (s === 'putaway') {
      const k = Math.min(1, t / 0.25);
      y = -0.13 - k * 0.3; rx = 0.15 + k * 0.45;
    } else if (s === 'ready') {
      y += breathe;
    } else if (s === 'cook' && !this.underhand) {
      // drawn back over the shoulder for an overhand throw
      const k = Math.min(1, t / 0.15);
      x = 0.13 + k * 0.04; y = -0.13 + k * 0.03 + breathe; z = -0.4 + k * 0.04; rx = 0.15 - k * 0.3; rz = -0.25 * k;
    } else if (s === 'cook') {
      // held low and back for an underhand lob
      const k = Math.min(1, t / 0.15);
      x = 0.12; y = -0.13 - k * 0.1 + breathe; z = -0.4 + k * 0.06; rx = 0.15 + k * 0.4;
    } else if (s === 'throw') {
      const k = Math.min(1, t / 0.11);
      if (this.underhand) { x = 0.12 - k * 0.06; y = -0.23 + k * 0.12; z = -0.34 - k * 0.25; rx = 0.55 - k * 0.6; }
      else { x = 0.17 - k * 0.1; y = -0.1 + k * 0.07; z = -0.36 - k * 0.25; rx = -0.15 + k * 0.8; }
    }
    h.position.set(x, y - 0.01, z - 0.04);
    h.rotation.set(rx, 0, rz);
    h.scale.setScalar(0.82);
  }

  /** Live grenades for the HUD warning indicators. */
  dangers() { return this.live.map((g) => g.mesh.position); }
}

export { FUSE, MAX_GRENADES, LETHAL_RADIUS, D2R };
