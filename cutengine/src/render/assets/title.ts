// Renders an IRLayer with title asset to styled HTML <div> + CSS.

import type { IRLayer } from '../parser/types.js';
import type { RenderedElement } from './image.js';

export function renderTitle(layer: IRLayer, layerIndex: number): RenderedElement {
  const id = `layer-${layerIndex}`;
  const text = layer.asset.text ?? '';
  const style = layer.asset.style ?? 'default';
  const background = layer.asset.background;
  const font = layer.asset.font ?? {};

  const fontFamily = font.family ?? 'sans-serif';
  const fontSize = font.size ?? 48;
  const fontColor = font.color ?? '#ffffff';
  const fontWeight = font.weight ?? 700;

  const backgroundCss = background ? `background: ${background};` : '';

  // Simple fade-in animation for titles
  const animationName = `title-fade-${layerIndex}`;

  const css = `
  @keyframes ${animationName} {
    0% { opacity: 0; transform: translateY(20px); }
    100% { opacity: 1; transform: translateY(0); }
  }
  #${id} {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: '${fontFamily}', sans-serif;
    font-size: ${fontSize}px;
    color: ${fontColor};
    font-weight: ${fontWeight};
    text-align: center;
    ${backgroundCss}
    animation: ${animationName} 0.5s ease-out forwards;
    padding: 0 5%;
  }`;

  const html = `<div id="${id}">${text}</div>`;

  return { html, css };
}
