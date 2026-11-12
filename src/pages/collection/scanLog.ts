// A troubleshooting record of one scan: the device, the settings, every page and tile the scanner read,
// and small pictures of the doubtful tiles. Built on request and saved as a file on this device.
import { answerKey, CALIBRATION_VERSION, type GridCalibration } from '../../lib/scanner';
import type { FrameSource, StillRun } from './scanFrames';
import type { ScanOutput } from './scanRunner';

/** What the page collects while a scan is set up and run. */
export interface ScanTrace {
  started: string;
  search: string;
  source?: { kind: 'video' | 'screenshots'; files: { name: string; type: string; mb: number }[]; duration?: number; videoWidth?: number; videoHeight?: number };
  /** size of the frames the scanner works on */
  analysis?: [number, number];
  pauses?: StillRun[];
  /** change between samples a quarter second apart, from the pause search (under 3.5 counts as still; -1 = first sample) */
  stillDiffs?: number[];
  /** frames fetched from the video, by kind, and how long that took */
  frameStats?: FrameSource['stats'];
  /** the first page as the scanner saw it (JPEG) */
  firstPage?: string;
  /** the two taps on CP numbers, the grid they gave, and what the automatic fit changed */
  taps?: { taps: { x: number; y: number }[]; base: GridCalibration; fit: Partial<GridCalibration> | null };
  /** the grid used for the scan */
  calibration?: GridCalibration;
  /** how long each step took, in ms */
  timings: Record<string, number>;
  events: { at: number; msg: string }[];
  output?: ScanOutput;
}

export const newTrace = (search = ''): ScanTrace => ({ started: new Date().toISOString(), search, timings: {}, events: [] });
/** Add a line to the trace's event list (time is ms since the trace began). */
export function note(trace: ScanTrace, msg: string) { trace.events.push({ at: Date.now() - Date.parse(trace.started), msg }); }

export interface LogItem { uid: number; answer: { id: string; costume?: string; shiny: boolean } | null; edited?: boolean }

/** Pictures are only kept for doubtful or corrected tiles, and only this many, to keep the file small. */
const MAX_PICTURES = 150;

function toJpeg(url: string, quality = 0.8): Promise<string> {
  return new Promise((resolve) => {
    if (!url) { resolve(''); return; }
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      c.getContext('2d')!.drawImage(im, 0, 0);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    im.onerror = () => resolve('');
    im.src = url;
  });
}
const base64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); };

const round = (_k: string, v: unknown) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v);
/** JSON with one top-level key per line, and one line per item for lists of objects (pages, tiles…). */
function format(log: Record<string, unknown>): string {
  const lines = Object.entries(log).filter(([, v]) => v !== undefined).map(([k, v]) => {
    if (Array.isArray(v) && v.length && typeof v[0] === 'object' && v[0] !== null && !Array.isArray(v[0])) return `${JSON.stringify(k)}: [\n${v.map((x) => `  ${JSON.stringify(x, round)}`).join(',\n')}\n]`;
    return `${JSON.stringify(k)}: ${JSON.stringify(v, round)}`;
  });
  return `{\n${lines.join(',\n')}\n}\n`;
}

/**
 * The scan log as text (JSON). `items` is the review list as it stands now, so answers you corrected or
 * removed are recorded next to what the scanner read; null if the scan never reached the review step.
 */
