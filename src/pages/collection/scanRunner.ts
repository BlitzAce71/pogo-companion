// Drives a full scan: turns a recording (or screenshots) into identified tiles. Kept free of React so
// it can be run and tested on its own.
import {
  applyNumberOrder, borderColor, cutoutPreview, eraseScrollHandle, findRowPhase, fingerprintRegion, isFadedTile, matchFingerprint, pageOverlap, tileRects, tileSignature,
  type Fingerprint, type GridCalibration, type MatchOptions, type MatchResult, type Rect, type SpriteLibrary, type TileSignature,
} from '../../lib/scanner';
import { loadImagePage, measureScroll, thumbnail, type FrameSource, type Page, type StillRun } from './scanFrames';

export interface RawTile { page: number; /** place on its page: row × columns + column */ slot: number; label: string; fp: Fingerprint; match: MatchResult; thumb: string; cutout: string; rect: Rect }
export interface ScanOutput { tiles: RawTile[]; warnings: string[]; pagesRead: number; /** faded (fused) Pokémon left out */ faded: number; log: ScanTrail }

/** One page (frame or screenshot) as the scanner read it — for the troubleshooting log. */
export interface PageLog {
  label: string; time: number | null; seeked?: number;
  /** how far the list had scrolled, in analysis pixels (video only) */ pos: number | null;
  width: number; height: number;
  /** where the row pattern was found, and the top of each row's picture box */ phase: number; rows: number[];
  /** tile slots looked at; of those: empty, already read on an earlier page, faded, and newly added */
  slots: number; empty: number; repeated: number; faded: number; added: number;
  /** rows that went by unread before this page */ gapRows: number;
  /** the scroll handle was on screen and erased */ handle: boolean;
  /** time to fetch the frame, and to read it */ grabMs: number; readMs: number;
}
/** One followed scroll between two pauses. */
export interface ScrollLog { from: number; to: number; total: number; frames: number; /** biggest move between two frames */ fastest: number; /** times of in-between frames that were read */ reads: number[]; /** scroll so far at each frame */ cum: number[] }
export interface ScanTrail { pages: PageLog[]; scrolls: ScrollLog[] }
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export interface ScanOptions {
  lib: SpriteLibrary;
  cal: GridCalibration;
  match: MatchOptions;
  signal?: AbortSignal;
  onProgress?: (label: string, fraction: number) => void;
  /** Pokédex number of a Pokémon id — enables number-order checking (for storage sorted by number) */
  dexOf?: (id: string) => number;
  /** Confidence below which a tile is flagged for review */
  flagBelow?: number;
  /** Make the small diagnostic images (thumbnail + cut-out) for each tile */
  images?: (canvas: HTMLCanvasElement | undefined, p: Page['pixels'], r: Rect, f: Fingerprint) => { thumb: string; cutout: string };
}

function defaultImages(cal: GridCalibration) {
  return (canvas: HTMLCanvasElement | undefined, p: Page['pixels'], r: Rect, f: Fingerprint) => {
    if (!canvas) return { thumb: '', cutout: '' };
    const tw = cal.pitchX * 0.96, th = cal.pitchY * 0.96;
    const cut = cutoutPreview(p, r, f);
    const c = document.createElement('canvas');
    c.width = cut.w; c.height = cut.h;
    c.getContext('2d')!.putImageData(new ImageData(cut.data, cut.w, cut.h), 0, 0);
    return { thumb: thumbnail(canvas, r.x + r.w / 2 - tw / 2, r.y + r.h / 2 - th / 2, tw, th), cutout: c.toDataURL('image/png') };
  };
}

interface PageState { rowYs: number[]; sigs: (TileSignature | null)[]; pos: number | null }

