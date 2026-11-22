import * as THREE from 'three';
import { mulberry32 } from '../noise.js';

// Procedural facade textures for Singapore heartland buildings.
// Every texture tiles: u = 1 per BAY metres along the wall, v = 1 per FLOOR metres up.
// Each canvas holds 4 bays × 2 floors so repetition is less obvious.

export const BAY = 3.6;
export const FLOOR = 3.0;
const PX = 256; // pixels per bay / per floor

export const HDB_PALETTES = [
  { wall: '#e9e1cf', accent: '#a8553a', trim: '#cfc6b2' },
  { wall: '#ecebe5', accent: '#4f7aa3', trim: '#d4d3cc' },
  { wall: '#e6d8c0', accent: '#7b8f5a', trim: '#cdbfa6' },
  { wall: '#dfe3e6', accent: '#c8873a', trim: '#c5c9cc' },
  { wall: '#efe6d8', accent: '#8c4f6b', trim: '#d6cdbf' },
  { wall: '#e4e0d2', accent: '#5d6f80', trim: '#cac6b8' },
];

const SHOPS = ['COFFEE SHOP', 'MINIMART', 'CLINIC', 'BAKERY', 'PHARMACY', 'HAIR SALON', 'OPTICAL', 'TCM HALL',
  'HARDWARE', 'BOOKSTORE', 'MOBILE REPAIR', 'TUITION CENTRE', 'FLORIST', 'LAUNDRY', 'DENTAL', 'NASI LEMAK', 'CHICKEN RICE', 'PRATA HOUSE'];
const SIGN_COLORS = ['#b3261e', '#1f5aa6', '#1d7a46', '#d9a21b', '#6b2d8a', '#c4561c', '#20707a', '#2b2b2b'];

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function toTex(canvas, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  return t;
}

