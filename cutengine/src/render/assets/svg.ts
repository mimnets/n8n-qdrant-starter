// Renders an IRLayer with SVG shapes to inline <svg> + CSS.

import type { IRLayer } from '../parser/types.js';
import type { RenderedElement } from './image.js';

interface SvgShape {
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  cx?: number;
  cy?: number;
  r?: number;
  rx?: number;
  ry?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  points?: string;
  d?: string;
  fill?: string;
  stroke?: { color?: string; width?: number };
  transform?: string;
  [key: string]: any;
}

function buildFill(fill: string | undefined): string {
  return fill ? `fill="${fill}"` : 'fill="none"';
}

function buildStroke(stroke: { color?: string; width?: number } | undefined): string {
  if (!stroke) return '';
  const parts: string[] = [];
  if (stroke.color) parts.push(`stroke="${stroke.color}"`);
  if (stroke.width) parts.push(`stroke-width="${stroke.width}"`);
  return parts.join(' ');
}

function buildTransform(transform: string | undefined): string {
  return transform ? `transform="${transform}"` : '';
}

function renderSvgShape(shape: SvgShape): string {
  const fill = buildFill(shape.fill);
  const stroke = buildStroke(shape.stroke);
  const transform = buildTransform(shape.transform);
  const attrs = [fill, stroke, transform].filter(Boolean).join(' ');

  switch (shape.type) {
    case 'rectangle':
      return `<rect x="${shape.x ?? 0}" y="${shape.y ?? 0}" width="${shape.width ?? 100}" height="${shape.height ?? 100}" ${attrs} />`;

    case 'circle':
      return `<circle cx="${shape.cx ?? 50}" cy="${shape.cy ?? 50}" r="${shape.r ?? 50}" ${attrs} />`;

    case 'ellipse':
      return `<ellipse cx="${shape.cx ?? 50}" cy="${shape.cy ?? 50}" rx="${shape.rx ?? 50}" ry="${shape.ry ?? 30}" ${attrs} />`;

    case 'line':
      return `<line x1="${shape.x1 ?? 0}" y1="${shape.y1 ?? 0}" x2="${shape.x2 ?? 100}" y2="${shape.y2 ?? 100}" ${stroke || 'stroke="#000"'} ${transform} />`;

    case 'star': {
      const cx = shape.cx ?? 50;
      const cy = shape.cy ?? 50;
      const outerR = shape.r ?? 50;
      const innerR = outerR * 0.4;
      const spikes = shape.points ? parseInt(shape.points, 10) : 5;
      const pts: string[] = [];
      for (let i = 0; i < spikes * 2; i++) {
        const radius = i % 2 === 0 ? outerR : innerR;
        const angle = (Math.PI * i) / spikes - Math.PI / 2;
        pts.push(`${cx + radius * Math.cos(angle)},${cy + radius * Math.sin(angle)}`);
      }
      return `<polygon points="${pts.join(' ')}" ${attrs} />`;
    }

    case 'polygon':
      return `<polygon points="${shape.points ?? ''}" ${attrs} />`;

    case 'path':
    case 'custom':
      return `<path d="${shape.d ?? ''}" ${attrs} />`;

    // Stubs for remaining types
    case 'arrow':
    case 'heart':
    case 'cross':
    case 'ring':
      return `<!-- ${shape.type} shape: not yet implemented -->`;

    default:
      return `<!-- unknown shape: ${shape.type} -->`;
  }
}

export function renderSvg(layer: IRLayer, layerIndex: number): RenderedElement {
  const id = `layer-${layerIndex}`;
  const shapes: SvgShape[] = layer.asset.shapes ?? [];

  const svgContent = shapes.map(renderSvgShape).join('\n    ');

  const css = `
  #${id} {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
  }
  #${id} svg {
    width: 100%; height: 100%;
  }`;

  const html = `<div id="${id}"><svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    ${svgContent}
  </svg></div>`;

  return { html, css };
}
