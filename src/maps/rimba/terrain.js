import { fbm, smoothstep } from '../../noise.js';

// Rimba Basin terrain: rolling jungle hills, a meandering river with a shallow
// ford, flattened clearings for the village and the mercenary camp, and hills
// around the edge that close the valley in. All heights in metres; north = -Z.

export const HALF = 105;          // playable half-size
export const WATER_Y = -1.2;      // river surface
export const BRIDGE = { z: 8, half: 12, width: 1.8 };

export const CLEARINGS = [
  { id: 'village', x: -50, z: 34, r: 26 },
  { id: 'camp', x: 54, z: -44, r: 24 },
  { id: 'landing', x: -70, z: -60, r: 13 },
  { id: 'spawn', x: -82, z: 86, r: 10 },
];

export function riverX(z) {
  return 18 * Math.sin(z * 0.017 + 0.6) + 7 * Math.sin(z * 0.043 + 2.1);
}

function baseHeight(x, z) {
  return (fbm(x * 0.011 + 3, z * 0.011 + 7, 4) - 0.5) * 15 + (fbm(x * 0.06, z * 0.06, 3) - 0.5) * 1.4;
}
for (const c of CLEARINGS) c.h = baseHeight(c.x, c.z) * 0.5 + 0.6;

export function heightAt(x, z) {
  let h = baseHeight(x, z);
  for (const c of CLEARINGS) {
    const k = 1 - smoothstep(c.r * 0.55, c.r * 1.1, Math.hypot(x - c.x, z - c.z));
    if (k > 0) h += (c.h - h) * k;
  }
  // river valley: banks slope gently down, then a channel
  const d = Math.abs(x - riverX(z));
  const valley = 1 - smoothstep(7, 30, d);
  h += (WATER_Y + 1.0 - h) * valley * 0.85;
  const ford = Math.exp(-(((z + 66) / 9) ** 2));                 // shallow crossing in the south
  const bed = WATER_Y - 1.05 + ford * 0.8;
  const channel = 1 - smoothstep(3.2, 7.5, d);
  h += (bed - h) * channel;
  // hills that enclose the basin
  const edge = smoothstep(HALF - 8, HALF + 45, Math.max(Math.abs(x), Math.abs(z)));
  h += edge * (22 + fbm(x * 0.02, z * 0.02) * 18);
  return h;
}

/** Bridge deck height at (x, z) or -Infinity when not on the bridge. */
export function bridgeDeck(x, z) {
  const cx = riverX(BRIDGE.z);
  const t = (x - cx) / BRIDGE.half;
  if (Math.abs(z - BRIDGE.z) > BRIDGE.width / 2 || Math.abs(t) > 1) return -Infinity;
  const end = Math.max(heightAt(cx - BRIDGE.half, BRIDGE.z), heightAt(cx + BRIDGE.half, BRIDGE.z)) + 0.35;
  return end - 0.45 * (1 - t * t); // gentle sag in the middle
}

export function groundAt(x, z) {
  return Math.max(heightAt(x, z), bridgeDeck(x, z));
}

export function waterDepth(x, z) {
  if (bridgeDeck(x, z) > -Infinity) return 0;
  return Math.max(0, WATER_Y - heightAt(x, z));
}

/** 0..1 how muddy the ground is (riverbanks, clearings) – used to blend textures. */
export function mudWeight(x, z) {
  const d = Math.abs(x - riverX(z));
  let m = (1 - smoothstep(5, 11, d)) * 0.9;
  for (const c of CLEARINGS) m = Math.max(m, (1 - smoothstep(c.r * 0.3, c.r * 0.85, Math.hypot(x - c.x, z - c.z))) * 0.75);
  return Math.min(1, m + (fbm(x * 0.08 + 5, z * 0.08) - 0.5) * 0.4);
}

export function slopeAt(x, z) {
  const e = 0.8;
  return Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
}
