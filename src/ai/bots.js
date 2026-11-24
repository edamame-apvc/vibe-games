import * as THREE from 'three';
import { createMercenary } from './botModel.js';
import { WEAPON_BY_ID } from '../weapons/data.js';
import { mulberry32 } from '../noise.js';

// Mercenary AI. States: patrol → (hear / see) → hunt → combat ⇄ cover → dead.

export const DIFFICULTY = {
  recruit: { label: 'Recruit', reaction: [0.9, 1.5], spread: 1.7, damage: 0.55, see: 0.7, rate: 0.75, hp: 90 },
  regular: { label: 'Regular', reaction: [0.5, 0.9], spread: 1.0, damage: 0.9, see: 1.0, rate: 1.0, hp: 100 },
  veteran: { label: 'Veteran', reaction: [0.25, 0.5], spread: 0.65, damage: 1.2, see: 1.3, rate: 1.15, hp: 115 },
};

const LOADOUTS = [
  { weapon: 'rifle', chance: 0.55, dmg: 19, rpm: 600, burst: [3, 6], range: 90 },
  { weapon: 'smg', chance: 0.3, dmg: 14, rpm: 780, burst: [4, 8], range: 40 },
  { weapon: 'lmg', chance: 0.15, dmg: 21, rpm: 640, burst: [6, 12], range: 100 },
];

const EYE = 1.6, EYE_CROUCH = 1.05, RADIUS = 0.35;
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
const gauss = (r) => { let s = 0; for (let i = 0; i < 3; i++) s += r() * 2 - 1; return s / 1.7; };

export class BotManager {
  constructor({ scene, world, nav, player, camera, effects, audio, hud, shootables, difficulty = 'regular', onPlayerHit, onKill }) {
    Object.assign(this, { scene, world, nav, player, camera, effects, audio, hud, shootables, onPlayerHit, onKill });
    this.diff = DIFFICULTY[difficulty] || DIFFICULTY.regular;
    this.bots = [];
    this.rand = mulberry32(Date.now() & 0xffff);
    this.ray = new THREE.Raycaster();
    this.ray.firstHitOnly = true;
    this.staticMeshes = world.shootables;
    this.time = 0;
  }

  removeAll() {
    for (const b of this.bots) {
      this.scene.remove(b.model.root);
      for (const m of b.model.meshes) { const i = this.shootables.indexOf(m); if (i >= 0) this.shootables.splice(i, 1); }
    }
    this.bots = [];
  }

  groundY(x, z) { return this.world.groundAt ? this.world.groundAt(x, z) : 0; }

  get alive() { return this.bots.filter((b) => !b.dead).length; }
  get total() { return this.bots.length; }

  /** Line of sight against the static world (not bots). */
  clear(from, to) {
    tmp.subVectors(to, from);
    const d = tmp.length();
    if (d < 0.01) return true;
    this.ray.set(from, tmp.divideScalar(d));
    this.ray.far = d - 0.05;
    return this.ray.intersectObjects(this.staticMeshes, false).length === 0;
  }

  spawn(count) {
    const r = this.rand;
    const pHead = this.player.pos.clone().add(new THREE.Vector3(0, EYE, 0));
    for (let i = 0; i < count; i++) {
      let p = null;
      for (let tries = 0; tries < 300 && !p; tries++) {
        const [x, z] = this.nav.randomPoint(r);
        const c = new THREE.Vector3(x, this.groundY(x, z), z);
        const far = c.distanceTo(this.player.pos) > (tries < 200 ? 45 : 25);
        const spaced = this.bots.every((b) => b.pos.distanceTo(c) > (tries < 150 ? 8 : 3));
        const hidden = tries > 250 || !this.clear(c.clone().setY(c.y + EYE), pHead);
        if (far && spaced && hidden) p = c;
      }
      if (!p) continue;
      this.add(p, i);
    }
  }