function grime(ctx, w, h, rand, strength = 1) {
  // vertical rain streaks + speckle (tropical weathering)
  for (let i = 0; i < 70 * strength; i++) {
    const x = rand() * w, y = rand() * h, len = 20 + rand() * 120;
    const g = ctx.createLinearGradient(0, y, 0, y + len);
    g.addColorStop(0, `rgba(60,55,45,${0.05 + rand() * 0.08})`);
    g.addColorStop(1, 'rgba(60,55,45,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, 2 + rand() * 6, len);
  }
  for (let i = 0; i < 1500 * strength; i++) {
    ctx.fillStyle = `rgba(${rand() > 0.5 ? '0,0,0' : '255,255,255'},${rand() * 0.05})`;
    ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
}

// y measured from the bottom of a floor, in metres → canvas pixel row
const yPx = (floorIdx, m) => (2 - floorIdx) * PX - (m / FLOOR) * PX;
const xPx = (bay, m) => bay * PX + (m / BAY) * PX;

function windowPane(ctx, rough, x, y, w, h, rand) {
  // aluminium frame
  ctx.fillStyle = '#b9bcbd';
  ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
  rough.fillStyle = '#707070';
  rough.fillRect(x - 4, y - 4, w + 8, h + 8);
  // glass with sky reflection gradient
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#5d7286'); g.addColorStop(0.5, '#2c3a46'); g.addColorStop(1, '#1d262e');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  rough.fillStyle = '#141414';
  rough.fillRect(x, y, w, h);
  // curtains / open window / interior
  const r = rand();
  if (r < 0.35) {
    const cc = ['#d9c9a3', '#b98c7a', '#9fb3c8', '#e5e0d5', '#c9a0a8'][Math.floor(rand() * 5)];
    ctx.fillStyle = cc;
    const cw = w * (0.3 + rand() * 0.5);
    ctx.globalAlpha = 0.75;
    ctx.fillRect(rand() > 0.5 ? x : x + w - cw, y + 2, cw, h - 4);
    ctx.globalAlpha = 1;
    rough.fillStyle = '#c8c8c8';
    rough.fillRect(x, y, cw, h);
  } else if (r < 0.5) {
    ctx.fillStyle = 'rgba(10,12,14,0.85)';
    ctx.fillRect(x + w * 0.5, y, w * 0.5, h); // window swung open
  }
  // mullion
  ctx.fillStyle = '#a9acad';
  ctx.fillRect(x + w / 2 - 2, y, 4, h);
  ctx.fillRect(x, y + h * 0.35, w, 3);
}

function aircon(ctx, x, y) {
  ctx.fillStyle = '#d8d8d4';
  ctx.fillRect(x, y, 58, 40);
  ctx.strokeStyle = '#8a8a86'; ctx.lineWidth = 2;
  ctx.strokeRect(x, y, 58, 40);
  ctx.beginPath(); ctx.arc(x + 22, y + 20, 14, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x + 40, y + 8 + i * 8); ctx.lineTo(x + 54, y + 8 + i * 8); ctx.stroke(); }
}

function laundry(ctx, x, y, w, rand) {
  ctx.strokeStyle = '#c9b27a'; ctx.lineWidth = 3;
  for (let i = 0; i < 2; i++) { ctx.beginPath(); ctx.moveTo(x, y + i * 6); ctx.lineTo(x + w, y + i * 6); ctx.stroke(); }
  let cx = x + 4;
  while (cx < x + w - 14) {
    const cw = 10 + rand() * 22;
    ctx.fillStyle = ['#e4e4e0', '#2f4f8f', '#b83a3a', '#e0c04a', '#3f8a5a', '#f0a0b0', '#444'][Math.floor(rand() * 7)];
    ctx.fillRect(cx, y + 3, cw, 16 + rand() * 26);
    cx += cw + 3 + rand() * 6;
  }
}

/** HDB residential facade. kind: 'window' | 'corridor' */
export function hdbFacade(paletteIdx, kind, seed = 1) {
  const pal = HDB_PALETTES[paletteIdx % HDB_PALETTES.length];
  const rand = mulberry32(seed * 7919 + paletteIdx * 131 + (kind === 'corridor' ? 17 : 0));
  const [c, ctx] = makeCanvas(PX * 4, PX * 2);
  const [rc, rough] = makeCanvas(PX * 4, PX * 2);
  ctx.fillStyle = pal.wall; ctx.fillRect(0, 0, c.width, c.height);
  rough.fillStyle = '#dcdcdc'; rough.fillRect(0, 0, c.width, c.height);

  for (let f = 0; f < 2; f++) {
    // slab edge band
    ctx.fillStyle = pal.trim;
    ctx.fillRect(0, yPx(f, 0.28), c.width, (0.28 / FLOOR) * PX);
    for (let b = 0; b < 4; b++) {
      if (kind === 'window') {
        const wx = xPx(b, 0.95), ww = (1.7 / BAY) * PX;
        const wy = yPx(f, 2.35), wh = (1.35 / FLOOR) * PX;
        windowPane(ctx, rough, wx, wy, ww, wh, rand);
        if (rand() < 0.45) aircon(ctx, xPx(b, 2.7), yPx(f, 0.95));
        if (rand() < 0.3) laundry(ctx, wx - 10, yPx(f, 0.9), ww + 20, rand);
        // accent column every other bay
        if (b % 2 === 1) { ctx.fillStyle = pal.accent; ctx.fillRect(xPx(b, 3.45), 0, (0.15 / BAY) * PX, c.height); }
      } else {
        // corridor: parapet + dark recess with doors and gates
        const top = yPx(f, 2.75), par = yPx(f, 1.05);
        ctx.fillStyle = '#2a2a28';
        ctx.fillRect(xPx(b, 0), top, PX, par - top);
        rough.fillStyle = '#b4b4b4';
        rough.fillRect(xPx(b, 0), top, PX, par - top);
        // door + metal gate
        ctx.fillStyle = ['#6b4a2f', '#7a2e2a', '#3c5a7a', '#5a5a5a'][Math.floor(rand() * 4)];
        ctx.fillRect(xPx(b, 0.5), yPx(f, 2.4), (0.95 / BAY) * PX, yPx(f, 1.05) - yPx(f, 2.4));
        ctx.strokeStyle = 'rgba(150,150,150,0.6)'; ctx.lineWidth = 2;
        for (let i = 0; i < 8; i++) { const gx = xPx(b, 0.5) + i * 9; ctx.beginPath(); ctx.moveTo(gx, yPx(f, 2.4)); ctx.lineTo(gx, yPx(f, 1.05)); ctx.stroke(); }
        // kitchen window with grille
        ctx.fillStyle = '#3d4a52';
        ctx.fillRect(xPx(b, 2.0), yPx(f, 2.3), (1.1 / BAY) * PX, (0.8 / FLOOR) * PX);
        // parapet + accent stripe
        ctx.fillStyle = pal.wall;
        ctx.fillRect(xPx(b, 0), par, PX, yPx(f, 0) - par);
        ctx.fillStyle = pal.accent;
        ctx.fillRect(xPx(b, 0), par, PX, 8);
        // potted plants / shoe racks on the parapet
        if (rand() < 0.5) {
          for (let i = 0; i < 3; i++) {
            ctx.fillStyle = ['#3e7a35', '#5a8f3b', '#2f6b3a'][Math.floor(rand() * 3)];
            ctx.beginPath(); ctx.arc(xPx(b, 1.6 + i * 0.5), par - 10, 10 + rand() * 8, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
    }
  }
  grime(ctx, c.width, c.height, rand);
  return { map: toTex(c), roughnessMap: toTex(rc, false) };
}

/** Ground-floor shop band, 2 shops per tile (u = 1 per 6 m, v = 1 per 4 m). */
export function shopFacade(seed = 1) {
  const rand = mulberry32(seed * 31 + 7);
  const W = PX * 4, H = PX;
  const [c, ctx] = makeCanvas(W, H);
  const [rc, rough] = makeCanvas(W, H);
  ctx.fillStyle = '#d9d4c8'; ctx.fillRect(0, 0, W, H);
  rough.fillStyle = '#d0d0d0'; rough.fillRect(0, 0, W, H);
  for (let s = 0; s < 2; s++) {
    const x0 = s * W / 2;
    const signY = H * 0.08, signH = H * 0.2;
    const col = SIGN_COLORS[Math.floor(rand() * SIGN_COLORS.length)];
    ctx.fillStyle = col; ctx.fillRect(x0 + 20, signY, W / 2 - 40, signH);
    ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.floor(signH * 0.55)}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(SHOPS[Math.floor(rand() * SHOPS.length)], x0 + W / 4, signY + signH / 2 + 2);
    const oy = H * 0.34, oh = H - oy - 6;
    if (rand() < 0.25) {
      // roller shutter
      ctx.fillStyle = '#9a9c9c'; ctx.fillRect(x0 + 24, oy, W / 2 - 48, oh);
      ctx.strokeStyle = 'rgba(60,60,60,0.5)'; ctx.lineWidth = 2;
      for (let y = oy; y < oy + oh; y += 6) { ctx.beginPath(); ctx.moveTo(x0 + 24, y); ctx.lineTo(x0 + W / 2 - 24, y); ctx.stroke(); }
    } else {
      // open shop: warm interior with shelves / tables
      const g = ctx.createLinearGradient(0, oy, 0, oy + oh);
      g.addColorStop(0, '#f1e2bf'); g.addColorStop(1, '#8a6a46');
      ctx.fillStyle = g; ctx.fillRect(x0 + 24, oy, W / 2 - 48, oh);
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = `hsl(${rand() * 360},45%,${40 + rand() * 25}%)`;
        ctx.fillRect(x0 + 34 + rand() * (W / 2 - 120), oy + 20 + rand() * (oh - 60), 30 + rand() * 60, 14 + rand() * 30);
      }
      rough.fillStyle = '#303030'; rough.fillRect(x0 + 24, oy, W / 2 - 48, oh); // glass
    }
    // column between shops (five-foot way pillar)
    ctx.fillStyle = '#e6e1d6'; ctx.fillRect(x0, 0, 20, H); ctx.fillRect(x0 + W / 2 - 20, 0, 20, H);
  }
  grime(ctx, W, H, rand, 0.5);
  return { map: toTex(c), roughnessMap: toTex(rc, false) };
}

/** Mall / office curtain wall. */
export function glassFacade(seed = 1, tint = '#4b6a73') {
  const rand = mulberry32(seed * 97 + 3);
  const [c, ctx] = makeCanvas(PX * 4, PX * 2);
  const [rc, rough] = makeCanvas(PX * 4, PX * 2);
  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, tint); g.addColorStop(1, '#3c525a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
  rough.fillStyle = '#121212'; rough.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = `rgba(255,255,255,${rand() * 0.06})`;
    ctx.fillRect(rand() * c.width, rand() * c.height, 40 + rand() * 120, 20 + rand() * 80);
  }
  ctx.fillStyle = '#c9ccce';
  rough.fillStyle = '#5a5a5a';
  for (let x = 0; x <= c.width; x += PX / 2) { ctx.fillRect(x - 3, 0, 6, c.height); rough.fillRect(x - 3, 0, 6, c.height); }
  for (let f = 0; f < 2; f++) {
    const y = yPx(f, 0);
    ctx.fillStyle = '#d8d6d0'; ctx.fillRect(0, y - 26, c.width, 26);
    rough.fillStyle = '#c0c0c0'; rough.fillRect(0, y - 26, c.width, 26);
  }
  return { map: toTex(c), roughnessMap: toTex(rc, false) };
}

/** Multi-storey carpark open decks. */
export function carparkFacade(seed = 1, accent = '#c8873a') {
  const rand = mulberry32(seed * 13 + 5);
  const [c, ctx] = makeCanvas(PX * 4, PX * 2);
  const [rc, rough] = makeCanvas(PX * 4, PX * 2);
  ctx.fillStyle = '#d4d1c8'; ctx.fillRect(0, 0, c.width, c.height);
  rough.fillStyle = '#e0e0e0'; rough.fillRect(0, 0, c.width, c.height);
  for (let f = 0; f < 2; f++) {
    const top = yPx(f, 2.7), par = yPx(f, 1.1);
    ctx.fillStyle = '#1e1f1f'; ctx.fillRect(0, top, c.width, par - top);
    // car silhouettes inside
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = `rgba(${60 + rand() * 80},${60 + rand() * 80},${60 + rand() * 80},0.5)`;
      ctx.fillRect(rand() * c.width, par - 40, 90, 34);
    }
    ctx.fillStyle = accent; ctx.fillRect(0, par, c.width, 10);
  }
  for (let b = 0; b < 4; b++) { ctx.fillStyle = '#cfcbc1'; ctx.fillRect(b * PX, 0, 22, c.height); }
  grime(ctx, c.width, c.height, rand);
  return { map: toTex(c), roughnessMap: toTex(rc, false) };
}

/** Low civic / generic building: painted concrete with ribbon windows. */
export function civicFacade(seed = 1, wall = '#e2ddd2', accent = '#8a3b32') {
  const rand = mulberry32(seed * 53 + 11);
  const [c, ctx] = makeCanvas(PX * 4, PX * 2);
  const [rc, rough] = makeCanvas(PX * 4, PX * 2);
  ctx.fillStyle = wall; ctx.fillRect(0, 0, c.width, c.height);
  rough.fillStyle = '#d8d8d8'; rough.fillRect(0, 0, c.width, c.height);
  for (let f = 0; f < 2; f++) {
    const wy = yPx(f, 2.5), wh = (1.5 / FLOOR) * PX;
    for (let b = 0; b < 4; b++) windowPane(ctx, rough, xPx(b, 0.3), wy, (3.0 / BAY) * PX, wh, rand);
    ctx.fillStyle = accent; ctx.fillRect(0, yPx(f, 0.3), c.width, 10);
  }
  grime(ctx, c.width, c.height, rand);
  return { map: toTex(c), roughnessMap: toTex(rc, false) };
}
