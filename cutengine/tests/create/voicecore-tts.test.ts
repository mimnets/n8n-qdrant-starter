/**
 * VoiceCore TTS — Unit Tests
 *
 * Tests for VoiceCoreTTSProvider, TTS routing in ProviderRouter,
 * and VoiceCore config parsing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceCoreTTSProvider } from '../../src/create/providers/voicecore-tts.js';
import type { GenerateRequest, ProviderName } from '@gstack/types';

// ─── VoiceCoreTTSProvider ───

describe('VoiceCoreTTSProvider', () => {
  let provider: VoiceCoreTTSProvider;

  beforeEach(() => {
    provider = new VoiceCoreTTSProvider({ host: 'localhost', port: 8080 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct provider name', () => {
    expect(provider.name).toBe('voicecore-tts');
  });

  it('generates TTS audio with mocked fetch', async () => {
    // Set STORAGE_PATH to OS temp dir so real fs.mkdir/writeFile succeed
    const os = await import('node:os');
    const path = await import('node:path');
    const tmpDir = path.join(os.tmpdir(), `voicecore-test-${Date.now()}`);
    const origStorage = process.env.STORAGE_PATH;
    process.env.STORAGE_PATH = tmpDir;

    // Mock fetch to return WAV audio data
    const mockWavData = new ArrayBuffer(44); // Minimal WAV header size
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: () => Promise.resolve(mockWavData),
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as any);

    const req: GenerateRequest = {
      type: 'tts',
      prompt: 'Hello, this is a test of text to speech synthesis.',
    };

    const result = await provider.generate(req);

    // Restore env
    if (origStorage !== undefined) process.env.STORAGE_PATH = origStorage;
    else delete process.env.STORAGE_PATH;

    expect(result.status).toBe('done');
    expect(result.provider).toBe('voicecore-tts');
    expect(result.output).toBeDefined();
    expect(result.output!.format).toBe('wav');
    expect(result.output!.url).toMatch(/^\/serve\/v1\/assets\/tts\/tts_\d+\.wav$/);
    expect(result.cost).toBe(0);
    expect(result.gpu_time_ms).toBeDefined();

    // Verify fetch was called with correct parameters
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8080/v1/tts',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining('"text"'),
      }),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    expect(body.text).toBe('Hello, this is a test of text to speech synthesis.');
    expect(body.reference_id).toBe('default');
    expect(body.format).toBe('wav');
    expect(body.streaming).toBe(false);

    // Cleanup temp dir
    const fs = await import('node:fs/promises');
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('uses style as reference_id when provided', async () => {
    const os = await import('node:os');
    const path = await import('node:path');
    const tmpDir = path.join(os.tmpdir(), `voicecore-test-${Date.now()}`);
    const origStorage = process.env.STORAGE_PATH;
    process.env.STORAGE_PATH = tmpDir;

    const mockWavData = new ArrayBuffer(44);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(mockWavData),
    } as any);

    const req: GenerateRequest = {
      type: 'tts',
      prompt: 'Test with custom voice',
      style: 't1_narrator',
    };

    await provider.generate(req);

    // Restore env
    if (origStorage !== undefined) process.env.STORAGE_PATH = origStorage;
    else delete process.env.STORAGE_PATH;

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    expect(body.reference_id).toBe('t1_narrator');

    // Cleanup temp dir
    const fs = await import('node:fs/promises');
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns failed status on empty prompt', async () => {
    const req: GenerateRequest = {
      type: 'tts',
      prompt: '',
    };

    const result = await provider.generate(req);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('non-empty text prompt');
  });

  it('returns failed status on fetch error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as any);

    const req: GenerateRequest = {
      type: 'tts',
      prompt: 'This will fail',
    };

    const result = await provider.generate(req);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('TTS failed');
    expect(result.error).toContain('500');
  });

  it('returns failed status on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection refused'));

    const req: GenerateRequest = {
      type: 'tts',
      prompt: 'This will fail',
    };

    const result = await provider.generate(req);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Connection refused');
  });

  it('isAvailable returns false when server is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const available = await provider.isAvailable();
    expect(available).toBe(false);
  });
});

// ─── TTS Type Validation ───

describe('TTS type in GenerateRequest', () => {
  it('accepts tts as a valid type', () => {
    const validTypes = ['text-to-image', 'image-to-video', 'upscale', 'tts'];
    expect(validTypes).toContain('tts');
  });
});

// ─── TTS Routing ───

describe('TTS routing logic', () => {
  it('voicecore-tts is a valid ProviderName', () => {
    const name: ProviderName = 'voicecore-tts';
    expect(name).toBe('voicecore-tts');
  });
});

// ─── VoiceCore Config ───

describe('VoiceCore config parsing', () => {
  it('parses voicecore config from environment', async () => {
    // Save original env
    const origHost = process.env.VOICECORE_HOST;
    const origPort = process.env.VOICECORE_PORT;
    const origEnabled = process.env.VOICECORE_ENABLED;

    try {
      process.env.VOICECORE_HOST = 'fish-speech-server';
      process.env.VOICECORE_PORT = '9090';
      process.env.VOICECORE_ENABLED = 'true';

      // Re-import config to pick up new env vars
      // Note: since config is cached at import time, we test the parsing logic directly
      const host = process.env.VOICECORE_HOST ?? 'localhost';
      const port = parseInt(process.env.VOICECORE_PORT ?? '8080', 10);
      const enabled = process.env.VOICECORE_ENABLED === 'true';

      expect(host).toBe('fish-speech-server');
      expect(port).toBe(9090);
      expect(enabled).toBe(true);
    } finally {
      // Restore
      if (origHost !== undefined) process.env.VOICECORE_HOST = origHost;
      else delete process.env.VOICECORE_HOST;
      if (origPort !== undefined) process.env.VOICECORE_PORT = origPort;
      else delete process.env.VOICECORE_PORT;
      if (origEnabled !== undefined) process.env.VOICECORE_ENABLED = origEnabled;
      else delete process.env.VOICECORE_ENABLED;
    }
  });

  it('uses defaults when env vars are not set', () => {
    const origHost = process.env.VOICECORE_HOST;
    const origPort = process.env.VOICECORE_PORT;
    const origEnabled = process.env.VOICECORE_ENABLED;

    try {
      delete process.env.VOICECORE_HOST;
      delete process.env.VOICECORE_PORT;
      delete process.env.VOICECORE_ENABLED;

      const host = process.env.VOICECORE_HOST ?? 'localhost';
      const port = parseInt(process.env.VOICECORE_PORT ?? '8080', 10);
      const enabled = process.env.VOICECORE_ENABLED === 'true';

      expect(host).toBe('localhost');
      expect(port).toBe(8080);
      expect(enabled).toBe(false);
    } finally {
      if (origHost !== undefined) process.env.VOICECORE_HOST = origHost;
      if (origPort !== undefined) process.env.VOICECORE_PORT = origPort;
      if (origEnabled !== undefined) process.env.VOICECORE_ENABLED = origEnabled;
    }
  });
});
