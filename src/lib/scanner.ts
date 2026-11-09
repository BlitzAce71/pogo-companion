// Box Scanner engine: identifies Pokémon in screenshots / video frames of the storage grid by
// comparing each tile's sprite against fingerprints of every storage icon (public/data/sprites.json,
// built by scripts/build-sprites.mjs). Pure functions over RGBA pixel buffers so it can run in the
// browser or in node tests.

export interface Pixels { width: number; height: number; data: Uint8ClampedArray | Uint8Array }
export interface Rect { x: number; y: number; w: number; h: number }

export interface SpriteRef { id: string; costume?: string; shiny: boolean; female?: boolean; variant?: string; aspect: number }
export interface SpriteLibrary { size: number; refs: SpriteRef[]; fp: Uint8Array; coarse: Float32Array }

export interface Fingerprint { fp: Uint8Array; aspect: number; coverage: number; /** outline used, within the box: x0, y0, x1, y1 */ bbox?: [number, number, number, number] }
export interface Candidate { ref: SpriteRef; index: number; score: number }
export interface MatchResult { best: Candidate | null; alternatives: Candidate[]; confidence: number }

const SIZE = 16;
const COARSE = 4; // coarse grid used to pre-filter references

// ---------------------------------------------------------------- library
export function parseLibrary(json: { size: number; refs: SpriteRef[]; data: string }): SpriteLibrary {
  const bin = Uint8Array.from(atob(json.data), (c) => c.charCodeAt(0)); // atob exists in browsers and Node 16+
  const n = json.refs.length;
  const coarse = new Float32Array(n * COARSE * COARSE * 4);
  for (let r = 0; r < n; r++) coarsen(bin.subarray(r * SIZE * SIZE * 4, (r + 1) * SIZE * SIZE * 4), coarse, r * COARSE * COARSE * 4);
  return { size: json.size, refs: json.refs, fp: bin, coarse };
}

let libPromise: Promise<SpriteLibrary> | null = null;
export function loadLibrary(): Promise<SpriteLibrary> {
  if (!libPromise) {
    libPromise = fetch(`${import.meta.env.BASE_URL}data/sprites.json`)
      .then((r) => { if (!r.ok) throw new Error(`sprites.json ${r.status}`); return r.json(); })
      .then(parseLibrary)
      .catch((e) => { libPromise = null; throw e; });
  }
  return libPromise;
}

/** 4×4 summary (alpha-weighted colour + coverage) of a 16×16 fingerprint */
function coarsen(fp: Uint8Array, out: Float32Array, o: number) {
  const k = SIZE / COARSE;
  for (let cy = 0; cy < COARSE; cy++) for (let cx = 0; cx < COARSE; cx++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let y = 0; y < k; y++) for (let x = 0; x < k; x++) {
      const i = ((cy * k + y) * SIZE + cx * k + x) * 4, al = fp[i + 3] / 255;
      r += fp[i] * al; g += fp[i + 1] * al; b += fp[i + 2] * al; a += al;
    }
    const j = o + (cy * COARSE + cx) * 4;
    out[j] = a ? r / a : 0; out[j + 1] = a ? g / a : 0; out[j + 2] = a ? b / a : 0; out[j + 3] = a / (k * k);
  }
}

// ---------------------------------------------------------------- segmentation
const px = (p: Pixels, x: number, y: number) => (y * p.width + x) * 4;
const cdist = (r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) => {
  // weighted RGB distance (rough perceptual weighting)
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db) / 3;
};

/** Median colour of a rectangle's border — the tile background */
export function borderColor(p: Pixels, r: Rect): [number, number, number] {
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  const push = (x: number, y: number) => { const i = px(p, x, y); rs.push(p.data[i]); gs.push(p.data[i + 1]); bs.push(p.data[i + 2]); };
  for (let x = r.x; x < r.x + r.w; x++) { push(x, r.y); push(x, r.y + r.h - 1); }
  for (let y = r.y; y < r.y + r.h; y++) { push(r.x, y); push(r.x + r.w - 1, y); }
  const med = (a: number[]) => a.sort((m, n) => m - n)[a.length >> 1];
  return [med(rs), med(gs), med(bs)];
}

/**
 * Foreground mask for a sprite region: pixels that differ from the background, plus any
 * background-coloured "holes" fully enclosed by the sprite (e.g. white bellies on a white tile).
 */
