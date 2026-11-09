#!/usr/bin/env node
/**
 * Builds the sprite reference library used by the Box Scanner.
 *
 * Downloads every Pokémon / costume storage icon (normal + shiny, female variants,
 * cosmetic variants) and reduces each one to a tiny fingerprint: the sprite cropped
 * to its outline and resampled to SIZE×SIZE RGBA. Output: public/data/sprites.json
 *
 * Run after build-data.mjs (it reads public/data/pokemon.json & costumes.json).
 * Usage: node scripts/build-sprites.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'icons');
const DATA = path.join(ROOT, 'public', 'data');
export const SIZE = 16;
fs.mkdirSync(CACHE, { recursive: true });

const PM = 'https://raw.githubusercontent.com/PokeMiners/pogo_assets/master/Images/Pokemon/Addressable%20Assets/';
const LD = 'https://cdn.leekduck.com/assets/img/pokemon_icons/';

// ---------------------------------------------------------------- minimal PNG decoder (8-bit, non-interlaced)
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let pos = 8, width = 0, height = 0, depth = 0, type = 0, palette = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), name = buf.toString('ascii', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (name === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9]; if (data[12]) throw new Error('interlaced'); }
    else if (name === 'PLTE') palette = data;
    else if (name === 'tRNS') trns = data;
    else if (name === 'IDAT') idat.push(data);
    else if (name === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8) throw new Error(`bit depth ${depth}`);
  const ch = { 6: 4, 2: 3, 0: 1, 4: 2, 3: 1 }[type];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch, out = Buffer.alloc(width * height * ch);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[dst + x - ch] : 0, b = y ? out[dst - stride + x] : 0, c = x >= ch && y ? out[dst - stride + x - ch] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + x] = v & 255;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    let r, g, b, al = 255;
    if (type === 6) { r = out[i * 4]; g = out[i * 4 + 1]; b = out[i * 4 + 2]; al = out[i * 4 + 3]; }
    else if (type === 2) { r = out[i * 3]; g = out[i * 3 + 1]; b = out[i * 3 + 2]; }
    else if (type === 0) { r = g = b = out[i]; }
    else if (type === 4) { r = g = b = out[i * 2]; al = out[i * 2 + 1]; }
    else { const k = out[i]; r = palette[k * 3]; g = palette[k * 3 + 1]; b = palette[k * 3 + 2]; al = trns && k < trns.length ? trns[k] : 255; }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = al;
  }
  return { width, height, rgba };
}

// ---------------------------------------------------------------- fingerprint (shared algorithm with src/lib/scanner.ts)
/** Crop to alpha bbox, fit into SIZE×SIZE keeping aspect, area-average. Returns RGBA bytes + aspect. */
function fingerprint({ width, height, rgba }) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (rgba[(y * width + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, scale = Math.max(bw, bh) / SIZE;
  const ox = (SIZE - bw / scale) / 2, oy = (SIZE - bh / scale) / 2;
  const acc = new Float64Array(SIZE * SIZE * 5);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const tx = Math.min(SIZE - 1, Math.floor((x - x0) / scale + ox)), ty = Math.min(SIZE - 1, Math.floor((y - y0) / scale + oy));
    const i = (y * width + x) * 4, a = rgba[i + 3] / 255, k = (ty * SIZE + tx) * 5;
    acc[k] += rgba[i] * a; acc[k + 1] += rgba[i + 1] * a; acc[k + 2] += rgba[i + 2] * a; acc[k + 3] += a; acc[k + 4] += 1;
  }
  const out = Buffer.alloc(SIZE * SIZE * 4);
  for (let c = 0; c < SIZE * SIZE; c++) {
    const k = c * 5, a = acc[k + 3], n = acc[k + 4];
    if (a > 0) { out[c * 4] = Math.round(acc[k] / a); out[c * 4 + 1] = Math.round(acc[k + 1] / a); out[c * 4 + 2] = Math.round(acc[k + 2] / a); }
    out[c * 4 + 3] = n ? Math.round((a / Math.max(n, (scale * scale) * 0.999)) * 255) : 0;
  }
  return { fp: out, aspect: bw / bh };
}

async function fetchIcon(name) {
  const file = path.join(CACHE, name);
  if (fs.existsSync(file)) return fs.statSync(file).size > 100 ? fs.readFileSync(file) : null;
  for (const base of [PM, LD]) {
    try {
      const res = await fetch(base + name);
      if (res.ok) { const b = Buffer.from(await res.arrayBuffer()); if (b.readUInt32BE(0) === 0x89504e47) { fs.writeFileSync(file, b); return b; } }
    } catch { /* try next */ }
  }
  fs.writeFileSync(file, 'missing'); // negative cache
  return null;
}

async function main() {
  const pokemon = JSON.parse(fs.readFileSync(path.join(DATA, 'pokemon.json'), 'utf8'));
  const costumes = JSON.parse(fs.readFileSync(path.join(DATA, 'costumes.json'), 'utf8'));
  let tree = [];
  try { tree = JSON.parse(fs.readFileSync(path.join(ROOT, '.cache', 'assets_tree.json'), 'utf8')).tree.map((x) => x.path); } catch { /* optional */ }
  const files = new Set(tree);

  // Each job: icon file → reference { pokemon id, costume id?, shiny, female }
  const jobs = [];
  const add = (img, ref) => { jobs.push({ name: `${img}${ref.shiny ? '.s' : ''}.icon.png`, ref }); };
  const ownImgs = new Set(pokemon.map((p) => p.img));
  for (const p of pokemon) {
    if (!p.released) continue;
    for (const shiny of [false, true]) {
      add(p.img, { id: p.id, shiny });
      if (files.has(`${p.img}.g2.icon.png`)) add(`${p.img}.g2`, { id: p.id, shiny, female: true });
    }
    // Cosmetic variants collapsed into this entry (Unown letters, Vivillon patterns, …)
    if (p.variants && !p.form) {
      const prefix = `pm${p.dex}.f`;
      for (const f of files) {
        if (!f.startsWith(prefix) || !/^pm\d+\.f[A-Z0-9_]+\.icon\.png$/.test(f)) continue;
        const img = f.replace('.icon.png', '');
        if (ownImgs.has(img) || costumes.some((c) => c.img === img)) continue;
        for (const shiny of [false, true]) add(img, { id: p.id, shiny, variant: img.split('.f')[1] });
      }
    }
  }
  for (const c of costumes) for (const shiny of [false, true]) add(c.img, { id: c.base, costume: c.id, shiny });

  console.log(`Fingerprinting ${jobs.length} sprites…`);
  const refs = [];
  const chunks = [];
  let missing = 0, i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const job = jobs[i++];
      const buf = await fetchIcon(job.name);
      if (!buf) { missing++; continue; }
      try {
        const f = fingerprint(decodePng(buf));
        if (!f) continue;
        refs.push({ ...job.ref, aspect: Math.round(f.aspect * 1000) / 1000, fp: f.fp });
      } catch (e) { missing++; }
    }
  };
  await Promise.all(Array.from({ length: 16 }, worker));
  refs.sort((a, b) => (a.id + (a.costume || '') + (a.shiny ? 1 : 0)).localeCompare(b.id + (b.costume || '') + (b.shiny ? 1 : 0)));
  for (const r of refs) chunks.push(r.fp);
  const out = {
    size: SIZE,
    refs: refs.map(({ fp, ...r }) => r),
    data: Buffer.concat(chunks).toString('base64'),
  };
  fs.writeFileSync(path.join(DATA, 'sprites.json'), JSON.stringify(out));
  console.log(`  → sprites.json: ${refs.length} references (${missing} unavailable), ${(fs.statSync(path.join(DATA, 'sprites.json')).size / 1024).toFixed(0)} KB`);
}

main().catch((e) => { console.error(e); process.exit(1); });
