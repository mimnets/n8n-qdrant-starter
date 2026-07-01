import { describe, it, expect } from 'vitest';
import { parseTimeline } from '../../../src/render/parser/index.js';
import { resolveOutput } from '../../../src/render/parser/resolve-output.js';
import { resolveTiming } from '../../../src/render/parser/resolve-timing.js';
import type { ShotstackEdit, ShotstackClip } from '../../../src/render/parser/types.js';

// ---- Helpers ----

function minimalEdit(overrides: Partial<ShotstackEdit> = {}): ShotstackEdit {
  return {
    timeline: {
      tracks: [{
        clips: [{
          asset: { type: 'image', src: 'https://example.com/photo.jpg' },
          start: 0,
          length: 5,
        }],
      }],
    },
    output: { format: 'mp4', resolution: 'hd' },
    ...overrides,
  };
}

// ---- 1. Minimal parse ----

describe('parseTimeline – minimal', () => {
  it('parses a 1-track, 1-image-clip HD edit into valid IR', () => {
    const ir = parseTimeline(minimalEdit());

    expect(ir.output.width).toBe(1280);
    expect(ir.output.height).toBe(720);
    expect(ir.output.fps).toBe(25);
    expect(ir.output.format).toBe('mp4');

    expect(ir.scenes).toHaveLength(1);
    expect(ir.scenes[0].layers).toHaveLength(1);

    const layer = ir.scenes[0].layers[0];
    expect(layer.type).toBe('visual');
    expect(layer.asset.type).toBe('image');
    expect(layer.asset.src).toBe('https://example.com/photo.jpg');
    expect(layer.timing.start).toBe(0);
    expect(layer.timing.duration).toBe(5);
  });
});

// ---- 2. start: "auto" ----

describe('resolveTiming', () => {
  it('resolves start: "auto" to previous clip end time', () => {
    const clip: ShotstackClip = {
      asset: { type: 'image', src: 'a.jpg' },
      start: 'auto',
      length: 3,
    };

    const result = resolveTiming(clip, 5, 20);
    expect(result.start).toBe(5);
    expect(result.duration).toBe(3);
  });

  it('resolves start: number as absolute time', () => {
    const clip: ShotstackClip = {
      asset: { type: 'image', src: 'a.jpg' },
      start: 10,
      length: 2,
    };

    const result = resolveTiming(clip, 5, 20);
    expect(result.start).toBe(10);
    expect(result.duration).toBe(2);
  });

  it('resolves length: "auto" to 0 (placeholder)', () => {
    const clip: ShotstackClip = {
      asset: { type: 'video', src: 'v.mp4' },
      start: 0,
      length: 'auto',
    };

    const result = resolveTiming(clip, 0, 20);
    expect(result.duration).toBe(0);
  });

  it('resolves length: "end" to totalDuration - start', () => {
    const clip: ShotstackClip = {
      asset: { type: 'image', src: 'a.jpg' },
      start: 7,
      length: 'end',
    };

    const result = resolveTiming(clip, 0, 20);
    expect(result.start).toBe(7);
    expect(result.duration).toBe(13);
  });
});

// ---- 3. Output resolution presets ----

describe('resolveOutput – resolution presets', () => {
  it('hd resolves to 1280x720', () => {
    const out = resolveOutput({ format: 'mp4', resolution: 'hd' });
    expect(out.width).toBe(1280);
    expect(out.height).toBe(720);
  });

  it('1080 resolves to 1920x1080', () => {
    const out = resolveOutput({ format: 'mp4', resolution: '1080' });
    expect(out.width).toBe(1920);
    expect(out.height).toBe(1080);
  });

  it('preview resolves to 512x288 at 15fps', () => {
    const out = resolveOutput({ format: 'mp4', resolution: 'preview' });
    expect(out.width).toBe(512);
    expect(out.height).toBe(288);
    expect(out.fps).toBe(15);
  });

  it('defaults to sd when no resolution specified', () => {
    const out = resolveOutput({ format: 'mp4' });
    expect(out.width).toBe(1024);
    expect(out.height).toBe(576);
  });
});

// ---- 4. Aspect ratio ----

describe('resolveOutput – aspectRatio', () => {
  it('9:16 with 1080 preset swaps to portrait (1080x1920)', () => {
    const out = resolveOutput({ format: 'mp4', resolution: '1080', aspectRatio: '9:16' });
    expect(out.width).toBe(1080);
    expect(out.height).toBe(1920);
  });

  it('1:1 with hd preset produces square', () => {
    const out = resolveOutput({ format: 'mp4', resolution: 'hd', aspectRatio: '1:1' });
    expect(out.width).toBe(1280);
    expect(out.height).toBe(1280);
  });

  it('explicit size overrides aspectRatio', () => {
    const out = resolveOutput({
      format: 'mp4',
      resolution: 'hd',
      aspectRatio: '9:16',
      size: { width: 800, height: 600 },
    });
    expect(out.width).toBe(800);
    expect(out.height).toBe(600);
  });
});

