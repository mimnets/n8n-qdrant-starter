// Converts Shotstack Tween objects to CSS @keyframes animations.

import type { IRTween } from '../parser/types.js';

export interface TweenResult {
  keyframes: string;
  animationCSS: string;
}

const EASING_MAP: Record<string, string> = {
  linear: 'linear',
  ease: 'ease',
  easeIn: 'ease-in',
  easeOut: 'ease-out',
  easeInOut: 'ease-in-out',
};

/**
 * Map an easing string to a CSS timing function.
 * Falls back to 'ease' for unrecognised values.
 */
function mapEasing(easing?: string): string {
  if (!easing) return 'ease';
  return EASING_MAP[easing] ?? 'ease';
}

/**
 * Map an interpolation string to a CSS timing function.
 * 'bezier' becomes a generic cubic-bezier; 'linear' stays linear.
 * When both interpolation and easing are set, easing takes priority.
 */
function mapInterpolation(interpolation?: string): string | null {
  if (!interpolation) return null;
  if (interpolation === 'linear') return 'linear';
  if (interpolation === 'bezier') return 'cubic-bezier(0.42, 0, 0.58, 1)';
  return null;
}

/**
 * Resolve the CSS timing-function from a tween's interpolation + easing.
 * Easing takes priority; interpolation is used as fallback.
 */
function resolveTimingFunction(tween: IRTween): string {
  if (tween.easing) return mapEasing(tween.easing);
  const interp = mapInterpolation(tween.interpolation);
  if (interp) return interp;
  return 'ease';
}

/**
 * Build CSS keyframes + animation declaration for a set of tweens
 * applied to a single CSS property.
 *
 * @param tweens   Array of tween definitions for one property
 * @param property CSS property: 'opacity' | 'offsetX' | 'offsetY' | 'rotation' | 'skewX' | 'skewY' | 'volume'
 * @param layerId  Unique layer identifier (used in keyframe name)
 * @param clipDuration  Total duration of the clip (seconds) -- needed to
 *                      calculate percentage positions inside the keyframe.
 */
export function buildTween(
  tweens: IRTween[],
  property: string,
  layerId: string,
  clipDuration?: number,
): TweenResult {
  if (!tweens.length) {
    return { keyframes: '', animationCSS: '' };
  }

  const animName = `tween-${layerId}-${property}`;
  const totalDuration = clipDuration ?? computeTotalDuration(tweens);

  // Build keyframe stops from the tweens
  const stops = buildKeyframeStops(tweens, property, totalDuration);

  const keyframes = `@keyframes ${animName} {\n${stops}\n}`;

  // Use the first tween's timing function (simple case).
  // For multi-tween chaining each segment ideally gets its own timing,
  // but CSS only allows one timing-function per animation, so we pick
  // the first and encode per-segment timing inside the keyframes when
  // using the 'animation-timing-function' trick within keyframe blocks.
  const timingFn = resolveTimingFunction(tweens[0]);

  const animationCSS = `animation: ${animName} ${totalDuration}s ${timingFn} forwards;`;

  return { keyframes, animationCSS };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function computeTotalDuration(tweens: IRTween[]): number {
  let max = 0;
  for (const t of tweens) {
    const end = t.start + t.length;
    if (end > max) max = end;
  }
  return max || 1;
}

function cssValueForProperty(property: string, value: number): string {
  switch (property) {
    case 'opacity':
      return `opacity: ${value};`;
    case 'offsetX':
      return `transform: translateX(${value}%);`;
    case 'offsetY':
      return `transform: translateY(${value}%);`;
    case 'rotation':
      return `transform: rotate(${value}deg);`;
    case 'skewX':
      return `transform: skewX(${value}deg);`;
    case 'skewY':
      return `transform: skewY(${value}deg);`;
    case 'volume':
      // volume is not directly a CSS property; store as a custom prop
      return `--volume: ${value};`;
    default:
      return `${property}: ${value};`;
  }
}

function pct(time: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (time / total) * 100));
}

function buildKeyframeStops(tweens: IRTween[], property: string, totalDuration: number): string {
  const sorted = [...tweens].sort((a, b) => a.start - b.start);
  const lines: string[] = [];

  for (const tween of sorted) {
    const fromPct = pct(tween.start, totalDuration);
    const toPct = pct(tween.start + tween.length, totalDuration);

    lines.push(`  ${fromPct.toFixed(1)}% { ${cssValueForProperty(property, tween.from)} }`);
    lines.push(`  ${toPct.toFixed(1)}% { ${cssValueForProperty(property, tween.to)} }`);
  }

  return lines.join('\n');
}
