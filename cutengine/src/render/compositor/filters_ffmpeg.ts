// Maps CutEngine IR effects to FFmpeg filter expressions.

// Ken Burns motion effects → scale+crop+scale chain (NOT zoompan)
//
// HISTORY: zoompan was used in v1~v7 but caused persistent pixelation/shimmer
// because zoompan uses bilinear interpolation (hardcoded, not configurable).
// Even pre-scaling to 8000px didn't fix it — bilinear re-samples every frame.
//
// SOLUTION: Replace zoompan with scale(lanczos) + crop(integer, no interpolation)
// + scale(lanczos). Both scale ops use lanczos, crop uses integer pixel boundaries.
// Reference: SS(Shotstack) and AE(After Effects) don't use zoompan — they use
// their own high-quality renderers, which is why KB looked good in those engines.
//
// Intermediate resolution = 4x output (7680x4320 for 1080p). Provides 0.25px output
// resolution per crop pixel — virtually eliminates integer-boundary jitter on slow zoom.
// Tested: SSIM 0.998+, max frame diff 3-4/255 on worst-case grid patterns.
const KB_INTER_SCALE = 4;
const ZOOM_END = 1.25;  // max zoom factor (25% zoom-in)
const SLIDE_RANGE = 0.1; // 10% movement range for slide effects
const SLIDE_ZOOM = 1.25;  // match Puppeteer scale(1.25) — prevents edge exposure during slide

interface KenBurnsParams {
  base: string;
  durationMultiplier: number;
}

function parseMotionEffect(effect: string): KenBurnsParams | null {
  const bases = ['zoomIn', 'zoomOut', 'slideLeft', 'slideRight', 'slideUp', 'slideDown'];

  if (effect.endsWith('Fast')) {
    const base = effect.slice(0, -4);
    if (bases.includes(base)) return { base, durationMultiplier: 0.6 };
  }
  if (effect.endsWith('Slow')) {
    const base = effect.slice(0, -4);
    if (bases.includes(base)) return { base, durationMultiplier: 1.6 };
  }
  if (bases.includes(effect)) {
    return { base: effect, durationMultiplier: 1.0 };
  }
  return null;
}

/**
 * Generate FFmpeg scale+crop+scale filter chain for Ken Burns effect.
 *
 * Uses crop with frame-number expressions (n) instead of zoompan.
 * crop operates on integer pixel boundaries — no interpolation artifacts.
 * Both scale operations use lanczos for high-quality resampling.
 *
 * @param effect - Motion effect name (e.g., 'zoomIn', 'slideLeftFast')
 * @param clipDuration - Duration of the clip in seconds
 * @param width - Output width (e.g., 1920)
 * @param height - Output height (e.g., 1080)
 * @param fps - Output FPS
 * @returns filter chain string (without input/output labels)
 */
