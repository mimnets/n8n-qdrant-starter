// Converts IRTransform to CSS transform declarations.

import type { IRTransform } from '../parser/types.js';

/**
 * Build a CSS `transform` declaration from an IRTransform object.
 * Returns an empty string when there is nothing to transform.
 */
export function buildTransformCSS(transform: IRTransform): string {
  const parts: string[] = [];

  if (transform.rotate?.angle) {
    parts.push(`rotate(${transform.rotate.angle}deg)`);
  }
  if (transform.skew) {
    if (transform.skew.x) parts.push(`skewX(${transform.skew.x}deg)`);
    if (transform.skew.y) parts.push(`skewY(${transform.skew.y}deg)`);
  }
  if (transform.flip) {
    if (transform.flip.horizontal) parts.push('scaleX(-1)');
    if (transform.flip.vertical) parts.push('scaleY(-1)');
  }

  return parts.length ? `transform: ${parts.join(' ')};` : '';
}
