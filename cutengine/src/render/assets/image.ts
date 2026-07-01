// Renders an IRLayer with image asset to HTML <img> tag + CSS.

import type { IRLayer } from '../parser/types.js';

export interface RenderedElement {
  html: string;
  css: string;
}

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

export function renderImage(layer: IRLayer, layerIndex: number): RenderedElement {
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

  const transformStr = transforms.length > 0 ? transforms.join(' ') : '';

  const css = `
  #${id} {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    object-fit: ${objectFit};
    ${transformStr ? `transform: ${transformStr};` : ''}
  }`;

  // Store base transform in data attribute so KenBurns JS can prepend it
  const html = `<img id="${id}" src="${src}" ${transformStr ? `data-base-transform="${transformStr}"` : ''} />`;

  return { html, css };
}
