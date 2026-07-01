/**
 * Ecosystem Integration Tests — ProfileCore + CubeInsight
 *
 * Tests for ProfileCoreProvider, CubeInsightProvider,
 * and config parsing for both services.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProfileCoreProvider } from '../../src/create/providers/profilecore.js';
import { CubeInsightProvider } from '../../src/create/providers/cubeinsight.js';

// ─── ProfileCoreProvider ───

describe('ProfileCoreProvider', () => {
  let provider: ProfileCoreProvider;

  beforeEach(() => {
    provider = new ProfileCoreProvider({
      host: 'localhost',
      port: 3001,
      mode: 'http',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct provider name', () => {
    expect(provider.name).toBe('profilecore');
  });

  it('launches a profile via HTTP', async () => {
    const mockResult = { sessionId: 'profile-1', status: 'launched' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResult),
    } as any);

    const result = await provider.launchProfile('profile-1');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://localhost:3001/api/launch');
    expect(opts?.method).toBe('POST');
    const body = JSON.parse(opts?.body as string);
    expect(body.profileId).toBe('profile-1');
    expect(body.url).toBe('https://studio.youtube.com');
    expect(result).toEqual(mockResult);
  });

  it('launches a profile with custom URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sessionId: 'p2', status: 'launched' }),
    } as any);

    await provider.launchProfile('p2', 'https://youtube.com');

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.url).toBe('https://youtube.com');
  });

  it('throws on HTTP launch error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      statusText: 'Service Unavailable',
    } as any);

    await expect(provider.launchProfile('bad')).rejects.toThrow('ProfileCore launch error');
  });

  it('closes a profile via HTTP', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
    } as any);

    await provider.closeProfile('profile-1');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://localhost:3001/api/close');
    expect(opts?.method).toBe('POST');
    const body = JSON.parse(opts?.body as string);
    expect(body.profileId).toBe('profile-1');
  });

  it('throws on HTTP close error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      statusText: 'Not Found',
    } as any);

    await expect(provider.closeProfile('bad')).rejects.toThrow('ProfileCore close error');
  });

  it('gets health status via HTTP', async () => {
    const mockHealth = { profiles: 10, healthy: 8 };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockHealth),
    } as any);

    const result = await provider.getHealth();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('http://localhost:3001/api/health');
    expect(result).toEqual(mockHealth);
  });

  it('gets health with tier filter', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ tier: 'gold' }),
    } as any);

    await provider.getHealth('gold');
    expect(fetchSpy.mock.calls[0][0]).toBe('http://localhost:3001/api/health?tier=gold');
  });

  it('returns CLI-mode health when mode is cli', async () => {
    const cliProvider = new ProfileCoreProvider({
      host: 'localhost',
      port: 3001,
      mode: 'cli',
    });

    const result = await cliProvider.getHealth();
    expect(result.status).toBe('cli-mode');
  });

  it('lists profiles via HTTP', async () => {
    const mockList = [{ id: 'p1' }, { id: 'p2' }];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockList),
    } as any);

    const result = await provider.listProfiles();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('http://localhost:3001/api/list');
    expect(result).toEqual(mockList);
  });

  it('lists profiles with tier filter', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    } as any);

    await provider.listProfiles('silver');
    expect(fetchSpy.mock.calls[0][0]).toBe('http://localhost:3001/api/list?tier=silver');
  });

  it('returns empty array in CLI mode for listProfiles', async () => {
    const cliProvider = new ProfileCoreProvider({
      host: 'localhost',
      port: 3001,
      mode: 'cli',
    });

    const result = await cliProvider.listProfiles();
    expect(result).toEqual([]);
  });
});

// ─── CubeInsightProvider ───

describe('CubeInsightProvider', () => {
  let provider: CubeInsightProvider;

  beforeEach(() => {
    provider = new CubeInsightProvider({
      host: 'localhost',
      port: 8000,
      apiKey: 'test-key',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct provider name', () => {
    expect(provider.name).toBe('cubeinsight');
  });

  it('fetches trending topics', async () => {
    const mockTopics = [{ topic: 'AI', score: 95 }, { topic: 'Gaming', score: 87 }];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockTopics),
    } as any);

    const result = await provider.getTrendingTopics('tech', 'US', 5);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('/api/b2b/trend-topics');
    expect(url).toContain('tier=tech');
    expect(url).toContain('region_code=US');
    expect(url).toContain('limit=5');
    // Check API key header
    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['X-API-KEY']).toBe('test-key');
    expect(result).toEqual(mockTopics);
  });

  it('uses default region and limit', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    } as any);

    await provider.getTrendingTopics('gaming');

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('region_code=US');
    expect(url).toContain('limit=10');
  });

  it('throws on trending topics API error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      statusText: 'Internal Server Error',
    } as any);

    await expect(provider.getTrendingTopics('tech')).rejects.toThrow('CubeInsight API error');
  });

  it('analyzes video sentiment', async () => {
    const mockSentiment = { positive: 0.7, negative: 0.1, neutral: 0.2 };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSentiment),
    } as any);

    const result = await provider.analyzeVideo('dQw4w9WgXcQ');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('/api/analyze_video');
    expect(url).toContain('video_id=dQw4w9WgXcQ');
    expect(result).toEqual(mockSentiment);
  });

  it('throws on sentiment analysis error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      statusText: 'Not Found',
    } as any);

    await expect(provider.analyzeVideo('bad-id')).rejects.toThrow('CubeInsight analysis error');
  });

  it('searches channels', async () => {
    const mockChannels = [{ name: 'TechChannel', subs: 1000000 }];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockChannels),
    } as any);

    const result = await provider.searchChannels('tech reviews');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('/api/search');
    expect(url).toContain('q=tech%20reviews');
    expect(result).toEqual(mockChannels);
  });

  it('throws on channel search error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      statusText: 'Bad Request',
    } as any);

    await expect(provider.searchChannels('')).rejects.toThrow('CubeInsight search error');
  });

  it('works without apiKey', async () => {
    const noKeyProvider = new CubeInsightProvider({
      host: 'localhost',
      port: 8000,
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    } as any);

    await noKeyProvider.getTrendingTopics('test');

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['X-API-KEY']).toBeUndefined();
  });
});

// ─── Config parsing ───

describe('Ecosystem config parsing', () => {
  it('parses profilecore config from environment', async () => {
    // The config module reads env at import time, so we test the shape
    const { config } = await import('../../src/config/index.js');

    expect(config.profilecore).toBeDefined();
    expect(typeof config.profilecore.enabled).toBe('boolean');
    expect(typeof config.profilecore.host).toBe('string');
    expect(typeof config.profilecore.port).toBe('number');
    expect(['http', 'cli']).toContain(config.profilecore.mode);
  });

  it('parses cubeinsight config from environment', async () => {
    const { config } = await import('../../src/config/index.js');

    expect(config.cubeinsight).toBeDefined();
    expect(typeof config.cubeinsight.enabled).toBe('boolean');
    expect(typeof config.cubeinsight.host).toBe('string');
    expect(typeof config.cubeinsight.port).toBe('number');
  });

  it('profilecore is disabled by default', async () => {
    const { config } = await import('../../src/config/index.js');
    expect(config.profilecore.enabled).toBe(false);
  });

  it('cubeinsight is disabled by default', async () => {
    const { config } = await import('../../src/config/index.js');
    expect(config.cubeinsight.enabled).toBe(false);
  });

  it('profilecore defaults to http mode on localhost:3001', async () => {
    const { config } = await import('../../src/config/index.js');
    expect(config.profilecore.host).toBe('localhost');
    expect(config.profilecore.port).toBe(3001);
    expect(config.profilecore.mode).toBe('http');
  });

  it('cubeinsight defaults to localhost:8000', async () => {
    const { config } = await import('../../src/config/index.js');
    expect(config.cubeinsight.host).toBe('localhost');
    expect(config.cubeinsight.port).toBe(8000);
  });
});
