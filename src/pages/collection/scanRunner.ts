// Drives a full scan: turns a recording (or screenshots) into identified tiles. Kept free of React so
// it can be run and tested on its own.
import {
  applyNumberOrder, borderColor, cutoutPreview, eraseScrollHandle, findRowPhase, fingerprintRegion, isFadedTile, matchFingerprint, pageOverlap, profileShift, rowLuminance, tileRects, tileSignature,
  type Fingerprint, type GridCalibration, type MatchOptions, type MatchResult, type Rect, type SpriteLibrary, type TileSignature,
} from '../../lib/scanner';
import { followScroll, loadImagePage, measureScroll, thumbnail, type FrameSource, type Page, type StillRun } from './scanFrames';

export interface RawTile { page: number; /** place on its page: row × columns + column */ slot: number; label: string; fp: Fingerprint; match: MatchResult; thumb: string; cutout: string; rect: Rect; /** the scroll handle covered part of the picture */ underHandle?: boolean; /** first read under the scroll handle, then read again from a later frame without it */ reread?: boolean }
export interface ScanOutput { tiles: RawTile[]; warnings: string[]; pagesRead: number; /** faded (fused) Pokémon left out */ faded: number; log: ScanTrail }

/** One page (frame or screenshot) as the scanner read it — for the troubleshooting log. */
export interface PageLog {
  label: string; time: number | null; seeked?: number;
  /** how far the list had scrolled, in analysis pixels (video only) */ pos: number | null;
  width: number; height: number;
  /** where the row pattern was found, and the top of each row's picture box */ phase: number; rows: number[];
  /** tile slots looked at; of those: empty, already read on an earlier page, faded, and newly added */
  slots: number; empty: number; repeated: number; faded: number; added: number;
  /** tiles read again here because the scroll handle covered them the first time */ reread: number;
  /** how far this frame was from the frame it was placed by, and whether that had to be followed frame by frame */ moved: number; followed: boolean;
  /** rows that went by unread before this page */ gapRows: number;
  /** the scroll handle was on screen and erased */ handle: boolean;
  /** time to fetch the frame, and to read it */ grabMs: number; readMs: number;
}
/** One followed scroll between two pauses. */
export interface ScrollLog { /** why this stretch was followed: between two pauses, or because a frame wasn't where a pause said it would be */ why: 'scroll' | 'page' | 'pause end'; from: number; to: number; total: number; frames: number; /** biggest move between two frames */ fastest: number; /** times of in-between frames that were read */ reads: number[]; /** scroll so far at each frame */ cum: number[] }
export interface ScanTrail { pages: PageLog[]; scrolls: ScrollLog[] }
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
/** Two frames are the same view, a little shifted, when their row profiles match this well (0–255 scale). Still frames score under 1.2; frames a row apart score over 5. */
const HOP_OK = 2;

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
  // Video: tiles read with the scroll handle over them, by list row and column → index in out.tiles.
  // If a later frame shows the same tile clear of the handle, that reading replaces the first.
  const covered = new Map<string, number>();
  let firstRow: number | null = null;
  const overlaps = (a: Rect, b: Rect | null) => !!b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  return {
    get prev() { return prev; },
    process(page: Page, pos: number | null, grabMs = 0, placed: { moved: number; followed: boolean } = { moved: 0, followed: false }) {
      const t0 = now();
      const p = page.pixels;
      const handle = eraseScrollHandle(p);
      const gapBg = borderColor(p, { x: Math.round(cal.x0 + cal.pitchX / 2 - 2), y: cal.top, w: 4, h: Math.max(4, cal.bottom - cal.top) });
      const phase = findRowPhase(p, cal, gapBg);
      const rects = tileRects(p, cal, phase);
      const fps = rects.map((r) => fingerprintRegion(p, r));
      const sigs = rects.map((r, k) => (fps[k] ? tileSignature(p, r, cal) : null));
      const rowYs = rects.filter((_, k) => k % cal.columns === 0).map((r) => r.y);
      let skip = 0, gapRows = 0, added = 0, faded = 0, reread = 0;
      if (pos !== null && firstRow === null && rowYs.length) firstRow = rowYs[0] + pos;
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
        if (!f) return; // an empty slot at the end of the box
        const under = overlaps(r, handle);
        const key = pos !== null && firstRow !== null ? `${Math.round((r.y + pos - firstRow) / cal.pitchY)}|${k % cal.columns}` : null;
        if (k < skip) { // already read
          const earlier = key !== null && !under ? covered.get(key) : undefined;
          if (earlier === undefined) return;
          covered.delete(key!);
          reread++;
          out.tiles[earlier] = { ...out.tiles[earlier], slot: k, label: page.label, fp: f, match: matchFingerprint(o.lib, f, o.match), rect: r, ...images(page.canvas, p, r, f), underHandle: undefined, reread: true };
          return;
        }
        if (isFadedTile(p, r, cal)) { out.faded++; faded++; return; } // fused into another Pokémon: not usable
        const im = images(page.canvas, p, r, f);
        added++;
        out.tiles.push({ page: out.pagesRead, slot: k, label: page.label, fp: f, match: matchFingerprint(o.lib, f, o.match), rect: r, ...im, underHandle: under || undefined });
        if (under && key !== null) covered.set(key, out.tiles.length - 1);
      });
      prev = { rowYs, sigs, pos };
      out.log.pages.push({
        label: page.label, time: page.time, seeked: page.seeked, pos, width: p.width, height: p.height, phase, rows: rowYs,
        slots: rects.length, empty: fps.filter((f) => !f).length, repeated: Math.min(skip, rects.length), faded, added, reread, moved: placed.moved, followed: placed.followed, gapRows, handle: !!handle,
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
  // A frame whose place in the list is known. Every other frame is placed by comparing it with one of
  // these — a pause is never just assumed to be motionless: on phones the video player can hand back
  // the previous frame after a jump, which makes a moving list look paused.
  interface Known { t: number; prof: Float32Array; pos: number }
  const top = Math.round(cal.top), bottom = Math.round(cal.bottom), reach = Math.round(cal.pitchY * 0.45);
  /** How far the list moved from a known frame to another frame (its time and brightness profile). */
  const moved = async (from: Known, t: number, prof: Float32Array, why: ScrollLog['why']): Promise<{ moved: number; followed: boolean }> => {
    // Close frames (a pause) match in one comparison...
    const r = profileShift(from.prof, prof, top, bottom, reach, 0, reach);
    if (r.error < HOP_OK || Math.abs(t - from.t) < 0.01) return { moved: r.error < HOP_OK ? r.shift : 0, followed: false };
    // ...if they don't, the list moved further in between: follow it frame by frame
    const back = t < from.t;
    const track = await followScroll(video, back ? t : from.t, back ? from.t : t, cal, o.signal);
    out.log.scrolls.push({ why, from: Math.min(t, from.t), to: Math.max(t, from.t), total: track.total, frames: track.frames.length, fastest: track.frames.reduce((m, f) => Math.max(m, f.step), 0), reads: [], cum: track.frames.map((f) => Math.round(f.cum)) });
    return { moved: back ? -track.total : track.total, followed: true };
  };
  /** Read the frame at t, placing it by a known frame (the first page is the origin). */
  const read = async (t: number, ref: Known | null): Promise<Known> => {
    if (o.signal?.aborted) throw new Error('Cancelled');
    o.onProgress?.(`Reading ${label(t)} of ${label(video.duration)} · ${out.tiles.length} Pokémon so far`, t / video.duration);
    const t0 = now();
    const page = await video.page(t, out.pagesRead);
    page.label = label(t);
    const grabMs = now() - t0;
    const prof = rowLuminance(page.pixels);
    const placed = ref ? await moved(ref, t, prof, 'page') : { moved: 0, followed: false };
    const pos = (ref?.pos ?? 0) + placed.moved;
    proc.process(page, pos, grabMs, placed);
    return { t, prof, pos };
  };

  let cur = await read(runs[0].time, null);
  for (let i = 1; i < runs.length; i++) {
    o.onProgress?.(`Following the scroll at ${label(runs[i - 1].end)} · ${out.tiles.length} Pokémon so far`, runs[i - 1].end / video.duration);
    const track = await measureScroll(video, runs[i - 1], runs[i], cal, o.signal);
    const scroll: ScrollLog = { why: 'scroll', from: runs[i - 1].end, to: runs[i].start, total: track.total, frames: track.frames.length, fastest: track.frames.reduce((m, f) => Math.max(m, f.step), 0), reads: [], cum: track.frames.map((f) => Math.round(f.cum)) };
    out.log.scrolls.push(scroll);
    // Where the list was when this stretch began, measured from the last page read
    const pausePos = cur.pos + (await moved(cur, runs[i - 1].end, track.profiles[0], 'pause end')).moved;
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
      cur = await read(pick.t, { t: pick.t, prof: track.profiles[track.frames.indexOf(pick)], pos: pausePos + pick.cum });
      lastPos = pausePos + pick.cum;
    }
    cur = await read(runs[i].time, { t: runs[i].start, prof: track.profiles[track.profiles.length - 1], pos: endPos });
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
