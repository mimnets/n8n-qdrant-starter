// Timeline chunk splitter for parallel rendering.
// Splits an IRTimeline into N sub-timelines at scene boundaries.
// Each chunk is independently renderable via composeTimeline().

import type { IRTimeline, IRScene, IRAudioMix } from '../parser/types.js';

export interface TimelineChunk {
  chunkIndex: number;
  /** Sub-timeline with scenes subset, audio stripped */
  subTimeline: IRTimeline;
  /** True if first scene is an overlap duplicate from previous chunk */
  overlapStart: boolean;
  /** Duration of the overlap scene (for trimming after render) */
  overlapDuration: number;
}

/** Empty audio mix used when stripping audio from chunks */
const EMPTY_AUDIO: IRAudioMix = {
  clips: [],
  soundtrack: undefined as any,
};

/**
 * Split a timeline into N chunks at scene boundaries for parallel rendering.
 *
 * Rules:
 * - Never splits mid-scene
 * - Distributes scenes approximately evenly by total duration
 * - Duplicates boundary scenes for transition overlap (trimmed after concat)
 * - Strips audio from all chunks (audio rendered separately in final pass)
 * - Adjusts scene timing to be relative (each chunk starts at t=0)
 *
 * @param ir - Full timeline
 * @param workerCount - Desired number of chunks (auto-reduced if too few scenes)
 * @returns Array of chunks ready for independent rendering
 */
export function splitTimeline(ir: IRTimeline, workerCount: number): TimelineChunk[] {
  const scenes = ir.scenes;

  // Can't split more than we have scenes
  const effectiveWorkers = Math.min(workerCount, scenes.length);
  if (effectiveWorkers <= 1) {
    // Single chunk — return the full timeline (no audio stripping needed,
    // caller handles audio separately in parallel mode)
    return [{
      chunkIndex: 0,
      subTimeline: { ...ir, audio: EMPTY_AUDIO },
      overlapStart: false,
      overlapDuration: 0,
    }];
  }

  // Calculate total duration and target per-chunk duration
  const totalDuration = scenes.reduce((sum, s) => sum + s.duration, 0);
  const targetDuration = totalDuration / effectiveWorkers;

  // Greedy split: accumulate scenes until we exceed target duration
  const splitPoints: number[] = [0]; // scene indices where each chunk starts
  let accumulated = 0;

  for (let i = 0; i < scenes.length; i++) {
    accumulated += scenes[i].duration;

    // Check if we've accumulated enough for a chunk
    // But don't create a split if it would leave us with too many chunks
    if (accumulated >= targetDuration && splitPoints.length < effectiveWorkers) {
      splitPoints.push(i + 1);
      accumulated = 0;
    }
  }

  // Build chunks from split points
  const chunks: TimelineChunk[] = [];

  for (let c = 0; c < splitPoints.length; c++) {
    const startIdx = splitPoints[c];
    const endIdx = c + 1 < splitPoints.length ? splitPoints[c + 1] : scenes.length;

    // Add overlap: include previous chunk's last scene as our first (for transitions)
    // Only head-overlap is used — the previous chunk's last scene is duplicated at the
    // start of the next chunk, then trimmed after rendering. Tail-overlap was removed
    // because it caused scenes at split boundaries to appear twice in the final output.
    const overlapStart = c > 0 && startIdx > 0;

    const actualStart = overlapStart ? startIdx - 1 : startIdx;
    const actualEnd = endIdx;

    // Extract and rebase scenes (each chunk starts at t=0)
    const chunkScenes = scenes.slice(actualStart, actualEnd);
    const timeOffset = chunkScenes[0]?.startTime ?? 0;

    const rebasedScenes: IRScene[] = chunkScenes.map(scene => ({
      ...scene,
      startTime: scene.startTime - timeOffset,
      layers: scene.layers.map(layer => ({
        ...layer,
        timing: {
          ...layer.timing,
          start: layer.timing.start - timeOffset,
        },
      })),
    }));

    const overlapDuration = overlapStart
      ? (scenes[startIdx - 1]?.duration ?? 0)
      : 0;

    chunks.push({
      chunkIndex: c,
      subTimeline: {
        scenes: rebasedScenes,
        audio: EMPTY_AUDIO,
        output: { ...ir.output },
        assets: ir.assets,
      },
      overlapStart,
      overlapDuration,
    });
  }

  return chunks;
}
