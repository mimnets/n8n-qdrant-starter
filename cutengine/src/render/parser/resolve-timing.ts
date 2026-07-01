import type { ShotstackClip } from './types.js';

export interface ResolvedTiming {
  start: number;
  duration: number;
}

/**
 * Resolve Shotstack smart clip timing values.
 *
 * - `start: "auto"` -> previous clip's end time (prevEnd)
 * - `start: number` -> absolute time in seconds
 * - `length: "auto"` -> placeholder duration (0), resolved when asset is downloaded
 * - `length: "end"` -> totalDuration - resolvedStart
 * - `length: number` -> absolute duration in seconds
 */
export function resolveTiming(
  clip: ShotstackClip,
  prevEnd: number,
  totalDuration: number,
): ResolvedTiming {
  // Resolve start
  let start: number;
  if (clip.start === 'auto') {
    start = prevEnd;
  } else {
    start = clip.start as number;
  }

  // Resolve length/duration
  let duration: number;
  if (clip.length === 'auto') {
    // Placeholder — will be resolved when asset metadata is available
    duration = 0;
  } else if (clip.length === 'end') {
    duration = Math.max(0, totalDuration - start);
  } else {
    duration = clip.length as number;
  }

  return { start, duration };
}

/**
 * Calculate the total duration of all clips in a track,
 * used to resolve `length: "end"` values.
 * Only considers clips with explicit numeric start + length.
 */
export function calculateTrackDuration(clips: ShotstackClip[]): number {
  let maxEnd = 0;
  let currentEnd = 0;

  for (const clip of clips) {
    const start = clip.start === 'auto' ? currentEnd : (clip.start as number);
    let length = 0;
    if (typeof clip.length === 'number') {
      length = clip.length;
    }
    const end = start + length;
    if (end > maxEnd) maxEnd = end;
    currentEnd = end;
  }

  return maxEnd;
}
