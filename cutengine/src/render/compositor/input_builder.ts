// Builds FFmpeg -i input arguments from IRTimeline layers.
// Each unique media source gets one input index. Images are looped to create video streams.

import type { IRTimeline, IRLayer } from '../parser/types.js';

export interface InputBuildResult {
  /** FFmpeg arguments: [-loop, 1, -t, D, -i, path, ...] */
  args: string[];
  /** Map from asset src path → input index */
  indexMap: Map<string, number>;
  /** Total number of inputs */
  count: number;
}

/**
 * Collect all unique media inputs from the timeline and build FFmpeg -i arguments.
 * Deduplicates by source path — the same image used in multiple clips only gets one input.
 *
 * @param ir - Parsed timeline
 * @param totalDuration - Total timeline duration in seconds (for image loop duration)
 * @returns Input arguments and source-to-index mapping
 */
export function buildInputs(ir: IRTimeline, totalDuration: number): InputBuildResult {
  const args: string[] = [];
  const indexMap = new Map<string, number>();
  let nextIndex = 0;

  for (const scene of ir.scenes) {
    for (const layer of scene.layers) {
      if (layer.type !== 'visual') continue;
      if (!layer.asset.src) continue;
      if (indexMap.has(layer.asset.src)) continue;

      const inputArgs = buildSingleInput(layer, totalDuration);
      args.push(...inputArgs, '-i', layer.asset.src);
      indexMap.set(layer.asset.src, nextIndex);
      nextIndex++;
    }
  }

  return { args, indexMap, count: nextIndex };
}

function buildSingleInput(layer: IRLayer, totalDuration: number): string[] {
  const pre: string[] = [];

  switch (layer.asset.type) {
    case 'image': {
      // Still image needs -loop 1 and a duration to create a video stream
      // Duration = clip duration + some padding for transitions
      const duration = layer.timing.duration + 1;
      pre.push('-loop', '1', '-t', String(Math.min(duration, totalDuration + 1)));
      break;
    }
    case 'video': {
      // Video with optional trim (seek)
      if (layer.asset.trim && layer.asset.trim > 0) {
        pre.push('-ss', String(layer.asset.trim));
      }
      break;
    }
    // text, caption, html — no file input needed (handled by drawtext or overlay)
    // audio — handled separately by audio-mixer.ts
  }

  return pre;
}

/**
 * Build input arguments for pre-rendered text/caption overlay PNGs.
 * Called after pre_renderer produces PNG files.
 *
 * Each PNG is looped for the full timeline duration so FFmpeg's enable=between()
 * filter can reference any timestamp. Previously hardcoded to -t 1 which caused
 * captions starting after t=1s to produce blank overlays.
 *
 * @param pngPaths - Paths to pre-rendered transparent PNGs
 * @param startIndex - Input index offset (after media inputs)
 * @param totalDuration - Total timeline duration in seconds
 * @returns Additional -i arguments and index map
 */
export function buildOverlayInputs(
  pngPaths: string[],
  startIndex: number,
  totalDuration: number,
): { args: string[]; indexMap: Map<string, number> } {
  const args: string[] = [];
  const indexMap = new Map<string, number>();
  const loopDuration = String(totalDuration + 1);

  for (let i = 0; i < pngPaths.length; i++) {
    args.push('-loop', '1', '-t', loopDuration, '-i', pngPaths[i]);
    indexMap.set(pngPaths[i], startIndex + i);
  }

  return { args, indexMap };
}
