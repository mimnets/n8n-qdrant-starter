// Handles text/caption rendering for the FFmpeg compositor.
// Two tiers: simple text → drawtext filter, HTML captions → pre-render to PNG.

import type { IRLayer } from '../parser/types.js';
import { join, resolve } from 'path';
import { existsSync } from 'fs';

// Common font family → .ttf filename mapping for fonts typically downloaded during prefetch
const FONT_FILE_MAP: Record<string, string> = {
  'Inter': 'Inter-Regular.ttf',
  'Montserrat': 'Montserrat-Bold.ttf',
  'Noto Sans': 'NotoSans-Regular.ttf',
  'Roboto': 'Roboto-Regular.ttf',
  'Open Sans': 'OpenSans-Regular.ttf',
};

/**
 * Check if a text/caption layer can use FFmpeg drawtext (simple text only).
 * HTML assets with styled backgrounds must be pre-rendered to PNG.
 */
export function canUseDrawtext(layer: IRLayer): boolean {
  // HTML assets always need pre-render
  if (layer.asset.type === 'html') return false;
  // Text with background needs pre-render
  if (layer.asset.background) return false;
  // Stroke text is hard to replicate with drawtext — allow simple cases
  return layer.asset.type === 'text' || layer.asset.type === 'caption';
}

/**
 * Generate an FFmpeg drawtext filter string for a simple text layer.
 * The filter is applied as an overlay on the composited video.
 *
 * @param layer - Text/caption layer
 * @param width - Output width
 * @param height - Output height
 * @param prefetchDir - Directory where fonts were downloaded
 * @returns drawtext filter expression with enable timing, or null if font not found
 */
export function buildDrawtextFilter(
  layer: IRLayer,
  width: number,
  height: number,
  prefetchDir: string,
): string | null {
  const text = layer.asset.text ?? '';
  if (!text) return null;

  const fontFamily = layer.asset.font?.family ?? 'Inter';
  const fontSize = layer.asset.font?.size ?? 42;
  const fontColor = layer.asset.font?.color ?? 'white';
  const fontWeight = layer.asset.font?.weight;

  // Resolve font file path
  const fontPath = resolveFontPath(fontFamily, prefetchDir, fontWeight);
  if (!fontPath) return null;

  // Escape text for FFmpeg drawtext
  const escaped = escapeDrawtext(text);

  // Calculate position
  const { x, y } = calculateTextPosition(layer, width, height, fontSize);

  // Timing gate
  const start = layer.timing.start;
  const end = start + layer.timing.duration;
  const enable = `enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'`;

  // Build stroke/border if present
  const strokeParts: string[] = [];
  if (layer.asset.stroke?.width && layer.asset.stroke?.color) {
    strokeParts.push(`borderw=${layer.asset.stroke.width}`);
    strokeParts.push(`bordercolor=${layer.asset.stroke.color}`);
  }

  const parts = [
    `fontfile='${fontPath}'`,
    `text='${escaped}'`,
    `fontsize=${fontSize}`,
    `fontcolor=${fontColor}`,
    `x=${x}`,
    `y=${y}`,
    ...strokeParts,
    enable,
  ];

  return `drawtext=${parts.join(':')}`;
}

function resolveFontPath(family: string, prefetchDir: string, weight?: number): string | null {
  // Check prefetch directory for downloaded font files
  const candidates = [
    // Exact match from map
    FONT_FILE_MAP[family],
    // Weight-specific variants
    weight && weight >= 700 ? `${family.replace(/\s/g, '')}-Bold.ttf` : null,
    weight && weight >= 600 ? `${family.replace(/\s/g, '')}-SemiBold.ttf` : null,
    `${family.replace(/\s/g, '')}-Regular.ttf`,
    `${family.replace(/\s/g, '')}.ttf`,
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const fullPath = join(prefetchDir, candidate);
    if (existsSync(fullPath)) return fullPath;
  }

  // Fallback: check system fonts (macOS)
  const systemPaths = [
    `/System/Library/Fonts/${family.replace(/\s/g, '')}.ttc`,
    `/Library/Fonts/${family.replace(/\s/g, '')}.ttf`,
  ];
  for (const p of systemPaths) {
    if (existsSync(p)) return p;
  }

  return null;
}

function escapeDrawtext(text: string): string {
  // FFmpeg drawtext requires escaping: ' → \\', : → \\:, \ → \\\\
  return text
    .replace(/\\/g, '\\\\\\\\')
    .replace(/'/g, "\\\\\\'")
    .replace(/:/g, '\\\\:')
    .replace(/%/g, '%%')
    .replace(/\n/g, '\\n');
}

function calculateTextPosition(
  layer: IRLayer,
  width: number,
  height: number,
  fontSize: number,
): { x: string; y: string } {
  const hAlign = layer.asset.alignment?.horizontal ?? 'center';
  const vAlign = layer.asset.alignment?.vertical ?? 'bottom';

  let x: string;
  switch (hAlign) {
    case 'left':   x = '20'; break;
    case 'right':  x = `(w-tw-20)`; break;
    case 'center':
    default:       x = '(w-tw)/2'; break;
  }

  let y: string;
  switch (vAlign) {
    case 'top':    y = '20'; break;
    case 'center': y = '(h-th)/2'; break;
    case 'bottom':
    default:       y = `(h-th-${Math.round(height * 0.1)})`; break;
  }

  // Apply position offsets
  if (layer.position.offsetX) {
    x = `${x}+${Math.round(layer.position.offsetX * width)}`;
  }
  if (layer.position.offsetY) {
    y = `${y}+${Math.round(layer.position.offsetY * height)}`;
  }

  return { x, y };
}
