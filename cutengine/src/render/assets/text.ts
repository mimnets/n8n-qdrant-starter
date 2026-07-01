// Renders an IRLayer with text asset to HTML <div> + CSS.

import type { IRLayer } from '../parser/types.js';
import type { RenderedElement } from './image.js';

/**
 * Map Shotstack vertical position strings to CSS.
 * Uses offset values when provided for precise positioning.
 */
function mapVerticalPosition(position?: string, offsetY?: number): string {
  // Shotstack offset.y: positive = move UP from anchor, negative = move DOWN
  // position: 'center' + offset.y: 0.38 = center moved 38% upward = top ~12%
  // position: 'center' + offset.y: -0.30 = center moved 30% downward = top ~80%
  if (position === 'center' && offsetY !== undefined && offsetY !== 0) {
    // Center is 50%, offset moves up (positive) or down (negative)
    const topPercent = 50 - (offsetY * 100);
    return `top: ${topPercent}%; transform: translateY(-50%);`;
  }
  const offset = offsetY !== undefined ? Math.abs(offsetY) * 100 : undefined;
  switch (position) {
    case 'top':
      return `top: ${offset !== undefined ? offset : 10}%; bottom: auto;`;
    case 'bottom':
      return `bottom: ${offset !== undefined ? offset : 10}%; top: auto;`;
    case 'center':
    default:
      return 'top: 50%; transform: translateY(-50%);';
  }
}

/**
 * Build CSS text-shadow for stroke effect.
 * Uses 8-direction shadow for better stroke quality that matches Shotstack output.
 */
function buildStroke(stroke?: { color?: string; width?: number }): string {
  if (!stroke || !stroke.color || !stroke.width) return '';
  const c = stroke.color;
  const w = stroke.width;
  // 8-direction shadow for more uniform stroke appearance
  return `text-shadow: ${w}px 0 ${c}, -${w}px 0 ${c}, 0 ${w}px ${c}, 0 -${w}px ${c}, ${w}px ${w}px ${c}, -${w}px -${w}px ${c}, ${w}px -${w}px ${c}, -${w}px ${w}px ${c};`;
}

export function renderText(layer: IRLayer, layerIndex: number): RenderedElement {
  const id = `layer-${layerIndex}`;
  const text = layer.asset.text ?? '';
  const font = layer.asset.font ?? {};
  const stroke = layer.asset.stroke;
  const alignment = layer.asset.alignment;

  const fontFamily = font.family ?? 'sans-serif';
  const fontSize = font.size ?? 32;
  const fontColor = font.color ?? '#ffffff';
  const fontWeight = font.weight ?? 400;
  const textAlign = alignment?.horizontal ?? 'center';

  // Determine vertical position: use clip-level position (top/center/bottom) first, then alignment
  const clipPosition = layer.asset.clipPosition as string | undefined;
  const vertPosition = clipPosition ?? alignment?.vertical ?? 'center';
  const offsetY = layer.position.offsetY;
  const verticalPos = mapVerticalPosition(vertPosition, offsetY !== 0 ? offsetY : undefined);
  const strokeCss = buildStroke(stroke);

  // Offsets from position (only horizontal — vertical is handled by mapVerticalPosition)
  const offsetX = layer.position.offsetX;
  const offsetTransform = (offsetX !== 0)
    ? `margin-left: ${offsetX * 100}%;`
    : '';

  const css = `
  #${id} {
    position: absolute;
    left: 0; right: 0;
    ${verticalPos}
    font-family: '${fontFamily}', sans-serif;
    font-size: ${fontSize}px;
    color: ${fontColor};
    font-weight: ${fontWeight};
    text-align: ${textAlign};
    ${strokeCss}
    ${offsetTransform}
    padding: 0 5%;
  }`;

  const html = `<div id="${id}">${text}</div>`;

  return { html, css };
}
