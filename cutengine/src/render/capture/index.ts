import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { acquirePage, releasePage } from './browser-pool.js';

export type ProgressCallback = (frame: number, totalFrames: number) => void;

export interface CaptureOptions {
  html: string;
  outputDir: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  isStatic?: boolean;
  onProgress?: ProgressCallback;
  /** Use JPEG instead of PNG for faster I/O on low-memory machines. Default: false */
  useJpeg?: boolean;
  /** JPEG quality (1-100). Default: 80 */
  jpegQuality?: number;
  /** Capture every Nth frame only (e.g. 2 = half the frames). FFmpeg interpolates. Default: 1 */
  frameSkip?: number;
}

export interface CaptureResult {
  frameDir: string;
  frameCount: number;
  framePattern: string;
  resumed: boolean;
  resumedFrom: number;
  /** Actual capture FPS after frameSkip (for FFmpeg -framerate) */
  captureFps: number;
  /** Target output FPS (original fps, for FFmpeg -r) */
  outputFps: number;
}

interface Checkpoint {
  lastFrame: number;
  totalFrames: number;
  updatedAt: string;
}

const CHECKPOINT_INTERVAL = 100;

function readCheckpoint(dir: string): Checkpoint | null {
  const path = join(dir, 'checkpoint.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function writeCheckpoint(dir: string, lastFrame: number, totalFrames: number): void {
  const path = join(dir, 'checkpoint.json');
  const data: Checkpoint = { lastFrame, totalFrames, updatedAt: new Date().toISOString() };
  writeFileSync(path, JSON.stringify(data));
}

function frameExists(dir: string, frameNum: string): boolean {
  return existsSync(join(dir, `frame_${frameNum}.png`)) || existsSync(join(dir, `frame_${frameNum}.jpg`));
}

/**
 * Load HTML into page using setContent with domcontentloaded (never hangs).
 * Then wait for images via evaluate with a hard timeout.
 */
async function loadHtml(page: any, html: string): Promise<void> {
  // domcontentloaded returns as soon as HTML is parsed — never waits for network
  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for all <img> elements to load (with 15s hard timeout)
  try {
    await page.waitForFunction(
      () => Array.from(document.images).every((img: HTMLImageElement) => img.complete),
      { timeout: 15000 },
    );
  } catch {
    // Some images may not load (404, slow network) — proceed anyway
  }
}

export async function captureFrames(opts: CaptureOptions): Promise<CaptureResult> {
  mkdirSync(opts.outputDir, { recursive: true });

  const imgType = opts.useJpeg ? 'jpeg' : 'png';
  const imgExt = opts.useJpeg ? 'jpg' : 'png';
  const jpegQuality = opts.jpegQuality ?? 80;
  const frameSkip = Math.max(1, opts.frameSkip ?? 1);

  if (opts.isStatic) {
    const page = await acquirePage(opts.width, opts.height);
    try {
      await loadHtml(page, opts.html);
      await page.evaluate((time: number) => {
        if (typeof (window as any).updateFrame === 'function') {
          (window as any).updateFrame(time);
        }
      }, 0);
      const screenshotOpts: any = {
        path: join(opts.outputDir, `frame_00001.${imgExt}`),
        type: imgType,
      };
      if (imgType === 'jpeg') screenshotOpts.quality = jpegQuality;
      await page.screenshot(screenshotOpts);
      return { frameDir: opts.outputDir, frameCount: 1, framePattern: `frame_%05d.${imgExt}`, resumed: false, resumedFrom: 0, captureFps: opts.fps, outputFps: opts.fps };
    } finally {
      await releasePage(page);
    }
  }

  const totalFrames = Math.ceil(opts.fps * opts.duration);

  // With frameSkip, we capture fewer frames but at wider time intervals
  // e.g. frameSkip=2, 15fps, 14s = 210 total frames, capture 105 actual frames
  const capturedFrameCount = Math.ceil(totalFrames / frameSkip);
  const captureFps = opts.fps / frameSkip;

  // Check for existing checkpoint to resume from
  const checkpoint = readCheckpoint(opts.outputDir);
  let startCaptureIndex = 0;
  let resumed = false;

  if (checkpoint && checkpoint.totalFrames === capturedFrameCount && checkpoint.lastFrame > 0) {
    const lastFrameNum = String(checkpoint.lastFrame).padStart(5, '0');
    if (frameExists(opts.outputDir, lastFrameNum)) {
      startCaptureIndex = checkpoint.lastFrame;
      resumed = true;
    }
  }

  const page = await acquirePage(opts.width, opts.height);

  try {
    await loadHtml(page, opts.html);

    for (let ci = startCaptureIndex; ci < capturedFrameCount; ci++) {
      // Map capture index back to original timeline
      const originalFrameIndex = ci * frameSkip;
      const currentTime = originalFrameIndex / opts.fps;

      await page.evaluate((time: number) => {
        if (typeof (window as any).updateFrame === 'function') {
          (window as any).updateFrame(time);
        }
      }, currentTime);

      const frameNum = String(ci + 1).padStart(5, '0');
      const screenshotOpts: any = {
        path: join(opts.outputDir, `frame_${frameNum}.${imgExt}`),
        type: imgType,
      };
      if (imgType === 'jpeg') screenshotOpts.quality = jpegQuality;
      await page.screenshot(screenshotOpts);

      // Write checkpoint every N frames
      if ((ci + 1) % CHECKPOINT_INTERVAL === 0) {
        writeCheckpoint(opts.outputDir, ci + 1, capturedFrameCount);
      }

      // Report progress
      opts.onProgress?.(ci + 1, capturedFrameCount);
    }

    // Final checkpoint
    writeCheckpoint(opts.outputDir, capturedFrameCount, capturedFrameCount);

    return {
      frameDir: opts.outputDir,
      frameCount: capturedFrameCount,
      framePattern: `frame_%05d.${imgExt}`,
      resumed,
      resumedFrom: resumed ? startCaptureIndex : 0,
      captureFps,
      outputFps: opts.fps,
    };
  } finally {
    await releasePage(page);
  }
}
