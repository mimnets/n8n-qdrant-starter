// Decides whether an IRTimeline can be rendered via the FFmpeg compositor
// or must fall back to the Puppeteer frame-capture path.

import type { IRTimeline, IRLayer } from '../parser/types.js';
import { mapTransition } from './filters_ffmpeg.js';

const SUPPORTED_ASSET_TYPES = new Set([
  'image', 'video', 'text', 'caption', 'html', 'audio', 'svg',
]);

export interface RouteDecision {
  eligible: boolean;
  reason?: string;
}

/**
 * Check if the entire timeline can be rendered via FFmpeg compositor.
 * Returns eligible=false with a reason if any layer requires Puppeteer.
 */
export function canUseFFmpegCompositor(
  ir: IRTimeline,
  forceMode?: 'ffmpeg' | 'puppeteer' | 'auto',
): RouteDecision {
  if (forceMode === 'puppeteer') {
    return { eligible: false, reason: 'forced puppeteer mode' };
  }
  if (forceMode === 'ffmpeg') {
    return { eligible: true };
  }

  // Only MP4 output supported by compositor (GIF/image uses different encoder path)
  if (ir.output.format !== 'mp4') {
    return { eligible: false, reason: `unsupported output format: ${ir.output.format}` };
  }

  for (const scene of ir.scenes) {
    for (const layer of scene.layers) {
      if (layer.type !== 'visual') continue;

      const check = checkLayer(layer);
      if (!check.eligible) return check;
    }
  }

  return { eligible: true };
}

function checkLayer(layer: IRLayer): RouteDecision {
  // Asset type check
  if (!SUPPORTED_ASSET_TYPES.has(layer.asset.type)) {
    return { eligible: false, reason: `unsupported asset type: ${layer.asset.type}` };
  }

  // Tween opacity arrays require per-frame JS interpolation
  if (Array.isArray(layer.effects.opacity)) {
    return { eligible: false, reason: 'tween opacity not supported in compositor' };
  }

  // Tween arrays require per-frame JS interpolation
  if (layer.effects.tween && layer.effects.tween.length > 0) {
    return { eligible: false, reason: 'tween effects not supported in compositor' };
  }

  // Skew transform has no FFmpeg equivalent
  if (layer.effects.transform?.skew) {
    return { eligible: false, reason: 'skew transform not supported in compositor' };
  }

  // Check transitions can be mapped to xfade
  for (const transName of [layer.timing.transitionIn, layer.timing.transitionOut]) {
    if (!transName) continue;
    if (mapTransition(transName) === null) {
      return { eligible: false, reason: `unsupported transition: ${transName}` };
    }
  }

  return { eligible: true };
}
