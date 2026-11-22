// ─────────────────────────────────────────────────────────────────────────────
// Quality presets + automatic quality governor.
//
// How "Auto" works (two layers, like modern console games):
//
//  1. FIRST GUESS — before the first frame we read the GPU name WebGL reports
//     (e.g. "AMD Radeon(TM) Graphics" = integrated → Medium, "RTX 4070" → Ultra),
//     plus CPU core count / device memory / mobile. That picks the starting tier
//     and which texture resolution (1k / 2k) to download into GPU memory.
//
//  2. LIVE TUNING while you play:
//     a) Dynamic resolution (fast, every 0.5 s): if frames are slower than the
//        target, render fewer pixels (down to the tier's floor, e.g. 65 %).
//        When there is headroom again it creeps back up.
//     b) Tier changes (slow): if resolution is already at its floor and it is
//        still too slow, drop a whole tier (shadows, AO, grass, bloom, AA…).
//        If everything is smooth at 100 % resolution for a while, it *tries*
//        the next tier up; if that tier can't hold the frame rate it reverts and
//        waits longer before trying again (exponential back-off), so it never
//        flip-flops.
//     When the browser exposes a GPU timer (EXT_disjoint_timer_query_webgl2) we
//     measure real GPU milliseconds, which reveals headroom even when the frame
//     rate is locked to the monitor's refresh rate.
// ─────────────────────────────────────────────────────────────────────────────

export const TIERS = ['low', 'medium', 'high', 'ultra'];

export const PRESETS = {
  low: {
    label: 'Low', pixelCap: 0.85, minScale: 0.6,
    shadowSize: 1024, shadowRange: 45, shadowRadius: 1, propShadows: false,
    ao: 0, bloom: false, aa: 'fxaa', msaa: 0,
    grass: 0, anisotropy: 2, decals: 40, particles: 400, texRes: '1k',
  },
  medium: {
    label: 'Medium', pixelCap: 1.0, minScale: 0.65,
    shadowSize: 2048, shadowRange: 70, shadowRadius: 2, propShadows: true,
    ao: 0, bloom: true, aa: 'fxaa', msaa: 0,
    grass: 0.35, anisotropy: 4, decals: 100, particles: 800, texRes: '1k',
  },
  high: {
    label: 'High', pixelCap: 1.5, minScale: 0.7,
    shadowSize: 2048, shadowRange: 100, shadowRadius: 3, propShadows: true,
    ao: 0.5, bloom: true, aa: 'smaa', msaa: 0,
    grass: 0.7, anisotropy: 8, decals: 200, particles: 1200, texRes: '2k',
  },
  ultra: {
    label: 'Ultra', pixelCap: 2.0, minScale: 0.75,
    shadowSize: 4096, shadowRange: 140, shadowRadius: 3, propShadows: true,
    ao: 1, bloom: true, aa: 'smaa', msaa: 4,
    grass: 1, anisotropy: 16, decals: 300, particles: 1600, texRes: '2k',
  },
};

// ── 1. First guess from hardware ────────────────────────────────────────────

export function detectHardware() {
  let gpu = 'unknown';
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || 'unknown';
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch { /* ignore */ }

  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 8; // GB, Chromium only (capped at 8)
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  const g = gpu.toLowerCase();

  let tier;
  let reason;
  if (/swiftshader|llvmpipe|software|basic render|microsoft basic/.test(g)) {
    tier = 'low'; reason = 'software rendering (no GPU acceleration)';
  } else if (mobile || /mali|adreno|powervr|apple gpu/.test(g)) {
    tier = 'low'; reason = 'mobile GPU';
  } else if (/rtx|radeon rx\s?[6-9]\d{3}|rx\s?[6-9]\d{3}|arc a[57]|arc b|radeon pro w|quadro rtx|apple m[1-9] (pro|max|ultra)/.test(g)) {
    tier = 'ultra'; reason = 'dedicated high-end GPU';
  } else if (/gtx|radeon rx|rx\s?\d{3,4}|arc|quadro|firepro|apple m\d/.test(g)) {
    tier = 'high'; reason = 'dedicated GPU';
  } else if (/iris|radeon\s?\(tm\)\s?graphics|radeon graphics|vega|780m|680m|880m|890m/.test(g)) {
    tier = 'medium'; reason = 'modern integrated GPU';
  } else if (/intel/.test(g)) {
    tier = 'low'; reason = 'older integrated GPU';
  } else {
    tier = 'medium'; reason = 'unknown GPU';
  }

  // Weak CPUs / low RAM pull the guess down one notch.
  if ((cores <= 4 || memory <= 4) && tier !== 'low') {
    tier = TIERS[TIERS.indexOf(tier) - 1];
    reason += `, limited CPU/RAM (${cores} threads, ${memory}+ GB)`;
  }

  return { gpu, cores, memory, mobile, tier, reason };
}

// ── 2. Live governor ─────────────────────────────────────────────────────────

export class AutoQuality {
  constructor({ tier, onChange }) {
    this.tier = tier;
    this.scale = 1;
    this.onChange = onChange; // (tier, scale) => void
    this.enabled = true;
    this.lockTier = false;      // manual quality + dynamic resolution: only resolution moves
    this.targetFps = 60;

    this.frameTimes = [];
    this.gpuTimes = [];
    this.evalTimer = 0;
    this.badTime = 0;
    this.goodTime = 0;
    this.warmup = 6; // seconds of faster reactions at the start
    this.clock = 0;

    this.probe = null;            // { from, to, until }
    this.blockedUntil = {};       // tier → clock time
    this.backoff = {};            // tier → seconds
    this.upgradeWait = 8;
    this.refreshHz = 60;
    this.lastFps = 0;
    this.lastGpuMs = null;
  }

