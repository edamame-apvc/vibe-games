import * as THREE from 'three';
import { BOUNDS } from './world.js';

const RADIUS = 0.32;
const STAND_H = 1.8, CROUCH_H = 1.25;
const STAND_EYE = 1.64, CROUCH_EYE = 1.12;
const STEP = 0.42;
const GRAVITY = 13.5;

export class Player {
  constructor(colliders, audio, { collision = null, bounds = BOUNDS, groundAt = null, speedAt = null } = {}) {
    this.colliders = colliders;
    this.groundAt = groundAt; // terrain height (maps with hills); null = flat ground at y 0
    this.speedAt = speedAt;   // movement multiplier, e.g. wading through a river
    this.collision = collision; // polygon/segment world (city maps)
    this.bounds = bounds;
    this.audio = audio;
    this.pos = new THREE.Vector3(0, 0, 4.5);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = true;
    this.crouch = 0;          // 0 standing … 1 crouched (smoothed)
    this.crouching = false;
    this.sprinting = false;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.stepDist = 0;
    this.landDip = 0;
    this.landVel = 0;
    this.speed = 0;
    this.health = 100;
    this.alive = true;
    this.clock = 0;
    this._box = new THREE.Box3();
  }

  get eyeHeight() { return STAND_EYE + (CROUCH_EYE - STAND_EYE) * this.crouch; }
  get height() { return this.crouching ? CROUCH_H : STAND_H; }

  look(dx, dy, sens) {
    this.yaw -= dx * 0.0022 * sens;
    this.pitch -= dy * 0.0022 * sens;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
  }

  /** ctx: { input, ads, mobility, canSprint } */
  update(dt, { input, ads, mobility, canSprint, scoped, firing }) {
    this.clock += dt;
    // Crouch: hold Shift (C also works). Not Ctrl: Ctrl+W is the browser's "close tab" shortcut.
    const wantCrouch = input.down('ShiftLeft') || input.down('KeyC');
    if (wantCrouch) this.crouching = true;
    else if (this.crouching && !this.blockedAbove()) this.crouching = false;
    this.crouch += ((this.crouching ? 1 : 0) - this.crouch) * Math.min(1, dt * 12);

    let fx = 0, fz = 0;
    if (input.down('KeyW')) fz -= 1;
    if (input.down('KeyS')) fz += 1;
    if (input.down('KeyA')) fx -= 1;
    if (input.down('KeyD')) fx += 1;
    const len = Math.hypot(fx, fz);
    if (len > 0) { fx /= len; fz /= len; }

    // Auto-sprint: moving forward is sprinting, unless aiming, crouching or shooting.
    this.sprinting = fz < -0.5 && !this.crouching && !ads && !firing && canSprint && this.onGround;
    let maxSpeed = this.sprinting ? 6.6 : 4.7;
    if (this.crouching) maxSpeed = 2.2;
    if (ads) maxSpeed *= 0.58;
    maxSpeed *= mobility;
    if (this.speedAt) maxSpeed *= this.speedAt(this.pos.x, this.pos.z);

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = fx * cos + fz * sin;
    const wz = -fx * sin + fz * cos;

    const accel = this.onGround ? (len > 0 ? 38 : 30) : 5;
    const tx = wx * maxSpeed, tz = wz * maxSpeed;
    this.vel.x = approach(this.vel.x, tx, accel * dt);
    this.vel.z = approach(this.vel.z, tz, accel * dt);

    if (input.hit('Space') && this.onGround && !scoped) { // Space holds breath while scoped
      this.vel.y = 4.5;
      this.onGround = false;
    }
    this.vel.y -= GRAVITY * dt;

    this.moveAxis('x', this.vel.x * dt);
    this.moveAxis('z', this.vel.z * dt);
    if (this.collision && this.collision.resolve(this.pos, RADIUS, this.height)) {
      // lose the velocity component pushing into the wall
      this.vel.x *= 0.9; this.vel.z *= 0.9;
    }

    const prevY = this.pos.y;
    const wasAir = !this.onGround;
    const grounded = this.onGround;
    const fallSpeed = -this.vel.y;
    this.pos.y += this.vel.y * dt;
    this.resolveVertical(prevY, grounded);
    if (this.onGround && wasAir && fallSpeed > 2) {
      this.landVel -= Math.min(fallSpeed, 9) * 0.35;
      this.audio.footstep(6, false);
    }

    const B = this.bounds;
    this.pos.x = Math.max(B.minX, Math.min(B.maxX, this.pos.x));
    this.pos.z = Math.max(B.minZ, Math.min(B.maxZ, this.pos.z));

    // Head bob + footsteps
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    const moving = this.onGround && this.speed > 0.5;
    this.bobAmount += ((moving ? Math.min(1, this.speed / 4.7) : 0) - this.bobAmount) * Math.min(1, dt * 8);
    if (moving) {
      this.bobPhase += dt * this.speed * (this.sprinting ? 1.55 : 1.75);
      this.stepDist += this.speed * dt;
      const stride = this.sprinting ? 2.3 : this.crouching ? 1.3 : 1.9;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        this.audio.footstep(this.speed, this.crouching);
      }
    }

