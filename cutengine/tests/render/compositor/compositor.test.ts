import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { canUseFFmpegCompositor } from '../../../src/render/compositor/router.js';
import { buildInputs, buildOverlayInputs } from '../../../src/render/compositor/input_builder.js';
import { buildFilterGraph, buildHtmlOverlayChain } from '../../../src/render/compositor/filter_graph.js';
import { mapKenBurns, mapColorFilter, mapTransition, getFFmpegTransitionDuration } from '../../../src/render/compositor/filters_ffmpeg.js';
import { collectHtmlLayers, wrapInHtmlTransparent } from '../../../src/render/compositor/pre_renderer.js';
import { extractFontFamilies, extractWoff2Url } from '../../../src/render/compositor/font_resolver.js';
import { collectSvgLayers } from '../../../src/render/compositor/svg_renderer.js';
import { PreRenderCache } from '../../../src/render/compositor/cache_manager.js';
import { splitTimeline } from '../../../src/render/compositor/chunk_splitter.js';
import type { IRTimeline, IRScene, IRLayer } from '../../../src/render/parser/types.js';
import type { PreRenderResult } from '../../../src/render/compositor/pre_renderer.js';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ---- Helpers ----

function makeLayer(overrides: Partial<IRLayer> = {}): IRLayer {
  return {
    type: 'visual',
    asset: { type: 'image', src: '/tmp/test.jpg' },
    timing: { start: 0, duration: 5 },
    effects: {},
    position: { fit: 'cover', scale: 1, offsetX: 0, offsetY: 0 },
    ...overrides,
  };
}

function makeTimeline(layers: IRLayer[], format = 'mp4'): IRTimeline {
  const totalDuration = layers.reduce((max, l) => Math.max(max, l.timing.start + l.timing.duration), 0);
  return {
    scenes: [{
      startTime: 0,
      duration: totalDuration,
      layers,
    }],
    audio: { clips: [] },
    output: { width: 1920, height: 1080, fps: 25, format, quality: 'high' },
    assets: [],
  };
}

// ---- Router tests ----

describe('canUseFFmpegCompositor', () => {
  it('accepts timeline with image clips', () => {
    const ir = makeTimeline([makeLayer()]);
    expect(canUseFFmpegCompositor(ir).eligible).toBe(true);
  });

  it('accepts timeline with video clips', () => {
    const ir = makeTimeline([
      makeLayer({ asset: { type: 'video', src: '/tmp/test.mp4' } }),
    ]);
    expect(canUseFFmpegCompositor(ir).eligible).toBe(true);
  });

  it('accepts SVG asset (Phase C)', () => {
    const ir = makeTimeline([
      makeLayer({ asset: { type: 'svg', src: '/tmp/test.svg' } }),
    ]);
    const result = canUseFFmpegCompositor(ir);
    expect(result.eligible).toBe(true);
  });

  it('rejects luma asset', () => {
    const ir = makeTimeline([
      makeLayer({ asset: { type: 'luma', src: '/tmp/luma.mp4' } }),
    ]);
    expect(canUseFFmpegCompositor(ir).eligible).toBe(false);
  });

  it('rejects tween opacity arrays', () => {
    const ir = makeTimeline([
      makeLayer({ effects: { opacity: [{ from: 0, to: 1, start: 0, length: 1 }] } }),
    ]);
    expect(canUseFFmpegCompositor(ir).eligible).toBe(false);
  });

  it('rejects shuffle transitions', () => {
    const ir = makeTimeline([
      makeLayer({ timing: { start: 0, duration: 5, transitionIn: 'shuffleLeft' } }),
    ]);
    expect(canUseFFmpegCompositor(ir).eligible).toBe(false);
  });

  it('accepts fade transitions', () => {
    const ir = makeTimeline([
      makeLayer({ timing: { start: 0, duration: 5, transitionIn: 'fade' } }),
    ]);
    expect(canUseFFmpegCompositor(ir).eligible).toBe(true);
  });

  it('rejects GIF output format', () => {
    const ir = makeTimeline([makeLayer()], 'gif');
    expect(canUseFFmpegCompositor(ir).eligible).toBe(false);
  });

  it('respects force puppeteer mode', () => {
    const ir = makeTimeline([makeLayer()]);
    expect(canUseFFmpegCompositor(ir, 'puppeteer').eligible).toBe(false);
  });

  it('respects force ffmpeg mode', () => {
    const ir = makeTimeline([
      makeLayer({ asset: { type: 'svg', src: '/tmp/test.svg' } }),
    ]);
    expect(canUseFFmpegCompositor(ir, 'ffmpeg').eligible).toBe(true);
  });
});

