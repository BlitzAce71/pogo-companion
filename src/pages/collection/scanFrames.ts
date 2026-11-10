// Turning a screen recording (or screenshots) into still "pages" of the storage grid.
import { rowLuminance, trackSteps, type GridCalibration, type Pixels } from '../../lib/scanner';

/** Frames are analysed at this width (phone recordings are scaled down; plenty for 3-column tiles). */
export const ANALYSIS_WIDTH = 540;

export interface Page { index: number; time: number | null; label: string; pixels: Pixels; canvas?: HTMLCanvasElement; /** where the video player says it landed (video only) */ seeked?: number }

/**
 * Where video frames come from. In the app this is the browser's video player (videoSource); tests can
 * supply frames decoded some other way. Times are in seconds.
 */
export interface FrameSource {
  duration: number;
  /** Tiny RGBA thumbnail (48 px wide) — for spotting pauses */
  tiny(t: number): Promise<Uint8ClampedArray>;
  /** Brightness profile of the frame (see rowLuminance) — for following the scroll */
  profile(t: number): Promise<Float32Array>;
  /** The full frame at the analysis width */
  page(t: number, index: number): Promise<Page>;
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => { video.removeEventListener('seeked', done); video.removeEventListener('error', fail); resolve(); };
    const fail = () => { video.removeEventListener('seeked', done); video.removeEventListener('error', fail); reject(new Error('Could not read the video')); };
    video.addEventListener('seeked', done);
    video.addEventListener('error', fail);
    video.currentTime = Math.min(t, Math.max(0, video.duration - 0.01));
  });
}

export function loadVideo(file: File): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.onloadedmetadata = () => {
      if (Number.isFinite(v.duration)) { resolve(v); return; }
      // Some recorders write no duration (WebM); seeking far past the end makes the browser compute it
      v.ondurationchange = () => { if (Number.isFinite(v.duration)) { v.ondurationchange = null; v.currentTime = 0; resolve(v); } };
      v.currentTime = 1e101;
      setTimeout(() => (Number.isFinite(v.duration) ? undefined : reject(new Error('Video length unknown'))), 8000);
    };
    v.onerror = () => reject(new Error('This video format can’t be read by the browser. Try an MP4 recording.'));
    v.src = URL.createObjectURL(file);
  });
}

function drawTo(src: CanvasImageSource, sw: number, sh: number, width: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width; c.height = Math.round((sh / sw) * width);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
const pixelsOf = (c: HTMLCanvasElement): Pixels => {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);
  return { width: d.width, height: d.height, data: d.data };
};

/** A pause in the recording: still from `start` to `end`; `time` is the frame we read. */
export interface StillRun { start: number; end: number; time: number }

/**
 * Find the moments the recording is still (your pauses between scrolls).
 * Samples the video every `step` seconds at low resolution and keeps the middle of each still run.
 */
export async function findStillTimes(source: FrameSource, onProgress: (f: number) => void, step = 0.25, signal?: AbortSignal): Promise<StillRun[]> {
  let prev: Uint8ClampedArray | null = null;
  const diffs: { t: number; d: number }[] = [];
  for (let t = 0; t <= source.duration; t += step) {
    if (signal?.aborted) throw new Error('Cancelled');
    const cur = await source.tiny(t);
    let d = 0;
    if (prev) for (let i = 0; i < cur.length; i += 4) d += Math.abs(cur[i] - prev[i]) + Math.abs(cur[i + 1] - prev[i + 1]) + Math.abs(cur[i + 2] - prev[i + 2]);
    diffs.push({ t, d: prev ? d / (cur.length / 4) : Infinity });
    prev = cur;
    onProgress(t / source.duration);
  }
  // still = frame barely changed since the previous sample (a quarter-second stop is enough: screen
  // recordings have no motion blur, so any frame where the list isn't moving reads cleanly)
  const still = diffs.map((x) => x.d < 3.5);
  const runs: StillRun[] = [];
  for (let i = 0; i < still.length; ) {
    if (!still[i]) { i++; continue; }
    let j = i;
    while (j + 1 < still.length && still[j + 1]) j++;
    // still[i] means frame i matches frame i-1, so the pause really began at sample i-1; read the middle
    runs.push({ start: diffs[Math.max(0, i - 1)].t, end: diffs[j].t, time: diffs[Math.floor((i + j) / 2)].t });
    i = j + 1;
  }
  return runs;
}

