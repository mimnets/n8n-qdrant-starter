// Renders an IRLayer with luma matte asset to HTML <div> + CSS mask.
// Luma matte: white areas are visible, black areas are transparent.

import type { IRLayer } from '../parser/types.js';
import type { RenderedElement } from './image.js';

export function renderLuma(layer: IRLayer, layerIndex: number): RenderedElement {
  const id = `layer-${layerIndex}`;
  const src = layer.asset.src ?? '';

  const css = `
  #${id} {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    -webkit-mask-image: url('${src}');
    mask-image: url('${src}');
    -webkit-mask-size: cover;
    mask-size: cover;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
  }`;

  const html = `<div id="${id}"></div>`;

  return { html, css };
}