export async function buildScanLog(trace: ScanTrace, items: LogItem[] | null, flagBelow: number): Promise<string> {
  const out = trace.output;
  const columns = trace.calibration?.columns ?? 3;
  const byUid = new Map((items || []).map((i) => [i.uid, i]));
  let pictures = 0, flaggedN = 0, corrected = 0, removed = 0, reread = 0;
  const tiles: Record<string, unknown>[] = [];
  for (const [uid, t] of (out?.tiles || []).entries()) {
    const m = t.match, item = byUid.get(uid);
    const read = m.best ? answerKey(m.best.ref) : null;
    const flagged = m.confidence < flagBelow || !m.best;
    const gone = !!items && !item;
    const now = item?.answer ? answerKey({ ...item.answer, aspect: 0 }) : null;
    const changed = !!item?.edited && now !== read;
    if (flagged) flaggedN++;
    if (t.reread) reread++;
    if (gone) removed++;
    if (changed) corrected++;
    const row: Record<string, unknown> = {
      n: uid, page: t.page, at: t.label, row: Math.floor(t.slot / columns), col: t.slot % columns, box: [t.rect.x, t.rect.y, t.rect.w, t.rect.h],
      read, confidence: m.confidence, flagged: flagged || undefined, byOrder: m.byOrder || undefined, underHandle: t.underHandle, reread: t.reread,
      // answer keys are id|costume|shiny
      candidates: m.alternatives.map((c) => [answerKey(c.ref) + (c.ref.variant ? `~${c.ref.variant}` : '') + (c.ref.female ? '~f' : ''), c.score]),
      shape: t.fp.aspect, fill: t.fp.coverage, outline: t.fp.bbox, background: t.fp.bg,
      confirmed: (item?.edited && !changed) || undefined, correctedTo: changed ? now : undefined, removed: gone || undefined,
    };
    if ((flagged || changed || gone) && pictures < MAX_PICTURES) {
      pictures++;
      row.fingerprint = base64(t.fp.fp);
      row.thumb = t.thumb;
      row.cutout = await toJpeg(t.cutout);
    }
    tiles.push(row);
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  return format({
    kind: 'pogo-companion box scan log', logVersion: 3, saved: new Date().toISOString(), started: trace.started,
    app: {
      build: typeof __BUILD__ !== 'undefined' ? __BUILD__ : null, calibrationVersion: CALIBRATION_VERSION, page: location.origin + location.pathname,
      installed: typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches,
    },
    device: {
      userAgent: nav.userAgent, screen: [screen.width, screen.height], window: [innerWidth, innerHeight], pixelRatio: devicePixelRatio,
      cores: nav.hardwareConcurrency, memoryGB: nav.deviceMemory, touch: nav.maxTouchPoints,
    },
    summary: out ? {
      found: out.tiles.length, confident: out.tiles.length - flaggedN, flagged: flaggedN, faded: out.faded, pagesRead: out.pagesRead,
      pauses: trace.pauses?.length, corrected, removed, reviewed: !!items, picturesKept: pictures,
      // pages that weren't where a pause said they'd be (the list was followed frame by frame instead), and tiles read again clear of the scroll handle
      pagesFollowed: out.log.pages.filter((p) => p.followed).length, reread,
      // pages the picture check moved by more than a quarter row from where the scroll tracker put them, pages it could not check, and moments left out because the list was not on screen
      pagesMoved: out.log.pages.filter((p) => Math.abs(p.fixed ?? 0) > (trace.calibration?.pitchY ?? 200) / 4).length,
      pagesUnchecked: out.log.pages.filter((p) => p.placedBy === 'tracker').length, skipped: out.log.skipped.length,
    } : { scanFinished: false },
    search: trace.search,
    source: trace.source,
    analysis: trace.analysis,
    timings: trace.timings,
    frameStats: trace.frameStats,
    events: trace.events,
    warnings: out?.warnings,
    calibration: trace.calibration,
    taps: trace.taps,
    pauses: trace.pauses,
    stillDiffs: trace.stillDiffs,
    pages: out?.log.pages,
    scrolls: out?.log.scrolls,
    skipped: out?.log.skipped,
    tiles,
    firstPage: trace.firstPage,
  });
}

const stamp = () => { const d = new Date(), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
export const logFileName = (ext: string) => `box-scan-log-${stamp()}.${ext}`;

// Phones can hand a file straight to another app. Shared as plain text: share sheets refuse .json files.
const shareFile = (text: string) => new File([text], logFileName('txt'), { type: 'text/plain' });
export function canShareLog(): boolean {
  try { return typeof navigator.canShare === 'function' && matchMedia('(pointer: coarse)').matches && navigator.canShare({ files: [shareFile('x')] }); } catch { return false; }
}
export async function shareLog(text: string): Promise<void> {
  await navigator.share({ files: [shareFile(text)], title: 'Box Scanner log' });
}