  add(pos, i) {
    const model = createMercenary(i);
    const r = this.rand();
    let acc = 0, loadout = LOADOUTS[0];
    for (const l of LOADOUTS) { acc += l.chance; if (r <= acc) { loadout = l; break; } }
    const bot = {
      type: 'bot', surface: 'flesh', owner: this, model, pos: pos.clone(), yaw: this.rand() * Math.PI * 2, vel: new THREE.Vector3(),
      hp: this.diff.hp, dead: false, deadT: 0, deadDir: 1, state: 'patrol', path: null, pathIdx: 0, idle: this.rand() * 3,
      aware: 0, lastKnown: null, lastSeen: -99, sees: false, losTimer: this.rand() * 0.2, react: 0, track: 0,
      burst: 0, fireTimer: 0, coverTimer: 0, crouch: 0, crouchTarget: 0, phase: this.rand() * 6, speed: 0,
      loadout, sound: WEAPON_BY_ID[loadout.weapon].sound, stuck: 0, lastPos: pos.clone(), stepAcc: 0, shots: 0, strafe: 0, strafeTimer: 0,
    };
    for (const m of model.meshes) { m.userData.target = bot; this.shootables.push(m); }
    model.root.position.copy(pos);
    this.scene.add(model.root);
    this.bots.push(bot);
    return bot;
  }

  // ── events ──
  alertShot(origin, loud = 1) {
    for (const b of this.bots) {
      if (b.dead) continue;
      const d = b.pos.distanceTo(origin);
      if (d > 140 * loud) continue;
      const err = Math.min(12, d * 0.12);
      if (b.state === 'patrol' || b.state === 'hunt') {
        b.lastKnown = origin.clone().add(new THREE.Vector3((this.rand() - 0.5) * err, 0, (this.rand() - 0.5) * err));
        b.lastKnown.y = 0;
        b.aware = Math.max(b.aware, 0.55);
        if (b.state === 'patrol') { b.state = 'hunt'; b.path = null; }
      }
    }
  }

  hit(bot, zone, dmg, dist, dir) {
    if (bot.dead) return { counted: false };
    bot.hp -= dmg;
    bot.aware = 1;
    bot.lastKnown = this.player.pos.clone();
    if (bot.state !== 'combat' && bot.state !== 'cover') { bot.state = 'combat'; bot.react = 0.25 + this.rand() * 0.3; }
    bot.yaw += (this.rand() - 0.5) * 0.25; // flinch
    if (bot.hp <= 0) {
      this.kill(bot, dir, zone === 'head');
      return { counted: true, killed: true };
    }
    return { counted: true, killed: false };
  }

  kill(bot, dir, head) {
    bot.dead = true;
    const fwd = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    bot.deadDir = dir && dir.dot(fwd) > 0 ? -1 : 1; // shot from behind → falls forward
    for (const m of bot.model.meshes) {
      const i = this.shootables.indexOf(m);
      if (i >= 0) this.shootables.splice(i, 1);
    }
    this.onKill?.(bot, head);
  }

  explosion(pos, radius, clearLine) {
    const out = [];
    for (const b of this.bots) {
      if (b.dead) continue;
      const point = b.pos.clone().add(new THREE.Vector3(0, 1, 0));
      const d = point.distanceTo(pos);
      if (d > radius) continue;
      let dmg = Math.round(200 * Math.pow(1 - d / radius, 1.2));
      if (!clearLine(pos.clone().add(new THREE.Vector3(0, 0.2, 0)), point)) dmg = Math.round(dmg * 0.25);
      if (dmg < 5) continue;
      const r = this.hit(b, 'torso', dmg, d, point.clone().sub(pos).normalize());
      out.push({ ...r, damage: dmg, point });
    }
    return out;
  }

