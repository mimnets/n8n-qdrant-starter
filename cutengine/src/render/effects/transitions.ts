// Maps Shotstack transitions to CSS keyframe animations.

export interface TransitionResult {
  className: string;
  keyframes: string;
  duration: number;
}

interface TransitionDef {
  from: Record<string, string>;
  to: Record<string, string>;
}

// Base transition definitions
const TRANSITION_DEFS: Record<string, TransitionDef> = {
  fade: {
    from: { opacity: '0' },
    to: { opacity: '1' },
  },
  reveal: {
    from: { 'clip-path': 'inset(0 100% 0 0)' },
    to: { 'clip-path': 'inset(0 0 0 0)' },
  },
  slideLeft: {
    from: { transform: 'translateX(100%)' },
    to: { transform: 'translateX(0)' },
  },
  slideRight: {
    from: { transform: 'translateX(-100%)' },
    to: { transform: 'translateX(0)' },
  },
  slideUp: {
    from: { transform: 'translateY(100%)' },
    to: { transform: 'translateY(0)' },
  },
  slideDown: {
    from: { transform: 'translateY(-100%)' },
    to: { transform: 'translateY(0)' },
  },
  wipeLeft: {
    from: { 'clip-path': 'inset(0 0 0 100%)' },
    to: { 'clip-path': 'inset(0 0 0 0)' },
  },
  wipeRight: {
    from: { 'clip-path': 'inset(0 100% 0 0)' },
    to: { 'clip-path': 'inset(0 0 0 0)' },
  },
  wipeUp: {
    from: { 'clip-path': 'inset(100% 0 0 0)' },
    to: { 'clip-path': 'inset(0 0 0 0)' },
  },
  wipeDown: {
    from: { 'clip-path': 'inset(0 0 100% 0)' },
    to: { 'clip-path': 'inset(0 0 0 0)' },
  },
  zoom: {
    from: { transform: 'scale(0)' },
    to: { transform: 'scale(1)' },
  },
  carouselLeft: {
    from: { transform: 'translateX(100%)', opacity: '0' },
    to: { transform: 'translateX(0)', opacity: '1' },
  },
  carouselRight: {
    from: { transform: 'translateX(-100%)', opacity: '0' },
    to: { transform: 'translateX(0)', opacity: '1' },
  },
  carouselUp: {
    from: { transform: 'translateY(100%)', opacity: '0' },
    to: { transform: 'translateY(0)', opacity: '1' },
  },
  carouselDown: {
    from: { transform: 'translateY(-100%)', opacity: '0' },
    to: { transform: 'translateY(0)', opacity: '1' },
  },
  shuffleLeft: {
    from: { transform: 'translateX(100%) rotate(5deg)', opacity: '0' },
    to: { transform: 'translateX(0) rotate(0deg)', opacity: '1' },
  },
  shuffleRight: {
    from: { transform: 'translateX(-100%) rotate(-5deg)', opacity: '0' },
    to: { transform: 'translateX(0) rotate(0deg)', opacity: '1' },
  },
};

const DURATION_NORMAL = 0.3;
const DURATION_FAST = 0.15;
const DURATION_SLOW = 0.6;

function propsToString(props: Record<string, string>): string {
  return Object.entries(props).map(([k, v]) => `${k}: ${v};`).join(' ');
}

/**
 * Parse transition name to extract base name, speed, and direction.
 * E.g. "fadeSlow" -> { base: "fade", duration: 2 }
 *      "slideLeftFast" -> { base: "slideLeft", duration: 0.5 }
 */
function parseTransition(name: string): { base: string; duration: number } | null {
  if (name.endsWith('Fast')) {
    const base = name.slice(0, -4);
    if (TRANSITION_DEFS[base]) return { base, duration: DURATION_FAST };
  }
  if (name.endsWith('Slow')) {
    const base = name.slice(0, -4);
    if (TRANSITION_DEFS[base]) return { base, duration: DURATION_SLOW };
  }
  if (TRANSITION_DEFS[name]) {
    return { base: name, duration: DURATION_NORMAL };
  }
  return null;
}

/**
 * Build a transition-in animation (element appears).
 */
export function buildTransitionIn(name: string): TransitionResult | null {
  const parsed = parseTransition(name);
  if (!parsed) return null;

  const def = TRANSITION_DEFS[parsed.base];
  const className = `trans-in-${name}`;
  const keyframes = `@keyframes ${className} {
  from { ${propsToString(def.from)} }
  to { ${propsToString(def.to)} }
}
.${className} {
  animation: ${className} ${parsed.duration}s ease-in-out forwards;
}`;

  return { className, keyframes, duration: parsed.duration };
}

/**
 * Build a transition-out animation (element disappears).
 * Reverses the from/to of the base transition.
 */