// ---- Filter mapping tests ----

describe('filters_ffmpeg', () => {
  describe('mapKenBurns', () => {
    it('generates scale+crop+scale for zoomIn (no zoompan)', () => {
      const result = mapKenBurns('zoomIn', 5, 1920, 1080, 25);
      expect(result).toBeTruthy();
      expect(result).toContain('crop=');
      expect(result).toContain('flags=lanczos');
      expect(result).toContain('scale=1920:1080');
      expect(result).not.toContain('zoompan');
    });

    it('generates scale+crop+scale for zoomOut', () => {
      const result = mapKenBurns('zoomOut', 5, 1920, 1080, 25);
      expect(result).toContain('crop=');
      expect(result).toContain('flags=lanczos');
      expect(result).not.toContain('zoompan');
    });

    it('generates scale+crop+scale for slideLeft with clamp', () => {
      const result = mapKenBurns('slideLeft', 5, 1920, 1080, 25);
      expect(result).toContain('crop=');
      expect(result).toContain('min(');  // edge clamp
      expect(result).not.toContain('zoompan');
    });

    it('returns null for unknown effect', () => {
      expect(mapKenBurns('unknownEffect', 5, 1920, 1080, 25)).toBeNull();
    });

    it('handles speed suffixes', () => {
      const fast = mapKenBurns('zoomInFast', 3, 1920, 1080, 25);
      const slow = mapKenBurns('zoomInSlow', 8, 1920, 1080, 25);
      expect(fast).toBeTruthy();
      expect(slow).toBeTruthy();
    });
  });

  describe('mapColorFilter', () => {
    it('maps boost to eq', () => {
      expect(mapColorFilter('boost')).toBe('eq=contrast=1.2:saturation=1.3');
    });

    it('maps greyscale to hue', () => {
      expect(mapColorFilter('greyscale')).toBe('hue=s=0');
    });

    it('maps darken to eq brightness', () => {
      expect(mapColorFilter('darken')).toBe('eq=brightness=-0.3');
    });

    it('returns null for unknown filter', () => {
      expect(mapColorFilter('nonexistent')).toBeNull();
    });
  });

  describe('mapTransition', () => {
    it('maps fade', () => {
      expect(mapTransition('fade')).toBe('fade');
    });

    it('maps slideLeft', () => {
      expect(mapTransition('slideLeft')).toBe('slideleft');
    });

    it('maps wipeRight', () => {
      expect(mapTransition('wipeRight')).toBe('wiperight');
    });

    it('returns null for shuffleLeft', () => {
      expect(mapTransition('shuffleLeft')).toBeNull();
    });

    it('strips speed suffix', () => {
      expect(mapTransition('fadeFast')).toBe('fade');
      expect(mapTransition('slideLeftSlow')).toBe('slideleft');
    });
  });

  describe('getFFmpegTransitionDuration', () => {
    it('returns 0.3 for normal speed', () => {
      expect(getFFmpegTransitionDuration('fade')).toBe(0.3);
    });

    it('returns 0.15 for fast', () => {
      expect(getFFmpegTransitionDuration('fadeFast')).toBe(0.15);
    });

    it('returns 0.6 for slow', () => {
      expect(getFFmpegTransitionDuration('fadeSlow')).toBe(0.6);
    });
  });
});

// ---- Input builder tests ----

describe('buildInputs', () => {
  it('builds inputs for image clips with loop flag', () => {
    const ir = makeTimeline([
      makeLayer({ asset: { type: 'image', src: '/tmp/img1.jpg' }, timing: { start: 0, duration: 5 } }),
      makeLayer({ asset: { type: 'image', src: '/tmp/img2.jpg' }, timing: { start: 5, duration: 5 } }),
    ]);
    const result = buildInputs(ir, 10);
    expect(result.count).toBe(2);
    expect(result.indexMap.get('/tmp/img1.jpg')).toBe(0);
    expect(result.indexMap.get('/tmp/img2.jpg')).toBe(1);
    // Check loop flags are present
    expect(result.args).toContain('-loop');
    expect(result.args).toContain('1');
  });

  it('deduplicates same source used in multiple clips', () => {
    const ir = makeTimeline([
      makeLayer({ asset: { type: 'image', src: '/tmp/same.jpg' }, timing: { start: 0, duration: 5 } }),
      makeLayer({ asset: { type: 'image', src: '/tmp/same.jpg' }, timing: { start: 5, duration: 5 } }),
    ]);
    const result = buildInputs(ir, 10);
    expect(result.count).toBe(1);
  });

  it('handles video inputs without loop', () => {
    const ir = makeTimeline([
      makeLayer({ asset: { type: 'video', src: '/tmp/clip.mp4' }, timing: { start: 0, duration: 5 } }),
    ]);
    const result = buildInputs(ir, 5);
    expect(result.count).toBe(1);
    // Video inputs should not have -loop flag
    const loopIdx = result.args.indexOf('-loop');
    expect(loopIdx).toBe(-1);
  });
});

