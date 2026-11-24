// All sound is synthesized with the Web Audio API – no audio files needed.
// A gunshot is layered: a sharp transient crack, a filtered-noise body, a
// sub-bass thump, and an outdoor reverb tail with slap-back echoes off the berms.

export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
  }

  /** Must be called from a user gesture (click). */
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 6;
    comp.attack.value = 0.002; comp.release.value = 0.2;
    // Muffle filter: closes briefly after a nearby explosion (ears ringing).
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 22000;
    this.master.connect(this.muffle).connect(comp).connect(ctx.destination);

    // Outdoor reverb: sparse early echoes + diffuse tail.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.55;
    this.reverbSend.connect(this.reverb).connect(this.master);

    this.noise = this.makeNoise(2);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  makeNoise(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  makeImpulse(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    const echoes = [0.09, 0.17, 0.31, 0.52, 0.86]; // reflections off berms / hills
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t / seconds, 3.2) * 0.22 * Math.min(1, t * 30);
      }
      for (const [k, e] of echoes.entries()) {
        const start = Math.floor((e + ch * 0.013 + Math.random() * 0.01) * ctx.sampleRate);
        const amp = 0.55 / (k + 1.3);
        for (let i = 0; i < 2600 && start + i < len; i++) {
          d[start + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / 500);
        }
      }
    }
    return buf;
  }

  noiseBurst({ time, dur, gain, type = 'lowpass', freq = 2000, q = 0.7, attack = 0.001, decay, dest, sweepTo, rate = 1 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, time + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain, time + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, time + (decay ?? dur));
    src.connect(f).connect(g).connect(dest || this.master);
    src.start(time, Math.random() * 1.5, dur + 0.05);
    return g;
  }

  tone({ time, freq, freqEnd, dur, gain, type = 'sine', dest }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, time);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, time + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain, time + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(g).connect(dest || this.master);
    o.start(time);
    o.stop(time + dur + 0.05);
  }

  /** p = weapon sound profile from weapons/data.js */
  gunshot(p) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = 0.92 + Math.random() * 0.16;
    const bus = this.ctx.createGain();
    bus.gain.value = p.loud * v;
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = (Math.random() - 0.5) * 0.08;
    bus.connect(pan);
    pan.connect(this.master);
    pan.connect(this.reverbSend);

    // 1. supersonic crack / transient
    this.noiseBurst({ time: t, dur: 0.012, gain: 1.0, type: 'highpass', freq: 2500, dest: bus });
    // 2. muzzle blast body
    this.noiseBurst({ time: t, dur: p.body, gain: 0.9, type: 'lowpass', freq: p.bodyFreq, sweepTo: p.bodyFreq * 0.25, q: 0.9, dest: bus });
    this.noiseBurst({ time: t, dur: p.body * 0.6, gain: 0.5, type: 'bandpass', freq: p.bodyFreq * 1.6, q: 1.2, dest: bus });
    // 3. low thump
    this.tone({ time: t, freq: p.thump, freqEnd: 32, dur: 0.16 + p.body * 0.5, gain: 0.85, dest: bus });
    // 4. mechanical action (bolt carrier / slide)
    this.noiseBurst({ time: t + 0.03, dur: 0.025, gain: 0.12 * p.mech, type: 'bandpass', freq: 3800, q: 4, dest: this.master });
  }

  /** Frag grenade detonation. The boom arrives late at range; close blasts make your ears ring. */
  explosion(distance) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + distance / 343;
    const bus = ctx.createGain();
    bus.gain.value = Math.min(1.6, 34 / (distance + 10));
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(900, 16000 - distance * 120); // distant blasts sound duller
    bus.connect(lp);
    lp.connect(this.master);
    lp.connect(this.reverbSend);
    this.noiseBurst({ time: t, dur: 0.03, gain: 1, type: 'highpass', freq: 1800, dest: bus });
    this.noiseBurst({ time: t, dur: 1.4, gain: 1, type: 'lowpass', freq: 1400, sweepTo: 160, q: 0.8, dest: bus });
    this.noiseBurst({ time: t, dur: 2.6, gain: 0.55, type: 'lowpass', freq: 200, q: 0.7, attack: 0.02, dest: bus, rate: 0.5 });
    this.tone({ time: t, freq: 75, freqEnd: 22, dur: 1.3, gain: 1, dest: bus });
    for (let i = 0; i < 14; i++) { // debris pattering down
      this.noiseBurst({ time: t + 0.35 + Math.random() * 1.4, dur: 0.03, gain: 0.04 + Math.random() * 0.06, type: 'bandpass', freq: 1500 + Math.random() * 3000, q: 2, dest: bus });
    }
    if (distance < 14) {
      const k = 1 - distance / 14;
      this.muffle.frequency.cancelScheduledValues(t);
      this.muffle.frequency.setValueAtTime(400 + (1 - k) * 2000, t + 0.02);
      this.muffle.frequency.exponentialRampToValueAtTime(22000, t + 1.5 + k * 3.5);
      this.tone({ time: t + 0.05, freq: 3500, dur: 2 + k * 2.5, gain: 0.05 * k + 0.01, type: 'sine' });
    }
  }

  grenadeBounce(intensity, distance) {
    if (!this.ctx || distance > 50) return;
    const t = this.ctx.currentTime + distance / 343;
    const g = 0.12 * intensity * Math.max(0.1, 1 - distance / 50);
    this.tone({ time: t, freq: 1700 + Math.random() * 300, dur: 0.07, gain: g, type: 'triangle' });
    this.noiseBurst({ time: t, dur: 0.04, gain: g * 1.5, type: 'bandpass', freq: 900, q: 1.5 });
  }

  /** Someone else's gunshot: delayed by distance, panned, duller and quieter far away. */
  gunshotAt(p, distance, pan = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + distance / 343;
    const bus = ctx.createGain();
    bus.gain.value = p.loud * Math.min(1, 9 / (distance + 3)) * (0.9 + Math.random() * 0.2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(900, 17000 - distance * 120);
    const pn = ctx.createStereoPanner();
    pn.pan.value = pan * 0.85;
    bus.connect(lp).connect(pn);
    pn.connect(this.master);
    const send = ctx.createGain();
    send.gain.value = Math.min(1.5, 0.4 + distance / 60); // distant shots are mostly echo
    pn.connect(send).connect(this.reverbSend);
    this.noiseBurst({ time: t, dur: 0.012, gain: 1, type: 'highpass', freq: 2500, dest: bus });
    this.noiseBurst({ time: t, dur: p.body, gain: 0.9, type: 'lowpass', freq: p.bodyFreq, sweepTo: p.bodyFreq * 0.25, q: 0.9, dest: bus });
    this.tone({ time: t, freq: p.thump, freqEnd: 32, dur: 0.16 + p.body * 0.5, gain: 0.8, dest: bus });
  }

  /** Supersonic crack + whizz of a bullet passing close by. */
  crack(pan = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const pn = ctx.createStereoPanner();
    pn.pan.value = pan;
    pn.connect(this.master);
    this.noiseBurst({ time: t, dur: 0.01, gain: 0.55, type: 'highpass', freq: 3500, dest: pn });
    this.noiseBurst({ time: t, dur: 0.14, gain: 0.16, type: 'bandpass', freq: 3200, sweepTo: 700, q: 3, dest: pn });
  }

  footstepAt(distance, pan, speed) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const pn = ctx.createStereoPanner();
    pn.pan.value = pan * 0.9;
    const g = ctx.createGain();
    g.gain.value = Math.max(0, 1 - distance / 26) * 0.1 * Math.min(1.4, speed / 3);
    g.connect(pn).connect(this.master);
    for (let i = 0; i < 4; i++) {
      this.noiseBurst({ time: t + i * 0.012 + Math.random() * 0.01, dur: 0.03 + Math.random() * 0.03, gain: 0.6 + Math.random() * 0.4, type: 'bandpass', freq: 800 + Math.random() * 2400, q: 1.2, dest: g });
    }
  }

  hurt(heavy = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone({ time: t, freq: heavy ? 90 : 120, freqEnd: 40, dur: 0.25, gain: 0.6 });
    this.noiseBurst({ time: t, dur: 0.08, gain: 0.35, type: 'lowpass', freq: 900 });
  }

  dryFire() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noiseBurst({ time: t, dur: 0.02, gain: 0.25, type: 'bandpass', freq: 3000, q: 6 });
  }

  /** Short mechanical clicks for reload stages. kind: 'magOut' | 'magIn' | 'bolt' | 'shell' | 'pump' | 'switch' */
  mech(kind) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const presets = {
      magOut: [[0, 0.04, 0.35, 1800, 3], [0.03, 0.06, 0.18, 700, 1.5]],
      magIn: [[0, 0.03, 0.5, 2400, 4], [0.025, 0.05, 0.4, 900, 2]],
      bolt: [[0, 0.04, 0.45, 2600, 5], [0.12, 0.05, 0.5, 2000, 5], [0.16, 0.06, 0.25, 800, 2]],
      shell: [[0, 0.03, 0.3, 1500, 3], [0.04, 0.04, 0.25, 900, 2]],
      pump: [[0, 0.06, 0.5, 1200, 3], [0.14, 0.06, 0.55, 1600, 3]],
      switch: [[0, 0.05, 0.2, 900, 1.5], [0.06, 0.04, 0.15, 2200, 3]],
      pin: [[0, 0.02, 0.45, 4200, 8], [0.05, 0.05, 0.25, 2600, 4], [0.09, 0.03, 0.2, 5200, 9]],
      throw: [[0, 0.22, 0.18, 700, 0.8]],
    }[kind];
    for (const [dt, dur, gain, freq, q] of presets) {
      this.noiseBurst({ time: t + dt, dur, gain, type: 'bandpass', freq, q });
    }
  }

  /** Steel target ring. Arrives late at long range – sound travels 343 m/s. */
  steelPing(distance, strong = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + distance / 343;
    const g = this.ctx.createGain();
    g.gain.value = Math.min(0.9, 6 / Math.max(6, distance)) * 0.9 * strong + 0.05;
    g.connect(this.master);
    g.connect(this.reverbSend);
    const base = 620 + Math.random() * 80;
    for (const [mult, amp, dur] of [[1, 0.6, 0.9], [2.32, 0.35, 0.6], [3.87, 0.22, 0.4], [5.4, 0.12, 0.25]]) {
      this.tone({ time: t, freq: base * mult, dur, gain: amp, type: 'sine', dest: g });
    }
    this.noiseBurst({ time: t, dur: 0.02, gain: 0.4, type: 'highpass', freq: 3000, dest: g });
  }

  /** Bullet hitting the ground / wood / concrete near the player. */
  impact(surface, distance) {
    if (!this.ctx || distance > 60) return;
    const t = this.ctx.currentTime + distance / 343;
    const gain = Math.max(0.02, 0.25 * (1 - distance / 60));
    const f = { dirt: 600, wood: 1400, concrete: 2500, metal: 4000, plastic: 1800, rubber: 400 }[surface] || 1200;
    this.noiseBurst({ time: t, dur: 0.06, gain, type: 'bandpass', freq: f, q: 1.5 });
  }

  casing(intensity = 1, shotgun = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = 0.04 * intensity;
    if (shotgun) {
      this.noiseBurst({ time: t, dur: 0.05, gain: g * 2, type: 'bandpass', freq: 900, q: 2 });
      return;
    }
    const base = 3800 + Math.random() * 1500;
    this.tone({ time: t, freq: base, dur: 0.12, gain: g });
    this.tone({ time: t + 0.07 + Math.random() * 0.04, freq: base * 1.1, dur: 0.08, gain: g * 0.6 });
  }

  footstep(speed, crouched) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const gain = (crouched ? 0.05 : 0.11) * Math.min(1.3, speed / 4.5);
    // Gravel crunch = several tiny grains.
    for (let i = 0; i < 5; i++) {
      this.noiseBurst({
        time: t + i * 0.012 + Math.random() * 0.01, dur: 0.03 + Math.random() * 0.03,
        gain: gain * (0.5 + Math.random() * 0.6), type: 'bandpass', freq: 900 + Math.random() * 2600, q: 1.2,
      });
    }
    this.noiseBurst({ time: t, dur: 0.07, gain: gain * 0.8, type: 'lowpass', freq: 300 });
  }

  hitmarker(head) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone({ time: t, freq: head ? 1900 : 1400, dur: 0.05, gain: head ? 0.12 : 0.07, type: 'triangle' });
  }
}
