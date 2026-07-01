import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import { parseTimeline } from '../../src/render/parser/index.js';
import { buildScene } from '../../src/render/builder/index.js';
import type { ShotstackEdit } from '../../src/render/parser/types.js';

/**
 * Beyond Orbit 4-track payload:
 *  Track 0: text subtitles (topmost)
 *  Track 1: image scenes with effects/filters/transitions
 *  Track 2: TTS audio
 *  Track 3: background music
 */
const beyondOrbitPayload: ShotstackEdit = {
  timeline: {
    background: '#000000',
    tracks: [
      {
        clips: [{
          asset: {
            type: 'text',
            text: 'Sample subtitle',
            font: { family: 'Montserrat', size: 34, color: '#ffffff', weight: 700 },
            stroke: { color: '#000000', width: 3 },
          },
          start: 0,
          length: 3,
          position: 'bottom',
          offset: { y: 0.04 },
        }],
      },
      {
        clips: [
          {
            asset: { type: 'image', src: 'https://example.com/scene1.jpg' },
            start: 0,
            length: 5,
            effect: 'zoomIn',
            filter: 'boost',
            transition: { out: 'fadeSlow' },
          },
          {
            asset: { type: 'image', src: 'https://example.com/scene2.jpg' },
            start: 5,
            length: 5,
            effect: 'zoomOut',
            filter: 'boost',
            transition: { in: 'fade', out: 'reveal' },
          },
        ],
      },
      {
        clips: [{
          asset: { type: 'audio', src: 'https://example.com/tts_1.mp3', volume: 1 },
          start: 0,
          length: 5,
        }],
      },
      {
        clips: [{
          asset: { type: 'audio', src: 'https://example.com/bgm.mp3', volume: 0.15, volumeEffect: 'fadeIn' },
          start: 0,
          length: 10,
        }],
      },
    ],
  },
  output: { format: 'mp4', resolution: 'hd' },
};