// ---- Filter graph tests ----

describe('buildFilterGraph', () => {
  it('generates filter_complex for single image clip with ken burns', () => {
    const ir = makeTimeline([
      makeLayer({
        asset: { type: 'image', src: '/tmp/img.jpg' },
        timing: { start: 0, duration: 10 },
        effects: { motion: 'zoomIn' },
      }),
    ]);
    const indexMap = new Map([[ '/tmp/img.jpg', 0 ]]);
    const result = buildFilterGraph(ir, indexMap, '/tmp/prefetch');

    expect(result.filterComplex).toContain('crop=');
    expect(result.videoOutputLabel).toBeTruthy();
  });

  it('generates xfade for sequential clips with transition', () => {
    const ir = makeTimeline([
      makeLayer({
        asset: { type: 'image', src: '/tmp/a.jpg' },
        timing: { start: 0, duration: 5, transitionOut: 'fade' },
      }),
      makeLayer({
        asset: { type: 'image', src: '/tmp/b.jpg' },
        timing: { start: 5, duration: 5, transitionIn: 'fade' },
      }),
    ]);
    const indexMap = new Map([[ '/tmp/a.jpg', 0 ], [ '/tmp/b.jpg', 1 ]]);
    const result = buildFilterGraph(ir, indexMap, '/tmp/prefetch');

    expect(result.filterComplex).toContain('xfade');
    expect(result.filterComplex).toContain('transition=fade');
  });

  it('generates color filter chain', () => {
    const ir = makeTimeline([
      makeLayer({
        asset: { type: 'image', src: '/tmp/img.jpg' },
        timing: { start: 0, duration: 5 },
        effects: { filter: 'boost' },
      }),
    ]);
    const indexMap = new Map([[ '/tmp/img.jpg', 0 ]]);
    const result = buildFilterGraph(ir, indexMap, '/tmp/prefetch');

    expect(result.filterComplex).toContain('eq=contrast=1.2:saturation=1.3');
  });

  it('handles empty timeline gracefully', () => {
    const ir = makeTimeline([]);
    const result = buildFilterGraph(ir, new Map(), '/tmp/prefetch');

    expect(result.filterComplex).toContain('color=c=black');
    expect(result.videoOutputLabel).toBeTruthy();
  });

  it('generates overlay for overlapping clips', () => {
    const ir = makeTimeline([
      makeLayer({
        asset: { type: 'image', src: '/tmp/bg.jpg' },
        timing: { start: 0, duration: 10 },
      }),
      makeLayer({
        asset: { type: 'image', src: '/tmp/fg.jpg' },
        timing: { start: 2, duration: 5 },
      }),
    ]);
    const indexMap = new Map([[ '/tmp/bg.jpg', 0 ], [ '/tmp/fg.jpg', 1 ]]);
    const result = buildFilterGraph(ir, indexMap, '/tmp/prefetch');

    expect(result.filterComplex).toContain('overlay');
    expect(result.filterComplex).toContain('between');
  });

  it('passes through without changes when no pre-rendered PNGs provided', () => {
    const ir = makeTimeline([
      makeLayer({ asset: { type: 'image', src: '/tmp/img.jpg' }, timing: { start: 0, duration: 5 } }),
    ]);
    const indexMap = new Map([[ '/tmp/img.jpg', 0 ]]);
    const withoutPhaseB = buildFilterGraph(ir, indexMap, '/tmp/prefetch');
    const withPhaseB = buildFilterGraph(ir, indexMap, '/tmp/prefetch', [], new Map());
    // Same output when no HTML overlays
    expect(withPhaseB.filterComplex).toBe(withoutPhaseB.filterComplex);
  });

  it('adds HTML overlay chain for pre-rendered PNGs', () => {
    const ir = makeTimeline([
      makeLayer({ asset: { type: 'image', src: '/tmp/img.jpg' }, timing: { start: 0, duration: 10 } }),
    ]);
    const indexMap = new Map([[ '/tmp/img.jpg', 0 ]]);
    const preRendered: PreRenderResult[] = [
      { pngPath: '/tmp/pre_render/caption_0_0.png', sceneIndex: 0, layerIndex: 1, timing: { start: 0, duration: 2.5 } },
      { pngPath: '/tmp/pre_render/caption_0_1.png', sceneIndex: 0, layerIndex: 2, timing: { start: 2.5, duration: 3.0 } },
    ];
    const overlayMap = new Map([
      ['/tmp/pre_render/caption_0_0.png', 1],
      ['/tmp/pre_render/caption_0_1.png', 2],
    ]);
    const result = buildFilterGraph(ir, indexMap, '/tmp/prefetch', preRendered, overlayMap);

    // Should contain overlay=0:0 filters with timing
    expect(result.filterComplex).toContain('overlay=0:0');
    expect(result.filterComplex).toContain("enable='between(t,0.000,2.500)'");
    expect(result.filterComplex).toContain("enable='between(t,2.500,5.500)'");
    // Two overlay steps chained
    expect(result.filterComplex).toContain('[1:v]');
    expect(result.filterComplex).toContain('[2:v]');
  });
});