  get preset() { return PRESETS[this.tier]; }

  /** Call once per rendered frame while the player is actually playing. */
  sample(frameMs, gpuMs) {
    if (frameMs > 250) return; // loading hitch / tab switch – ignore
    this.frameTimes.push(frameMs);
    if (gpuMs != null) this.gpuTimes.push(gpuMs);
  }

  update(dt) {
    this.clock += dt;
    if (this.warmup > 0) this.warmup -= dt;
    this.evalTimer += dt;
    if (this.evalTimer < 0.5) return;
    const window = this.evalTimer;
    this.evalTimer = 0;

    const ft = this.frameTimes.splice(0);
    const gt = this.gpuTimes.splice(0);
    if (ft.length < 5) return;

    ft.sort((a, b) => a - b);
    const avg = ft.reduce((s, v) => s + v, 0) / ft.length;
    const p90 = ft[Math.floor(ft.length * 0.9)];
    this.lastFps = 1000 / avg;

    // Learn the monitor's refresh rate from the fastest stable frames.
    const fast = ft[Math.floor(ft.length * 0.1)];
    const hz = 1000 / fast;
    for (const c of [30, 50, 60, 75, 90, 100, 120, 144, 165, 240]) {
      if (Math.abs(hz - c) / c < 0.06 && c > this.refreshHz * 0.9) { this.refreshHz = c; break; }
    }

    if (!this.enabled) return;

    const target = Math.min(this.targetFps, this.refreshHz);
    const budget = 1000 / target;
    let gpuAvg = gt.length ? gt.reduce((s, v) => s + v, 0) / gt.length : null;
    if (gpuAvg != null && gpuAvg > avg * 1.4) gpuAvg = null; // timer unreliable on this driver – fall back to frame times
    this.lastGpuMs = gpuAvg;

    const tooSlow = avg > budget * 1.12 || p90 > budget * 1.6;
    // With a GPU timer we can see real headroom; without one, "hitting the
    // target" is the best signal we get (the frame rate is capped by vsync).
    const comfortable = gpuAvg != null
      ? (avg < budget * 1.05 && gpuAvg < budget * 0.62)
      : avg < budget * 1.03;

    const preset = this.preset;
    let changed = false;

    // A probe (trying a higher tier) that fails → revert and back off.
    if (this.probe && tooSlow) {
      const failed = this.probe.to;
      this.tier = this.probe.from;
      this.scale = 1;
      this.backoff[failed] = Math.min((this.backoff[failed] || 20) * 2, 600);
      this.blockedUntil[failed] = this.clock + this.backoff[failed];
      this.probe = null;
      this.goodTime = 0;
      this.badTime = 0;
      this.onChange(this.tier, this.scale, 'reverted');
      return;
    }
    if (this.probe && this.clock > this.probe.until) this.probe = null; // probe survived

    if (tooSlow) {
      this.goodTime = 0;
      this.badTime += window;
      const patience = this.warmup > 0 ? 0.5 : 1.0;
      if (this.badTime >= patience) {
        this.badTime = 0;
        if (this.scale > preset.minScale + 0.001) {
          // Pixel cost ~ scale², so step by the square root of how far over budget we are.
          const factor = Math.max(0.8, Math.min(0.95, Math.sqrt(budget / avg)));
          this.scale = Math.max(preset.minScale, quantize(this.scale * factor));
          changed = true;
        } else if (!this.lockTier && TIERS.indexOf(this.tier) > 0) {
          this.tier = TIERS[TIERS.indexOf(this.tier) - 1];
          this.scale = 0.9;
          this.upgradeWait = Math.min(this.upgradeWait * 1.5, 120);
          changed = true;
        }
      }
    } else if (comfortable) {
      this.badTime = 0;
      this.goodTime += window;
      if (this.scale < 1 && this.goodTime >= 2) {
        this.scale = Math.min(1, quantize(this.scale + 0.05));
        this.goodTime = 0;
        changed = true;
      } else if (!this.lockTier && this.scale >= 1 && this.goodTime >= this.upgradeWait) {
        const next = TIERS[TIERS.indexOf(this.tier) + 1];
        this.goodTime = 0;
        if (next && !(this.blockedUntil[next] > this.clock)) {
          this.probe = { from: this.tier, to: next, until: this.clock + 6 };
          this.tier = next;
          this.scale = 1;
          changed = true;
        }
      }
    } else {
      // In between: hold steady.
      this.badTime = Math.max(0, this.badTime - window);
    }

    if (changed) this.onChange(this.tier, this.scale);
  }
}

function quantize(v) { return Math.round(v * 20) / 20; }

// ── GPU timer (optional; only some browsers/drivers expose it) ──────────────

export class GpuTimer {
  constructor(gl) {
    this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.pending = [];
    this.active = null;
  }
  get supported() { return !!this.ext; }
  begin() {
    if (!this.ext || this.active || this.pending.length > 3) return;
    const q = this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }
  end() {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }
  /** Returns the newest finished measurement in ms, or null. */
  poll() {
    if (!this.ext) return null;
    const gl = this.gl;
    let result = null;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      gl.deleteQuery(q);
      this.pending.shift();
      if (!disjoint) result = ns / 1e6;
    }
    return result;
  }
}