// Threshold tuned on real recordings: 13 keeps pale Pokémon (Seel, Goldeen, Galarian Corsola) from
// fading into the near-white storage background without picking up compression noise.
export function spriteMask(p: Pixels, r: Rect, bg: [number, number, number], threshold = 13): Float32Array {
  const { w, h } = r;
  const m = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = px(p, r.x + x, r.y + y);
    const d = cdist(p.data[i], p.data[i + 1], p.data[i + 2], bg[0], bg[1], bg[2]);
    m[y * w + x] = Math.max(0, Math.min(1, (d - threshold * 0.6) / threshold));
  }
  // flood-fill background from the border; unreached low-contrast pixels are enclosed → foreground
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
  while (stack.length) {
    const k = stack.pop()!;
    if (seen[k] || m[k] >= 0.5) continue;
    seen[k] = 1;
    const x = k % w, y = (k / w) | 0;
    if (x > 0) stack.push(k - 1); if (x < w - 1) stack.push(k + 1);
    if (y > 0) stack.push(k - w); if (y < h - 1) stack.push(k + w);
  }
  for (let k = 0; k < w * h; k++) if (!seen[k] && m[k] < 0.5) m[k] = 1;
  dropSmallParts(m, w, h);
  return m;
}

/**
 * Remove small separate blobs that poke in from the edge of the box (letters of the name, the
 * favourite star, tag icons) so only the Pokémon's picture is fingerprinted. Small pieces fully
 * inside the box are kept — they're usually part of the sprite (e.g. Magnemite's magnets).
 */
function dropSmallParts(m: Float32Array, w: number, h: number) {
  const label = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const edge: boolean[] = [];
  const topBottom: boolean[] = [];
  const boxes: [number, number, number, number][] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (m[start] < 0.5 || label[start] >= 0) continue;
    const id = sizes.length;
    let size = 0, touches = false, tb = false, bx0 = w, by0 = h, bx1 = 0, by1 = 0;
    stack.push(start);
    label[start] = id;
    while (stack.length) {
      const k = stack.pop()!;
      size++;
      const x = k % w, y = (k / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
      if (y === 0 || y === h - 1) tb = true;
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const n = yy * w + xx;
        if (m[n] >= 0.5 && label[n] < 0) { label[n] = id; stack.push(n); }
      }
    }
    sizes.push(size);
    edge.push(touches);
    topBottom.push(tb);
    boxes.push([bx0, by0, bx1, by1]);
  }
  if (sizes.length < 2) return;
  // Edge-touching blobs other than the main one are intruders unless they're big (the favourite star
  // can be ~20% the size of a small Pokémon like Caterpie, so the bar is half the main blob).
  const largest = Math.max(...sizes), keepEdge = largest * 0.5;
  // Text cut by the top or bottom of the box (CP digits, the name) is wide and short. It's never the
  // Pokémon, even when it's the biggest blob next to a tiny sprite — as long as something else is there.
  const isText = sizes.map((_, id) => {
    if (!topBottom[id]) return false;
    const [x0, y0, x1, y1] = boxes[id], bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    return bh <= h * 0.3 && bw >= bh * 1.3;
  });
  const others = sizes.reduce((s, n, id) => (isText[id] ? s : s + n), 0);
  for (let k = 0; k < w * h; k++) {
    const id = label[k];
    if (id < 0) continue;
    if (isText[id] && others >= 20) { m[k] = 0; continue; }
    if (edge[id] && sizes[id] < keepEdge && sizes[id] !== largest) m[k] = 0;
  }
}

/** Fingerprint a sprite inside rect r of an image (same algorithm as build-sprites.mjs). */
export function fingerprintRegion(p: Pixels, r: Rect, bg?: [number, number, number]): Fingerprint | null {
  const background = bg || borderColor(p, r);
  const m = spriteMask(p, r, background);
  const { w, h } = r;
  // bounding box of solid foreground, ignoring rows/cols with only a couple of stray pixels
  const rowSum = new Float32Array(h), colSum = new Float32Array(w);
  let total = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = m[y * w + x] > 0.5 ? 1 : 0; rowSum[y] += v; colSum[x] += v; total += v; }
  if (total < 20) return null;
  const minRun = 2;
  let x0 = 0, x1 = w - 1, y0 = 0, y1 = h - 1;
  while (x0 < w && colSum[x0] < minRun) x0++;
  while (x1 > x0 && colSum[x1] < minRun) x1--;
  while (y0 < h && rowSum[y0] < minRun) y0++;
  while (y1 > y0 && rowSum[y1] < minRun) y1--;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  if (bw < 4 || bh < 4) return null;
  const scale = Math.max(bw, bh) / SIZE;
  const ox = (SIZE - bw / scale) / 2, oy = (SIZE - bh / scale) / 2;
  const acc = new Float64Array(SIZE * SIZE * 5);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const tx = Math.min(SIZE - 1, Math.floor((x - x0) / scale + ox)), ty = Math.min(SIZE - 1, Math.floor((y - y0) / scale + oy));
    const i = px(p, r.x + x, r.y + y), a = m[y * w + x], k = (ty * SIZE + tx) * 5;
    acc[k] += p.data[i] * a; acc[k + 1] += p.data[i + 1] * a; acc[k + 2] += p.data[i + 2] * a; acc[k + 3] += a; acc[k + 4] += 1;
  }
  const fp = new Uint8Array(SIZE * SIZE * 4);
  let cov = 0;
  for (let c = 0; c < SIZE * SIZE; c++) {
    const k = c * 5, a = acc[k + 3], n = acc[k + 4];
    if (a > 0) { fp[c * 4] = Math.round(acc[k] / a); fp[c * 4 + 1] = Math.round(acc[k + 1] / a); fp[c * 4 + 2] = Math.round(acc[k + 2] / a); }
    const al = n ? a / Math.max(n, scale * scale * 0.999) : 0;
    fp[c * 4 + 3] = Math.round(al * 255);
    cov += al;
  }
  return { fp, aspect: bw / bh, coverage: cov / (SIZE * SIZE), bbox: [x0, y0, x1, y1] };
}