  // ── per-frame ──
  update(dt) {
    this.time += dt;
    const p = this.player;
    const pHead = this.camera.getWorldPosition(new THREE.Vector3());
    const pChest = p.pos.clone().add(new THREE.Vector3(0, p.crouching ? 0.8 : 1.2, 0));
    const pMoving = p.speed > 1.5;
    let pathBudget = 3;

    for (const b of this.bots) {
      if (b.dead) {
        b.deadT += dt;
        const k = Math.min(1, b.deadT / 0.65);
        b.model.pose({ phase: b.phase, speed: 0, crouch: b.crouch * (1 - k), aimPitch: 0, dead: k * k, deadDir: b.deadDir });
        continue;
      }

      const toP = tmp2.subVectors(p.pos, b.pos);
      const dist = toP.length();
      const eye = b.pos.clone().setY(b.pos.y + (b.crouch > 0.5 ? EYE_CROUCH : EYE));

      // ── perception (throttled) ──
      b.losTimer -= dt;
      if (b.losTimer <= 0) {
        const window = 0.18;
        b.losTimer = window;
        const fwd = new THREE.Vector3(-Math.sin(b.yaw), 0, -Math.cos(b.yaw));
        const dir = toP.clone().setY(0).normalize();
        const inCone = fwd.dot(dir) > Math.cos((b.state === 'patrol' ? 65 : 110) * Math.PI / 180) || dist < 5;
        const range = 150 * this.diff.see;
        b.sees = p.alive !== false && dist < range && inCone && (this.clear(eye, pHead) || this.clear(eye, pChest));
        if (b.sees) {
          let rate = Math.max(0.25, 1.7 - dist / 90) * this.diff.see;
          if (p.crouching) rate *= 0.6;
          if (pMoving) rate *= 1.35;
          if (b.state !== 'patrol') rate *= 3;
          if (dist < 6) rate = 20;
          b.aware = Math.min(1, b.aware + rate * window);
          if (b.aware >= 1) {
            b.lastKnown = p.pos.clone();
            b.lastSeen = this.time;
            if (b.state !== 'combat' && b.state !== 'cover') {
              b.state = 'combat';
              b.react = this.diff.reaction[0] + this.rand() * (this.diff.reaction[1] - this.diff.reaction[0]);
              b.crouchTarget = dist > 30 && this.rand() < 0.4 ? 1 : 0;
              b.track = 0;
            }
          }
        } else if (b.state === 'patrol') {
          b.aware = Math.max(0, b.aware - 0.1 * window);
        }
      }
      if (b.sees && b.aware >= 1) { b.track += dt; b.lastKnown.copy(p.pos); b.lastSeen = this.time; } else b.track = 0;

      // ── decisions ──
      let speed = 0, face = null;
      if (b.state === 'combat') {
        face = p.pos;
        if (!b.sees && this.time - b.lastSeen > 1.6) { b.state = 'hunt'; b.path = null; }
        else {
          if (b.sees) this.shooting(b, dt, dist, pChest, pMoving);
          // hurt or exposed at range → look for cover
          if ((b.hp < this.diff.hp * 0.5 && this.rand() < dt * 0.8) || (this.rand() < dt * 0.06)) this.findCover(b, pHead);
          // small strafes keep them from being statues
          b.strafeTimer -= dt;
          if (b.strafeTimer <= 0) { b.strafe = b.crouchTarget ? 0 : (this.rand() - 0.5) * 2; b.strafeTimer = 1 + this.rand() * 1.5; }
          if (b.strafe) {
            const side = new THREE.Vector3(toP.z, 0, -toP.x).normalize().multiplyScalar(Math.sign(b.strafe));
            const tgt = b.pos.clone().addScaledVector(side, 1);
            if (this.nav.walkableAt(tgt.x, tgt.z)) { b.vel.lerp(side.multiplyScalar(1.6), Math.min(1, dt * 5)); speed = 1.6; }
          }
        }
      } else if (b.state === 'cover') {
        speed = 4.2;
        if (this.followPath(b, dt, speed)) {
          b.crouchTarget = 1;
          b.coverTimer -= dt;
          speed = 0;
          if (b.coverTimer <= 0) { b.state = 'combat'; b.crouchTarget = 0; b.react = 0.3; }
          face = b.lastKnown;
        }
        if (b.sees && b.path && b.pathIdx >= b.path.length) face = p.pos;
      } else if (b.state === 'hunt') {
        speed = 3.6;
        b.crouchTarget = 0;
        if (!b.path && pathBudget > 0 && b.lastKnown) { pathBudget--; this.pathTo(b, b.lastKnown); }
        if (b.path && this.followPath(b, dt, speed)) {
          speed = 0;
          b.idle -= dt;
          b.yaw += dt * 1.2; // look around
          if (b.idle <= -3.5) { b.state = 'patrol'; b.aware = 0.4; b.idle = 2; b.path = null; }
        }
        if (!b.path && !b.lastKnown) b.state = 'patrol';
      } else { // patrol
        speed = 1.7;
        b.crouchTarget = 0;
        if (!b.path) {
          b.idle -= dt;
          speed = 0;
          if (b.idle <= 0 && pathBudget > 0) {
            pathBudget--;
            let goal = null;
            for (let k = 0; k < 10 && !goal; k++) {
              const [x, z] = this.nav.randomPoint(this.rand);
              if (Math.hypot(x - b.pos.x, z - b.pos.z) < 45) goal = new THREE.Vector3(x, 0, z);
            }
            if (goal) this.pathTo(b, goal);
            b.idle = 2 + this.rand() * 4;
          }
        } else if (this.followPath(b, dt, speed)) { b.path = null; speed = 0; }
      }

      // ── movement ──
      if (speed === 0 && !(b.state === 'combat' && b.strafe)) b.vel.multiplyScalar(Math.max(0, 1 - dt * 8));
      // separation
      for (const o of this.bots) {
        if (o === b || o.dead) continue;
        const dx = b.pos.x - o.pos.x, dz = b.pos.z - o.pos.z, d = Math.hypot(dx, dz);
        if (d < 1.1 && d > 1e-3) { b.pos.x += (dx / d) * (1.1 - d) * 0.5; b.pos.z += (dz / d) * (1.1 - d) * 0.5; }
      }
      b.pos.addScaledVector(b.vel, dt);
      this.world.collision?.resolve(b.pos, RADIUS, 1.8);
      const B = this.world.bounds;
      b.pos.x = Math.max(B.minX, Math.min(B.maxX, b.pos.x));
      b.pos.z = Math.max(B.minZ, Math.min(B.maxZ, b.pos.z));
      b.pos.y = this.groundY(b.pos.x, b.pos.z);
      b.speed = Math.hypot(b.vel.x, b.vel.z);

      // stuck → re-path
      b.stuck += dt;
      if (b.stuck > 1.2) {
        if (b.path && b.pos.distanceTo(b.lastPos) < 0.4) { b.path = null; if (b.state === 'cover') b.state = 'combat'; }
        b.stuck = 0; b.lastPos.copy(b.pos);
      }

      // facing
      let targetYaw = b.yaw;
      if (face) targetYaw = Math.atan2(-(face.x - b.pos.x), -(face.z - b.pos.z));
      else if (b.speed > 0.3) targetYaw = Math.atan2(-b.vel.x, -b.vel.z);
      let dy = targetYaw - b.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      b.yaw += Math.sign(dy) * Math.min(Math.abs(dy), dt * 7);

      // footsteps you can hear
      if (b.speed > 1) {
        b.stepAcc += b.speed * dt;
        if (b.stepAcc > (b.speed > 3 ? 2.2 : 1.6)) { b.stepAcc = 0; if (dist < 26) this.audio.footstepAt?.(dist, this.panOf(b.pos), b.speed); }
      }

      // animation
      b.crouch += (b.crouchTarget - b.crouch) * Math.min(1, dt * 6);
      b.phase += b.speed * dt * 2.3;
      const aimPitch = b.state === 'combat' || b.state === 'cover' ? Math.atan2(pChest.y - (b.pos.y + 1.4), Math.max(1, dist)) : 0;
      b.model.root.position.copy(b.pos);
      b.model.root.rotation.y = b.yaw;
      b.model.pose({ phase: b.phase, speed: b.speed, crouch: b.crouch, aimPitch: -aimPitch, dead: 0, deadDir: 1 });
    }
  }