// ---- Phase B: buildOverlayInputs tests ----

describe('buildOverlayInputs', () => {
  it('builds looped PNG inputs with correct duration', () => {
    const result = buildOverlayInputs(
      ['/tmp/c0.png', '/tmp/c1.png'],
      3,
      30,
    );
    expect(result.args).toContain('-loop');
    expect(result.args).toContain('31'); // totalDuration + 1
    expect(result.indexMap.get('/tmp/c0.png')).toBe(3);
    expect(result.indexMap.get('/tmp/c1.png')).toBe(4);
  });

  it('returns empty for empty input', () => {
    const result = buildOverlayInputs([], 0, 10);
    expect(result.args).toHaveLength(0);
    expect(result.indexMap.size).toBe(0);
  });
});

// ---- Phase B: buildHtmlOverlayChain tests ----

describe('buildHtmlOverlayChain', () => {
  it('chains overlays sequentially with timing gates', () => {
    const preRendered: PreRenderResult[] = [
      { pngPath: '/tmp/c0.png', sceneIndex: 0, layerIndex: 0, timing: { start: 0, duration: 3 } },
      { pngPath: '/tmp/c1.png', sceneIndex: 1, layerIndex: 0, timing: { start: 3, duration: 4 } },
    ];
    const overlayMap = new Map([
      ['/tmp/c0.png', 1],
      ['/tmp/c1.png', 2],
    ]);
    const chains: string[] = [];
    let counter = 0;
    const nextLabel = (prefix: string) => `${prefix}${counter++}`;

    const finalLabel = buildHtmlOverlayChain(preRendered, overlayMap, 'vbase', chains, nextLabel);

    expect(chains).toHaveLength(2);
    // First overlay on base
    expect(chains[0]).toContain('[vbase][1:v]overlay=0:0');
    expect(chains[0]).toContain("enable='between(t,0.000,3.000)'");
    // Second overlay on first result
    expect(chains[1]).toContain('[2:v]overlay=0:0');
    expect(chains[1]).toContain("enable='between(t,3.000,7.000)'");
    // Final label is the second overlay output
    expect(finalLabel).toBe('ho1');
  });

  it('returns base label when no pre-rendered PNGs', () => {
    const chains: string[] = [];
    let counter = 0;
    const nextLabel = (prefix: string) => `${prefix}${counter++}`;

    const result = buildHtmlOverlayChain([], new Map(), 'vbase', chains, nextLabel);
    expect(result).toBe('vbase');
    expect(chains).toHaveLength(0);
  });

  it('sorts overlays by start time', () => {
    const preRendered: PreRenderResult[] = [
      { pngPath: '/tmp/late.png', sceneIndex: 1, layerIndex: 0, timing: { start: 5, duration: 2 } },
      { pngPath: '/tmp/early.png', sceneIndex: 0, layerIndex: 0, timing: { start: 1, duration: 3 } },
    ];
    const overlayMap = new Map([
      ['/tmp/late.png', 2],
      ['/tmp/early.png', 1],
    ]);
    const chains: string[] = [];
    let counter = 0;
    const nextLabel = (prefix: string) => `${prefix}${counter++}`;

    buildHtmlOverlayChain(preRendered, overlayMap, 'v0', chains, nextLabel);

    // Early caption should be overlaid first
    expect(chains[0]).toContain("enable='between(t,1.000,4.000)'");
    expect(chains[1]).toContain("enable='between(t,5.000,7.000)'");
  });
});

