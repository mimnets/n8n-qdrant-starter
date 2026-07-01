import { describe, it, expect } from 'vitest';
import { renderRichText } from '../../../src/render/assets/richtext.js';
import { renderHtml } from '../../../src/render/assets/html.js';
import { renderShape } from '../../../src/render/assets/shape.js';
import { renderSvg } from '../../../src/render/assets/svg.js';
import { renderTitle } from '../../../src/render/assets/title.js';
import { renderLuma } from '../../../src/render/assets/luma.js';
import type { IRLayer } from '../../../src/render/parser/types.js';

// ---- Helpers ----

function makeLayer(assetOverrides: Record<string, any> = {}, layerOverrides: Partial<IRLayer> = {}): IRLayer {
  return {
    type: 'visual',
    asset: { type: 'text', ...assetOverrides },
    timing: { start: 0, duration: 5 },
    effects: {},
    position: { fit: 'crop', scale: 1, offsetX: 0, offsetY: 0 },
    ...layerOverrides,
  };
}

// ====================================================================
// RichText Asset Tests
// ====================================================================

describe('renderRichText', () => {
  it('injects HTML content into a div', () => {
    const layer = makeLayer({ type: 'richtext', html: '<p>Hello <b>World</b></p>' });
    const result = renderRichText(layer, 0);

    expect(result.html).toContain('<p>Hello <b>World</b></p>');
    expect(result.html).toContain('id="layer-0"');
  });

  it('applies font styling when present', () => {
    const layer = makeLayer({
      type: 'richtext',
      html: '<p>Styled</p>',
      font: { family: 'Roboto', size: 24, color: '#ff0000', weight: 700 },
    });
    const result = renderRichText(layer, 1);

    expect(result.css).toContain("font-family: 'Roboto'");
    expect(result.css).toContain('font-size: 24px');
    expect(result.css).toContain('color: #ff0000');
    expect(result.css).toContain('font-weight: 700');
  });

  it('applies background when present', () => {
    const layer = makeLayer({
      type: 'richtext',
      html: '<p>BG</p>',
      background: '#333333',
    });
    const result = renderRichText(layer, 2);

    expect(result.css).toContain('background: #333333');
  });
});

// ====================================================================
// HTML Asset Tests
// ====================================================================

describe('renderHtml', () => {
  it('injects user HTML inside a container div', () => {
    const layer = makeLayer({ type: 'html', html: '<span>Custom</span>' });
    const result = renderHtml(layer, 0);

    expect(result.html).toContain('<span>Custom</span>');
    expect(result.html).toContain('id="layer-0"');
  });

  it('injects user CSS alongside container CSS', () => {
    const layer = makeLayer({ type: 'html', html: '<div class="box"></div>', css: '.box { color: red; }' });
    const result = renderHtml(layer, 1);

    expect(result.css).toContain('.box { color: red; }');
    expect(result.css).toContain('#layer-1');
  });

  it('applies explicit width and height when provided', () => {
    const layer = makeLayer({ type: 'html', html: '<p>Sized</p>', width: 400, height: 300 });
    const result = renderHtml(layer, 2);

    expect(result.css).toContain('width: 400px');
    expect(result.css).toContain('height: 300px');
  });
});

// ====================================================================
// Shape Asset Tests
// ====================================================================

describe('renderShape', () => {
  it('renders a rectangle with fill and stroke', () => {
    const layer = makeLayer({
      type: 'shape',
      shape: 'rectangle',
      fill: '#ff0000',
      stroke: { color: '#000000', width: 2 },
    });
    const result = renderShape(layer, 0);

    expect(result.css).toContain('background: #ff0000');
    expect(result.css).toContain('border: 2px solid #000000');
    expect(result.html).toContain('id="layer-0"');
  });

  it('renders a circle with border-radius 50%', () => {
    const layer = makeLayer({
      type: 'shape',
      shape: 'circle',
      fill: '#0000ff',
    });
    const result = renderShape(layer, 1);

    expect(result.css).toContain('border-radius: 50%');
    expect(result.css).toContain('background: #0000ff');
  });

  it('renders a line with border-bottom', () => {
    const layer = makeLayer({
      type: 'shape',
      shape: 'line',
      stroke: { color: '#00ff00', width: 3 },
    });
    const result = renderShape(layer, 2);

    expect(result.css).toContain('border-bottom: 3px solid #00ff00');
  });
});

