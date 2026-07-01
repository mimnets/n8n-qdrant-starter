// Scene Builder: converts IR scene into full HTML/CSS page for Puppeteer capture.
// Uses JavaScript-based frame rendering instead of CSS animations.

import type { IRScene, IRLayer, IROutput } from '../parser/types.js';
import { wrapInHtml } from './html-template.js';
import { renderImage } from '../assets/image.js';
import { renderText } from '../assets/text.js';
import { renderVideo } from '../assets/video.js';
import { renderRichText } from '../assets/richtext.js';
import { renderHtml } from '../assets/html.js';
import { renderShape } from '../assets/shape.js';
import { renderSvg } from '../assets/svg.js';
import { renderTitle } from '../assets/title.js';
import { renderLuma } from '../assets/luma.js';
import { buildFilter } from '../effects/filters.js';
import { getTransitionDuration } from '../effects/transitions.js';

/**
 * Layer timing data embedded in the HTML for the updateFrame script.
 */
export interface LayerTiming {
  id: string;
  start: number;
  duration: number;
  effect: string | null;
  filter: string | null;
  transitionIn: string | null;
  transitionInDuration: number;
  transitionOut: string | null;
  transitionOutDuration: number;
}

/**
 * Render a single layer to HTML + CSS based on its asset type.
 */
function renderLayer(layer: IRLayer, index: number): { html: string; css: string } {
  switch (layer.asset.type) {
    case 'image':
      return renderImage(layer, index);
    case 'video':
      return renderVideo(layer, index);
    case 'text':
    case 'caption':
      return renderText(layer, index);
    case 'title':
      return renderTitle(layer, index);
    case 'richtext':
      return renderRichText(layer, index);
    case 'html':
      return renderHtml(layer, index);
    case 'shape':
      return renderShape(layer, index);
    case 'svg':
      return renderSvg(layer, index);
    case 'luma':
      return renderLuma(layer, index);
    default:
      // For unsupported types, return an empty placeholder
      return {
        html: `<div id="layer-${index}" class="unsupported"></div>`,
        css: `#layer-${index} { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }`,
      };
  }
}

/**
 * Calculate the total timeline duration from all layers.
 * This is the maximum (start + duration) across all visual layers.
 */
export function calcTimelineDuration(layers: IRLayer[]): number {
  let max = 0;
  for (const layer of layers) {
    if (layer.type !== 'visual') continue;
    const end = layer.timing.start + layer.timing.duration;
    if (end > max) max = end;
  }
  return max;
}

/**
 * Build the updateFrame JavaScript function that will be embedded in the HTML.
 * This function is called via page.evaluate() for each frame to:
 * - Show/hide layers based on timing
 * - Apply KenBurns transforms
 * - Apply transition fade in/out
 */
