import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EncodeOptions } from '../../../src/render/encoder/index.js';
import type { IRAudioMix } from '../../../src/render/parser/types.js';

// Mock child_process — vi.mock is hoisted, so use vi.fn() directly in factory
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execFileSync: vi.fn().mockReturnValue(''),
}));

// Mock config
vi.mock('../../../src/config/index.js', () => ({
  config: {
    encoder: { codec: 'libx264', crf: undefined },
  },
}));

import { buildFFmpegArgs, encode } from '../../../src/render/encoder/index.js';
import { buildAudioMix } from '../../../src/render/encoder/audio-mixer.js';
import { spawn } from 'child_process';

function makeOpts(overrides: Partial<EncodeOptions> = {}): EncodeOptions {
  return {
    frameDir: '/tmp/frames',
    framePattern: 'frame_%05d.png',
    frameCount: 100,
    output: {
      width: 1920,
      height: 1080,
      fps: 25,
      format: 'mp4',
      quality: 'medium',
    },
    outputPath: '/tmp/output.mp4',
    ...overrides,
  };
}

function setupSpawnMock(exitCode: number, stderrData?: string, emitError?: Error) {
  const stderrOn = vi.fn();
  const procOn = vi.fn();

  if (stderrData) {
    stderrOn.mockImplementation((event: string, cb: Function) => {
      if (event === 'data') cb(Buffer.from(stderrData));
    });
  }

  procOn.mockImplementation((event: string, cb: Function) => {
    if (emitError && event === 'error') {
      setTimeout(() => cb(emitError), 0);
    } else if (!emitError && event === 'close') {
      setTimeout(() => cb(exitCode), 0);
    }
  });

  const mockProc = {
    stderr: { on: stderrOn },
    on: procOn,
  };

  (spawn as any).mockReturnValue(mockProc);
  return mockProc;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// buildFFmpegArgs
// ============================================================

describe('buildFFmpegArgs', () => {
  it('builds mp4 args with libx264, correct CRF and fps', () => {
    const args = buildFFmpegArgs(makeOpts());
    expect(args).toContain('-c:v');
    expect(args).toContain('libx264');
    expect(args).toContain('-crf');
    expect(args[args.indexOf('-crf') + 1]).toBe('23'); // medium
    expect(args).toContain('-framerate');
    expect(args[args.indexOf('-framerate') + 1]).toBe('25');
    expect(args).toContain('-pix_fmt');
    expect(args).toContain('yuv420p');
    expect(args).toContain('-movflags');
    expect(args).toContain('+faststart');
    expect(args).toContain('-y');
    expect(args[args.length - 1]).toBe('/tmp/output.mp4');
  });

  it('builds gif args with palettegen + paletteuse filter', () => {
    const args = buildFFmpegArgs(
      makeOpts({
        output: { width: 640, height: 480, fps: 10, format: 'gif', quality: 'medium' },
        outputPath: '/tmp/output.gif',
      }),
    );
    expect(args).toContain('-filter_complex');
    const filterIdx = args.indexOf('-filter_complex');
    const filter = args[filterIdx + 1];
    expect(filter).toContain('palettegen');
    expect(filter).toContain('paletteuse');
    expect(args).not.toContain('-c:v');
  });

  it('builds jpg args with -frames:v 1', () => {
    const args = buildFFmpegArgs(
      makeOpts({
        output: { width: 1920, height: 1080, fps: 25, format: 'jpg', quality: 'high' },
        outputPath: '/tmp/output.jpg',
      }),
    );
    expect(args).toContain('-frames:v');
    expect(args[args.indexOf('-frames:v') + 1]).toBe('1');
    expect(args).toContain('/tmp/frames/frame_00001.png');
  });

  it('builds png args with -frames:v 1', () => {
    const args = buildFFmpegArgs(
      makeOpts({
        output: { width: 1920, height: 1080, fps: 25, format: 'png', quality: 'high' },
        outputPath: '/tmp/output.png',
      }),
    );
    expect(args).toContain('-frames:v');
    expect(args[args.indexOf('-frames:v') + 1]).toBe('1');
  });

  it('maps quality levels to correct CRF values', () => {
    const cases: Array<[string, string]> = [
      ['verylow', '35'],
      ['low', '28'],
      ['medium', '23'],
      ['high', '18'],
      ['veryhigh', '15'],
    ];
    for (const [quality, expectedCrf] of cases) {
      const args = buildFFmpegArgs(
        makeOpts({
          output: { width: 1920, height: 1080, fps: 25, format: 'mp4', quality },
        }),
      );
      const crfIdx = args.indexOf('-crf');
      expect(args[crfIdx + 1]).toBe(expectedCrf);
    }
  });

  it('defaults to CRF 23 for unknown quality', () => {
    const args = buildFFmpegArgs(
      makeOpts({
        output: { width: 1920, height: 1080, fps: 25, format: 'mp4', quality: 'unknown' },
      }),
    );
    const crfIdx = args.indexOf('-crf');
    expect(args[crfIdx + 1]).toBe('23');
  });
});

describe('buildFFmpegArgs with audio', () => {
  it('uses -c:a aac and -t instead of -shortest for mp4 with audio', () => {
    const audio: IRAudioMix = {
      clips: [{ src: '/audio/narration.mp3', start: 0, duration: 10, volume: 1 }],
      soundtrack: { src: '/audio/bgm.mp3', effect: 'fadeInFadeOut', volume: 0.3 },
    };
    const args = buildFFmpegArgs(makeOpts({ audio, frameCount: 250 }));

    // Must have explicit AAC codec
    expect(args).toContain('-c:a');
    expect(args[args.indexOf('-c:a') + 1]).toBe('aac');

    // Must use -t for exact duration control (not -shortest which can cause silent audio)
    expect(args).toContain('-t');
    expect(args).not.toContain('-shortest');

    // Duration should be frameCount / fps = 250 / 25 = 10
    const tIdx = args.indexOf('-t');
    expect(args[tIdx + 1]).toBe('10');

    // Must have filter_complex with audio mixing
    expect(args).toContain('-filter_complex');
    expect(args).toContain('-map');
  });

  it('does not include audio args when no audio provided', () => {
    const args = buildFFmpegArgs(makeOpts());
    expect(args).not.toContain('-c:a');
    expect(args).not.toContain('-t');
    expect(args).not.toContain('-filter_complex');
  });
});

// ============================================================
// buildAudioMix
// ============================================================

describe('buildAudioMix', () => {
  it('returns empty result when no audio clips or soundtrack', () => {
    const audio: IRAudioMix = { clips: [] };
    const result = buildAudioMix(audio, 10);
    expect(result.inputArgs).toEqual([]);
    expect(result.filterComplex).toBe('');
    expect(result.mapArgs).toEqual([]);
  });

  it('builds mix with 2 clips including volume and delay', () => {
    const audio: IRAudioMix = {
      clips: [
        { src: '/audio/clip1.mp3', start: 0, duration: 5, volume: 0.8 },
        { src: '/audio/clip2.mp3', start: 3, duration: 4, volume: 1.2 },
      ],
    };
    const result = buildAudioMix(audio, 10);

    expect(result.inputArgs).toEqual(['-i', '/audio/clip1.mp3', '-i', '/audio/clip2.mp3']);
    expect(result.filterComplex).toContain('[1:a]');
    expect(result.filterComplex).toContain('[2:a]');
    expect(result.filterComplex).toContain('volume=0.8');
    expect(result.filterComplex).toContain('adelay=3000|3000');
    expect(result.filterComplex).toContain('amix=inputs=2');
    expect(result.mapArgs).toEqual(['-map', '0:v', '-map', '[aout]']);
  });

  it('builds soundtrack with fadeIn effect', () => {
    const audio: IRAudioMix = {
      clips: [],
      soundtrack: { src: '/audio/bg.mp3', effect: 'fadeIn', volume: 0.5 },
    };
    const result = buildAudioMix(audio, 20);

    expect(result.inputArgs).toEqual(['-i', '/audio/bg.mp3']);
    expect(result.filterComplex).toContain('volume=0.5');
    expect(result.filterComplex).toContain('afade=t=in:d=2');
    expect(result.filterComplex).toContain('apad=whole_dur=20');
    expect(result.filterComplex).toContain('[aout]');
    expect(result.filterComplex).not.toContain('amix');
  });

  it('builds soundtrack with fadeOut effect', () => {
    const audio: IRAudioMix = {
      clips: [],
      soundtrack: { src: '/audio/bg.mp3', effect: 'fadeOut', volume: 1 },
    };
    const result = buildAudioMix(audio, 20);

    expect(result.filterComplex).toContain('afade=t=out:st=18:d=2');
  });

  it('builds soundtrack with fadeInFadeOut effect', () => {
    const audio: IRAudioMix = {
      clips: [],
      soundtrack: { src: '/audio/bg.mp3', effect: 'fadeInFadeOut', volume: 1 },
    };
    const result = buildAudioMix(audio, 20);

    expect(result.filterComplex).toContain('afade=t=in:d=2');
    expect(result.filterComplex).toContain('afade=t=out:st=18:d=2');
  });

  it('builds clip with volumeEffect fadeInFadeOut', () => {
    const audio: IRAudioMix = {
      clips: [
        { src: '/audio/clip.mp3', start: 0, duration: 10, volume: 1, volumeEffect: 'fadeInFadeOut' },
      ],
    };
    const result = buildAudioMix(audio, 10);

    expect(result.filterComplex).toContain('afade=t=in:d=1');
    expect(result.filterComplex).toContain('afade=t=out:st=9:d=1');
  });

  it('builds clip with speed adjustment', () => {
    const audio: IRAudioMix = {
      clips: [
        { src: '/audio/clip.mp3', start: 0, duration: 5, volume: 1, speed: 1.5 },
      ],
    };
    const result = buildAudioMix(audio, 10);

    expect(result.filterComplex).toContain('atempo=1.5');
  });

  it('skips volume filter when volume is 1', () => {
    const audio: IRAudioMix = {
      clips: [
        { src: '/audio/clip.mp3', start: 2, duration: 5, volume: 1 },
      ],
    };
    const result = buildAudioMix(audio, 10);

    const filterParts = result.filterComplex.split(';');
    const clipFilter = filterParts[0];
    expect(clipFilter).not.toContain('volume=');
    expect(clipFilter).toContain('adelay=2000|2000');
  });
});

// ============================================================
// encode (mocked spawn)
// ============================================================

describe('encode', () => {
  it('calls ffmpeg with correct args and resolves output path on success', async () => {
    setupSpawnMock(0);

    const opts = makeOpts();
    const result = await encode(opts);

    expect(spawn).toHaveBeenCalledWith(
      'ffmpeg',
      expect.arrayContaining(['-c:v', 'libx264']),
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
    );
    expect(result).toBe('/tmp/output.mp4');
  });

  it('rejects with error when ffmpeg exits with non-zero code', async () => {
    setupSpawnMock(1, 'encoding error');

    const opts = makeOpts();
    await expect(encode(opts)).rejects.toThrow(/FFmpeg exited with code 1/);
  });

  it('rejects when spawn emits error', async () => {
    setupSpawnMock(0, undefined, new Error('spawn ENOENT'));

    const opts = makeOpts();
    await expect(encode(opts)).rejects.toThrow('spawn ENOENT');
  });
});

// ============================================================
// Hardware encoding (codec override)
// ============================================================

describe('buildFFmpegArgs with hardware codecs', () => {
  it('uses h264_nvenc with -cq quality flag', () => {
    const args = buildFFmpegArgs(makeOpts(), 'h264_nvenc');
    expect(args).toContain('h264_nvenc');
    expect(args).toContain('-cq');
    expect(args).not.toContain('-crf');
    expect(args).toContain('-preset');
    expect(args[args.indexOf('-preset') + 1]).toBe('p4');
  });

  it('uses h264_videotoolbox with -q:v quality flag and no preset', () => {
    const args = buildFFmpegArgs(makeOpts(), 'h264_videotoolbox');
    expect(args).toContain('h264_videotoolbox');
    expect(args).toContain('-q:v');
    expect(args).not.toContain('-crf');
    expect(args).not.toContain('-preset');
  });

  it('uses h264_qsv with -global_quality flag', () => {
    const args = buildFFmpegArgs(makeOpts(), 'h264_qsv');
    expect(args).toContain('h264_qsv');
    expect(args).toContain('-global_quality');
  });

  it('nvenc maps quality levels correctly', () => {
    const cases: Array<[string, string]> = [
      ['verylow', '35'],
      ['low', '28'],
      ['medium', '23'],
      ['high', '18'],
      ['veryhigh', '15'],
    ];
    for (const [quality, expectedCq] of cases) {
      const args = buildFFmpegArgs(
        makeOpts({
          output: { width: 1920, height: 1080, fps: 25, format: 'mp4', quality },
        }),
        'h264_nvenc',
      );
      const cqIdx = args.indexOf('-cq');
      expect(args[cqIdx + 1]).toBe(expectedCq);
    }
  });

  it('hardware codec works with audio mixing', () => {
    const audio: IRAudioMix = {
      clips: [{ src: '/audio/clip.mp3', start: 0, duration: 5, volume: 1 }],
    };
    const args = buildFFmpegArgs(
      makeOpts({ audio }),
      'h264_nvenc',
    );
    expect(args).toContain('h264_nvenc');
    expect(args).toContain('-cq');
    expect(args).toContain('-c:a');
    expect(args).toContain('aac');
    expect(args).toContain('-t');
    expect(args).not.toContain('-shortest');
  });
});

describe('hwaccel detection', () => {
  it('resolveCodec returns libx264 for explicit libx264', async () => {
    const { resolveCodec } = await import('../../../src/render/encoder/hwaccel.js');
    expect(resolveCodec('libx264')).toBe('libx264');
  });

  it('resolveCodec returns libx264 for unknown codec', async () => {
    const { resolveCodec } = await import('../../../src/render/encoder/hwaccel.js');
    expect(resolveCodec('invalid_codec')).toBe('libx264');
  });

  it('getQualityArgs returns correct flag for each codec', async () => {
    const { getQualityArgs } = await import('../../../src/render/encoder/hwaccel.js');
    expect(getQualityArgs('medium', 'libx264')[0]).toBe('-crf');
    expect(getQualityArgs('medium', 'h264_nvenc')[0]).toBe('-cq');
    expect(getQualityArgs('medium', 'h264_videotoolbox')[0]).toBe('-q:v');
    expect(getQualityArgs('medium', 'h264_qsv')[0]).toBe('-global_quality');
  });

  it('getPresetArgs returns empty array for videotoolbox', async () => {
    const { getPresetArgs } = await import('../../../src/render/encoder/hwaccel.js');
    expect(getPresetArgs('h264_videotoolbox')).toEqual([]);
    expect(getPresetArgs('h264_nvenc')).toEqual(['-preset', 'p4']);
  });

  it('getQualityArgs overrides CRF when crfOverride is set for libx264', async () => {
    const { getQualityArgs } = await import('../../../src/render/encoder/hwaccel.js');
    // CRF override should replace the quality-mapped value for libx264
    expect(getQualityArgs('medium', 'libx264', 18)).toEqual(['-crf', '18']);
    expect(getQualityArgs('low', 'libx264', 18)).toEqual(['-crf', '18']);
    expect(getQualityArgs('veryhigh', 'libx264', 18)).toEqual(['-crf', '18']);
  });

  it('getQualityArgs does NOT override non-CRF codecs even with crfOverride', async () => {
    const { getQualityArgs } = await import('../../../src/render/encoder/hwaccel.js');
    // h264_nvenc uses -cq, not -crf — override should NOT apply
    expect(getQualityArgs('medium', 'h264_nvenc', 18)).toEqual(['-cq', '23']);
    // h264_videotoolbox uses -q:v — override should NOT apply
    expect(getQualityArgs('medium', 'h264_videotoolbox', 18)).toEqual(['-q:v', '40']);
  });

  it('getQualityArgs ignores crfOverride when undefined', async () => {
    const { getQualityArgs } = await import('../../../src/render/encoder/hwaccel.js');
    expect(getQualityArgs('medium', 'libx264', undefined)).toEqual(['-crf', '23']);
    expect(getQualityArgs('high', 'libx264', undefined)).toEqual(['-crf', '18']);
  });
});