    // Landing spring
    this.landVel += (-this.landDip * 90 - this.landVel * 12) * dt;
    this.landDip += this.landVel * dt;
  }

  playerBox(y = this.pos.y, h = this.height) {
    return this._box.set(
      new THREE.Vector3(this.pos.x - RADIUS, y, this.pos.z - RADIUS),
      new THREE.Vector3(this.pos.x + RADIUS, y + h, this.pos.z + RADIUS),
    );
  }

  moveAxis(axis, amount) {
    if (amount === 0) return;
    this.pos[axis] += amount;
    for (const b of this.colliders) {
      const pb = this.playerBox();
      if (!overlaps(pb, b)) continue;
      const rise = b.max.y - this.pos.y;
      if (this.onGround && rise > 0 && rise <= STEP && !this.wouldHitCeiling(b.max.y)) {
        this.pos.y = b.max.y; // step up onto low objects
        continue;
      }
      if (amount > 0) this.pos[axis] = b.min[axis] - RADIUS - 0.001;
      else this.pos[axis] = b.max[axis] + RADIUS + 0.001;
      this.vel[axis] = 0;
    }
  }

  wouldHitCeiling(y) {
    const pb = this.playerBox(y + 0.01);
    return this.colliders.some((b) => overlaps(pb, b));
  }

  resolveVertical(prevY, grounded = false) {
    let floor = this.groundAt ? this.groundAt(this.pos.x, this.pos.z) : 0;
    const x0 = this.pos.x - RADIUS, x1 = this.pos.x + RADIUS, z0 = this.pos.z - RADIUS, z1 = this.pos.z + RADIUS;
    for (const b of this.colliders) {
      if (x1 <= b.min.x || x0 >= b.max.x || z1 <= b.min.z || z0 >= b.max.z) continue;
      if (prevY >= b.max.y - 0.06 && b.max.y > floor) floor = b.max.y;               // standing on top
      else if (this.vel.y > 0 && prevY + this.height <= b.min.y + 0.01 && this.pos.y + this.height > b.min.y) {
        this.pos.y = b.min.y - this.height; this.vel.y = 0;                          // head bump
      }
    }
    // On terrain, stay glued to the ground when walking downhill instead of hopping off every slope.
    if (this.groundAt && grounded && this.vel.y <= 0 && this.pos.y > floor && this.pos.y - floor < 0.5) this.pos.y = floor;
    if (this.pos.y <= floor) {
      this.pos.y = floor;
      if (this.vel.y < 0) this.vel.y = 0;
      this.onGround = true;
    } else {
      // Small tolerance so walking down off a crate edge isn't counted as "airborne".
      this.onGround = this.pos.y - floor < 0.02 && this.vel.y <= 0;
    }
  }

  blockedAbove() {
    const pb = this.playerBox(this.pos.y, STAND_H);
    return this.colliders.some((b) => overlaps(pb, b));
  }
}

// Strict overlap (touching faces – e.g. standing on top of a crate – does not count).
function overlaps(a, b, e = 1e-4) {
  return a.max.x > b.min.x + e && a.min.x < b.max.x - e &&
    a.max.y > b.min.y + e && a.min.y < b.max.y - e &&
    a.max.z > b.min.z + e && a.min.z < b.max.z - e;
}

function approach(v, t, d) {
  return v < t ? Math.min(v + d, t) : Math.max(v - d, t);
}
