import { describe, it, expect } from 'vitest';
import { buildTween } from '../../../src/render/effects/tween.js';
import {
  buildChromaKeyFFmpegFilter,
  buildChromaKeyScript,
} from '../../../src/render/effects/chromakey.js';
import { buildTransformCSS } from '../../../src/render/effects/transform.js';
import {
  buildSpeedCSS,
  buildSpeedFFmpegFilter,
  buildSpeedAudioFilter,
} from '../../../src/render/effects/speed.js';
import {
  buildTransitionIn,
  buildTransitionOut,
} from '../../../src/render/effects/transitions.js';
import type { IRTween, IRTransform } from '../../../src/render/parser/types.js';

// ---- Tween tests ----

describe('Tween', () => {
  it('builds opacity 0 -> 1 keyframes', () => {
    const tweens: IRTween[] = [{ from: 0, to: 1, start: 0, length: 1 }];
    const result = buildTween(tweens, 'opacity', 'layer1');

    expect(result.keyframes).toContain('@keyframes tween-layer1-opacity');
    expect(result.keyframes).toContain('opacity: 0;');
    expect(result.keyframes).toContain('opacity: 1;');
    expect(result.animationCSS).toContain('tween-layer1-opacity');
  });

  it('maps easing "easeInOut" to ease-in-out', () => {
    const tweens: IRTween[] = [
      { from: 0, to: 1, start: 0, length: 2, easing: 'easeInOut' },
    ];
    const result = buildTween(tweens, 'opacity', 'layer2');

    expect(result.animationCSS).toContain('ease-in-out');
  });

  it('maps interpolation "linear" when no easing set', () => {
    const tweens: IRTween[] = [
      { from: 0, to: 1, start: 0, length: 1, interpolation: 'linear' },
    ];
    const result = buildTween(tweens, 'opacity', 'layer3');

    expect(result.animationCSS).toContain('linear');
  });

  it('handles offsetX tweens with translateX', () => {
    const tweens: IRTween[] = [{ from: -50, to: 0, start: 0, length: 1 }];
    const result = buildTween(tweens, 'offsetX', 'layerOX');

    expect(result.keyframes).toContain('translateX(-50%)');
    expect(result.keyframes).toContain('translateX(0%)');
  });

  it('returns empty strings for empty tweens array', () => {
    const result = buildTween([], 'opacity', 'empty');
    expect(result.keyframes).toBe('');
    expect(result.animationCSS).toBe('');
  });

  it('respects clipDuration for percentage calculation', () => {
    const tweens: IRTween[] = [{ from: 0, to: 1, start: 1, length: 1 }];
    const result = buildTween(tweens, 'opacity', 'pct', 4);

    // start=1 out of 4 = 25%, end=2 out of 4 = 50%
    expect(result.keyframes).toContain('25.0%');
    expect(result.keyframes).toContain('50.0%');
    expect(result.animationCSS).toContain('4s');
  });
});

// ---- ChromaKey tests ----

describe('ChromaKey', () => {
  it('builds FFmpeg filter for green (#00ff00)', () => {
    const filter = buildChromaKeyFFmpegFilter({ color: '#00ff00' });
    expect(filter).toBe('chromakey=0x00ff00:0.3:0.1');
  });

  it('reflects custom threshold in FFmpeg filter', () => {
    const filter = buildChromaKeyFFmpegFilter({
      color: '#0000ff',
      threshold: 0.5,
      softness: 0.2,
    });
    expect(filter).toBe('chromakey=0x0000ff:0.5:0.2');
  });

  it('builds canvas script with target id', () => {
    const script = buildChromaKeyScript(
      { color: '#00ff00' },
      'video-layer-1',
    );
    expect(script).toContain('<script>');
    expect(script).toContain('video-layer-1');
    expect(script).toContain('</script>');
  });
});

// ---- Transform tests ----