/**
 * Diagnostic image of what the scanner cut out of a box: pixels it treated as background are dimmed,
 * and the outline it used for the Pokémon is drawn in magenta.
 */
export function cutoutPreview(p: Pixels, r: Rect, f: Fingerprint | null): { w: number; h: number; data: Uint8ClampedArray } {
  const m = spriteMask(p, r, borderColor(p, r));
  const { w, h } = r;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = px(p, r.x + x, r.y + y), o = (y * w + x) * 4, a = m[y * w + x] >= 0.5 ? 1 : 0.22;
    data[o] = p.data[i] * a + 40 * (1 - a); data[o + 1] = p.data[i + 1] * a + 40 * (1 - a); data[o + 2] = p.data[i + 2] * a + 48 * (1 - a); data[o + 3] = 255;
  }
  if (f?.bbox) {
    const [x0, y0, x1, y1] = f.bbox;
    const dot = (x: number, y: number) => { const o = (y * w + x) * 4; data[o] = 255; data[o + 1] = 0; data[o + 2] = 200; };
    for (let x = x0; x <= x1; x++) { dot(x, y0); dot(x, y1); }
    for (let y = y0; y <= y1; y++) { dot(x0, y); dot(x1, y); }
  }
  return { w, h, data };
}

// ---------------------------------------------------------------- matching
function fullDistance(a: Uint8Array, b: Uint8Array, bo: number): number {
  let shape = 0, color = 0, wsum = 0;
  for (let c = 0; c < SIZE * SIZE; c++) {
    const i = c * 4, j = bo + i;
    const aa = a[i + 3] / 255, ab = b[j + 3] / 255;
    shape += (aa - ab) * (aa - ab);
    const wgt = Math.min(aa, ab);
    if (wgt > 0.15) {
      color += wgt * cdist(a[i], a[i + 1], a[i + 2], b[j], b[j + 1], b[j + 2]);
      wsum += wgt;
    }
  }
  const colorTerm = wsum ? color / wsum : 120;
  return colorTerm + (shape / (SIZE * SIZE)) * 220;
}

function coarseDistance(a: Float32Array, b: Float32Array, bo: number): number {
  let d = 0;
  for (let c = 0; c < COARSE * COARSE; c++) {
    const i = c * 4, j = bo + i;
    const wgt = Math.min(a[i + 3], b[j + 3]);
    d += (a[i + 3] - b[j + 3]) * (a[i + 3] - b[j + 3]) * 300 + wgt * cdist(a[i], a[i + 1], a[i + 2], b[j], b[j + 1], b[j + 2]);
  }
  return d;
}

export interface MatchOptions {
  filter?: (ref: SpriteRef) => boolean;
  /** Extra score added to a reference (rare answers like Megas need a clearly better match) */
  prior?: (ref: SpriteRef) => number;
  shortlist?: number;
}

/** Find the closest references to a fingerprint. Confidence 0–1 compares the best to the best *different* answer. */
export function matchFingerprint(lib: SpriteLibrary, f: Fingerprint, opts: MatchOptions = {}): MatchResult {
  const n = lib.refs.length;
  const coarse = new Float32Array(COARSE * COARSE * 4);
  coarsen(f.fp, coarse, 0);
  const pre: { i: number; d: number }[] = [];
  for (let r = 0; r < n; r++) {
    const ref = lib.refs[r];
    if (opts.filter && !opts.filter(ref)) continue;
    const asp = Math.log(f.aspect / ref.aspect);
    pre.push({ i: r, d: coarseDistance(coarse, lib.coarse, r * COARSE * COARSE * 4) + asp * asp * 400 });
  }
  pre.sort((a, b) => a.d - b.d);
  const shortlist = pre.slice(0, opts.shortlist ?? 80);
  const scored: Candidate[] = shortlist.map(({ i }) => {
    const ref = lib.refs[i];
    const asp = Math.log(f.aspect / ref.aspect);
    return { ref, index: i, score: fullDistance(f.fp, lib.fp, i * SIZE * SIZE * 4) + asp * asp * 60 + (opts.prior ? opts.prior(ref) : 0) };
  }).sort((a, b) => a.score - b.score);
  // keep one candidate per distinct answer (id + costume + shiny)
  const seen = new Set<string>();
  const alternatives: Candidate[] = [];
  for (const c of scored) {
    const k = answerKey(c.ref);
    if (seen.has(k)) continue;
    seen.add(k);
    alternatives.push(c);
    if (alternatives.length >= 6) break;
  }
  const best = alternatives[0] || null;
  const second = alternatives[1];
  const confidence = !best ? 0 : !second ? 1 : Math.max(0, Math.min(1, (second.score - best.score) / Math.max(4, best.score * 0.6)));
  return { best, alternatives, confidence };
}

