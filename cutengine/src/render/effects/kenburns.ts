// Maps Shotstack motion effects to CSS @keyframes animations.

export interface KenBurnsResult {
  className: string;
  keyframes: string;
}

interface MotionDef {
  from: string;
  to: string;
}

const MOTION_MAP: Record<string, MotionDef> = {
  zoomIn:     { from: 'scale(1)',         to: 'scale(1.3)' },
  zoomOut:    { from: 'scale(1.3)',       to: 'scale(1)' },
  // slide effects: scale(1.15) prevents edge exposure during translate
  slideLeft:  { from: 'scale(1.15) translateX(5%)',  to: 'scale(1.15) translateX(-5%)' },
  slideRight: { from: 'scale(1.15) translateX(-5%)', to: 'scale(1.15) translateX(5%)' },
  slideUp:    { from: 'scale(1.15) translateY(5%)',  to: 'scale(1.15) translateY(-5%)' },
  slideDown:  { from: 'scale(1.15) translateY(-5%)', to: 'scale(1.15) translateY(5%)' },
};

const SPEED_NORMAL = 5;
const SPEED_FAST = 3;
const SPEED_SLOW = 8;

/**
 * Parse a motion effect string like "zoomIn", "zoomInFast", "slideLeftSlow"
 * and return the base effect name plus duration.
 */
function parseMotion(effect: string): { base: string; duration: number } | null {
  // Check for speed suffixes
  if (effect.endsWith('Fast')) {
    const base = effect.slice(0, -4);
    if (MOTION_MAP[base]) return { base, duration: SPEED_FAST };
  }
  if (effect.endsWith('Slow')) {
    const base = effect.slice(0, -4);
    if (MOTION_MAP[base]) return { base, duration: SPEED_SLOW };
  }
  if (MOTION_MAP[effect]) {
    return { base: effect, duration: SPEED_NORMAL };
  }
  return null;
}

export function buildKenBurns(effect: string): KenBurnsResult | null {
  const parsed = parseMotion(effect);
  if (!parsed) return null;

  const motion = MOTION_MAP[parsed.base];
  const className = `kb-${effect}`;
  const keyframes = `@keyframes ${className} {
  from { transform: ${motion.from}; }
  to { transform: ${motion.to}; }
}
.${className} {
  animation: ${className} ${parsed.duration}s ease-in-out forwards;
}`;

  return { className, keyframes };
}

/**
 * Get the CSS transform string for a Ken Burns effect at a specific time.
 * Returns the interpolated transform between from and to based on progress.
 * @param effect - The motion effect string (e.g., "zoomIn", "slideLeftFast")
 * @param time - Current time relative to the layer start (0 to layerDuration)
 * @param layerDuration - Total duration of the layer
 */
export function getKenBurnsTransformAtTime(
  effect: string,
  time: number,
  layerDuration: number,
): string {
  const parsed = parseMotion(effect);
  if (!parsed) return '';

  const motion = MOTION_MAP[parsed.base];
  // Clamp progress 0..1 based on motion duration (not layer duration)
  const effectDuration = Math.min(parsed.duration, layerDuration);
  const progress = Math.min(1, Math.max(0, time / effectDuration));

  // Apply ease-in-out approximation: cubic bezier
  const eased = easeInOut(progress);

  return interpolateTransform(motion.from, motion.to, eased);
}

function easeInOut(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function interpolateTransform(from: string, to: string, t: number): string {
  const fromParts = parseAllTransforms(from);
  const toParts = parseAllTransforms(to);

  if (fromParts.length !== toParts.length) return t < 0.5 ? from : to;

  return fromParts.map((fp, i) => {
    const tp = toParts[i];
    if (fp.fn !== tp.fn) return t < 0.5 ? `${fp.fn}(${fp.value}${fp.unit})` : `${tp.fn}(${tp.value}${tp.unit})`;
    const val = fp.value + (tp.value - fp.value) * t;
    return `${fp.fn}(${val}${fp.unit})`;
  }).join(' ');
}

function parseAllTransforms(s: string): Array<{ fn: string; value: number; unit: string }> {
  const results: Array<{ fn: string; value: number; unit: string }> = [];
  const regex = /(\w+)\(([^)]+)\)/g;
  let match;
  while ((match = regex.exec(s)) !== null) {
    const fn = match[1];
    const inner = match[2];
    const numMatch = inner.match(/^([-.0-9]+)(%|px|deg)?$/);
    if (numMatch) {
      results.push({ fn, value: parseFloat(numMatch[1]), unit: numMatch[2] || '' });
    }
  }
  return results;
}