describe('Transform', () => {
  it('rotates 45 degrees', () => {
    const t: IRTransform = { rotate: { angle: 45 } };
    expect(buildTransformCSS(t)).toBe('transform: rotate(45deg);');
  });

  it('flips horizontal', () => {
    const t: IRTransform = { flip: { horizontal: true } };
    expect(buildTransformCSS(t)).toBe('transform: scaleX(-1);');
  });

  it('flips vertical', () => {
    const t: IRTransform = { flip: { vertical: true } };
    expect(buildTransformCSS(t)).toBe('transform: scaleY(-1);');
  });

  it('combines skew and rotate', () => {
    const t: IRTransform = {
      rotate: { angle: 30 },
      skew: { x: 10, y: 5 },
    };
    const css = buildTransformCSS(t);
    expect(css).toContain('rotate(30deg)');
    expect(css).toContain('skewX(10deg)');
    expect(css).toContain('skewY(5deg)');
  });

  it('returns empty string when nothing to transform', () => {
    const t: IRTransform = {};
    expect(buildTransformCSS(t)).toBe('');
  });

  it('combines flip and rotate', () => {
    const t: IRTransform = {
      rotate: { angle: 90 },
      flip: { horizontal: true, vertical: true },
    };
    const css = buildTransformCSS(t);
    expect(css).toContain('rotate(90deg)');
    expect(css).toContain('scaleX(-1)');
    expect(css).toContain('scaleY(-1)');
  });
});

// ---- Speed tests ----

describe('Speed', () => {
  it('2x FFmpeg filter -> setpts=0.5*PTS', () => {
    expect(buildSpeedFFmpegFilter(2)).toBe('setpts=0.5*PTS');
  });

  it('2x audio -> atempo=2', () => {
    expect(buildSpeedAudioFilter(2)).toBe('atempo=2');
  });

  it('4x audio -> chained atempo filters', () => {
    const filter = buildSpeedAudioFilter(4);
    // 4 / 2.0 = 2, so: atempo=2.0,atempo=2
    expect(filter).toContain('atempo=2.0');
    expect(filter).toContain('atempo=2');
    expect(filter.split(',').length).toBe(2);
  });

  it('1x speed returns empty string for all builders', () => {
    expect(buildSpeedCSS(1)).toBe('');
    expect(buildSpeedFFmpegFilter(1)).toBe('');
    expect(buildSpeedAudioFilter(1)).toBe('');
  });

  it('0.25x audio -> chained atempo=0.5 filters', () => {
    const filter = buildSpeedAudioFilter(0.25);
    expect(filter).toContain('atempo=0.5');
    // 0.25 < 0.5 -> atempo=0.5, remaining = 0.25/0.5 = 0.5 -> atempo=0.5
    expect(filter.split(',').length).toBe(2);
  });

  it('CSS speed adjusts animation-duration inversely', () => {
    expect(buildSpeedCSS(2)).toBe('animation-duration: 0.5s;');
  });

  it('0.5x FFmpeg filter -> setpts=2*PTS', () => {
    expect(buildSpeedFFmpegFilter(0.5)).toBe('setpts=2*PTS');
  });
});

// ---- Expanded Transitions tests ----

describe('Expanded Transitions', () => {
  it('carouselLeft transition in works', () => {
    const result = buildTransitionIn('carouselLeft');
    expect(result).not.toBeNull();
    expect(result!.keyframes).toContain('translateX(100%)');
    expect(result!.keyframes).toContain('opacity: 0');
  });

  it('carouselRight transition out works', () => {
    const result = buildTransitionOut('carouselRight');
    expect(result).not.toBeNull();
    // out reverses: from=to-state, to=from-state
    expect(result!.keyframes).toContain('translateX(-100%)');
  });

  it('shuffleLeft transition in has rotation', () => {
    const result = buildTransitionIn('shuffleLeft');
    expect(result).not.toBeNull();
    expect(result!.keyframes).toContain('rotate(5deg)');
  });

  it('shuffleRight transition in has negative rotation', () => {
    const result = buildTransitionIn('shuffleRight');
    expect(result).not.toBeNull();
    expect(result!.keyframes).toContain('rotate(-5deg)');
  });

  it('carouselUpSlow uses slow duration', () => {
    const result = buildTransitionIn('carouselUpSlow');
    expect(result).not.toBeNull();
    expect(result!.duration).toBe(0.6);
  });

  it('shuffleLeftFast uses fast duration', () => {
    const result = buildTransitionIn('shuffleLeftFast');
    expect(result).not.toBeNull();
    expect(result!.duration).toBe(0.15);
  });

  it('unknown transition returns null', () => {
    expect(buildTransitionIn('nonexistent')).toBeNull();
  });
});
