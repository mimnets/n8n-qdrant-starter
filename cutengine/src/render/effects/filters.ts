// Maps Shotstack filter names to CSS filter values.

const FILTER_MAP: Record<string, string> = {
  blur:      'filter: blur(5px)',
  boost:     'filter: contrast(1.2) saturate(1.3)',
  contrast:  'filter: contrast(1.5)',
  darken:    'filter: brightness(0.7)',
  greyscale: 'filter: grayscale(1)',
  lighten:   'filter: brightness(1.3)',
  muted:     'filter: saturate(0.5) contrast(0.9)',
  negative:  'filter: invert(1)',
  none:      '',
};

/**
 * Returns CSS filter string for the given Shotstack filter name.
 * Returns empty string for unknown or "none" filters.
 */
export function buildFilter(filter: string): string {
  return FILTER_MAP[filter] ?? '';
}
