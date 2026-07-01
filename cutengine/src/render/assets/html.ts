// Renders an IRLayer with user-provided HTML/CSS content.

import type { IRLayer } from '../parser/types.js';
import type { RenderedElement } from './image.js';

export function renderHtml(layer: IRLayer, layerIndex: number): RenderedElement {
  const id = `layer-${layerIndex}`;
  const htmlContent = layer.asset.html ?? '';
  const assetCss = layer.asset.css ?? '';
  const width = layer.asset.width;
  const height = layer.asset.height;

  const widthCss = width ? `width: ${width}px;` : 'width: 100%;';
  const heightCss = height ? `height: ${height}px;` : 'height: 100%;';
  const background = layer.asset.background;
  const backgroundCss = background ? `background: ${background};` : '';

  const css = `
  #${id} {
    position: absolute;
    top: 0; left: 0;
    ${widthCss}
    ${heightCss}
    overflow: hidden;
    ${backgroundCss}
  }
  ${assetCss}`;

  const html = `<div id="${id}">${htmlContent}</div>`;

  return { html, css };
}