export const answerKey = (r: SpriteRef) => `${r.id}|${r.costume || ''}|${r.shiny ? 1 : 0}`;

// ---------------------------------------------------------------- grid geometry
export interface GridCalibration {
  /** Calibration format. 2 = anchored on the CP number of each tile. */
  version: number;
  /** Anchor (CP number centre) of the first tile (column 0) and horizontal/vertical pitch, in frame pixels at the analysis width */
  x0: number; pitchX: number; pitchY: number;
  /** Picture box size relative to pitch (0–1) */
  boxW: number; boxH: number;
  /** Picture box centre below the anchor, as a fraction of the row pitch */
  offsetY: number;
  /** Anchor y of the first row on the calibration frame */
  y0: number;
  /** Scrollable grid area (rows outside are ignored) */
  top: number; bottom: number;
  columns: number;
  /** Analysis width the calibration was made at */
  width: number;
  /** Foreground pattern of one row period (index 0 = anchor), learned from the calibration frame */
  rowTemplate?: number[];
}

/** A calibration is only usable if every measurement is a sensible number (guards against corrupt saved data). */
export function validCalibration(c: GridCalibration | null | undefined, width?: number): c is GridCalibration {
  if (!c) return false;
  if (c.version !== 2) return false; // older calibrations used a different anchor — redo the clicks
  const nums = [c.x0, c.pitchX, c.pitchY, c.boxW, c.boxH, c.offsetY, c.top, c.bottom, c.width, c.columns];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  if (c.pitchX < 20 || c.pitchY < 20 || c.boxW <= 0 || c.boxH <= 0 || c.bottom <= c.top || c.columns < 1) return false;
  return width === undefined || c.width === width;
}

const isTextPx = (p: Pixels, x: number, y: number) => {
  const i = px(p, x, y), r = p.data[i], g = p.data[i + 1], b = p.data[i + 2];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx < 130 && mx - mn < 45; // dark slate-grey text (CP numbers, names)
};

/** Rows [a, b] of the text band nearest y (counting text pixels across the given x ranges). */
function textBandNear(p: Pixels, y: number, xs: [number, number][], minPerRow: number, search: number): [number, number] | null {
  const count = (yy: number) => {
    if (yy < 0 || yy >= p.height) return 0;
    let n = 0;
    for (const [xa, xb] of xs) for (let x = Math.max(0, xa); x < Math.min(p.width, xb); x++) if (isTextPx(p, x, yy)) n++;
    return n;
  };
  const isRow = (yy: number) => count(yy) >= minPerRow;
  let c = -1;
  for (let d = 0; d <= search && c < 0; d++) { if (isRow(y + d)) c = y + d; else if (isRow(y - d)) c = y - d; }
  if (c < 0) return null;
  let a = c, b = c;
  while (a > c - search && (isRow(a - 1) || isRow(a - 2))) a--;
  while (b < c + search && (isRow(b + 1) || isRow(b + 2))) b++;
  return [a, b];
}

/**
 * Refine a rough calibration from the frame itself, so clicks only need to land roughly on the two CP
 * numbers: measures the CP-label columns (x positions & spacing), the next row's CP labels (row spacing),
 * and fits the picture box between the CP number and the name. Returns null if text can't be found.
 */
