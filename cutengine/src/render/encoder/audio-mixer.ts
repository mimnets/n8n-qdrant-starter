import { IRAudioMix } from '../parser/types.js';

export interface AudioMixResult {
  inputArgs: string[];
  filterComplex: string;
  mapArgs: string[];
}

/**
 * Build FFmpeg audio mixing filter.
 *
 * Strategy: Instead of amix (which normalizes volume unpredictably),
 * we pad each audio clip with silence to fill the entire timeline,
 * then overlay them using amerge + pan downmix.
 *
 * For simplicity and reliability, we use a 2-stage approach:
 * 1. Each clip: apply volume/effects → adelay to position → apad to full duration
 * 2. Mix all padded streams by summing (no normalization)
 */
export function buildAudioMix(audio: IRAudioMix, totalDuration: number): AudioMixResult {
  const inputArgs: string[] = [];
  const filters: string[] = [];
  let inputIdx = 1; // 0 is video
  const paddedStreams: string[] = [];

  // Process audio clips (TTS narration etc.)
  for (const clip of audio.clips) {
    inputArgs.push('-i', clip.src);
    const parts: string[] = [];

    // Volume (skip if 1)
    if (clip.volume !== undefined && clip.volume !== 1) {
      parts.push(`volume=${clip.volume}`);
    }

    // Volume effect (fadeIn/fadeOut)
    if (clip.volumeEffect === 'fadeIn') {
      parts.push(`afade=t=in:d=1`);
    } else if (clip.volumeEffect === 'fadeOut') {
      parts.push(`afade=t=out:st=${Math.max(0, clip.duration - 1)}:d=1`);
    } else if (clip.volumeEffect === 'fadeInFadeOut') {
      parts.push(`afade=t=in:d=1`);
      parts.push(`afade=t=out:st=${Math.max(0, clip.duration - 1)}:d=1`);
    }

    // Speed
    if (clip.speed && clip.speed !== 1) {
      parts.push(`atempo=${clip.speed}`);
    }

    // Delay to position on timeline (milliseconds)
    const delayMs = Math.round(clip.start * 1000);
    if (delayMs > 0) {
      parts.push(`adelay=${delayMs}|${delayMs}`);
    }

    // Pad with silence to full timeline duration so all streams are same length
    parts.push(`apad=whole_dur=${totalDuration}`);

    const chain = parts.join(',');
    const label = `a${inputIdx}`;
    filters.push(`[${inputIdx}:a]${chain}[${label}]`);
    paddedStreams.push(`[${label}]`);
    inputIdx++;
  }

  // Process soundtrack (BGM)
  if (audio.soundtrack) {
    inputArgs.push('-i', audio.soundtrack.src);
    const parts: string[] = [];
    parts.push(`volume=${audio.soundtrack.volume ?? 1}`);

    if (audio.soundtrack.effect === 'fadeIn') {
      parts.push(`afade=t=in:d=2`);
    } else if (audio.soundtrack.effect === 'fadeOut') {
      parts.push(`afade=t=out:st=${Math.max(0, totalDuration - 2)}:d=2`);
    } else if (audio.soundtrack.effect === 'fadeInFadeOut') {
      parts.push(`afade=t=in:d=2`);
      parts.push(`afade=t=out:st=${Math.max(0, totalDuration - 2)}:d=2`);
    }

    // Trim/pad to match total duration
    parts.push(`atrim=0:${totalDuration}`);
    parts.push(`apad=whole_dur=${totalDuration}`);

    const label = `a${inputIdx}`;
    filters.push(`[${inputIdx}:a]${parts.join(',')}[${label}]`);
    paddedStreams.push(`[${label}]`);
    inputIdx++;
  }

  // Mix all padded streams
  const streamCount = paddedStreams.length;
  if (streamCount === 0) {
    return { inputArgs: [], filterComplex: '', mapArgs: [] };
  }

  if (streamCount === 1) {
    // Single stream — no mixing needed, just use it directly
    // Replace last label with [aout]
    const lastFilter = filters[filters.length - 1];
    filters[filters.length - 1] = lastFilter.replace(/\[a\d+\]$/, '[aout]');
  } else {
    // Multiple streams: use amix with normalize=0 and dropout_transition=0
    // All streams are padded to same length, so no volume drift
    const mixInputs = paddedStreams.join('');
    filters.push(`${mixInputs}amix=inputs=${streamCount}:duration=first:dropout_transition=0:normalize=0[aout]`);
  }

  return {
    inputArgs,
    filterComplex: filters.join('; '),
    mapArgs: ['-map', '0:v', '-map', '[aout]'],
  };
}
