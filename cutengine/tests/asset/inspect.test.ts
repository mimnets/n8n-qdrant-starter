import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseFFProbeOutput, type MediaMetadata } from '../../src/asset/inspect.js';
import { createServer } from '../../src/server.js';

describe('parseFFProbeOutput', () => {
  it('extracts video metadata from ffprobe output', () => {
    const ffprobeOutput = {
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1920,
          height: 1080,
          r_frame_rate: '25/1',
        },
        {
          codec_type: 'audio',
          codec_name: 'aac',
          sample_rate: '44100',
          channels: 2,
        },
      ],
      format: {
        format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
        duration: '120.500000',
        size: '75000000',
        bit_rate: '5000000',
      },
    };

    const result = parseFFProbeOutput(ffprobeOutput);

    expect(result).toEqual({
      width: 1920,
      height: 1080,
      fps: 25,
      duration: 120.5,
      codec: 'h264',
      format: 'mp4',
      bitrate: 5000000,
      size: 75000000,
      audioCodec: 'aac',
      audioSampleRate: 44100,
      audioChannels: 2,
    });
  });

  it('handles fractional frame rates (e.g. 30000/1001)', () => {
    const ffprobeOutput = {
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1280,
          height: 720,
          r_frame_rate: '30000/1001',
        },
      ],
      format: {
        format_name: 'mp4',
        duration: '60.0',
        size: '10000000',
        bit_rate: '1333333',
      },
    };

    const result = parseFFProbeOutput(ffprobeOutput);
    expect(result.fps).toBeCloseTo(29.97, 1);
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
  });

  it('handles audio-only files', () => {
    const ffprobeOutput = {
      streams: [
        {
          codec_type: 'audio',
          codec_name: 'mp3',
          sample_rate: '48000',
          channels: 1,
        },
      ],
      format: {
        format_name: 'mp3',
        duration: '180.0',
        size: '4320000',
        bit_rate: '192000',
      },
    };

    const result = parseFFProbeOutput(ffprobeOutput);

    expect(result.width).toBeUndefined();
    expect(result.height).toBeUndefined();
    expect(result.codec).toBeUndefined();
    expect(result.fps).toBeUndefined();
    expect(result.audioCodec).toBe('mp3');
    expect(result.audioSampleRate).toBe(48000);
    expect(result.audioChannels).toBe(1);
    expect(result.duration).toBe(180.0);
    expect(result.format).toBe('mp3');
  });

  it('handles video without audio', () => {
    const ffprobeOutput = {
      streams: [
        {
          codec_type: 'video',
          codec_name: 'vp9',
          width: 3840,
          height: 2160,
          r_frame_rate: '60/1',
        },
      ],
      format: {
        format_name: 'webm',
        duration: '30.0',
        size: '50000000',
        bit_rate: '13333333',
      },
    };

    const result = parseFFProbeOutput(ffprobeOutput);

    expect(result.codec).toBe('vp9');
    expect(result.format).toBe('webm');
    expect(result.audioCodec).toBeUndefined();
    expect(result.audioSampleRate).toBeUndefined();
    expect(result.audioChannels).toBeUndefined();
  });

  it('handles empty streams and format', () => {
    const ffprobeOutput = {
      streams: [],
      format: {},
    };

    const result = parseFFProbeOutput(ffprobeOutput);

    expect(result).toEqual({});
  });
});

describe('GET /edit/v1/inspect', () => {
  let app: Awaited<ReturnType<typeof createServer>>;

  beforeEach(async () => {
    app = await createServer({ testing: true });
  });

  it('returns 400 when url parameter is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/edit/v1/inspect',
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.message).toContain('url');
  });

  it('returns 400 when url parameter is empty', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/edit/v1/inspect?url=',
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
  });
});
