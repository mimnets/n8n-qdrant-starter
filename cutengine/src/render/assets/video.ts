// Renders an IRLayer with video asset to HTML <video> tag + CSS.

import type { IRLayer } from '../parser/types.js';
import type { RenderedElement } from './image.js';

/**
 * Map IRPosition.fit to CSS object-fit value.
 * Shotstack uses "crop" to mean cover, "contain" stays contain, etc.
 */
function mapFit(fit: string): string {
  switch (fit) {
    case 'crop':
    case 'cover':
      return 'cover';
    case 'contain':
      return 'contain';
    case 'none':
      return 'none';
    default:
      return 'cover';
  }
}

function buildCropCSS(crop: { top: number; bottom: number; left: number; right: number }): string {
  return `clip-path: inset(${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%);`;
}

export function renderVideo(layer: IRLayer, layerIndex: number): RenderedElement {
  const id = `layer-${layerIndex}`;
  const src = layer.asset.src ?? '';
  const objectFit = mapFit(layer.position.fit);
  const scale = layer.position.scale;
  const offsetX = layer.position.offsetX;
  const offsetY = layer.position.offsetY;

  const transforms: string[] = [];
  if (scale !== 1) transforms.push(`scale(${scale})`);
  if (offsetX !== 0) transforms.push(`translateX(${offsetX * 100}%)`);
  if (offsetY !== 0) transforms.push(`translateY(${offsetY * -100}%)`);

  const transformCss = transforms.length > 0 ? `transform: ${transforms.join(' ')};` : '';
  const cropCss = layer.crop ? buildCropCSS(layer.crop) : '';

  const css = `
  #${id} {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    overflow: hidden;
    ${transformCss}
    ${cropCss}
  }
  #${id} video {
    width: 100%; height: 100%;
    object-fit: ${objectFit};
  }`;

  // Videos are always muted in the HTML output because audio is handled
  // separately by the FFmpeg encoder pipeline.
  const html = `<div id="${id}"><video src="${src}" muted preload="auto"></video></div>`;

  return { html, css };
}