// ---- Phase B: collectHtmlLayers tests ----

describe('collectHtmlLayers', () => {
  it('extracts HTML layers with correct timing', () => {
    const ir: IRTimeline = {
      scenes: [{
        startTime: 0,
        duration: 10,
        layers: [
          makeLayer({ asset: { type: 'image', src: '/tmp/bg.jpg' }, timing: { start: 0, duration: 10 } }),
          makeLayer({
            asset: { type: 'html', html: '<div>caption</div>', css: '', width: 1080, height: 1920 },
            timing: { start: 2, duration: 3 },
          }),
        ],
      }],
      audio: { clips: [] },
      output: { width: 1080, height: 1920, fps: 30, format: 'mp4', quality: 'high' },
      assets: [],
    };
    const layers = collectHtmlLayers(ir);
    expect(layers).toHaveLength(1);
    expect(layers[0].html).toBe('<div>caption</div>');
    expect(layers[0].sceneIndex).toBe(0);
    expect(layers[0].layerIndex).toBe(1);
    expect(layers[0].timing.start).toBe(2);
    expect(layers[0].timing.duration).toBe(3);
    expect(layers[0].width).toBe(1080);
    expect(layers[0].height).toBe(1920);
  });

  it('returns empty for timeline with no HTML layers', () => {
    const ir = makeTimeline([
      makeLayer({ asset: { type: 'image', src: '/tmp/bg.jpg' }, timing: { start: 0, duration: 5 } }),
    ]);
    expect(collectHtmlLayers(ir)).toHaveLength(0);
  });

  it('handles multiple HTML layers per scene', () => {
    const ir: IRTimeline = {
      scenes: [{
        startTime: 0,
        duration: 10,
        layers: [
          makeLayer({ asset: { type: 'html', html: '<div>sub1</div>' }, timing: { start: 0, duration: 3 } }),
          makeLayer({ asset: { type: 'html', html: '<div>sub2</div>' }, timing: { start: 3, duration: 4 } }),
          makeLayer({ asset: { type: 'html', html: '<div>sub3</div>' }, timing: { start: 7, duration: 3 } }),
        ],
      }],
      audio: { clips: [] },
      output: { width: 1920, height: 1080, fps: 30, format: 'mp4', quality: 'high' },
      assets: [],
    };
    const layers = collectHtmlLayers(ir);
    expect(layers).toHaveLength(3);
    expect(layers[0].timing.start).toBe(0);
    expect(layers[1].timing.start).toBe(3);
    expect(layers[2].timing.start).toBe(7);
  });

  it('collects from multiple scenes', () => {
    const ir: IRTimeline = {
      scenes: [
        {
          startTime: 0,
          duration: 5,
          layers: [
            makeLayer({ asset: { type: 'html', html: '<div>scene0</div>' }, timing: { start: 0, duration: 5 } }),
          ],
        },
        {
          startTime: 5,
          duration: 5,
          layers: [
            makeLayer({ asset: { type: 'html', html: '<div>scene1</div>' }, timing: { start: 5, duration: 5 } }),
          ],
        },
      ],
      audio: { clips: [] },
      output: { width: 1920, height: 1080, fps: 30, format: 'mp4', quality: 'high' },
      assets: [],
    };
    const layers = collectHtmlLayers(ir);
    expect(layers).toHaveLength(2);
    expect(layers[0].sceneIndex).toBe(0);
    expect(layers[0].timing.start).toBe(0);
    expect(layers[1].sceneIndex).toBe(1);
    expect(layers[1].timing.start).toBe(5);
  });

  it('skips HTML layers with empty html content', () => {
    const ir: IRTimeline = {
      scenes: [{
        startTime: 0,
        duration: 5,
        layers: [
          makeLayer({ asset: { type: 'html', html: '' }, timing: { start: 0, duration: 5 } }),
          makeLayer({ asset: { type: 'html', html: '<div>valid</div>' }, timing: { start: 0, duration: 5 } }),
        ],
      }],
      audio: { clips: [] },
      output: { width: 1920, height: 1080, fps: 30, format: 'mp4', quality: 'high' },
      assets: [],
    };
    const layers = collectHtmlLayers(ir);
    expect(layers).toHaveLength(1);
    expect(layers[0].html).toBe('<div>valid</div>');
  });

  it('uses output dimensions as default when asset has no width/height', () => {
    const ir: IRTimeline = {
      scenes: [{
        startTime: 0,
        duration: 5,
        layers: [
          makeLayer({ asset: { type: 'html', html: '<div>test</div>' }, timing: { start: 0, duration: 5 } }),
        ],
      }],
      audio: { clips: [] },
      output: { width: 1080, height: 1920, fps: 30, format: 'mp4', quality: 'high' },
      assets: [],
    };
    const layers = collectHtmlLayers(ir);
    expect(layers[0].width).toBe(1080);
    expect(layers[0].height).toBe(1920);
  });
});

