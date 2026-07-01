import { describe, it, expect } from 'vitest';
import { renderVideo } from '../../../src/render/assets/video.js';
import { extractAudioClip, extractVideoAudio } from '../../../src/render/assets/audio.js';
import type { IRLayer } from '../../../src/render/parser/types.js';

// ---- Helpers ----

function makeVideoLayer(overrides: Partial<IRLayer> = {}): IRLayer {
  return {
    type: 'visual',
    asset: { type: 'video', src: 'https://example.com/clip.mp4', volume: 0 },
    timing: { start: 0, duration: 10 },
    effects: {},
    position: { fit: 'crop', scale: 1, offsetX: 0, offsetY: 0 },
    ...overrides,
  };
}

function makeAudioLayer(overrides: Partial<IRLayer> = {}): IRLayer {
  return {
    type: 'audio',
    asset: { type: 'audio', src: 'https://example.com/music.mp3', volume: 0.8 },
    timing: { start: 0, duration: 30 },
    effects: {},
    position: { fit: 'crop', scale: 1, offsetX: 0, offsetY: 0 },
    ...overrides,
  };
}

// ====================================================================
// Video Asset Tests
// ====================================================================

describe('renderVideo', () => {
  it('generates a <video> tag with the correct src', () => {
    const layer = makeVideoLayer();
    const result = renderVideo(layer, 0);

    expect(result.html).toContain('<video');
    expect(result.html).toContain('src="https://example.com/clip.mp4"');
  });

  it('applies object-fit cover when position.fit is "crop"', () => {
    const layer = makeVideoLayer({ position: { fit: 'crop', scale: 1, offsetX: 0, offsetY: 0 } });
    const result = renderVideo(layer, 0);

    expect(result.css).toContain('object-fit: cover');
  });

  it('applies object-fit contain when position.fit is "contain"', () => {
    const layer = makeVideoLayer({ position: { fit: 'contain', scale: 1, offsetX: 0, offsetY: 0 } });
    const result = renderVideo(layer, 0);

    expect(result.css).toContain('object-fit: contain');
  });

  it('uses the layerIndex for the element id', () => {
    const layer = makeVideoLayer();
    const result = renderVideo(layer, 3);

    expect(result.html).toContain('id="layer-3"');
    expect(result.css).toContain('#layer-3');
  });

  it('applies clip-path CSS when crop is present', () => {
    const layer = makeVideoLayer({
      crop: { top: 0.1, bottom: 0.2, left: 0.05, right: 0.15 },
    });
    const result = renderVideo(layer, 0);

    expect(result.css).toContain('clip-path: inset(10% 15% 20% 5%)');
  });

  it('always renders the video element as muted', () => {
    const layer = makeVideoLayer({
      asset: { type: 'video', src: 'https://example.com/clip.mp4', volume: 1 },
    });
    const result = renderVideo(layer, 0);

    expect(result.html).toContain('muted');
  });

  it('applies scale transform when scale is not 1', () => {
    const layer = makeVideoLayer({ position: { fit: 'crop', scale: 1.5, offsetX: 0, offsetY: 0 } });
    const result = renderVideo(layer, 0);

    expect(result.css).toContain('scale(1.5)');
  });

  it('applies translate transform for offsets', () => {
    const layer = makeVideoLayer({ position: { fit: 'crop', scale: 1, offsetX: 0.1, offsetY: 0.2 } });
    const result = renderVideo(layer, 0);

    expect(result.css).toContain('translateX(10%)');
    expect(result.css).toContain('translateY(-20%)');
  });
});

// ====================================================================
// Audio Asset Tests
// ====================================================================

describe('extractAudioClip', () => {
  it('extracts correct IRAudioClip from an audio layer', () => {
    const layer = makeAudioLayer();
    const clip = extractAudioClip(layer);

    expect(clip).not.toBeNull();
    expect(clip!.src).toBe('https://example.com/music.mp3');
    expect(clip!.start).toBe(0);
    expect(clip!.duration).toBe(30);
    expect(clip!.volume).toBe(0.8);
  });

  it('includes volumeEffect when present', () => {
    const layer = makeAudioLayer({
      asset: { type: 'audio', src: 'https://example.com/music.mp3', volume: 1, volumeEffect: 'fadeIn' },
    });
    const clip = extractAudioClip(layer);

    expect(clip).not.toBeNull();
    expect(clip!.volumeEffect).toBe('fadeIn');
  });

  it('includes speed when present', () => {
    const layer = makeAudioLayer({
      asset: { type: 'audio', src: 'https://example.com/music.mp3', volume: 1, speed: 1.5 },
    });
    const clip = extractAudioClip(layer);

    expect(clip).not.toBeNull();
    expect(clip!.speed).toBe(1.5);
  });

  it('returns null for a non-audio layer', () => {
    const layer: IRLayer = {
      type: 'visual',
      asset: { type: 'image', src: 'https://example.com/photo.jpg' },
      timing: { start: 0, duration: 5 },
      effects: {},
      position: { fit: 'crop', scale: 1, offsetX: 0, offsetY: 0 },
    };
    const clip = extractAudioClip(layer);

    expect(clip).toBeNull();
  });

  it('returns null when audio layer has no src', () => {
    const layer = makeAudioLayer({
      asset: { type: 'audio', volume: 1 },
    });
    const clip = extractAudioClip(layer);

    expect(clip).toBeNull();
  });

  it('defaults volume to 1 when not specified', () => {
    const layer = makeAudioLayer({
      asset: { type: 'audio', src: 'https://example.com/music.mp3' },
    });
    const clip = extractAudioClip(layer);

    expect(clip).not.toBeNull();
    expect(clip!.volume).toBe(1);
  });
});

describe('extractVideoAudio', () => {
  it('returns audio clip from video layer with volume > 0', () => {
    const layer = makeVideoLayer({
      asset: { type: 'video', src: 'https://example.com/clip.mp4', volume: 0.7 },
    });
    const clip = extractVideoAudio(layer);

    expect(clip).not.toBeNull();
    expect(clip!.src).toBe('https://example.com/clip.mp4');
    expect(clip!.volume).toBe(0.7);
  });

  it('returns null from video layer with volume = 0', () => {
    const layer = makeVideoLayer({
      asset: { type: 'video', src: 'https://example.com/clip.mp4', volume: 0 },
    });
    const clip = extractVideoAudio(layer);

    expect(clip).toBeNull();
  });

  it('returns null from video layer with no volume set', () => {
    const layer = makeVideoLayer({
      asset: { type: 'video', src: 'https://example.com/clip.mp4' },
    });
    const clip = extractVideoAudio(layer);

    expect(clip).toBeNull();
  });

  it('returns null for non-video layers', () => {
    const layer = makeAudioLayer();
    const clip = extractVideoAudio(layer);

    expect(clip).toBeNull();
  });
});
