// Turning a screen recording (or screenshots) into still "pages" of the storage grid.
import { rowLuminance, trackScroll, type GridCalibration, type Pixels } from '../../lib/scanner';

/** Frames are analysed at this width (phone recordings are scaled down; plenty for 3-column tiles). */
export const ANALYSIS_WIDTH = 540;

export interface Page { index: number; time: number | null; label: string; pixels: Pixels; canvas: HTMLCanvasElement }

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
export async function findStillTimes(video: HTMLVideoElement, onProgress: (f: number) => void, step = 0.25, signal?: AbortSignal): Promise<StillRun[]> {
  const small = document.createElement('canvas');
  small.width = 48; small.height = Math.max(48, Math.round((video.videoHeight / video.videoWidth) * 48));
  const ctx = small.getContext('2d', { willReadFrequently: true })!;
  let prev: Uint8ClampedArray | null = null;
  const diffs: { t: number; d: number }[] = [];
  for (let t = 0; t <= video.duration; t += step) {
    if (signal?.aborted) throw new Error('Cancelled');
    await seek(video, t);
    ctx.drawImage(video, 0, 0, small.width, small.height);
    const cur = ctx.getImageData(0, 0, small.width, small.height).data;
    let d = 0;
    if (prev) for (let i = 0; i < cur.length; i += 4) d += Math.abs(cur[i] - prev[i]) + Math.abs(cur[i + 1] - prev[i + 1]) + Math.abs(cur[i + 2] - prev[i + 2]);
    diffs.push({ t, d: prev ? d / (cur.length / 4) : Infinity });
    prev = cur;
    onProgress(t / video.duration);
  }
  // still = frame barely changed since the previous sample
  const still = diffs.map((x) => x.d < 2.5);
  const runs: StillRun[] = [];
  for (let i = 0; i < still.length; ) {
    if (!still[i]) { i++; continue; }
    let j = i;
    while (j + 1 < still.length && still[j + 1]) j++;
    // a run of ≥2 still samples (≥ ~0.5 s) counts as a pause; read the frame in the middle of it.
    // still[i] means frame i matches frame i-1, so the pause really began at sample i-1.
    if (j - i + 1 >= 2) runs.push({ start: diffs[Math.max(0, i - 1)].t, end: diffs[j].t, time: diffs[Math.floor((i + j + 1) / 2)].t });
    i = j + 1;
  }
  return runs;
}

/**
 * How far the storage list scrolled between two pauses, by following the motion frame by frame
 * (~30 fps). Returns pixels at the analysis width (content moved up = positive).
 */
export async function measureScroll(video: HTMLVideoElement, from: StillRun, to: StillRun, cal: GridCalibration, signal?: AbortSignal): Promise<number> {
  const canvas = document.createElement('canvas');
  canvas.width = ANALYSIS_WIDTH; canvas.height = Math.round((video.videoHeight / video.videoWidth) * ANALYSIS_WIDTH);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const profiles: Float32Array[] = [];
  const grab = async (t: number) => {
    if (signal?.aborted) throw new Error('Cancelled');
    await seek(video, t);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
    profiles.push(rowLuminance({ width: d.width, height: d.height, data: d.data }, cal));
  };
  const step = 1 / 30;
  await grab(from.end);
  for (let t = from.end + step; t < to.start; t += step) await grab(t);
  await grab(to.start);
  return trackScroll(profiles, cal);
}

export async function grabFrame(video: HTMLVideoElement, t: number, index: number): Promise<Page> {
  await seek(video, t);
  const canvas = drawTo(video, video.videoWidth, video.videoHeight, ANALYSIS_WIDTH);
  return { index, time: t, label: `${t.toFixed(1)}s`, pixels: pixelsOf(canvas), canvas };
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