export function mapKenBurns(
  effect: string,
  clipDuration: number,
  width: number,
  height: number,
  fps: number,
): string | null {
  const parsed = parseMotionEffect(effect);
  if (!parsed) return null;

  const d = Math.max(Math.floor(clipDuration * fps), 1);

  // Intermediate resolution: 2x output for crop headroom
  const iw = KB_INTER_SCALE * width;
  const ih = KB_INTER_SCALE * height;

  const prescale = `scale=${iw}:${ih}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${iw}:${ih}:(ow-iw)/2:(oh-ih)/2:color=black`;
  const postscale = `scale=${width}:${height}:flags=lanczos`;

  switch (parsed.base) {
    case 'zoomIn': {
      // Crop shrinks from 100% to 80% of intermediate → simulates 1.0→1.25x zoom
      const shrinkW = Math.round(iw * (1 - 1 / ZOOM_END));
      const shrinkH = Math.round(ih * (1 - 1 / ZOOM_END));
      return [
        prescale,
        `crop=w='max(2,${iw}-trunc(${shrinkW}*n/${d}))':h='max(2,${ih}-trunc(${shrinkH}*n/${d}))':x='(iw-ow)/2':y='(ih-oh)/2'`,
        postscale,
      ].join(',');
    }
    case 'zoomOut': {
      // Crop expands from 80% to 100% → simulates 1.25→1.0x zoom
      const startW = Math.round(iw / ZOOM_END);
      const startH = Math.round(ih / ZOOM_END);
      const growW = iw - startW;
      const growH = ih - startH;
      return [
        prescale,
        `crop=w='max(2,${startW}+trunc(${growW}*n/${d}))':h='max(2,${startH}+trunc(${growH}*n/${d}))':x='(iw-ow)/2':y='(ih-oh)/2'`,
        postscale,
      ].join(',');
    }
    case 'slideLeft': {
      // Fixed crop size (1/1.1 of intermediate), x slides left→right
      const cropW = Math.round(iw / SLIDE_ZOOM);
      const cropH = Math.round(ih / SLIDE_ZOOM);
      const startX = Math.round(iw * 0.05);
      const slidePixels = Math.round(iw * SLIDE_RANGE);
      const maxX = iw - cropW; // clamp to prevent edge overflow
      return [
        prescale,
        `crop=w=${cropW}:h=${cropH}:x='min(${maxX},trunc(${startX}+${slidePixels}*n/${d}))':y='(ih-oh)/2'`,
        postscale,
      ].join(',');
    }
    case 'slideRight': {
      // Fixed crop, x slides right→left
      const cropW = Math.round(iw / SLIDE_ZOOM);
      const cropH = Math.round(ih / SLIDE_ZOOM);
      const startX = Math.round(iw * (0.05 + SLIDE_RANGE));
      const slidePixels = Math.round(iw * SLIDE_RANGE);
      return [
        prescale,
        `crop=w=${cropW}:h=${cropH}:x='max(0,trunc(${startX}-${slidePixels}*n/${d}))':y='(ih-oh)/2'`,
        postscale,
      ].join(',');
    }
    case 'slideUp': {
      // Fixed crop, y slides up
      const cropW = Math.round(iw / SLIDE_ZOOM);
      const cropH = Math.round(ih / SLIDE_ZOOM);
      const startY = Math.round(ih * 0.05);
      const slidePixels = Math.round(ih * SLIDE_RANGE);
      const maxY = ih - cropH;
      return [
        prescale,
        `crop=w=${cropW}:h=${cropH}:x='(iw-ow)/2':y='min(${maxY},trunc(${startY}+${slidePixels}*n/${d}))'`,
        postscale,
      ].join(',');
    }
    case 'slideDown': {
      // Fixed crop, y slides down
      const cropW = Math.round(iw / SLIDE_ZOOM);
      const cropH = Math.round(ih / SLIDE_ZOOM);
      const startY = Math.round(ih * (0.05 + SLIDE_RANGE));
      const slidePixels = Math.round(ih * SLIDE_RANGE);
      return [
        prescale,
        `crop=w=${cropW}:h=${cropH}:x='(iw-ow)/2':y='max(0,trunc(${startY}-${slidePixels}*n/${d}))'`,
        postscale,
      ].join(',');
    }
    default:
      return null;
  }
}

/**
 * Map CutEngine color filter name to FFmpeg filter expression.
 */
export function mapColorFilter(filter: string): string | null {
  switch (filter) {
    case 'boost':     return 'eq=contrast=1.2:saturation=1.3';
    case 'contrast':  return 'eq=contrast=1.5';
    case 'darken':    return 'eq=brightness=-0.3';
    case 'lighten':   return 'eq=brightness=0.3';
    case 'greyscale': return 'hue=s=0';
    case 'muted':     return 'eq=saturation=0.5:contrast=0.9';
    case 'negative':  return 'negate';
    case 'blur':      return 'boxblur=5:5';
    default:          return null;
  }
}

// Shotstack transition → FFmpeg xfade transition name
const TRANSITION_MAP: Record<string, string> = {
  fade:          'fade',
  slideLeft:     'slideleft',
  slideRight:    'slideright',
  slideUp:       'slideup',
  slideDown:     'slidedown',
  wipeLeft:      'wipeleft',
  wipeRight:     'wiperight',
  wipeUp:        'wipeup',
  wipeDown:      'wipedown',
  zoom:          'circleclose',
  reveal:        'wiperight',
  carouselLeft:  'slideleft',
  carouselRight: 'slideright',
  carouselUp:    'slideup',
  carouselDown:  'slidedown',
  // shuffle* has no FFmpeg equivalent — router rejects these
};

/**
 * Map Shotstack transition name to FFmpeg xfade transition type.
 * Returns null if the transition cannot be mapped (triggers Puppeteer fallback).
 */
export function mapTransition(name: string): string | null {
  // Strip speed suffix for lookup
  let base = name;
  if (name.endsWith('Fast')) base = name.slice(0, -4);
  else if (name.endsWith('Slow')) base = name.slice(0, -4);

  return TRANSITION_MAP[base] ?? null;
}

/**
 * Get transition duration in seconds from a transition name.
 * Matches the durations in effects/transitions.ts.
 */
export function getFFmpegTransitionDuration(name: string): number {
  if (name.endsWith('Fast')) return 0.15;
  if (name.endsWith('Slow')) return 0.6;
  return 0.3;
}