export function buildTransitionOut(name: string): TransitionResult | null {
  const parsed = parseTransition(name);
  if (!parsed) return null;

  const def = TRANSITION_DEFS[parsed.base];
  const className = `trans-out-${name}`;
  // Reverse: go from "to" state to "from" state
  const keyframes = `@keyframes ${className} {
  from { ${propsToString(def.to)} }
  to { ${propsToString(def.from)} }
}
.${className} {
  animation: ${className} ${parsed.duration}s ease-in-out forwards;
}`;

  return { className, keyframes, duration: parsed.duration };
}

/**
 * Get the inline CSS styles for a transition-in at a specific time.
 * @param name - Transition name (e.g., "fade", "fadeSlow")
 * @param time - Time relative to layer start
 * @returns CSS inline styles string or empty string
 */
export function getTransitionInStyleAtTime(name: string, time: number): string {
  const parsed = parseTransition(name);
  if (!parsed) return '';
  const def = TRANSITION_DEFS[parsed.base];

  if (time >= parsed.duration) {
    // Transition complete — use 'to' state
    return propsToString(def.to);
  }
  if (time <= 0) {
    return propsToString(def.from);
  }

  const progress = easeInOut(time / parsed.duration);
  return interpolateProps(def.from, def.to, progress);
}

/**
 * Get the inline CSS styles for a transition-out at a specific time.
 * @param name - Transition name (e.g., "fade", "fadeSlow")
 * @param time - Time relative to the start of the out-transition
 *               (i.e., 0 = transition starts, duration = transition ends)
 * @returns CSS inline styles string or empty string
 */
export function getTransitionOutStyleAtTime(name: string, time: number): string {
  const parsed = parseTransition(name);
  if (!parsed) return '';
  const def = TRANSITION_DEFS[parsed.base];

  if (time <= 0) {
    // Before transition starts — show normal (to) state
    return propsToString(def.to);
  }
  if (time >= parsed.duration) {
    // Transition complete — use 'from' (hidden) state
    return propsToString(def.from);
  }

  const progress = easeInOut(time / parsed.duration);
  // Out = reverse: interpolate from 'to' (visible) to 'from' (hidden)
  return interpolateProps(def.to, def.from, progress);
}

/**
 * Get the duration of a parsed transition by name.
 */
export function getTransitionDuration(name: string): number {
  const parsed = parseTransition(name);
  return parsed ? parsed.duration : 0;
}

function easeInOut(t: number): number {
  return t < 0.5
    ? 2 * t * t
    : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function interpolateProps(
  from: Record<string, string>,
  to: Record<string, string>,
  progress: number,
): string {
  const result: string[] = [];
  for (const key of Object.keys(from)) {
    const fromVal = from[key];
    const toVal = to[key];
    if (fromVal === undefined || toVal === undefined) continue;
    result.push(`${key}: ${interpolateValue(fromVal, toVal, progress)};`);
  }
  return result.join(' ');
}

function interpolateValue(from: string, to: string, t: number): string {
  // Try to interpolate numeric values
  const fromNum = parseFloat(from);
  const toNum = parseFloat(to);
  if (!isNaN(fromNum) && !isNaN(toNum)) {
    return String(fromNum + (toNum - fromNum) * t);
  }

  // Handle transform functions like translateX(100%)
  const fromMatch = from.match(/^([a-zA-Z]+)\((.+)\)$/);
  const toMatch = to.match(/^([a-zA-Z]+)\((.+)\)$/);
  if (fromMatch && toMatch && fromMatch[1] === toMatch[1]) {
    const fn = fromMatch[1];
    const fromInner = parseFloat(fromMatch[2]);
    const toInner = parseFloat(toMatch[2]);
    if (!isNaN(fromInner) && !isNaN(toInner)) {
      const unit = fromMatch[2].replace(/[-.0-9]+/, '') || '';
      const val = fromInner + (toInner - fromInner) * t;
      return `${fn}(${val}${unit})`;
    }
  }

  // Handle compound transforms like "translateX(100%) rotate(5deg)"
  // Fall back to discrete switch
  return t < 0.5 ? from : to;
}

/**
 * Handle clip-path inset interpolation: "inset(a b c d)" values.
 */
function interpolateClipPath(from: string, to: string, t: number): string {
  const fromMatch = from.match(/inset\(([^)]+)\)/);
  const toMatch = to.match(/inset\(([^)]+)\)/);
  if (!fromMatch || !toMatch) return t < 0.5 ? from : to;

  const fromVals = fromMatch[1].split(/\s+/).map(v => parseFloat(v));
  const toVals = toMatch[1].split(/\s+/).map(v => parseFloat(v));
  if (fromVals.length !== toVals.length) return t < 0.5 ? from : to;

  const vals = fromVals.map((fv, i) => {
    const tv = toVals[i];
    return `${fv + (tv - fv) * t}%`;
  });
  return `inset(${vals.join(' ')})`;
}
