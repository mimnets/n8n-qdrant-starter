// FFmpeg compositor orchestrator.
// Composes an entire IRTimeline into a final video using a single FFmpeg filter_complex pass.

import { spawn } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';
import type { IRTimeline } from '../parser/types.js';
import type { CompositorOptions } from './types.js';
import { buildInputs, buildOverlayInputs } from './input_builder.js';
import { buildFilterGraph } from './filter_graph.js';
import { preRenderHtmlLayers } from './pre_renderer.js';
import { preRenderSvgLayers } from './svg_renderer.js';
import { PreRenderCache } from './cache_manager.js';
import { buildAudioMix } from '../encoder/audio-mixer.js';
import { resolveCodec, getQualityArgs, getPresetArgs } from '../encoder/hwaccel.js';
import { config } from '../../config/index.js';

/**
 * Compose an IRTimeline into a final video file using FFmpeg filter_complex.
 * This bypasses the Puppeteer frame-capture pipeline entirely.
 *
 * @param ir - Parsed timeline (after prefetch — asset paths are local)
 * @param workDir - Working directory for temp files
 * @param outputPath - Final output file path
 * @param opts - Progress callback
 */
export async function composeTimeline(
  ir: IRTimeline,
  workDir: string,
  outputPath: string,
  opts?: CompositorOptions,
): Promise<void> {
  const totalDuration = ir.scenes.reduce((sum, s) => sum + s.duration, 0);
  const prefetchDir = join(workDir, 'prefetch');

  // 1. Build media inputs (-i arguments)
  const inputs = buildInputs(ir, totalDuration);

  // 1.4 Initialize pre-render cache (Phase C)
  const cacheEnabled = config.compositor?.cacheEnabled !== false;
  const cache = cacheEnabled ? new PreRenderCache(workDir) : undefined;

  // 1.5 Pre-render HTML caption layers to transparent PNGs (Phase B)
  let htmlPreRendered: Awaited<ReturnType<typeof preRenderHtmlLayers>> = [];
  let svgPreRendered: Awaited<ReturnType<typeof preRenderSvgLayers>> = [];
  let overlayInputMap = new Map<string, number>();
  let overlayArgs: string[] = [];

  const { width, height } = ir.output;

  try {
    htmlPreRendered = await preRenderHtmlLayers(ir, workDir, width, height, cache);
  } catch {
    // Puppeteer not available — skip HTML pre-render (Phase A behavior)
    htmlPreRendered = [];
  }

  // 1.6 Pre-render SVG layers to transparent PNGs (Phase C)
  try {
    svgPreRendered = await preRenderSvgLayers(ir, workDir, width, height, cache);
  } catch {
    // SVG pre-render failed — skip (SVG layers will be absent from output)
    svgPreRendered = [];
  }

  // 1.7 Merge all pre-rendered results and flush cache
  const preRendered = [...htmlPreRendered, ...svgPreRendered];
  cache?.flush();

  // 1.8 Add pre-rendered PNGs as FFmpeg inputs
  if (preRendered.length > 0) {
    const overlayResult = buildOverlayInputs(
      preRendered.map(p => p.pngPath),
      inputs.count,
      totalDuration,
    );
    overlayInputMap = overlayResult.indexMap;
    overlayArgs = overlayResult.args;
  }

  // 2. Build video filter_complex (with Phase B overlay info)
  const graph = buildFilterGraph(ir, inputs.indexMap, prefetchDir, preRendered, overlayInputMap);

  // 3. Build audio filter_complex (reuse existing audio-mixer)
  // Audio inputs start after video inputs AND overlay PNG inputs
  const hasAudio = ir.audio.clips.length > 0 || ir.audio.soundtrack;
  let audioFilterComplex = '';
  let audioInputArgs: string[] = [];
  let audioMapArgs: string[] = [];

  if (hasAudio && !ir.output.mute) {
    const audioOffset = inputs.count + preRendered.length;
    const audioMix = buildAudioMixWithOffset(ir, totalDuration, audioOffset);
    audioFilterComplex = audioMix.filterComplex;
    audioInputArgs = audioMix.inputArgs;
    audioMapArgs = audioMix.mapArgs;
  }

  // 4. Combine video + audio filter_complex
  let fullFilterComplex = graph.filterComplex;
  if (audioFilterComplex) {
    fullFilterComplex += ';\n' + audioFilterComplex;
  }

  // 5. Write filter_complex to temp file (avoid shell arg length limits)
  const filterScriptPath = join(workDir, 'filter_complex.txt');
  writeFileSync(filterScriptPath, fullFilterComplex, 'utf-8');

  // 6. Build final FFmpeg command
  const codec = resolveCodec(config.encoder.codec);
  const [qualityFlag, qualityValue] = getQualityArgs(ir.output.quality, codec);
  const presetArgs = getPresetArgs(codec);

  const args: string[] = [
    ...inputs.args,          // Video inputs (-loop 1 -t D -i path ...)
    ...overlayArgs,          // Pre-rendered PNG overlay inputs (Phase B)
    ...audioInputArgs,       // Audio inputs (-i narration.mp3 -i bgm.mp3 ...)
    '-filter_complex_script', filterScriptPath,
    '-map', graph.videoOutputLabel,
    ...(audioFilterComplex ? ['-map', '[aout]'] : []),
    '-c:v', codec,
    ...presetArgs,
    qualityFlag, qualityValue,
    '-pix_fmt', 'yuv420p',
    ...(audioFilterComplex ? ['-c:a', 'aac'] : []),
    '-ac', '2',
    '-b:a', '128k',
    '-t', String(totalDuration),
    '-movflags', '+faststart',
    '-y',
    outputPath,
  ];

  // 7. Run FFmpeg
  await runFFmpegWithProgress(args, totalDuration, opts?.onProgress);
}