export interface TrackedFrame { t: number; cum: number; step: number }

/**
 * How far the storage list scrolled between two pauses, by following the motion frame by frame
 * (~30 fps). Returns the total (pixels at the analysis width, content moved up = positive) and every
 * frame's time, cumulative scroll and its own motion (small = a crisp frame worth reading).
 */
export async function measureScroll(source: FrameSource, from: StillRun, to: StillRun, cal: GridCalibration, signal?: AbortSignal): Promise<{ total: number; frames: TrackedFrame[] }> {
  const profiles: Float32Array[] = [];
  const times: number[] = [];
  const grab = async (t: number) => {
    times.push(t);
    if (signal?.aborted) throw new Error('Cancelled');
    profiles.push(await source.profile(t));
  };
  const step = 1 / 30;
  await grab(from.end);
  for (let t = from.end + step; t < to.start; t += step) await grab(t);
  await grab(to.start);
  const steps = trackSteps(profiles, cal);
  const frames: TrackedFrame[] = [{ t: times[0], cum: 0, step: 0 }];
  let cum = 0;
  steps.forEach((st, i) => { cum += st; frames.push({ t: times[i + 1], cum, step: Math.max(Math.abs(st), Math.abs(steps[i + 1] ?? st)) }); });
  return { total: cum, frames };
}

/** Frames from a <video> element (seeking, then drawing to a canvas). */
export function videoSource(video: HTMLVideoElement): FrameSource {
  const tinyC = document.createElement('canvas');
  tinyC.width = 48; tinyC.height = Math.max(48, Math.round((video.videoHeight / video.videoWidth) * 48));
  const tinyCtx = tinyC.getContext('2d', { willReadFrequently: true })!;
  const big = document.createElement('canvas');
  big.width = ANALYSIS_WIDTH; big.height = Math.round((video.videoHeight / video.videoWidth) * ANALYSIS_WIDTH);
  const bigCtx = big.getContext('2d', { willReadFrequently: true })!;
  return {
    duration: video.duration,
    async tiny(t) { await seek(video, t); tinyCtx.drawImage(video, 0, 0, tinyC.width, tinyC.height); return tinyCtx.getImageData(0, 0, tinyC.width, tinyC.height).data; },
    async profile(t) {
      await seek(video, t);
      bigCtx.drawImage(video, 0, 0, big.width, big.height);
      const d = bigCtx.getImageData(0, 0, big.width, big.height);
      return rowLuminance({ width: d.width, height: d.height, data: d.data });
    },
    page: (t, index) => grabFrame(video, t, index),
  };
}

export async function grabFrame(video: HTMLVideoElement, t: number, index: number): Promise<Page> {
  await seek(video, t);
  const canvas = drawTo(video, video.videoWidth, video.videoHeight, ANALYSIS_WIDTH);
  return { index, time: t, label: `${t.toFixed(1)}s`, pixels: pixelsOf(canvas), canvas, seeked: video.currentTime };
}

export async function loadImagePage(file: File, index: number): Promise<Page> {
  const bmp = await createImageBitmap(file);
  const canvas = drawTo(bmp, bmp.width, bmp.height, ANALYSIS_WIDTH);
  bmp.close();
  return { index, time: null, label: file.name, pixels: pixelsOf(canvas), canvas };
}

/** Small JPEG thumbnail of a region (for the review screen). */
export function thumbnail(canvas: HTMLCanvasElement, x: number, y: number, w: number, h: number, size = 72): string {
  const c = document.createElement('canvas');
  c.width = size; c.height = Math.round((h / w) * size);
  c.getContext('2d')!.drawImage(canvas, Math.max(0, x), Math.max(0, y), w, h, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.72);
}
