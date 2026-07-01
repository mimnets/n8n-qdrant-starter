// Speed adjustment utilities for CSS animations and FFmpeg filters.

/**
 * CSS approach: adjust animation-duration so faster playback finishes sooner.
 * The caller multiplies this with the base duration.
 *
 * Returns empty string when speed is 1 (normal) or invalid.
 */
export function buildSpeedCSS(speed: number): string {
  if (!speed || speed === 1) return '';
  return `animation-duration: ${1 / speed}s;`;
}

/**
 * FFmpeg video speed filter using `setpts`.
 *
 * PTS = 1/speed  (2x speed -> 0.5*PTS -> video plays twice as fast)
 */
export function buildSpeedFFmpegFilter(speed: number): string {
  if (!speed || speed === 1) return '';
  const pts = 1 / speed;
  return `setpts=${pts}*PTS`;
}

/**
 * FFmpeg audio speed filter using `atempo`.
 *
 * `atempo` only accepts values in [0.5, 2.0], so speeds outside that
 * range are handled by chaining multiple atempo filters.
 */
export function buildSpeedAudioFilter(speed: number): string {
  if (!speed || speed === 1) return '';

  if (speed >= 0.5 && speed <= 2.0) {
    return `atempo=${speed}`;
  }

  // Chain filters for speeds outside the 0.5-2.0 range
  const filters: string[] = [];
  let remaining = speed;

  while (remaining > 2.0) {
    filters.push('atempo=2.0');
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }
  filters.push(`atempo=${remaining}`);

  return filters.join(',');
}