/** Shared page processing: find the tiles, drop rows already read on the previous page, identify the rest. */
function makeProcessor(o: ScanOptions, out: ScanOutput, gaps: string[], noOverlap: string[]) {
  const { cal } = o;
  const images = o.images || defaultImages(cal);
  let prev: PageState | null = null;
  // Video: absolute position (list coordinates) of the lowest row read so far — rows above it, on any
  // earlier page, are already done, even if you scrolled back up to them.
  let readUpTo = -Infinity;
  return {
    get prev() { return prev; },
    process(page: Page, pos: number | null, grabMs = 0) {
      const t0 = now();
      const p = page.pixels;
      const handle = eraseScrollHandle(p);
      const gapBg = borderColor(p, { x: Math.round(cal.x0 + cal.pitchX / 2 - 2), y: cal.top, w: 4, h: Math.max(4, cal.bottom - cal.top) });
      const phase = findRowPhase(p, cal, gapBg);
      const rects = tileRects(p, cal, phase);
      const fps = rects.map((r) => fingerprintRegion(p, r));
      const sigs = rects.map((r, k) => (fps[k] ? tileSignature(p, r, cal) : null));
      const rowYs = rects.filter((_, k) => k % cal.columns === 0).map((r) => r.y);
      let skip = 0, gapRows = 0, added = 0, faded = 0;
      if (pos !== null && rowYs.length) {
        // Video: we followed the scroll, so a row's position in the whole list is y + pos. Rows at or above
        // the furthest row already read are repeats (including ones revisited by scrolling back up).
        const abs = rowYs.map((y) => y + pos);
        const repeats = abs.filter((a) => a <= readUpTo + cal.pitchY / 2).length;
        skip = repeats * cal.columns;
        if (readUpTo > -Infinity && repeats < abs.length) {
          gapRows = Math.max(0, Math.round((abs[repeats] - readUpTo) / cal.pitchY) - 1);
          if (gapRows > 0) gaps.push(`${page.label} (${gapRows} row${gapRows > 1 ? 's' : ''})`);
        }
        readUpTo = Math.max(readUpTo, abs[abs.length - 1]);
      } else if (prev) {
        // Screenshots: recognise repeated rows by comparing whole tiles (incl. their printed CP)
        const ov = pageOverlap(prev.sigs, sigs, cal.columns);
        skip = ov.overlap;
        if (!ov.overlap) noOverlap.push(page.label);
      }
      rects.forEach((r, k) => {
        const f = fps[k];
        if (k < skip || !f) return; // already read, or an empty slot at the end of the box
        if (isFadedTile(p, r, cal)) { out.faded++; faded++; return; } // fused into another Pokémon: not usable
        const im = images(page.canvas, p, r, f);
        added++;
        out.tiles.push({ page: out.pagesRead, slot: k, label: page.label, fp: f, match: matchFingerprint(o.lib, f, o.match), rect: r, ...im });
      });
      prev = { rowYs, sigs, pos };
      out.log.pages.push({
        label: page.label, time: page.time, seeked: page.seeked, pos, width: p.width, height: p.height, phase, rows: rowYs,
        slots: rects.length, empty: fps.filter((f) => !f).length, repeated: Math.min(skip, rects.length), faded, added, gapRows, handle,
        grabMs: Math.round(grabMs), readMs: Math.round(now() - t0),
      });
      out.pagesRead++;
    },
  };
}

/** After all tiles are read: use number order (if the list is sorted by number) to fix doubtful reads. */
function finish(out: ScanOutput, o: ScanOptions) {
  if (out.faded) out.warnings.push(`Left out ${out.faded} faded Pokémon — ones fused into Necrozma, Kyurem or Calyrex, which can’t be used in the game.`);
  if (!o.dexOf) return;
  const n = applyNumberOrder(out.tiles.map((t) => t.match), o.dexOf, o.flagBelow ?? 0.25);
  if (n) out.warnings.push(`Your storage looks sorted by number, so ${n} doubtful read${n > 1 ? 's were' : ' was'} re-picked to fit between ${n > 1 ? 'their' : 'its'} neighbours (still marked for review).`);
}

/**
 * Scan a screen recording. Reads every pause, follows the scroll between pauses frame by frame, and
 * whenever a scroll would carry rows past unseen, also reads the stillest frames in between — so you
 * don't have to stop on every screen.
 */