// ---- Phase B: wrapInHtmlTransparent tests ----

describe('wrapInHtmlTransparent', () => {
  it('sets transparent body background', () => {
    const html = wrapInHtmlTransparent('<div>test</div>', '', 1080, 1920, '');
    expect(html).toContain('background: transparent');
    expect(html).not.toContain('background: #000');
  });

  it('injects font-face CSS', () => {
    const fontCss = "@font-face { font-family: 'Inter'; src: url('file:///tmp/Inter.woff2'); }";
    const html = wrapInHtmlTransparent('<div>test</div>', '', 1080, 1920, fontCss);
    expect(html).toContain(fontCss);
  });

  it('sets correct viewport dimensions', () => {
    const html = wrapInHtmlTransparent('<div>test</div>', '', 1080, 1920, '');
    expect(html).toContain('width: 1080px');
    expect(html).toContain('height: 1920px');
  });

  it('includes Google Fonts CDN link as fallback', () => {
    const html = wrapInHtmlTransparent('<div>test</div>', '', 1080, 1920, '');
    expect(html).toContain('fonts.googleapis.com');
    expect(html).toContain('Montserrat');
  });

  it('includes user CSS', () => {
    const html = wrapInHtmlTransparent('<div>test</div>', '.custom { color: red; }', 1080, 1920, '');
    expect(html).toContain('.custom { color: red; }');
  });
});

// ---- Phase B: font_resolver tests ----

describe('extractFontFamilies', () => {
  it('parses font-family from inline styles', () => {
    const layers = [{
      sceneIndex: 0, layerIndex: 0, css: '', width: 1080, height: 1920,
      timing: { start: 0, duration: 5 },
      html: '<div style="font-family:Montserrat,sans-serif">text</div>',
    }];
    const families = extractFontFamilies(layers);
    expect(families).toContain('Montserrat');
  });

  it('handles multiple font families', () => {
    const layers = [
      {
        sceneIndex: 0, layerIndex: 0, css: '', width: 1080, height: 1920,
        timing: { start: 0, duration: 5 },
        html: '<div style="font-family:Montserrat,sans-serif">a</div>',
      },
      {
        sceneIndex: 0, layerIndex: 1, css: '', width: 1080, height: 1920,
        timing: { start: 0, duration: 5 },
        html: '<div style="font-family:Inter,sans-serif">b</div>',
      },
    ];
    const families = extractFontFamilies(layers);
    expect(families).toContain('Montserrat');
    expect(families).toContain('Inter');
  });

  it('defaults to Montserrat when no font-family found', () => {
    const layers = [{
      sceneIndex: 0, layerIndex: 0, css: '', width: 1080, height: 1920,
      timing: { start: 0, duration: 5 },
      html: '<div>text without font-family</div>',
    }];
    const families = extractFontFamilies(layers);
    expect(families).toEqual(['Montserrat']);
  });

  it('strips quotes from font family names', () => {
    const layers = [{
      sceneIndex: 0, layerIndex: 0, css: '', width: 1080, height: 1920,
      timing: { start: 0, duration: 5 },
      html: `<div style="font-family:'Open Sans',sans-serif">text</div>`,
    }];
    const families = extractFontFamilies(layers);
    expect(families).toContain('Open Sans');
  });
});

describe('extractWoff2Url', () => {
  it('extracts woff2 URL from Google Fonts CSS', () => {
    const css = `@font-face { font-family: 'Montserrat'; src: url(https://fonts.gstatic.com/s/montserrat/v26/abc.woff2) format('woff2'); }`;
    const url = extractWoff2Url(css);
    expect(url).toBe('https://fonts.gstatic.com/s/montserrat/v26/abc.woff2');
  });

  it('returns null for CSS without woff2', () => {
    const css = `@font-face { font-family: 'Test'; src: url(test.ttf) format('truetype'); }`;
    expect(extractWoff2Url(css)).toBeNull();
  });
});