export function autoFitBox(p: Pixels, cal: GridCalibration): Partial<GridCalibration> | null {
  const y0 = Math.round(cal.y0);
  const full: [number, number][] = [[0, p.width]];
  // 1. CP band of the first row, across the whole width
  const band = textBandNear(p, y0, full, 6, Math.round(cal.pitchY * 0.12));
  if (!band) return null;
  const [a, b] = band;
  // 2. Column clusters of text within that band → tile centres
  const colCount = new Int32Array(p.width);
  for (let y = a; y <= b; y++) for (let x = 0; x < p.width; x++) if (isTextPx(p, x, y)) colCount[x]++;
  const clusters: { x0: number; x1: number; n: number }[] = [];
  const gap = Math.max(8, cal.pitchX * 0.12);
  for (let x = 0; x < p.width; x++) {
    if (!colCount[x]) continue;
    const last = clusters[clusters.length - 1];
    if (last && x - last.x1 <= gap) { last.x1 = x; last.n += colCount[x]; } else clusters.push({ x0: x, x1: x, n: colCount[x] });
  }
  const labels = clusters.filter((c) => c.n >= 12 && c.x1 - c.x0 >= 8).map((c) => (c.x0 + c.x1) / 2);
  let x0 = cal.x0, pitchX = cal.pitchX;
  if (labels.length >= cal.columns) {
    // pick the run of `columns` labels whose first is closest to the rough x0
    let bestI = 0;
    for (let i = 0; i + cal.columns <= labels.length; i++) if (Math.abs(labels[i] - cal.x0) < Math.abs(labels[bestI] - cal.x0)) bestI = i;
    const run = labels.slice(bestI, bestI + cal.columns);
    const spacing = (run[run.length - 1] - run[0]) / (cal.columns - 1);
    if (spacing > cal.pitchX * 0.6 && spacing < cal.pitchX * 1.5) { x0 = run[0]; pitchX = spacing; }
  }
  const cols: [number, number][] = Array.from({ length: cal.columns }, (_, c) => [Math.round(x0 + c * pitchX - pitchX * 0.38), Math.round(x0 + c * pitchX + pitchX * 0.38)]);
  // 3. Row spacing from the next row's CP band
  let pitchY = cal.pitchY;
  const next = textBandNear(p, Math.round(a + cal.pitchY), cols, 4 * cal.columns, Math.round(cal.pitchY * 0.2));
  if (next && next[0] - a > cal.pitchY * 0.75 && next[0] - a < cal.pitchY * 1.3) pitchY = next[0] - a;
  // 4. Name band: first ≥4-row text run in the lower part of the tile
  const textRow = (y: number) => { let n = 0; for (const [xa, xb] of cols) for (let x = Math.max(0, xa); x < Math.min(p.width, xb); x++) if (isTextPx(p, x, y)) n++; return n >= 4 * cal.columns; };
  let nameTop = -1;
  for (let y = Math.round(b + pitchY * 0.3); y < a + pitchY * 0.9; y++) if (textRow(y) && textRow(y + 1) && textRow(y + 2) && textRow(y + 3)) { nameTop = y; break; }
  const anchor = (a + b) / 2;
  const out: Partial<GridCalibration> = { x0, pitchX, pitchY, y0: anchor };
  if (nameTop > 0) {
    const top = b + Math.max(2, pitchY * 0.015), bottom = nameTop - Math.max(2, pitchY * 0.015);
    if (bottom - top >= pitchY * 0.25) { out.offsetY = ((top + bottom) / 2 - anchor) / pitchY; out.boxH = (bottom - top) / pitchY; }
  }
  return out;
}

/** Foreground "mass" per y inside the sprite columns, for finding where rows sit after scrolling. */
function rowProfile(p: Pixels, cal: GridCalibration, bg: [number, number, number]): Float32Array {
  const prof = new Float32Array(p.height);
  const halfW = (cal.boxW * cal.pitchX) / 2;
  for (let col = 0; col < cal.columns; col++) {
    const cx = cal.x0 + col * cal.pitchX;
    const xa = Math.max(0, Math.round(cx - halfW)), xb = Math.min(p.width - 1, Math.round(cx + halfW));
    for (let y = Math.max(0, cal.top); y < Math.min(p.height, cal.bottom); y++) {
      let s = 0;
      for (let x = xa; x <= xb; x += 2) {
        const i = px(p, x, y);
        if (cdist(p.data[i], p.data[i + 1], p.data[i + 2], bg[0], bg[1], bg[2]) > 26) s++;
      }
      prof[y] += s;
    }
  }
  return prof;
}

/** Fold a row profile modulo the row pitch (bin 0 = y ≡ 0 mod pitch). */
function foldProfile(prof: Float32Array, cal: GridCalibration): Float32Array {
  const P = Math.round(cal.pitchY);
  const out = new Float32Array(P), n = new Float32Array(P);
  for (let y = Math.max(0, cal.top); y < Math.min(prof.length, cal.bottom); y++) { const b = ((y % P) + P) % P; out[b] += prof[y]; n[b]++; }
  for (let b = 0; b < P; b++) out[b] = n[b] ? out[b] / n[b] : 0;
  return out;
}

