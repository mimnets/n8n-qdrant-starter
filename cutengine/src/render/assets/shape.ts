// Renders an IRLayer with shape asset (rectangle, circle, line) to HTML + CSS.

import type { IRLayer } from '../parser/types.js';
import type { RenderedElement } from './image.js';

export function renderShape(layer: IRLayer, layerIndex: number): RenderedElement {
  const id = `layer-${layerIndex}`;
  const shapeType = layer.asset.shape ?? 'rectangle';
  const fill = layer.asset.fill ?? layer.asset.background ?? 'transparent';
  const stroke = layer.asset.stroke;

  const strokeCss = stroke
    ? `border: ${stroke.width ?? 1}px solid ${stroke.color ?? '#000000'};`
    : '';

  let shapeCss = '';

  switch (shapeType) {
    case 'circle':
      shapeCss = `
        border-radius: 50%;
        background: ${fill};
        ${strokeCss}`;
      break;

    case 'line':
      shapeCss = `
        background: transparent;
        border-bottom: ${stroke?.width ?? 2}px solid ${stroke?.color ?? fill};
        height: auto !important;
        top: 50%;`;
      break;

    case 'rectangle':
    default:
      shapeCss = `
        background: ${fill};
        ${strokeCss}`;
      break;
  }

  const css = `
  #${id} {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    ${shapeCss}
  }`;

  const html = `<div id="${id}"></div>`;

  return { html, css };
}