/**
 * Build audio mix with input index offset (audio inputs come after video inputs).
 * The existing buildAudioMix assumes audio starts at input index 1 (index 0 = video frames).
 * In the compositor, audio inputs start at `videoInputCount`.
 */
function buildAudioMixWithOffset(
  ir: IRTimeline,
  totalDuration: number,
  videoInputCount: number,
): { inputArgs: string[]; filterComplex: string; mapArgs: string[] } {
  const mix = buildAudioMix(ir.audio, totalDuration);

  if (!mix.filterComplex) return mix;

  // Rewrite input indices in the filter_complex string
  // The audio-mixer uses indices starting from 1, but we need to offset by videoInputCount
  // Original: [1:a]...[a1]; [2:a]...[a2]; ...
  // Rewritten: [N:a]...[a1]; [N+1:a]...[a2]; ...
  let rewritten = mix.filterComplex;

  // Find all [N:a] references and offset them
  // Audio mixer starts from index 1 (0 is video frames input)
  // We need to shift by (videoInputCount - 1) since mixer assumes 0=video, 1=first audio
  const offset = videoInputCount - 1;
  if (offset > 0) {
    rewritten = rewritten.replace(/\[(\d+):a\]/g, (_match, idx) => {
      const newIdx = parseInt(idx, 10) + offset;
      return `[${newIdx}:a]`;
    });
  }

  return {
    inputArgs: mix.inputArgs,
    filterComplex: rewritten,
    mapArgs: ['-map', `[aout]`],
  };
}

function runFFmpegWithProgress(
  args: string[],
  totalDuration: number,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';

    proc.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;

      // Parse FFmpeg progress from stderr: "time=HH:MM:SS.ss"
      if (onProgress) {
        const timeMatch = chunk.match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (timeMatch) {
          const seconds = parseInt(timeMatch[1]) * 3600
            + parseInt(timeMatch[2]) * 60
            + parseFloat(timeMatch[3]);
          const percent = Math.min(99, Math.round((seconds / totalDuration) * 100));
          onProgress(percent);
        }
      }
    });

    proc.on('close', (code: number | null) => {
      if (code === 0) {
        onProgress?.(100);
        resolve();
      } else {
        // Include the last 500 chars of stderr for debugging
        const errorTail = stderr.slice(-500);
        reject(new Error(`FFmpeg compositor exited with code ${code}: ${errorTail}`));
      }
    });

    proc.on('error', reject);
  });
}

export { canUseFFmpegCompositor } from './router.js';
