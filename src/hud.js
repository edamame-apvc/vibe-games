import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const D2R = Math.PI / 180;

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), xh: $('crosshair'), hit: $('hitmarker'), dmg: $('dmg-layer'),
      mag: $('ammo-mag'), reserve: $('ammo-reserve'), name: $('weapon-name'), mode: $('fire-mode'), cls: $('weapon-class'),
      reload: $('reload-bar'), reloadFill: $('reload-fill'), feed: $('feed'), toast: $('toast'),
      stats: $('stats'), perf: $('perf'), scope: $('scope'), breath: $('breath'), breathFill: $('breath-fill'),
      hint: $('hint'), ammoBox: $('ammo'), grenades: $('grenades'), danger: $('danger-layer'),
      health: $('health'), healthFill: $('health-fill'), healthNum: $('health-num'), mission: $('mission'),
      vignette: $('hurt-vignette'), indLayer: $('ind-layer'),
    };
    this.numbers = [];
    this.indicators = [];
    this.hurtFlash = 0;
    this.combat = false;
    this.dangerEls = [];
    this.lastGrenades = -1;
    this.hitTimer = 0;
    this.toastTimer = 0;
    this.pulse = 0;
    this.v = new THREE.Vector3();
  }

  show(on) { this.el.hud.classList.toggle('hidden', !on); }

  setCombat(on) {
    this.combat = on;
    this.el.health.classList.toggle('hidden', !on);
    this.el.mission.classList.toggle('hidden', !on);
  }

  mission(alive, total, time) {
    const m = Math.floor(time / 60), s = Math.floor(time % 60);
    this.el.mission.innerHTML = `<span class="m-label">ENEMIES</span> <b>${alive}</b><span class="m-total">/${total}</span><span class="m-time">${m}:${String(s).padStart(2, '0')}</span>`;
  }

  /** Took damage from a world position: red flash + arrow pointing at the shooter. */
  hurt(fromPos, dmg) {
    this.hurtFlash = Math.min(1, this.hurtFlash + dmg / 35);
    const el = document.createElement('div');
    el.className = 'ind';
    this.el.indLayer.appendChild(el);
    this.indicators.push({ el, from: fromPos.clone(), t: 0 });
    if (this.indicators.length > 8) this.indicators.shift().el.remove();
  }

  weaponChanged(def) {
    this.el.name.textContent = def.name;
    this.el.cls.textContent = `${def.class} · ${def.caliber}`;
    this.el.ammoBox.classList.remove('pop'); void this.el.ammoBox.offsetWidth; this.el.ammoBox.classList.add('pop');
  }

  toast(text) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('show');
    this.toastTimer = 1.4;
  }

  shotFired() { this.pulse = 1; }

  hitmarker(head, killed) {
    const h = this.el.hit;
    h.classList.toggle('head', head);
    h.classList.toggle('kill', !!killed);
    h.classList.add('show');
    this.hitTimer = killed ? 0.28 : 0.14;
  }

  damageNumber(point, dmg, head) {
    const d = document.createElement('div');
    d.className = 'dmg' + (head ? ' head' : '');
    d.textContent = dmg;
    this.el.dmg.appendChild(d);
    this.numbers.push({ el: d, p: point.clone(), t: 0, dx: (Math.random() - 0.5) * 30 });
  }

  feed(text, head) {
    const d = document.createElement('div');
    d.className = 'feed-item' + (head ? ' head' : '');
    d.textContent = text;
    this.el.feed.prepend(d);
    setTimeout(() => d.classList.add('fade'), 2600);
    setTimeout(() => d.remove(), 3200);
    while (this.el.feed.children.length > 5) this.el.feed.lastChild.remove();
  }

  reloadStarted() { this.el.reload.classList.add('show'); this.el.reloadFill.style.width = '0%'; }
  reloadProgress(k) { this.el.reloadFill.style.width = `${Math.min(100, k * 100)}%`; }
  reloadDone() { this.el.reload.classList.remove('show'); }

  update(dt, { ws, camera, stats, perfText, showPerf, grenades, player }) {
    // health, damage vignette, direction indicators (combat maps)
    if (this.combat) {
      const hp = Math.max(0, player.health);
      this.el.healthFill.style.width = `${hp}%`;
      this.el.healthNum.textContent = Math.ceil(hp);
      this.el.health.classList.toggle('low', hp < 35);
      this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.6);
      const low = hp < 40 ? (1 - hp / 40) * (0.55 + Math.sin(performance.now() / 260) * 0.15) : 0;
      this.el.vignette.style.opacity = Math.min(1, this.hurtFlash * 0.8 + low);
      const inv = camera.quaternion.clone().invert();
      for (let i = this.indicators.length - 1; i >= 0; i--) {
        const ind = this.indicators[i];
        ind.t += dt;
        if (ind.t > 1.6) { ind.el.remove(); this.indicators.splice(i, 1); continue; }
        const local = ind.from.clone().sub(camera.position).applyQuaternion(inv);
        const ang = Math.atan2(local.x, -local.z);
        ind.el.style.transform = `translate(-50%, -50%) rotate(${ang}rad) translateY(-130px)`;
        ind.el.style.opacity = Math.min(1, (1.6 - ind.t) * 1.5);
      }
    }

    const d = ws.def, s = ws.cur;

    // crosshair: gap reflects the real bullet spread at the current FOV
    const spread = ws.currentSpreadDeg();
    const halfH = innerHeight / 2;
    const gap = Math.max(4, Math.tan(spread * D2R) / Math.tan(camera.fov * D2R / 2) * halfH);
    this.pulse = Math.max(0, this.pulse - dt * 10);
    const hideXh = ws.ads > 0.45 || d.sight === 'scope' || ws.sprintBlend > 0.5 || ws.switching.t < 1;
    this.el.xh.style.setProperty('--gap', `${Math.min(140, gap + this.pulse * 4)}px`);
    this.el.xh.classList.toggle('hidden', hideXh);
    this.el.xh.classList.toggle('pellets', d.pellets > 1);

    // ammo
    this.el.mag.textContent = s.ammo;
    this.el.reserve.textContent = s.reserve;
    this.el.mode.textContent = ws.mode.toUpperCase();
    this.el.mag.classList.toggle('low', s.ammo <= Math.ceil(d.mag * 0.25));
    const needReload = s.ammo <= Math.ceil(d.mag * 0.2) && s.reserve > 0 && !ws.reload;
    const empty = s.ammo === 0 && s.reserve === 0;
    const cooking = grenades && grenades.pinPulled && grenades.state === 'cook';
    const holding = grenades && (grenades.state === 'raise' || grenades.state === 'ready');
    this.el.hint.textContent = cooking ? `RELEASE TO ${grenades.underhand ? 'LOB' : 'THROW'} · ${Math.max(0, grenades.fuseLeft).toFixed(1)}s`
      : holding ? 'LMB THROW · RMB LOB · G PUT AWAY'
      : empty ? 'OUT OF AMMO — press T to restock' : needReload ? 'R  RELOAD' : '';
    this.el.hint.classList.toggle('show', !!(cooking || holding || empty || needReload));
    this.el.hint.classList.toggle('danger', !!(cooking && grenades.fuseLeft < 1.2));

    // grenade count
    if (grenades && grenades.count !== this.lastGrenades) {
      this.lastGrenades = grenades.count;
      this.el.grenades.innerHTML = [0, 1, 2].map((i) => `<i class="gicon${i < grenades.count ? '' : ' empty'}"></i>`).join('');
    }

    // live grenade warnings (within 12 m)
    const dangers = grenades ? grenades.dangers().filter((p) => p.distanceTo(player.pos) < 12) : [];
    while (this.dangerEls.length < dangers.length) {
      const d = document.createElement('div');
      d.className = 'danger';
      d.innerHTML = '<i></i><span></span>';
      this.el.danger.appendChild(d);
      this.dangerEls.push(d);
    }
    this.dangerEls.forEach((el, i) => {
      const p = dangers[i];
      el.style.display = p ? 'block' : 'none';
      if (!p) return;
      this.v.copy(p).project(camera);
      let x = this.v.x, y = this.v.y;
      if (this.v.z > 1) { x = -x; y = -y; } // behind you: mirror toward the screen edge
      const m = Math.max(Math.abs(x), Math.abs(y), 1e-3);
      if (m > 0.85 || this.v.z > 1) { x = (x / m) * 0.85; y = (y / m) * 0.85; }
      const dist = p.distanceTo(player.pos);
      el.style.transform = `translate(${(x * 0.5 + 0.5) * innerWidth}px, ${(-y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -50%)`;
      el.classList.toggle('lethal', dist < 7);
      el.lastChild.textContent = `${dist.toFixed(0)}m`;
    });

    // hitmarker
    this.hitTimer -= dt;
    if (this.hitTimer <= 0) this.el.hit.classList.remove('show');

    // toast
    this.toastTimer -= dt;
    if (this.toastTimer <= 0) this.el.toast.classList.remove('show');

    // floating damage numbers
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.t += dt;
      if (n.t > 0.9) { n.el.remove(); this.numbers.splice(i, 1); continue; }
      this.v.copy(n.p).project(camera);
      if (this.v.z > 1) { n.el.style.opacity = 0; continue; }
      const x = (this.v.x * 0.5 + 0.5) * innerWidth + n.dx * n.t;
      const y = (-this.v.y * 0.5 + 0.5) * innerHeight - n.t * 60;
      n.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${1 + Math.max(0, 0.2 - n.t) * 2})`;
      n.el.style.opacity = Math.min(1, (0.9 - n.t) * 4);
    }

    // scope
    this.el.scope.classList.toggle('show', ws.scoped);
    if (ws.scoped) {
      const sw = ws.scopeSway;
      this.el.scope.style.setProperty('--sx', `${-sw.x * 2500}px`);
      this.el.scope.style.setProperty('--sy', `${sw.y * 2500}px`);
    }
    const b = ws.breath;
    this.el.breath.classList.toggle('show', ws.scoped);
    this.el.breathFill.style.width = `${b.stamina * 100}%`;
    this.el.breath.classList.toggle('held', b.held);
    this.el.breath.classList.toggle('tired', b.exhausted > 0);

    // stats
    const acc = stats.shots ? Math.round((stats.hits / stats.shots) * 100) : 0;
    this.el.stats.innerHTML =
      `<b>${stats.hits}</b>/${stats.shots} hits · <b>${acc}%</b> acc · <b>${stats.headshots}</b> HS · <b>${stats.downs}</b> down` +
      (stats.longest ? ` · longest <b>${stats.longest.toFixed(0)} m</b>` : '');

    this.el.perf.classList.toggle('hidden', !showPerf);
    if (showPerf) this.el.perf.textContent = perfText;
  }
}