/** Learn the row pattern from the calibration frame, where the sprite-centre y (cal.y0) is known. */
export function learnRowTemplate(p: Pixels, cal: GridCalibration): number[] {
  const bg = borderColor(p, { x: Math.round(cal.x0 + cal.pitchX / 2 - 2), y: cal.top, w: 4, h: Math.max(4, cal.bottom - cal.top) });
  const folded = foldProfile(rowProfile(p, cal, bg), cal);
  const P = folded.length, c = ((Math.round(cal.y0) % P) + P) % P;
  return Array.from({ length: P }, (_, i) => folded[(c + i) % P]);
}

/** Find the vertical phase of the grid in a frame: the row-centre offset (mod pitch) after scrolling. */
export function findRowPhase(p: Pixels, cal: GridCalibration, bg: [number, number, number]): number {
  if (!validCalibration(cal)) return 0;
  const prof = rowProfile(p, cal, bg);
  if (cal.rowTemplate && cal.rowTemplate.length === Math.round(cal.pitchY)) {
    // correlate this frame's folded pattern with the learned template
    const f = foldProfile(prof, cal), t = cal.rowTemplate, P = t.length;
    const mean = (a: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; };
    const mf = mean(f), mt = mean(t);
    let best = 0, bestScore = -Infinity;
    for (let shift = 0; shift < P; shift++) {
      let sc = 0;
      for (let i = 0; i < P; i++) sc += (t[i] - mt) * (f[(shift + i) % P] - mf);
      if (sc > bestScore) { bestScore = sc; best = shift; }
    }
    return best;
  }
  const halfH = (cal.boxH * cal.pitchY) / 2;
  let best = 0, bestScore = -Infinity;
  for (let phase = 0; phase < cal.pitchY; phase += 1) {
    let inside = 0, outside = 0;
    for (let y = cal.top; y < cal.bottom; y++) {
      const off = (((y - phase) % cal.pitchY) + cal.pitchY) % cal.pitchY; // distance from a row centre at `phase`
      const d = Math.min(off, cal.pitchY - off);
      if (d <= halfH * 0.8) inside += prof[y]; else if (d > halfH * 1.05) outside += prof[y];
    }
    const score = inside - outside * 1.5;
    if (score > bestScore) { bestScore = score; best = phase; }
  }
  return best;
}

/** Sprite rectangles for every complete tile in a frame, in reading order. */
export function tileRects(p: Pixels, cal: GridCalibration, phase: number): Rect[] {
  if (!validCalibration(cal) || !Number.isFinite(phase)) return [];
  const w = Math.round(cal.boxW * cal.pitchX), h = Math.round(cal.boxH * cal.pitchY);
  const rects: Rect[] = [];
  // first row whose whole picture box is visible (box centre = anchor + offset)
  let cy = phase + cal.offsetY * cal.pitchY;
  while (cy - h / 2 < cal.top) cy += cal.pitchY;
  while (cy - cal.pitchY - h / 2 >= cal.top) cy -= cal.pitchY;
  for (; cy + h / 2 <= cal.bottom; cy += cal.pitchY) {
    for (let col = 0; col < cal.columns; col++) {
      const cx = cal.x0 + col * cal.pitchX;
      rects.push({ x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h });
    }
  }
  return rects.filter((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= p.width && r.y + r.h <= p.height);
}

// ---------------------------------------------------------------- stitching pages
/**
 * Pixel signature of a whole tile (sprite + CP + name) used to recognise the same tile on the next page.
 * Identical-looking Pokémon of the same species still differ in their printed CP.
 */
export interface TileSignature { w: number; h: number; g: Uint8Array; /** rows [y0, y1) inside the scroll area */ y0: number; y1: number }
export function tileSignature(p: Pixels, sprite: Rect, cal: GridCalibration): TileSignature {
  const w = Math.round(cal.pitchX * 0.9), h = Math.round(cal.pitchY * 0.92);
  const x0 = Math.round(sprite.x + sprite.w / 2 - w / 2), y0 = Math.round(sprite.y + sprite.h / 2 - h / 2);
  // Half resolution (2×2 average): the same tile lands on different sub-pixel positions on each page,
  // which smears sharp edges differently; averaging evens that out while CP digits stay distinct.
  const w2 = w >> 1, h2 = h >> 1;
  const g = new Uint8Array(w2 * h2);
  const lum = (x: number, y: number) => {
    const i = px(p, Math.min(p.width - 1, Math.max(0, x)), Math.min(p.height - 1, Math.max(0, y)));
    return (p.data[i] * 3 + p.data[i + 1] * 6 + p.data[i + 2]) / 10;
  };
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
    const sx = x0 + x * 2, sy = y0 + y * 2;
    g[y * w2 + x] = (lum(sx, sy) + lum(sx + 1, sy) + lum(sx, sy + 1) + lum(sx + 1, sy + 1)) / 4;
  }
  // Parts of the tile hidden behind the header / bottom bar differ between pages — ignore them
  const margin = Math.round(cal.pitchY * 0.12); // the scroll-area lines are approximate
  return { w: w2, h: h2, g, y0: Math.max(0, Math.ceil((cal.top + margin - y0) / 2)), y1: Math.min(h2, Math.floor((cal.bottom - margin - y0) / 2)) };
}