// ====================================================================
// SVG Asset Tests
// ====================================================================

describe('renderSvg', () => {
  it('renders a rectangle shape as <rect>', () => {
    const layer = makeLayer({
      type: 'svg',
      shapes: [{ type: 'rectangle', x: 10, y: 10, width: 80, height: 60, fill: '#ff0000' }],
    });
    const result = renderSvg(layer, 0);

    expect(result.html).toContain('<rect');
    expect(result.html).toContain('x="10"');
    expect(result.html).toContain('width="80"');
    expect(result.html).toContain('fill="#ff0000"');
  });

  it('renders a circle shape as <circle>', () => {
    const layer = makeLayer({
      type: 'svg',
      shapes: [{ type: 'circle', cx: 50, cy: 50, r: 40, fill: '#00ff00' }],
    });
    const result = renderSvg(layer, 1);

    expect(result.html).toContain('<circle');
    expect(result.html).toContain('cx="50"');
    expect(result.html).toContain('r="40"');
  });

  it('renders multiple shapes in a single SVG', () => {
    const layer = makeLayer({
      type: 'svg',
      shapes: [
        { type: 'rectangle', x: 0, y: 0, width: 50, height: 50, fill: '#ff0000' },
        { type: 'circle', cx: 75, cy: 75, r: 25, fill: '#0000ff' },
      ],
    });
    const result = renderSvg(layer, 2);

    expect(result.html).toContain('<rect');
    expect(result.html).toContain('<circle');
    expect(result.html).toContain('<svg');
  });
});

// ====================================================================
// Title Asset Tests
// ====================================================================

describe('renderTitle', () => {
  it('renders text content in a styled div', () => {
    const layer = makeLayer({ type: 'title', text: 'Hello World' });
    const result = renderTitle(layer, 0);

    expect(result.html).toContain('Hello World');
    expect(result.html).toContain('id="layer-0"');
  });

  it('applies font styling', () => {
    const layer = makeLayer({
      type: 'title',
      text: 'Styled Title',
      font: { family: 'Arial', size: 64, color: '#ffcc00', weight: 900 },
    });
    const result = renderTitle(layer, 1);

    expect(result.css).toContain("font-family: 'Arial'");
    expect(result.css).toContain('font-size: 64px');
    expect(result.css).toContain('color: #ffcc00');
    expect(result.css).toContain('font-weight: 900');
  });

  it('includes CSS animation for the title', () => {
    const layer = makeLayer({ type: 'title', text: 'Animated' });
    const result = renderTitle(layer, 3);

    expect(result.css).toContain('@keyframes title-fade-3');
    expect(result.css).toContain('animation:');
  });
});

// ====================================================================
// Luma Asset Tests
// ====================================================================

describe('renderLuma', () => {
  it('applies mask-image CSS with correct src', () => {
    const layer = makeLayer({ type: 'luma', src: 'https://example.com/matte.mp4' });
    const result = renderLuma(layer, 0);

    expect(result.css).toContain("mask-image: url('https://example.com/matte.mp4')");
    expect(result.html).toContain('id="layer-0"');
  });

  it('includes webkit prefix for mask-image', () => {
    const layer = makeLayer({ type: 'luma', src: 'https://example.com/matte.png' });
    const result = renderLuma(layer, 1);

    expect(result.css).toContain('-webkit-mask-image');
    expect(result.css).toContain('mask-image');
  });

  it('sets mask-size to cover', () => {
    const layer = makeLayer({ type: 'luma', src: 'https://example.com/matte.mp4' });
    const result = renderLuma(layer, 2);

    expect(result.css).toContain('mask-size: cover');
  });
});