export async function scanVideo(video: FrameSource, pauses: StillRun[], o: ScanOptions): Promise<ScanOutput> {
  const { cal } = o;
  const out: ScanOutput = { tiles: [], warnings: [], pagesRead: 0, faded: 0, log: { pages: [], scrolls: [] } };
  const gaps: string[] = [], noOverlap: string[] = [];
  const proc = makeProcessor(o, out, gaps, noOverlap);
  // The start and end of the recording count as pauses, so continuous scrolling still gets covered
  const runs = [...pauses];
  if (!runs.length || runs[0].start > 0.3) runs.unshift({ start: 0, end: 0, time: 0 });
  const endT = Math.max(0, video.duration - 0.05);
  if (runs[runs.length - 1].end < endT - 0.3) runs.push({ start: endT, end: endT, time: endT });
  const label = (t: number) => `${t.toFixed(1)}s`;
  const read = async (t: number, pos: number) => {
    if (o.signal?.aborted) throw new Error('Cancelled');
    o.onProgress?.(`Reading ${label(t)} of ${label(video.duration)} · ${out.tiles.length} Pokémon so far`, t / video.duration);
    const t0 = now();
    const page = await video.page(t, out.pagesRead);
    page.label = label(t);
    proc.process(page, pos, now() - t0);
  };

  let pausePos = 0;
  await read(runs[0].time, 0);
  for (let i = 1; i < runs.length; i++) {
    o.onProgress?.(`Following the scroll at ${label(runs[i - 1].end)} · ${out.tiles.length} Pokémon so far`, runs[i - 1].end / video.duration);
    const track = await measureScroll(video, runs[i - 1], runs[i], cal, o.signal);
    const scroll: ScrollLog = { from: runs[i - 1].end, to: runs[i].start, total: track.total, frames: track.frames.length, fastest: track.frames.reduce((m, f) => Math.max(m, f.step), 0), reads: [], cum: track.frames.map((f) => Math.round(f.cum)) };
    out.log.scrolls.push(scroll);
    const endPos = pausePos + track.total;
    // Fill the gap with in-between frames, keeping one row of overlap with the last page read
    const visibleRows = Math.max(1, proc.prev?.rowYs.length ?? 1);
    const spacing = Math.max(1, visibleRows - 1) * cal.pitchY;
    let lastPos = proc.prev?.pos ?? pausePos;
    while (endPos - lastPos > spacing + cal.pitchY * 0.25) {
      const target = lastPos + spacing;
      const ahead = track.frames.filter((f) => pausePos + f.cum > lastPos + cal.pitchY * 0.5 && pausePos + f.cum <= target);
      if (!ahead.length) break;
      // among frames within ~0.7 rows of the target, take the one moving least (crispest)
      const near = ahead.filter((f) => pausePos + f.cum >= target - cal.pitchY * 0.7);
      const pick = (near.length ? near : ahead).reduce((a, b) => (b.step < a.step || (b.step === a.step && b.cum > a.cum) ? b : a));
      scroll.reads.push(pick.t);
      await read(pick.t, pausePos + pick.cum);
      lastPos = pausePos + pick.cum;
    }
    pausePos = endPos;
    await read(runs[i].time, pausePos);
  }
  finish(out, o);
  if (gaps.length) out.warnings.push(`Rows went by too fast to read near ${gaps.slice(0, 8).join(', ')}${gaps.length > 8 ? '…' : ''}. Those Pokémon are missing from this scan — scroll a little slower there.`);
  return out;
}

/** Scan screenshots (in order). Repeated rows are recognised by comparing tiles, since there's no motion to follow. */
export async function scanImages(files: File[], o: ScanOptions): Promise<ScanOutput> {
  const out: ScanOutput = { tiles: [], warnings: [], pagesRead: 0, faded: 0, log: { pages: [], scrolls: [] } };
  const gaps: string[] = [], noOverlap: string[] = [];
  const proc = makeProcessor(o, out, gaps, noOverlap);
  for (let i = 0; i < files.length; i++) {
    if (o.signal?.aborted) throw new Error('Cancelled');
    o.onProgress?.(`Reading screenshot ${i + 1} of ${files.length} · ${out.tiles.length} Pokémon so far`, i / files.length);
    await new Promise((r) => setTimeout(r, 0));
    proc.process(await loadImagePage(files[i], i), null);
  }
  finish(out, o);
  if (noOverlap.length) out.warnings.push(`${noOverlap.length} of ${files.length} screenshots didn't repeat a row from the one before (${noOverlap.slice(0, 6).join(', ')}${noOverlap.length > 6 ? '…' : ''}). That's fine if you scrolled about one screen there — otherwise some Pokémon were never captured.`);
  return out;
}
