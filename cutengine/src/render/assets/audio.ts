// Audio asset handlers: extract audio clip metadata for the FFmpeg encoder.
// AudioAsset layers don't produce visual HTML — they produce audio mixing
// instructions consumed by the encoder pipeline.

import type { IRLayer, IRAudioClip } from '../parser/types.js';

/**
 * Extract an IRAudioClip from an audio-type layer.
 * Returns null if the layer is not an audio layer or has no src.
 */
export function extractAudioClip(layer: IRLayer): IRAudioClip | null {
  if (layer.type !== 'audio' && layer.asset.type !== 'audio') return null;

  const asset = layer.asset;
  if (!asset.src) return null;

  return {
    src: asset.src,
    start: layer.timing.start,
    duration: layer.timing.duration,
    volume: asset.volume ?? 1,
    volumeEffect: asset.volumeEffect,
    speed: asset.speed,
  };
}

/**
 * Extract audio from a video layer (when volume > 0).
 * Video layers with audible volume need their audio track
 * mixed in by the FFmpeg encoder.
 * Returns null if not a video layer or volume is 0/undefined.
 */
export function extractVideoAudio(layer: IRLayer): IRAudioClip | null {
  if (layer.asset.type !== 'video') return null;
  if (layer.asset.volume === 0 || layer.asset.volume === undefined) return null;

  return {
    src: layer.asset.src!,
    start: layer.timing.start,
    duration: layer.timing.duration,
    volume: layer.asset.volume,
    volumeEffect: layer.asset.volumeEffect,
    speed: layer.asset.speed,
  };
}