/** Number of clearly different pixels between two tile signatures (best of ±1 px shifts). */
export function signatureDiff(a: TileSignature, b: TileSignature): number {
  if (a.w !== b.w || a.h !== b.h) return Infinity;
  let best = Infinity;
  const ya = Math.max(2, a.y0, b.y0 + 1), yb = Math.min(a.h - 2, a.y1, b.y1 - 1);
  if (yb - ya < a.h * 0.35) return Infinity; // too little of the tile visible on both pages to compare
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    let n = 0;
    for (let y = ya; y < yb; y++) {
      const ra = y * a.w, rb = (y + dy) * a.w + dx;
      for (let x = 2; x < a.w - 2; x++) if (Math.abs(a.g[ra + x] - b.g[rb + x]) > 40) n++;
    }
    if (n < best) best = n;
  }
  return best;
}

/** Similarity of two sprite fingerprints (lower = more alike) */
export function tileDistance(a: Fingerprint, b: Fingerprint): number {
  return fullDistance(a.fp, b.fp, 0);
}

/**
 * How many tiles at the start of `next` repeat the end of `prev` (pages overlap when you scroll
 * less than a full screen). Only whole rows are considered; empty slots must line up too.
 */
export function pageOverlap(prev: (TileSignature | null)[], next: (TileSignature | null)[], columns: number): { overlap: number; certain: boolean } {
  const maxRows = Math.floor(Math.min(prev.length, next.length) / columns);
  const sample = next.find(Boolean) || prev.find(Boolean);
  if (!sample) return { overlap: 0, certain: false };
  // A wrong alignment of identical-looking Pokémon still differs in the printed CP digits, while the
  // true alignment differs only by video noise — so pick the overlap with the lowest average difference.
  const cap = Math.max(6, sample.w * sample.h * 0.0025);
  const pairCost = (a: TileSignature | null, b: TileSignature | null) => (!a || !b ? (a === b ? 0 : cap * 10) : Math.min(cap * 10, signatureDiff(a, b)));
  const costs: { k: number; c: number }[] = [];
  for (let rows = 1; rows <= maxRows; rows++) {
    const k = rows * columns;
    let c = 0;
    for (let i = 0; i < k; i++) c += pairCost(prev[prev.length - k + i], next[i]);
    costs.push({ k, c: c / k });
  }
  const min = Math.min(...costs.map((x) => x.c));
  if (!costs.length || min > cap) return { overlap: 0, certain: false };
  // Near-ties (e.g. a run of the same species whose CP is hidden at the screen edge): the overlap
  // confirmed by more tiles is the stronger evidence, so take the largest one within tolerance.
  const tol = Math.max(1, cap * 0.15);
  const best = Math.max(...costs.filter((x) => x.c <= min + tol).map((x) => x.k));
  const others = costs.filter((x) => x.c > min + tol).map((x) => x.c);
  return { overlap: best, certain: min < cap * 0.5 && costs.filter((x) => x.c <= min + tol).length === 1 && (!others.length || Math.min(...others) > min * 2 + 2) };
}

// ---------------------------------------------------------------- scroll tracking (video)
/**
 * Brightness profile of the grid area: mean luminance of each pixel row (centre 80% of the width),
 * used to measure how far the screen scrolled between two video frames.
 */
export function rowLuminance(p: Pixels): Float32Array {
  const out = new Float32Array(p.height);
  const xa = Math.round(p.width * 0.1), xb = Math.round(p.width * 0.9);
  for (let y = 0; y < p.height; y++) {
    let s = 0;
    for (let x = xa; x < xb; x += 2) { const i = px(p, x, y); s += p.data[i] * 3 + p.data[i + 1] * 6 + p.data[i + 2]; }
    out[y] = s / (((xb - xa) >> 1) * 10);
  }
  return out;
}

/**
 * Vertical scroll (in pixels, positive = content moved up) between two profiles, searched within
 * ±maxShift. Only the scroll area is compared. Sub-pixel precision via a parabola through the minimum.
 */