// ---- 5. Merge field substitution ----

describe('parseTimeline – merge fields', () => {
  it('substitutes {{TITLE}} in text asset', () => {
    const edit = minimalEdit({
      timeline: {
        tracks: [{
          clips: [{
            asset: { type: 'title', text: 'Welcome {{TITLE}}' },
            start: 0,
            length: 5,
          }],
        }],
      },
      merge: [{ find: 'TITLE', replace: 'World' }],
    });

    const ir = parseTimeline(edit);
    expect(ir.scenes[0].layers[0].asset.text).toBe('Welcome World');
  });

  it('substitutes multiple merge fields', () => {
    const edit: ShotstackEdit = {
      timeline: {
        tracks: [{
          clips: [{
            asset: { type: 'title', text: '{{GREETING}} {{NAME}}!' },
            start: 0,
            length: 3,
          }],
        }],
      },
      output: { format: 'mp4', resolution: 'hd' },
      merge: [
        { find: 'GREETING', replace: 'Hello' },
        { find: 'NAME', replace: 'Alice' },
      ],
    };

    const ir = parseTimeline(edit);
    expect(ir.scenes[0].layers[0].asset.text).toBe('Hello Alice!');
  });
});

// ---- 6. Track ordering (z-index) ----

describe('parseTimeline – track ordering', () => {
  it('tracks[0] clips appear as layers (topmost z-index)', () => {
    const edit: ShotstackEdit = {
      timeline: {
        tracks: [
          {
            clips: [{
              asset: { type: 'title', text: 'Overlay' },
              start: 0,
              length: 5,
            }],
          },
          {
            clips: [{
              asset: { type: 'video', src: 'bg.mp4' },
              start: 0,
              length: 5,
            }],
          },
        ],
      },
      output: { format: 'mp4', resolution: 'hd' },
    };

    const ir = parseTimeline(edit);
    // tracks[0] layer comes first in layers array (topmost)
    expect(ir.scenes[0].layers[0].asset.text).toBe('Overlay');
    expect(ir.scenes[0].layers[1].asset.src).toBe('bg.mp4');
  });
});

// ---- 7. Effects extraction ----

describe('parseTimeline – effects', () => {
  it('extracts effect and filter into IREffects', () => {
    const edit = minimalEdit({
      timeline: {
        tracks: [{
          clips: [{
            asset: { type: 'image', src: 'photo.jpg' },
            start: 0,
            length: 5,
            effect: 'zoomIn',
            filter: 'boost',
          }],
        }],
      },
    });

    const ir = parseTimeline(edit);
    const effects = ir.scenes[0].layers[0].effects;
    expect(effects.motion).toBe('zoomIn');
    expect(effects.filter).toBe('boost');
  });

  it('extracts transform with rotate', () => {
    const edit = minimalEdit({
      timeline: {
        tracks: [{
          clips: [{
            asset: { type: 'image', src: 'photo.jpg' },
            start: 0,
            length: 5,
            transform: { rotate: { angle: 45 } },
          }],
        }],
      },
    });

    const ir = parseTimeline(edit);
    expect(ir.scenes[0].layers[0].effects.transform?.rotate?.angle).toBe(45);
  });

  it('extracts opacity as number', () => {
    const edit = minimalEdit({
      timeline: {
        tracks: [{
          clips: [{
            asset: { type: 'image', src: 'photo.jpg' },
            start: 0,
            length: 5,
            opacity: 0.5,
          }],
        }],
      },
    });

    const ir = parseTimeline(edit);
    expect(ir.scenes[0].layers[0].effects.opacity).toBe(0.5);
  });
});

// ---- 8. Transitions ----

describe('parseTimeline – transitions', () => {
  it('extracts transition.in and transition.out into IRTiming', () => {
    const edit = minimalEdit({
      timeline: {
        tracks: [{
          clips: [{
            asset: { type: 'image', src: 'photo.jpg' },
            start: 0,
            length: 5,
            transition: { in: 'fade', out: 'fadeSlow' },
          }],
        }],
      },
    });

    const ir = parseTimeline(edit);
    const timing = ir.scenes[0].layers[0].timing;
    expect(timing.transitionIn).toBe('fade');
    expect(timing.transitionOut).toBe('fadeSlow');
  });
});

// ---- 9. Audio extraction ----