describe('Beyond Orbit Compatibility', () => {
  let app: Awaited<ReturnType<typeof createServer>>;

  beforeAll(async () => {
    app = await createServer({ testing: true });
  });

  afterAll(async () => {
    await app.close();
  });

  it('API accepts the 4-track Beyond Orbit payload and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/edit/v1/render',
      payload: beyondOrbitPayload,
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.response.id).toBeDefined();
    expect(body.response.status).toBe('queued');
  });

  it('Timeline Parser produces valid IR with correct structure', () => {
    const ir = parseTimeline(beyondOrbitPayload);

    // Should have at least one scene
    expect(ir.scenes.length).toBeGreaterThanOrEqual(1);

    const scene = ir.scenes[0];

    // Should have layers from all visual tracks (text + 2 images = at least 3 visual layers)
    // Audio layers are also included but typed as 'audio'
    const visualLayers = scene.layers.filter(l => l.type === 'visual');
    const audioLayers = scene.layers.filter(l => l.type === 'audio');

    expect(visualLayers.length).toBe(3); // 1 text + 2 images
    expect(audioLayers.length).toBe(2); // TTS + BGM

    // Check text layer
    const textLayer = visualLayers.find(l => l.asset.type === 'text');
    expect(textLayer).toBeDefined();
    expect(textLayer!.asset.text).toBe('Sample subtitle');
    expect(textLayer!.asset.font?.family).toBe('Montserrat');
    expect(textLayer!.asset.font?.size).toBe(34);
    expect(textLayer!.asset.stroke?.color).toBe('#000000');
    expect(textLayer!.asset.stroke?.width).toBe(3);

    // Check image layers have effects and filters
    const imageLayers = visualLayers.filter(l => l.asset.type === 'image');
    expect(imageLayers.length).toBe(2);

    const scene1Layer = imageLayers.find(l => l.asset.src === 'https://example.com/scene1.jpg');
    expect(scene1Layer).toBeDefined();
    expect(scene1Layer!.effects.motion).toBe('zoomIn');
    expect(scene1Layer!.effects.filter).toBe('boost');
    expect(scene1Layer!.timing.transitionOut).toBe('fadeSlow');

    const scene2Layer = imageLayers.find(l => l.asset.src === 'https://example.com/scene2.jpg');
    expect(scene2Layer).toBeDefined();
    expect(scene2Layer!.effects.motion).toBe('zoomOut');
    expect(scene2Layer!.effects.filter).toBe('boost');
    expect(scene2Layer!.timing.transitionIn).toBe('fade');
    expect(scene2Layer!.timing.transitionOut).toBe('reveal');

    // Check audio clips in IR
    expect(ir.audio.clips.length).toBe(2);
    const ttsClip = ir.audio.clips.find(c => c.src === 'https://example.com/tts_1.mp3');
    expect(ttsClip).toBeDefined();
    expect(ttsClip!.volume).toBe(1);

    const bgmClip = ir.audio.clips.find(c => c.src === 'https://example.com/bgm.mp3');
    expect(bgmClip).toBeDefined();
    expect(bgmClip!.volume).toBe(0.15);
    expect(bgmClip!.volumeEffect).toBe('fadeIn');
  });

  it('Scene Builder produces HTML with zoomIn effect data and boost filter', () => {
    const ir = parseTimeline(beyondOrbitPayload);
    const html = buildScene(ir.scenes[0], ir.output);

    // Should contain Ken Burns zoomIn in layer timing data (JS-based rendering)
    expect(html).toContain('"effect":"zoomIn"');
    expect(html).toContain('window.updateFrame');

    // Should contain boost filter CSS
    expect(html).toContain('contrast(1.2)');
    expect(html).toContain('saturate(1.3)');

    // Should contain transition data in layerTimings
    expect(html).toContain('"transitionOut":"fadeSlow"');
  });

  it('9:16 Shorts payload accepted with correct resolution (1080x1920)', async () => {
    const shortsPayload = {
      ...beyondOrbitPayload,
      output: { format: 'mp4', resolution: '1080' as const, aspectRatio: '9:16' as const },
    };

    // Test API acceptance
    const res = await app.inject({
      method: 'POST',
      url: '/edit/v1/render',
      payload: shortsPayload,
    });
    expect(res.statusCode).toBe(201);

    // Test resolution parsing
    const ir = parseTimeline(shortsPayload);
    expect(ir.output.width).toBe(1080);
    expect(ir.output.height).toBe(1920);
    expect(ir.output.format).toBe('mp4');
  });

  it('Shotstack response format matches expected structure', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/edit/v1/render',
      payload: beyondOrbitPayload,
    });

    const body = JSON.parse(res.body);

    // Required Shotstack-compatible response fields
    expect(body).toHaveProperty('success');
    expect(body).toHaveProperty('message');
    expect(body).toHaveProperty('response');
    expect(body.response).toHaveProperty('id');
    expect(body.response).toHaveProperty('status');

    expect(typeof body.success).toBe('boolean');
    expect(typeof body.message).toBe('string');
    expect(typeof body.response.id).toBe('string');
    expect(body.response.status).toBe('queued');
  });

  it('Payload with callback URL is accepted', async () => {
    const withCallback = {
      ...beyondOrbitPayload,
      callback: 'https://webhook.example.com/render-done',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/edit/v1/render',
      payload: withCallback,
    });

    expect(res.statusCode).toBe(201);
  });

  it('Payload with merge fields is accepted and substituted', async () => {
    const withMerge: ShotstackEdit = {
      timeline: {
        tracks: [{
          clips: [{
            asset: {
              type: 'text',
              text: '{{TITLE}}',
            },
            start: 0,
            length: 3,
          }],
        }],
      },
      output: { format: 'mp4', resolution: 'hd' },
      merge: [{ find: 'TITLE', replace: 'Hello World' }],
    };

    const ir = parseTimeline(withMerge);
    const textLayer = ir.scenes[0].layers.find(l => l.asset.type === 'text');
    expect(textLayer!.asset.text).toBe('Hello World');
  });
});