export function profileShift(a: Float32Array, b: Float32Array, top: number, bottom: number, maxShift: number, predicted = 0, minBack = maxShift): { shift: number; error: number } {
  let best = 0, bestErr = Infinity;
  const errs = new Map<number, number>();
  const c = Math.round(predicted);
  for (let s = Math.max(c - maxShift, -minBack); s <= c + maxShift; s++) {
    let e = 0, n = 0;
    // content at y in b was at y + s in a
    for (let y = Math.max(top, top - s); y < Math.min(bottom, bottom - s); y++) { e += Math.abs(b[y] - a[y + s]); n++; }
    if (n < (bottom - top) * 0.4) continue;
    e /= n;
    errs.set(s, e);
    if (e < bestErr) { bestErr = e; best = s; }
  }
  const l = errs.get(best - 1), r = errs.get(best + 1);
  let frac = 0;
  if (l !== undefined && r !== undefined) { const d = l - 2 * bestErr + r; if (d > 1e-6) frac = Math.max(-0.5, Math.min(0.5, (l - r) / (2 * d))); }
  return { shift: best + frac, error: bestErr };
}

/**
 * Total scroll across a sequence of frames (each step searched around the previous step's motion,
 * because touch scrolling speeds up and slows down smoothly). Returns pixels scrolled (content moved up).
 */
export function trackScroll(profiles: Float32Array[], cal: GridCalibration): number {
  return trackSteps(profiles, cal).reduce((s, x) => s + x, 0);
}

/** Per-step scroll between consecutive frames (see trackScroll). steps[i] = motion from frame i to i+1. */
export function trackSteps(profiles: Float32Array[], cal: GridCalibration): number[] {
  const window = Math.round(cal.pitchY * 0.45), wide = Math.round(cal.pitchY * 0.95);
  const top = Math.round(cal.top), bottom = Math.round(cal.bottom);
  const steps: number[] = [];
  let velocity = 0, stillRun = 0;
  for (let i = 1; i < profiles.length; i++) {
    const a = profiles[i - 1], b = profiles[i];
    // Search around the current motion. Mostly you scroll down, so only small backward moves are
    // allowed unless you're already scrolling back up.
    const minBack = velocity < 0 ? Math.round(window - velocity) : Math.round(cal.pitchY * 0.15);
    let r = profileShift(a, b, top, bottom, window, velocity, minBack);
    // A poor best match means the motion jumped outside the window (e.g. after a dropped frame):
    // look wider and take a clearly better match nearest the expected motion.
    if (r.error > 2.5) {
      const r2 = profileShift(a, b, top, bottom, wide, velocity, Math.round(wide - velocity));
      if (r2.error < r.error * 0.5) r = r2;
    }
    steps.push(r.shift);
    // Phone recorders sometimes repeat a frame mid-scroll; that isn't the scroll stopping, so keep the
    // velocity — unless the screen stays identical for a few frames (a real stop).
    const repeated = Math.abs(r.shift) < 0.5 && r.error < 0.15;
    stillRun = repeated ? stillRun + 1 : 0;
    if (!repeated || stillRun >= 3) velocity = r.shift;
  }
  return steps;
}

// ---------------------------------------------------------------- search-string attributes
export interface ScanAttributes { lucky?: boolean; shadow?: boolean; purified?: boolean; shiny?: boolean; dynamax?: boolean; gigantamax?: boolean; costume?: boolean; female?: boolean; male?: boolean; stars?: 0 | 1 | 2 | 3 | 4; favorite?: boolean; legendary?: boolean }

/**
 * Attributes every Pokémon in a scan must have, read from the in-game search string used.
 * Only positive AND-terms count (e.g. "lucky&4*"); negated terms (!lucky) and OR groups are ignored.
 */
export function attributesFromSearch(search: string): ScanAttributes {
  const out: ScanAttributes = {};
  for (const raw of search.toLowerCase().split('&')) {
    const t = raw.trim();
    if (!t || t.startsWith('!') || /[,;:]/.test(t)) continue;
    switch (t) {
      case 'lucky': out.lucky = true; break;
      case 'shadow': out.shadow = true; break;
      case 'purified': out.purified = true; break;
      case 'shiny': out.shiny = true; break;
      case 'dynamax': out.dynamax = true; break;
      case 'gigantamax': out.gigantamax = true; break;
      case 'costume': out.costume = true; break;
      case 'female': out.female = true; break;
      case 'male': out.male = true; break;
      case 'favorite': out.favorite = true; break;
      case 'legendary': out.legendary = true; break;
      case '0*': out.stars = 0; break; case '1*': out.stars = 1; break; case '2*': out.stars = 2; break;
      case '3*': out.stars = 3; break; case '4*': out.stars = 4; break;
    }
  }
  return out;
}

/** Negated terms (e.g. !shiny) tell us what the scan definitely does NOT contain. */
export function excludedFromSearch(search: string): Set<string> {
  const s = new Set<string>();
  for (const raw of search.toLowerCase().split('&')) {
    const t = raw.trim();
    if (t.startsWith('!') && !/[,;:]/.test(t)) s.add(t.slice(1));
  }
  return s;
}