  pathTo(b, goal) {
    const path = this.nav.findPath(b.pos.x, b.pos.z, goal.x, goal.z);
    b.path = path;
    b.pathIdx = 1;
    b.idle = 0;
    if (!path) b.lastKnown = null;
  }

  /** Steer along the path. Returns true when the end is reached. */
  followPath(b, dt, speed) {
    if (!b.path) return true;
    if (b.pathIdx >= b.path.length) return true;
    const [tx, tz] = b.path[b.pathIdx];
    const dx = tx - b.pos.x, dz = tz - b.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.6) { b.pathIdx++; return b.pathIdx >= b.path.length; }
    const want = new THREE.Vector3(dx / d * speed, 0, dz / d * speed);
    b.vel.lerp(want, Math.min(1, dt * 6));
    return false;
  }

  findCover(b, pHead) {
    let best = null, bestD = Infinity;
    for (let k = 0; k < 18; k++) {
      const a = this.rand() * Math.PI * 2, r = 3 + this.rand() * 11;
      const x = b.pos.x + Math.cos(a) * r, z = b.pos.z + Math.sin(a) * r;
      if (!this.nav.walkableAt(x, z)) continue;
      const low = new THREE.Vector3(x, this.groundY(x, z) + EYE_CROUCH, z);
      if (this.clear(low, pHead)) continue; // still exposed when crouched
      const d = Math.hypot(x - b.pos.x, z - b.pos.z);
      if (d < bestD) { bestD = d; best = new THREE.Vector3(x, 0, z); }
    }
    if (best) {
      this.pathTo(b, best);
      if (b.path) { b.state = 'cover'; b.coverTimer = 1.5 + this.rand() * 2; b.burst = 0; }
    }
  }

  shooting(b, dt, dist, pChest, pMoving) {
    if (b.react > 0) { b.react -= dt; return; }
    b.fireTimer -= dt;
    if (b.fireTimer > 0) return;
    if (b.burst <= 0) {
      const [a, c] = b.loadout.burst;
      b.burst = a + Math.floor(this.rand() * (c - a + 1));
    }
    this.fire(b, dist, pChest, pMoving);
    b.burst--;
    b.fireTimer = b.burst > 0 ? (60 / b.loadout.rpm) / this.diff.rate : 0.35 + this.rand() * 0.8;
  }

  fire(b, dist, pChest, pMoving) {
    const p = this.player;
    b.model.root.updateMatrixWorld(true);
    const muzzle = b.model.muzzle.getWorldPosition(new THREE.Vector3());
    const trackF = 1 + 1.2 * Math.max(0, 1 - b.track / 1.5);
    const sigma = (0.22 + dist * 0.011) * this.diff.spread * (pMoving ? 1.4 : 1) * (b.speed > 0.5 ? 1.7 : 1) * (p.crouching ? 0.85 : 1) * trackF;
    const aim = pChest.clone().add(new THREE.Vector3(gauss(this.rand) * sigma, gauss(this.rand) * sigma * 0.8, gauss(this.rand) * sigma));
    const dir = aim.sub(muzzle).normalize();

    // does the ray pass through the player's capsule?
    const ox = muzzle.x - p.pos.x, oz = muzzle.z - p.pos.z;
    const dxz2 = dir.x * dir.x + dir.z * dir.z || 1e-6;
    const t = -(ox * dir.x + oz * dir.z) / dxz2;
    const cx = ox + dir.x * t, cz = oz + dir.z * t;
    const closest = Math.hypot(cx, cz);
    const yAt = muzzle.y + dir.y * t;
    const height = p.crouching ? 1.25 : 1.8;
    const hitsPlayer = t > 0 && closest < 0.34 && yAt > p.pos.y && yAt < p.pos.y + height;

    this.ray.set(muzzle, dir);
    this.ray.far = hitsPlayer ? t : 200;
    const wall = this.ray.intersectObjects(this.staticMeshes, false)[0];
    let end;
    if (hitsPlayer && !wall) {
      end = muzzle.clone().addScaledVector(dir, t);
      const head = yAt > p.pos.y + height - 0.28;
      const fall = dist > b.loadout.range ? 0.7 : 1;
      this.onPlayerHit?.(Math.round(b.loadout.dmg * this.diff.damage * fall * (head ? 1.8 : 1)), b.pos.clone(), head);
    } else if (wall) {
      end = wall.point;
      const n = wall.face ? wall.face.normal.clone().transformDirection(wall.object.matrixWorld) : dir.clone().negate();
      if (n.dot(dir) > 0) n.negate();
      this.effects.impact(wall.object.userData.surface || 'concrete', wall.point, n, this.camera.position.distanceTo(wall.point));
    } else end = muzzle.clone().addScaledVector(dir, 200);
    if (!hitsPlayer && t > 0 && closest < 2.5 && yAt > p.pos.y - 0.5 && yAt < p.pos.y + 2.8) this.audio.crack?.(this.panOf(b.pos));

    // muzzle flash, tracer, sound
    this.effects.sparks.spawn({ p: muzzle.clone(), vel: dir.clone().multiplyScalar(2), life: 0.05, size: 0.35, alpha: 1, color: new THREE.Color(6, 3.5, 1.5) });
    if (++b.shots % 3 === 0) this.effects.tracer(muzzle, end, 760);
    this.audio.gunshotAt?.(b.sound, dist, this.panOf(b.pos));
  }

  panOf(pos) {
    const cam = this.camera;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const to = pos.clone().sub(cam.position).normalize();
    return Math.max(-1, Math.min(1, right.dot(to)));
  }
}
