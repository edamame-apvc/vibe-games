// "Clear the area" mission: kill every mercenary without dying.

const REGEN_DELAY = 5;   // seconds without damage before health regenerates
const REGEN_RATE = 12;   // health per second

export class Mission {
  constructor({ bots, player, hud, audio, stats, onEnd }) {
    Object.assign(this, { bots, player, hud, audio, stats, onEnd });
    this.active = false;
    this.time = 0;
    this.lastHurt = -99;
  }

  start(count, spawn) {
    this.bots.removeAll();
    const p = this.player;
    p.pos.copy(spawn.pos); p.yaw = spawn.yaw; p.pitch = 0; p.vel.set(0, 0, 0);
    p.health = 100; p.alive = true; p.crouching = false;
    this.bots.spawn(count);
    this.total = this.bots.total;
    this.time = 0;
    this.lastHurt = -99;
    this.active = true;
    this.ended = false;
    this.hud.mission(this.bots.alive, this.total, 0);
  }

  playerHit(dmg, fromPos, head) {
    const p = this.player;
    if (!this.active || !p.alive) return;
    p.health -= dmg;
    this.lastHurt = this.time;
    this.stats.damageTaken = (this.stats.damageTaken || 0) + dmg;
    this.hud.hurt(fromPos, dmg, head);
    this.audio.hurt(dmg > 25);
    if (p.health <= 0) {
      p.health = 0;
      p.alive = false;
      this.finish('dead');
    }
  }

  /** Your own (or anyone's) grenade going off near you. */
  playerBlast(pos, radius = 7) {
    const d = pos.distanceTo(this.player.pos.clone().setY(this.player.pos.y + 1));
    if (d > radius) return;
    this.playerHit(Math.round(160 * Math.pow(1 - d / radius, 1.3)), pos, false);
  }

  onKill() {
    if (!this.active) return;
    this.stats.kills = (this.stats.kills || 0) + 1;
    this.hud.mission(this.bots.alive, this.total, this.time);
    if (this.bots.alive === 0) this.finish('won');
  }

  update(dt) {
    if (!this.active) return;
    this.time += dt;
    const p = this.player;
    if (p.alive && this.time - this.lastHurt > REGEN_DELAY && p.health < 100) p.health = Math.min(100, p.health + REGEN_RATE * dt);
    this.hud.mission(this.bots.alive, this.total, this.time);
  }

  finish(result) {
    if (this.ended) return;
    this.ended = true;
    this.active = false;
    const s = this.stats;
    this.onEnd?.(result, {
      time: this.time,
      kills: s.kills || 0,
      total: this.total,
      accuracy: s.shots ? Math.round((s.hits / s.shots) * 100) : 0,
      headshots: s.headshots || 0,
      damageTaken: Math.round(s.damageTaken || 0),
    });
  }
}
