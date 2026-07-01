import { parseTimeline } from './parser/index.js';
import { buildScene } from './builder/index.js';
import { captureFrames } from './capture/index.js';
import { encode } from './encoder/index.js';
import { prefetchAssets, applyPrefetchPaths, resolveAssetUrl } from './prefetch.js';
import { composeTimeline, canUseFFmpegCompositor } from './compositor/index.js';
import { renderParallel } from './compositor/parallel_runner.js';
import { progressHub } from '../api/progress.js';
import type { IRTimeline } from './parser/types.js';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { renderTotal, renderDuration } from '../api/metrics.js';
import { config } from '../config/index.js';

export interface PipelineResult {
  outputPath: string;
  format: string;
  duration: number;
}

export type StatusCallback = (status: string) => Promise<void> | void;

interface StageLog {
  stage: string;
  durationMs: number;
}

function logStage(stage: string, startTime: number): StageLog {
  const durationMs = Date.now() - startTime;
  return { stage, durationMs };
}

export async function executePipeline(
  editJson: { timeline: any; output: any; merge?: any[]; callback?: string },
  workDir: string,
  onStatus?: StatusCallback,
  renderId?: string,
): Promise<PipelineResult> {
  mkdirSync(workDir, { recursive: true });

  const pipelineStart = Date.now();
  const stageLogs: StageLog[] = [];

  try {
    // Stage 1: Parse
    let stageStart = Date.now();
    await onStatus?.('fetching');
    const ir: IRTimeline = parseTimeline(editJson);
    stageLogs.push(logStage('parse', stageStart));

    // Stage 1.5: Prefetch external assets (images, videos, audio, fonts)
    if (ir.assets.length > 0) {
      stageStart = Date.now();
      const prefetchDir = join(workDir, 'prefetch');
      const prefetchResult = await prefetchAssets(ir.assets, prefetchDir);
      applyPrefetchPaths(ir.assets, prefetchResult.urlMap);

      // Replace src URLs in scene layers with URLs accessible by Docker Chromium
      for (const scene of ir.scenes) {
        for (const layer of scene.layers) {
          if (layer.asset.src) {
            const localPath = prefetchResult.urlMap.get(layer.asset.src);
            if (localPath) {
              layer.asset.src = resolveAssetUrl(localPath);
            }
          }
        }
      }

      // Replace audio clip src URLs
      for (const clip of ir.audio.clips) {
        const localPath = prefetchResult.urlMap.get(clip.src);
        if (localPath) clip.src = localPath;
      }

      // Replace soundtrack src
      if (ir.audio.soundtrack) {
        const localPath = prefetchResult.urlMap.get(ir.audio.soundtrack.src);
        if (localPath) ir.audio.soundtrack.src = localPath;
      }

      const prefetchLog = logStage('prefetch', stageStart);
      (prefetchLog as any).downloaded = prefetchResult.downloaded;
      (prefetchLog as any).cached = prefetchResult.cached;
      (prefetchLog as any).failed = prefetchResult.failed.length;
      stageLogs.push(prefetchLog);
    }

    // Stage 1.8: Route — FFmpeg compositor or Puppeteer?
    const totalDuration = ir.scenes.reduce((sum, s) => sum + s.duration, 0);
    const compositorForce = config.compositor?.forceMode ?? 'auto';
    const routeResult = canUseFFmpegCompositor(ir, compositorForce);

    if (routeResult.eligible && config.compositor?.enabled !== false) {
      stageStart = Date.now();
      await onStatus?.('compositing');
      const outputPath = join(workDir, `output.${ir.output.format}`);

      const workers = config.compositor?.parallelWorkers ?? 0;
      const progressCallback = renderId
        ? (percent: number) => progressHub.emitProgress({
            renderId: renderId!,
            stage: 'compose',
            percent,
          })
        : undefined;

      if (workers > 0 && ir.scenes.length > workers) {
        // Parallel chunk rendering (Phase C)
        await renderParallel(ir, workDir, outputPath, workers, {
          onProgress: progressCallback,
        });
      } else {
        // Sequential rendering (Phase A/B)
        await composeTimeline(ir, workDir, outputPath, {
          onProgress: progressCallback,
        });
      }

      stageLogs.push(logStage('compose', stageStart));

      const totalMs = Date.now() - pipelineStart;
      renderDuration.observe(totalMs / 1000);
      renderTotal.inc({ status: 'completed' });

      if (renderId) {
        progressHub.emitProgress({ renderId, stage: 'done', percent: 100 });
        progressHub.cleanup(renderId);
      }

      const logEntry = {
        event: 'pipeline_complete',
        renderer: 'compositor',
        totalMs,
        stages: stageLogs,
      };
      if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'test') {
        console.log(JSON.stringify(logEntry));
      }

      return { outputPath, format: ir.output.format, duration: totalDuration };
    }

    // Puppeteer fallback path (original)
    if (!routeResult.eligible) {
      const logEntry = { event: 'compositor_fallback', reason: routeResult.reason };
      if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'test') {
        console.log(JSON.stringify(logEntry));
      }
    }

    // Stage 2: Build HTML scene
    stageStart = Date.now();
    await onStatus?.('rendering');
    const sceneHtml = buildScene(ir.scenes[0], ir.output, totalDuration);
    stageLogs.push(logStage('build', stageStart));

    // Stage 3: Capture frames
    stageStart = Date.now();
    const frameDir = join(workDir, 'frames');
    // A scene is static only if all layers share the same timing AND have no effects
    const hasTimingVariation = ir.scenes.some(s =>
      s.layers.some(l => l.type === 'visual' && (l.timing.start > 0 || l.timing.duration < totalDuration)),
    );
    const isStatic = !hasTimingVariation && !ir.scenes.some(s =>
      s.layers.some(l => l.effects.motion || l.timing.transitionIn || l.timing.transitionOut),
    );

    // Low-memory mode: JPEG capture + frame skip for M1 8GB survival
    // Set CUTENGINE_LOW_MEMORY=1 to enable (auto-detected if free pages < 10000)
    const lowMemory = process.env.CUTENGINE_LOW_MEMORY === '1';

    const captureResult = await captureFrames({
      html: sceneHtml,
      outputDir: frameDir,
      width: ir.output.width,
      height: ir.output.height,
      fps: ir.output.fps,
      duration: totalDuration,
      isStatic,
      useJpeg: lowMemory,
      jpegQuality: lowMemory ? 80 : undefined,
      frameSkip: lowMemory ? 2 : 1,
      onProgress: renderId
        ? (frame, total) => progressHub.emitProgress({
            renderId: renderId!,
            stage: 'capture',
            frame,
            totalFrames: total,
            percent: Math.round((frame / total) * 100 * 10) / 10,
          })
        : undefined,
    });
    const captureLog = logStage('capture', stageStart);
    if (captureResult.resumed) {
      (captureLog as any).resumedFrom = captureResult.resumedFrom;
      (captureLog as any).skippedFrames = captureResult.resumedFrom;
    }
    stageLogs.push(captureLog);

    // Stage 4: Encode
    stageStart = Date.now();
    await onStatus?.('saving');
    const outputPath = join(workDir, `output.${ir.output.format}`);

    // Respect output.mute — skip audio when muted (consistent with compositor path)
    const hasAudio = !ir.output.mute && (ir.audio.clips.length > 0 || !!ir.audio.soundtrack);

    await encode({
      frameDir: captureResult.frameDir,
      framePattern: captureResult.framePattern,
      frameCount: captureResult.frameCount,
      output: ir.output,
      audio: hasAudio ? ir.audio : undefined,
      outputPath,
      captureFps: captureResult.captureFps,
      outputFps: captureResult.outputFps,
    });
    stageLogs.push(logStage('encode', stageStart));

    const totalMs = Date.now() - pipelineStart;
    renderDuration.observe(totalMs / 1000);
    renderTotal.inc({ status: 'completed' });

    if (renderId) {
      progressHub.emitProgress({ renderId, stage: 'done', percent: 100 });
      progressHub.cleanup(renderId);
    }

    // Structured log output
    const logEntry = {
      event: 'pipeline_complete',
      totalMs,
      stages: stageLogs,
    };
    if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'test') {
      console.log(JSON.stringify(logEntry));
    }

    return {
      outputPath,
      format: ir.output.format,
      duration: totalDuration,
    };
  } catch (error) {
    renderTotal.inc({ status: 'failed' });

    if (renderId) {
      progressHub.emitProgress({ renderId, stage: 'failed', percent: 0 });
      progressHub.cleanup(renderId);
    }

    const totalMs = Date.now() - pipelineStart;
    const logEntry = {
      event: 'pipeline_failed',
      totalMs,
      stages: stageLogs,
      error: error instanceof Error ? error.message : String(error),
    };
    if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'test') {
      console.error(JSON.stringify(logEntry));
    }

    throw error;
  }
}