describe('parseTimeline – audio clips', () => {
  it('AudioAsset clip appears in audio.clips', () => {
    const edit: ShotstackEdit = {
      timeline: {
        tracks: [{
          clips: [{
            asset: { type: 'audio', src: 'https://example.com/music.mp3', volume: 0.8 },
            start: 0,
            length: 10,
          }],
        }],
      },
      output: { format: 'mp4', resolution: 'hd' },
    };

    const ir = parseTimeline(edit);
    expect(ir.audio.clips).toHaveLength(1);
    expect(ir.audio.clips[0].src).toBe('https://example.com/music.mp3');
    expect(ir.audio.clips[0].volume).toBe(0.8);
    expect(ir.audio.clips[0].start).toBe(0);
    expect(ir.audio.clips[0].duration).toBe(10);
  });
});

// ---- 10. Soundtrack ----

describe('parseTimeline – soundtrack', () => {
  it('timeline.soundtrack maps to audio.soundtrack in IR', () => {
    const edit = minimalEdit({
      timeline: {
        soundtrack: {
          src: 'https://example.com/bg-music.mp3',
          effect: 'fadeIn',
          volume: 0.5,
        },
        tracks: [{
          clips: [{
            asset: { type: 'image', src: 'photo.jpg' },
            start: 0,
            length: 5,
          }],
        }],
      },
    });

    const ir = parseTimeline(edit);
    expect(ir.audio.soundtrack).toBeDefined();
    expect(ir.audio.soundtrack!.src).toBe('https://example.com/bg-music.mp3');
    expect(ir.audio.soundtrack!.effect).toBe('fadeIn');
    expect(ir.audio.soundtrack!.volume).toBe(0.5);
  });
});

// ---- 11. External assets collection ----

describe('parseTimeline – external assets', () => {
  it('collects image, video, audio, and font URLs', () => {
    const edit: ShotstackEdit = {
      timeline: {
        fonts: [{ src: 'https://example.com/font.ttf' }],
        soundtrack: { src: 'https://example.com/bg.mp3', volume: 1 },
        tracks: [{
          clips: [
            {
              asset: { type: 'image', src: 'https://example.com/img.jpg' },
              start: 0,
              length: 3,
            },
            {
              asset: { type: 'video', src: 'https://example.com/vid.mp4' },
              start: 3,
              length: 5,
            },
          ],
        }],
      },
      output: { format: 'mp4', resolution: 'hd' },
    };

    const ir = parseTimeline(edit);
    const urls = ir.assets.map(a => a.url);
    expect(urls).toContain('https://example.com/img.jpg');
    expect(urls).toContain('https://example.com/vid.mp4');
    expect(urls).toContain('https://example.com/bg.mp3');
    expect(urls).toContain('https://example.com/font.ttf');
  });
});

// ---- 12. Auto-start chaining across clips ----

describe('parseTimeline – auto start chaining', () => {
  it('clip 2 with start:"auto" starts at clip 1 end', () => {
    const edit: ShotstackEdit = {
      timeline: {
        tracks: [{
          clips: [
            {
              asset: { type: 'image', src: 'a.jpg' },
              start: 0,
              length: 5,
            },
            {
              asset: { type: 'image', src: 'b.jpg' },
              start: 'auto',
              length: 3,
            },
          ],
        }],
      },
      output: { format: 'mp4', resolution: 'hd' },
    };

    const ir = parseTimeline(edit);
    const layers = ir.scenes[0].layers;
    expect(layers[0].timing.start).toBe(0);
    expect(layers[0].timing.duration).toBe(5);
    expect(layers[1].timing.start).toBe(5);
    expect(layers[1].timing.duration).toBe(3);
  });
});

// ---- 13. Position and crop ----

describe('parseTimeline – position and crop', () => {
  it('extracts fit, scale, offset, and crop', () => {
    const edit = minimalEdit({
      timeline: {
        tracks: [{
          clips: [{
            asset: { type: 'image', src: 'photo.jpg' },
            start: 0,
            length: 5,
            fit: 'contain',
            scale: 0.5,
            offset: { x: 0.1, y: -0.2 },
            crop: { top: 0.1, bottom: 0.1, left: 0.05, right: 0.05 },
          }],
        }],
      },
    });

    const ir = parseTimeline(edit);
    const layer = ir.scenes[0].layers[0];
    expect(layer.position.fit).toBe('contain');
    expect(layer.position.scale).toBe(0.5);
    expect(layer.position.offsetX).toBe(0.1);
    expect(layer.position.offsetY).toBe(-0.2);
    expect(layer.crop).toEqual({ top: 0.1, bottom: 0.1, left: 0.05, right: 0.05 });
  });
});