// ==== Phase C: SVG Renderer ====

function makeMultiSceneTimeline(sceneCount: number, sceneDuration = 5): IRTimeline {
  const scenes: IRScene[] = [];
  for (let i = 0; i < sceneCount; i++) {
    scenes.push({
      startTime: i * sceneDuration,
      duration: sceneDuration,
      layers: [makeLayer({
        asset: { type: 'image', src: `/tmp/img_${i}.jpg` },
        timing: { start: i * sceneDuration, duration: sceneDuration },
      })],
    });
  }
  return {
    scenes,
    audio: { clips: [{ src: '/tmp/narration.mp3', start: 0, duration: sceneCount * sceneDuration, volume: 1 }] },
    output: { width: 1920, height: 1080, fps: 25, format: 'mp4', quality: 'high' },
    assets: [],
  };
}

describe('collectSvgLayers (Phase C)', () => {
  it('collects SVG layers from timeline', () => {
    const ir = makeTimeline([
      makeLayer({ asset: { type: 'svg', src: '/tmp/icon.svg' } }),
      makeLayer({ asset: { type: 'image', src: '/tmp/bg.jpg' }, timing: { start: 5, duration: 5 } }),
    ]);
    const svgLayers = collectSvgLayers(ir);
    expect(svgLayers).toHaveLength(1);
    expect(svgLayers[0].src).toBe('/tmp/icon.svg');
    expect(svgLayers[0].sceneIndex).toBe(0);
  });

  it('returns empty for non-SVG timeline', () => {
    const ir = makeTimeline([makeLayer()]);
    expect(collectSvgLayers(ir)).toHaveLength(0);
  });

  it('collects programmatic SVG with shapes', () => {
    const ir = makeTimeline([
      makeLayer({ asset: { type: 'svg', shapes: [{ type: 'circle', cx: 50, cy: 50, r: 30 }] } }),
    ]);
    const svgLayers = collectSvgLayers(ir);
    expect(svgLayers).toHaveLength(1);
    expect(svgLayers[0].shapes).toHaveLength(1);
    expect(svgLayers[0].src).toBeUndefined();
  });

  it('extracts correct timing from SVG layers', () => {
    const ir: IRTimeline = {
      scenes: [
        {
          startTime: 0,
          duration: 5,
          layers: [makeLayer({ asset: { type: 'image', src: '/tmp/bg.jpg' } })],
        },
        {
          startTime: 5,
          duration: 3,
          layers: [makeLayer({
            asset: { type: 'svg', src: '/tmp/overlay.svg' },
            timing: { start: 5, duration: 3 },
          })],
        },
      ],
      audio: { clips: [] },
      output: { width: 1920, height: 1080, fps: 25, format: 'mp4', quality: 'high' },
      assets: [],
    };
    const svgLayers = collectSvgLayers(ir);
    expect(svgLayers).toHaveLength(1);
    expect(svgLayers[0].timing.start).toBe(5);
    expect(svgLayers[0].timing.duration).toBe(3);
  });
});

describe('filter_graph SVG skip (Phase C)', () => {
  it('excludes SVG layers from mediaLayers', () => {
    const svgLayer = makeLayer({ asset: { type: 'svg', src: '/tmp/icon.svg' } });
    const imgLayer = makeLayer({ asset: { type: 'image', src: '/tmp/bg.jpg' } });
    const ir = makeTimeline([svgLayer, imgLayer]);
    const indexMap = new Map<string, number>();
    indexMap.set('/tmp/bg.jpg', 0);
    const result = buildFilterGraph(ir, indexMap, '/tmp/prefetch');
    // Should have filter_complex for the image only, SVG is skipped
    expect(result.filterComplex).toBeTruthy();
    expect(result.filterComplex).not.toContain('icon.svg');
  });
});

// ==== Phase C: Cache Manager ====

