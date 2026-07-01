// Parallel chunk renderer for the FFmpeg compositor.
// Splits timeline into N chunks, renders each via separate FFmpeg process,
// trims overlap, concatenates, and mixes audio in a final pass.

import { spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, copyFileSync, symlinkSync, lstatSync } from 'fs';
import { join, relative, resolve } from 'path';
import { cpus } from 'os';
import type { IRTimeline } from '../parser/types.js';
import type { CompositorOptions } from './types.js';
import { splitTimeline } from './chunk_splitter.js';
import { composeTimeline } from './index.js';
import { buildAudioMix } from '../encoder/audio-mixer.js';
import { resolveCodec, getQualityArgs, getPresetArgs } from '../encoder/hwaccel.js';
import { config } from '../../config/index.js';

/**
 * Render a timeline in parallel chunks for faster processing.
 *
 * Workflow:
 * 1. Split timeline into N chunks at scene boundaries
 * 2. Render each chunk via composeTimeline() in parallel (video only, no audio)
 * 3. Trim overlap from chunk boundaries
 * 4. Concatenate trimmed chunks (lossless, no re-encode)
 * 5. Mix audio onto the concatenated video in a final pass
 *
 * @param ir - Full parsed timeline
 * @param workDir - Working directory for temp files
 * @param outputPath - Final output file path
 * @param workerCount - Number of parallel workers (capped at CPU count and 4)
 * @param opts - Progress callback
 */
export async function renderParallel(
  ir: IRTimeline,
  workDir: string,
  outputPath: string,
  workerCount: number,
  opts?: CompositorOptions,
): Promise<void> {
  // Cap worker count
  const maxWorkers = Math.min(workerCount, cpus().length, 4);
  const totalDuration = ir.scenes.reduce((sum, s) => sum + s.duration, 0);

  // 1. Split timeline
  const chunks = splitTimeline(ir, maxWorkers);

  if (chunks.length <= 1) {
    // Not enough scenes to parallelize — fall back to sequential
    await composeTimeline(ir, workDir, outputPath, opts);
    return;
  }

  // 2. Create per-chunk work directories
  const chunkOutputs: string[] = [];
  for (const chunk of chunks) {
    const chunkDir = join(workDir, `chunk_${chunk.chunkIndex}`);
    if (!existsSync(chunkDir)) {
      mkdirSync(chunkDir, { recursive: true });
    }

    // Symlink prefetch directory (assets are shared, avoid duplicating)
    const prefetchLink = join(chunkDir, 'prefetch');
    const sourcePrefetch = join(workDir, 'prefetch');
    if (existsSync(sourcePrefetch) && !existsSync(prefetchLink)) {
      try {
        // Verify source is a real directory (not a symlink attack)
        const stat = lstatSync(sourcePrefetch);
        if (stat.isDirectory()) {
          symlinkSync(sourcePrefetch, prefetchLink, 'dir');
        }
      } catch {
        // Symlink failed (permissions) — chunks will re-use absolute paths directly
      }
    }

    const chunkOutput = join(chunkDir, `chunk_${chunk.chunkIndex}.mp4`);
    chunkOutputs.push(chunkOutput);
  }

  // 3. Render all chunks in parallel
  const progressPerChunk = new Map<number, number>();
  await Promise.all(
    chunks.map(async (chunk, i) => {
      const chunkDir = join(workDir, `chunk_${chunk.chunkIndex}`);
      await composeTimeline(chunk.subTimeline, chunkDir, chunkOutputs[i], {
        onProgress: (percent) => {
          progressPerChunk.set(i, percent);
          // Aggregate progress across all chunks
          if (opts?.onProgress) {
            const total = [...progressPerChunk.values()].reduce((s, v) => s + v, 0);
            const avg = Math.round((total / chunks.length) * 0.8); // 80% for rendering
            opts.onProgress(avg);
          }
        },
      });
    }),
  );

  // 4. Trim overlap from chunk boundaries
  const trimmedOutputs: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkOutput = chunkOutputs[i];

    if (chunk.overlapStart && chunk.overlapDuration > 0) {
      // Trim the overlap from the beginning of this chunk.
      // -ss AFTER -i = output option = frame-accurate decode-then-seek
      // (unlike input option which seeks to nearest keyframe)
      const trimmedPath = join(workDir, `chunk_${i}_trimmed.mp4`);
      await runFFmpegSimple([
        '-i', chunkOutput,
        '-ss', String(chunk.overlapDuration),
        '-c:v', 'libx264', '-crf', '18',
        '-c:a', 'copy',
        '-y',
        trimmedPath,
      ]);
      trimmedOutputs.push(trimmedPath);
    } else {
      trimmedOutputs.push(chunkOutput);
    }
  }

  // 5. Concatenate trimmed chunks using relative paths (no -safe 0 needed)
  const concatListPath = join(workDir, 'concat_list.txt');
  const concatContent = trimmedOutputs
    .map(p => `file '${relative(workDir, resolve(p)).replace(/'/g, "'\\''")}'`)
    .join('\n');
  writeFileSync(concatListPath, concatContent, 'utf-8');

  const mergedPath = join(workDir, 'merged_video.mp4');
  await runFFmpegSimple([
    '-f', 'concat',
    '-i', concatListPath,
    '-c', 'copy',
    '-y',
    mergedPath,
  ], workDir);

  opts?.onProgress?.(85);

  // 6. Mix audio onto merged video
  const hasAudio = ir.audio.clips.length > 0 || ir.audio.soundtrack;

  if (hasAudio && !ir.output.mute) {
    const audioMix = buildAudioMix(ir.audio, totalDuration);

    if (audioMix.filterComplex) {
      const codec = resolveCodec(config.encoder.codec);
      const [qualityFlag, qualityValue] = getQualityArgs(ir.output.quality, codec);
      const presetArgs = getPresetArgs(codec);

      const audioFilterPath = join(workDir, 'audio_filter.txt');
      writeFileSync(audioFilterPath, audioMix.filterComplex, 'utf-8');

      await runFFmpegSimple([
        '-i', mergedPath,
        ...audioMix.inputArgs,
        '-filter_complex_script', audioFilterPath,
        '-map', '0:v',
        '-map', '[aout]',
        '-c:v', 'copy',   // No video re-encode
        '-c:a', 'aac',
        '-b:a', '192k',
        '-t', String(totalDuration),
        '-y',
        outputPath,
      ]);
    } else {
      // No complex audio mix needed — just copy
      await runFFmpegSimple([
        '-i', mergedPath,
        ...audioMix.inputArgs,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-shortest',
        '-y',
        outputPath,
      ]);
    }
  } else {
    // No audio — merged video IS the final output
    copyFileSync(mergedPath, outputPath);
  }

  opts?.onProgress?.(100);
}

/**
 * Run a simple FFmpeg command (no progress tracking).
 * Used for trim, concat, and audio mix steps.
 */
function runFFmpegSimple(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'], cwd });
    let stderr = '';

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code: number | null) => {
      if (code === 0) {
        resolve();
      } else {
        const errorTail = stderr.slice(-500);
        reject(new Error(`FFmpeg exited with code ${code}: ${errorTail}`));
      }
    });

    proc.on('error', reject);
  });
}