function buildUpdateFrameScript(layerTimings: LayerTiming[]): string {
  return `
<script>
window.layerTimings = ${JSON.stringify(layerTimings)};

window.updateFrame = function(time) {
  var timings = window.layerTimings;
  for (var i = 0; i < timings.length; i++) {
    var lt = timings[i];
    var el = document.getElementById(lt.id);
    if (!el) continue;

    var visible = time >= lt.start && time < lt.start + lt.duration;

    // Crossfade: extend visibility by transitionIn duration BEFORE the layer starts
    // so the incoming layer overlaps with the outgoing layer
    var earlyStart = lt.transitionIn ? lt.transitionInDuration : 0;
    var visibleStart = lt.start - earlyStart;
    var visibleEnd = lt.start + lt.duration;
    var visible = time >= visibleStart && time < visibleEnd;

    if (!visible) {
      el.style.opacity = '0';
      el.style.transform = el.dataset.baseTransform || '';
      continue;
    }

    // Start with full opacity
    var opacity = 1;

    // Transition in: fade from 0 to 1 (includes early overlap period)
    if (lt.transitionIn && lt.transitionInDuration > 0) {
      var transTime = time - visibleStart;
      if (transTime < lt.transitionInDuration) {
        var p = transTime / lt.transitionInDuration;
        opacity = Math.min(opacity, p);
      }
    }

    // Transition out: fade from 1 to 0 at the end of the layer
    if (lt.transitionOut && lt.transitionOutDuration > 0) {
      var timeLeft = visibleEnd - time;
      if (timeLeft < lt.transitionOutDuration) {
        var p = timeLeft / lt.transitionOutDuration;
        opacity = Math.min(opacity, p);
      }
    }

    el.style.opacity = String(Math.max(0, Math.min(1, opacity)));

    // KenBurns transform
    if (lt.effect) {
      var localTime = time - lt.start;
      var effectDuration = lt.duration;
      // Map effect to speed duration
      var base = lt.effect;
      if (base.endsWith('Fast')) { base = base.slice(0, -4); }
      else if (base.endsWith('Slow')) { base = base.slice(0, -4); }
      // Use full layer duration for constant slow movement

      var progress = Math.min(1, Math.max(0, localTime / effectDuration));
      // Linear interpolation for constant speed throughout

      var transform = '';
      // Zoom: gentle 10% range (was 30%), Slide: pre-scale 1.15x + move 5% (was 10%)
      switch (base) {
        case 'zoomIn':
          transform = 'scale(' + (1.02 + 0.1 * progress) + ')'; break;
        case 'zoomOut':
          transform = 'scale(' + (1.12 - 0.1 * progress) + ')'; break;
        case 'slideLeft':
          transform = 'scale(1.25) translateX(' + (-3 * progress) + '%)'; break;
        case 'slideRight':
          transform = 'scale(1.25) translateX(' + (3 * progress) + '%)'; break;
        case 'slideUp':
          transform = 'scale(1.25) translateY(' + (-3 * progress) + '%)'; break;
        case 'slideDown':
          transform = 'scale(1.25) translateY(' + (3 * progress) + '%)'; break;
      }

      // Prepend any base transform from the element
      var baseT = el.dataset.baseTransform || '';
      el.style.transform = baseT + (baseT && transform ? ' ' : '') + transform;
    } else {
      el.style.transform = el.dataset.baseTransform || '';
    }
  }
};
</script>`;
}

/**
 * Build the complete HTML page for a single scene.
 *
 * Architecture: JavaScript-based frame rendering.
 * All layers are rendered statically with opacity: 0.
 * A global updateFrame(time) function is called per-frame via page.evaluate()
 * to show/hide layers, apply KenBurns transforms, and handle transitions.
 *
 * Layers are rendered with z-index so that the first layer in the array
 * appears on top (highest z-index), matching Shotstack's track ordering.
 */
export function buildScene(scene: IRScene, output: IROutput, totalDuration?: number): string {
  const allCss: string[] = [];
  const allHtml: string[] = [];
  const layerTimings: LayerTiming[] = [];

  const totalLayers = scene.layers.length;

  for (let i = 0; i < totalLayers; i++) {
    const layer = scene.layers[i];
    if (layer.type !== 'visual') continue;

    const { html, css } = renderLayer(layer, i);

    // z-index so stacking order is correct
    const zIndex = totalLayers - i;
    let layerCss = css;
    layerCss += `\n  #layer-${i} { z-index: ${zIndex}; opacity: 0; }`;

    // Apply filter effect (static CSS, not animated)
    if (layer.effects.filter) {
      const filterVal = buildFilter(layer.effects.filter);
      if (filterVal) {
        layerCss += `\n  #layer-${i} { ${filterVal}; }`;
      }
    }

    // Apply crop (static CSS)
    if (layer.crop) {
      const { top, bottom, left, right } = layer.crop;
      layerCss += `\n  #layer-${i} { clip-path: inset(${top * 100}% ${right * 100}% ${bottom * 100}% ${left * 100}%); }`;
    }

    allCss.push(layerCss);
    allHtml.push(html);

    // Build layer timing data for the updateFrame script
    const transInDur = layer.timing.transitionIn
      ? getTransitionDuration(layer.timing.transitionIn)
      : 0;
    const transOutDur = layer.timing.transitionOut
      ? getTransitionDuration(layer.timing.transitionOut)
      : 0;

    layerTimings.push({
      id: `layer-${i}`,
      start: layer.timing.start,
      duration: layer.timing.duration,
      effect: layer.effects.motion ?? null,
      filter: layer.effects.filter ?? null,
      transitionIn: layer.timing.transitionIn ?? null,
      transitionInDuration: transInDur,
      transitionOut: layer.timing.transitionOut ?? null,
      transitionOutDuration: transOutDur,
    });
  }

  const script = buildUpdateFrameScript(layerTimings);

  return wrapInHtml(allHtml.join('\n') + script, allCss.join('\n'), output.width, output.height);
}
