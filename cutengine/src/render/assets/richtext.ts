// Renders an IRLayer with rich text asset to HTML <div> + CSS.

import type { IRLayer } from '../parser/types.js';
import type { RenderedElement } from './image.js';

export function renderRichText(layer: IRLayer, layerIndex: number): RenderedElement {
  const id = `layer-${layerIndex}`;
  const htmlContent = layer.asset.html ?? '';
  const assetCss = layer.asset.css ?? '';
  const font = layer.asset.font ?? {};
  const background = layer.asset.background;

  const fontFamily = font.family ? `font-family: '${font.family}', sans-serif;` : '';
  const fontSize = font.size ? `font-size: ${font.size}px;` : '';
  const fontColor = font.color ? `color: ${font.color};` : '';
  const fontWeight = font.weight ? `font-weight: ${font.weight};` : '';
  const backgroundCss = background ? `background: ${background};` : '';

  const css = `
  #${id} {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    ${fontFamily}
    ${fontSize}
    ${fontColor}
    ${fontWeight}
    ${backgroundCss}
  }
  ${assetCss}`;

  const html = `<div id="${id}">${htmlContent}</div>`;

  return { html, css };
}
