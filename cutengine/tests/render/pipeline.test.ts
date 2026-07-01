import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all heavy dependencies before importing
vi.mock('../../src/render/parser/index.js', () => ({
  parseTimeline: vi.fn(),
}));
vi.mock('../../src/render/builder/index.js', () => ({
  buildScene: vi.fn(),
}));
vi.mock('../../src/render/capture/index.js', () => ({
  captureFrames: vi.fn(),
}));
vi.mock('../../src/render/encoder/index.js', () => ({
  encode: vi.fn(),
}));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
  };
});

import { executePipeline } from '../../src/render/pipeline.js';
import { parseTimeline } from '../../src/render/parser/index.js';
import { buildScene } from '../../src/render/builder/index.js';
import { captureFrames } from '../../src/render/capture/index.js';
import { encode } from '../../src/render/encoder/index.js';
import type { IRTimeline } from '../../src/render/parser/types.js';

const mockParseTimeline = vi.mocked(parseTimeline);
const mockBuildScene = vi.mocked(buildScene);
const mockCaptureFrames = vi.mocked(captureFrames);
const mockEncode = vi.mocked(encode);

function createMockIR(): IRTimeline {
  return {
    scenes: [{
      startTime: 0,
      duration: 5,
      layers: [{
        type: 'visual',
        asset: { type: 'image', src: 'https://example.com/photo.jpg' },
        timing: { start: 0, duration: 5 },
        effects: {},
        position: { fit: 'crop', scale: 1, offsetX: 0, offsetY: 0 },
      }],
    }],
    audio: { clips: [] },
    output: {
      width: 1920,
      height: 1080,
      fps: 25,
      format: 'mp4',
      quality: 'medium',
    },
    assets: [],
  };
}

const minimalEditJson = {
  timeline: { tracks: [{ clips: [{ asset: { type: 'image', src: 'https://example.com/photo.jpg' }, start: 0, length: 5 }] }] },
  output: { format: 'mp4', resolution: 'hd' },
};

describe('executePipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockParseTimeline.mockReturnValue(createMockIR());
    mockBuildScene.mockReturnValue('<html>scene</html>');
    mockCaptureFrames.mockResolvedValue({
      frameDir: '/tmp/test/frames',
      frameCount: 125,
      framePattern: 'frame_%05d.png',
    });
    mockEncode.mockResolvedValue('/tmp/test/output.mp4');
  });

  it('calls all 4 stages in order: parseTimeline -> buildScene -> captureFrames -> encode', async () => {
    const callOrder: string[] = [];

    mockParseTimeline.mockImplementation((..._args) => {
      callOrder.push('parse');
      return createMockIR();
    });
    mockBuildScene.mockImplementation((..._args) => {
      callOrder.push('build');
      return '<html>scene</html>';
    });
    mockCaptureFrames.mockImplementation(async (..._args) => {
      callOrder.push('capture');
      return { frameDir: '/tmp/test/frames', frameCount: 125, framePattern: 'frame_%05d.png' };
    });
    mockEncode.mockImplementation(async (..._args) => {
      callOrder.push('encode');
      return '/tmp/test/output.mp4';
    });

    await executePipeline(minimalEditJson, '/tmp/test');

    expect(callOrder).toEqual(['parse', 'build', 'capture', 'encode']);
    expect(mockParseTimeline).toHaveBeenCalledOnce();
    expect(mockBuildScene).toHaveBeenCalledOnce();
    expect(mockCaptureFrames).toHaveBeenCalledOnce();
    expect(mockEncode).toHaveBeenCalledOnce();
  });

  it('returns correct PipelineResult', async () => {
    const result = await executePipeline(minimalEditJson, '/tmp/test');

    expect(result.outputPath).toContain('output.mp4');
    expect(result.format).toBe('mp4');
    expect(result.duration).toBe(5);
  });

  it('updates status via callback: fetching -> rendering -> saving', async () => {
    const statuses: string[] = [];
    const onStatus = vi.fn(async (status: string) => {
      statuses.push(status);
    });

    await executePipeline(minimalEditJson, '/tmp/test', onStatus);

    expect(statuses).toEqual(['fetching', 'rendering', 'saving']);
    expect(onStatus).toHaveBeenCalledTimes(3);
  });

  it('passes correct options to captureFrames', async () => {
    await executePipeline(minimalEditJson, '/tmp/test');

    const captureCall = mockCaptureFrames.mock.calls[0][0];
    expect(captureCall.html).toBe('<html>scene</html>');
    expect(captureCall.width).toBe(1920);
    expect(captureCall.height).toBe(1080);
    expect(captureCall.fps).toBe(25);
    expect(captureCall.duration).toBe(5);
    expect(captureCall.isStatic).toBe(true); // no motion/transitions
  });

  it('detects non-static scenes with motion effects', async () => {
    const ir = createMockIR();
    ir.scenes[0].layers[0].effects.motion = 'slideLeft';
    mockParseTimeline.mockReturnValue(ir);

    await executePipeline(minimalEditJson, '/tmp/test');

    const captureCall = mockCaptureFrames.mock.calls[0][0];
    expect(captureCall.isStatic).toBe(false);
  });

  it('passes audio to encoder when audio clips exist', async () => {
    const ir = createMockIR();
    ir.audio.clips = [{ src: 'https://example.com/music.mp3', start: 0, duration: 5, volume: 1 }];
    mockParseTimeline.mockReturnValue(ir);

    await executePipeline(minimalEditJson, '/tmp/test');

    const encodeCall = mockEncode.mock.calls[0][0];
    expect(encodeCall.audio).toBeDefined();
    expect(encodeCall.audio!.clips).toHaveLength(1);
  });

  it('omits audio from encoder when no audio clips or soundtrack', async () => {
    await executePipeline(minimalEditJson, '/tmp/test');

    const encodeCall = mockEncode.mock.calls[0][0];
    expect(encodeCall.audio).toBeUndefined();
  });
});
