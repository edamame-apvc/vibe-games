// Downloads the CC0 Poly Haven assets listed in src/assetList.js into public/assets/.
// Safe to run repeatedly: files that already exist with the right size are skipped.
// Assets are git-ignored (they are large), so every machine runs this once (`npm run dev` does it for you).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEXTURES, TEXTURE_MAPS, TEXTURE_RESOLUTIONS, HDRI, MODELS } from '../src/assetList.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');
const API = 'https://api.polyhaven.com/files/';
const CONCURRENCY = 6;

const jobs = []; // { url, dest, size }

async function apiFiles(name) {
  const res = await fetch(API + name);
  if (!res.ok) throw new Error(`Poly Haven API ${res.status} for ${name}`);
  return res.json();
}

async function plan() {
  for (const [key, name] of Object.entries(TEXTURES)) {
    const files = await apiFiles(name);
    for (const res of TEXTURE_RESOLUTIONS) {
      for (const [map, local] of Object.entries(TEXTURE_MAPS)) {
        const f = files[map]?.[res]?.jpg;
        if (!f) throw new Error(`Missing ${map} ${res} for ${name}`);
        jobs.push({ url: f.url, dest: path.join(ROOT, 'textures', key, res, `${local}.jpg`), size: f.size });
      }
    }
  }

  const hdri = await apiFiles(HDRI.name);
  for (const res of HDRI.resolutions) {
    const f = hdri.hdri[res].hdr;
    jobs.push({ url: f.url, dest: path.join(ROOT, 'hdri', `sky_${res}.hdr`), size: f.size });
  }

  for (const name of MODELS) {
    const files = await apiFiles(name);
    const g = files.gltf?.['1k']?.gltf;
    if (!g) throw new Error(`No glTF for ${name}`);
    const dir = path.join(ROOT, 'models', name);
    jobs.push({ url: g.url, dest: path.join(dir, `${name}.gltf`), size: g.size });
    for (const [rel, inc] of Object.entries(g.include || {})) {
      jobs.push({ url: inc.url, dest: path.join(dir, ...rel.split('/')), size: inc.size });
    }
  }
}

function alreadyHave(job) {
  try { return fs.statSync(job.dest).size === job.size; } catch { return false; }
}

async function download(job, attempt = 1) {
  try {
    const res = await fetch(job.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(job.dest), { recursive: true });
    fs.writeFileSync(job.dest + '.part', buf);
    fs.renameSync(job.dest + '.part', job.dest);
  } catch (err) {
    if (attempt < 4) return download(job, attempt + 1);
    throw new Error(`Failed ${job.url}: ${err.message}`);
  }
}

async function main() {
  const marker = path.join(ROOT, '.complete');
  const signature = JSON.stringify({ TEXTURES, TEXTURE_MAPS, TEXTURE_RESOLUTIONS, HDRI, MODELS });
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === signature) {
    console.log('[assets] up to date');
    return;
  }

  console.log('[assets] checking Poly Haven…');
  await plan();
  const todo = jobs.filter((j) => !alreadyHave(j));
  const totalMB = todo.reduce((s, j) => s + j.size, 0) / 1e6;
  console.log(`[assets] ${todo.length} of ${jobs.length} files to download (${totalMB.toFixed(0)} MB)`);

  let done = 0;
  const queue = [...todo];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const job = queue.shift();
      await download(job);
      done++;
      if (done % 10 === 0 || done === todo.length) console.log(`[assets] ${done}/${todo.length}`);
    }
  }));

  fs.writeFileSync(path.join(ROOT, 'CREDITS.txt'),
    'All textures, HDRIs and models in this folder are CC0 from Poly Haven (https://polyhaven.com).\n');
  fs.writeFileSync(marker, signature);
  console.log('[assets] done');
}

main().catch((err) => { console.error('[assets]', err.message); process.exit(1); });