describe('PreRenderCache (Phase C)', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `cutengine_cache_test_${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  it('generates deterministic cache keys', () => {
    const cache = new PreRenderCache(testDir);
    const key1 = cache.computeKey('<div>hello</div>', 1920, 1080);
    const key2 = cache.computeKey('<div>hello</div>', 1920, 1080);
    expect(key1).toBe(key2);
    expect(key1).toHaveLength(64); // SHA256 hex
  });

  it('returns null on cache miss', () => {
    const cache = new PreRenderCache(testDir);
    expect(cache.get('nonexistent_key')).toBeNull();
  });

  it('returns cached path on cache hit', () => {
    const cache = new PreRenderCache(testDir);
    // Create a fake PNG
    const fakePng = join(testDir, 'test.png');
    writeFileSync(fakePng, 'fake png data');

    const key = cache.computeKey('test content', 1920, 1080);
    cache.set(key, fakePng);

    const result = cache.get(key);
    expect(result).toBeTruthy();
    expect(existsSync(result!)).toBe(true);
  });

  it('persists and reloads from disk', () => {
    const cache1 = new PreRenderCache(testDir);
    const fakePng = join(testDir, 'persist.png');
    writeFileSync(fakePng, 'fake png data');
    const key = cache1.computeKey('persist test', 1920, 1080);
    cache1.set(key, fakePng);
    cache1.flush();

    // Create a new cache instance from the same directory
    const cache2 = new PreRenderCache(testDir);
    const result = cache2.get(key);
    expect(result).toBeTruthy();
  });

  it('generates different keys for different content', () => {
    const cache = new PreRenderCache(testDir);
    const key1 = cache.computeKey('<div>AAA</div>', 1920, 1080);
    const key2 = cache.computeKey('<div>BBB</div>', 1920, 1080);
    expect(key1).not.toBe(key2);
  });

  it('generates different keys for different dimensions', () => {
    const cache = new PreRenderCache(testDir);
    const key1 = cache.computeKey('<div>same</div>', 1920, 1080);
    const key2 = cache.computeKey('<div>same</div>', 1080, 1920);
    expect(key1).not.toBe(key2);
  });
});

// ==== Phase C: Chunk Splitter ====

describe('splitTimeline (Phase C)', () => {
  it('splits 4 scenes into 2 chunks evenly', () => {
    const ir = makeMultiSceneTimeline(4, 5);
    const chunks = splitTimeline(ir, 2);
    expect(chunks).toHaveLength(2);
    // Each chunk should have at least 2 scenes (+ possible overlap)
    expect(chunks[0].subTimeline.scenes.length).toBeGreaterThanOrEqual(2);
    expect(chunks[1].subTimeline.scenes.length).toBeGreaterThanOrEqual(2);
  });

  it('splits 5 scenes into 2 chunks (uneven)', () => {
    const ir = makeMultiSceneTimeline(5, 5);
    const chunks = splitTimeline(ir, 2);
    expect(chunks).toHaveLength(2);
    const totalScenes = chunks.reduce((s, c) => s + c.subTimeline.scenes.length, 0);
    // Total scenes should be original + overlaps
    expect(totalScenes).toBeGreaterThanOrEqual(5);
  });

  it('returns single chunk for 1 scene', () => {
    const ir = makeMultiSceneTimeline(1, 10);
    const chunks = splitTimeline(ir, 4);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].overlapStart).toBe(false);
  });

  it('reduces worker count when fewer scenes than workers', () => {
    const ir = makeMultiSceneTimeline(2, 5);
    const chunks = splitTimeline(ir, 8);
    expect(chunks.length).toBeLessThanOrEqual(2);
  });

  it('strips audio from all chunks', () => {
    const ir = makeMultiSceneTimeline(4, 5);
    const chunks = splitTimeline(ir, 2);
    for (const chunk of chunks) {
      expect(chunk.subTimeline.audio.clips).toHaveLength(0);
    }
  });

  it('rebases scene timing to start at 0 for each chunk', () => {
    const ir = makeMultiSceneTimeline(4, 5);
    const chunks = splitTimeline(ir, 2);
    for (const chunk of chunks) {
      expect(chunk.subTimeline.scenes[0].startTime).toBe(0);
    }
  });

  it('preserves output settings in all chunks', () => {
    const ir = makeMultiSceneTimeline(4, 5);
    const chunks = splitTimeline(ir, 2);
    for (const chunk of chunks) {
      expect(chunk.subTimeline.output.width).toBe(1920);
      expect(chunk.subTimeline.output.height).toBe(1080);
      expect(chunk.subTimeline.output.fps).toBe(25);
    }
  });

  it('marks overlap correctly on boundary chunks', () => {
    const ir = makeMultiSceneTimeline(6, 5);
    const chunks = splitTimeline(ir, 3);
    if (chunks.length >= 3) {
      expect(chunks[0].overlapStart).toBe(false);
      expect(chunks[1].overlapStart).toBe(true);
      // overlapEnd removed in Phase C fix — only head-overlap used
    }
  });
});
