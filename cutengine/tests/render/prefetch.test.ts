import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdirSync } from 'fs';
import type { IRExternalAsset } from '../../src/render/parser/types.js';

// Mock fs
vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  createWriteStream: vi.fn().mockReturnValue({
    on: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    once: vi.fn(),
    emit: vi.fn(),
  }),
}));

// Mock stream/promises pipeline
vi.mock('stream/promises', () => ({
  pipeline: vi.fn().mockResolvedValue(undefined),
}));

// Mock stream Readable
vi.mock('stream', () => ({
  Readable: {
    fromWeb: vi.fn().mockReturnValue({ pipe: vi.fn() }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('prefetchAssets', () => {
  it('downloads assets and returns url map', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: { getReader: vi.fn() },
      headers: new Map([['content-type', 'image/png']]),
    });

    const { prefetchAssets } = await import('../../src/render/prefetch.js');

    const assets: IRExternalAsset[] = [
      { url: 'https://example.com/image1.png', type: 'image' },
      { url: 'https://example.com/image2.jpg', type: 'image' },
    ];

    const result = await prefetchAssets(assets, '/tmp/prefetch', { fetchFn: mockFetch as any });

    expect(result.downloaded).toBe(2);
    expect(result.cached).toBe(0);
    expect(result.failed.length).toBe(0);
    expect(result.urlMap.size).toBe(2);
    expect(result.urlMap.has('https://example.com/image1.png')).toBe(true);
    expect(result.urlMap.has('https://example.com/image2.jpg')).toBe(true);
  });

  it('deduplicates same URLs', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: vi.fn() },
    });

    const { prefetchAssets } = await import('../../src/render/prefetch.js');

    const assets: IRExternalAsset[] = [
      { url: 'https://example.com/same.png', type: 'image' },
      { url: 'https://example.com/same.png', type: 'image' },
      { url: 'https://example.com/same.png', type: 'image' },
    ];

    const result = await prefetchAssets(assets, '/tmp/prefetch', { fetchFn: mockFetch as any });

    expect(result.downloaded).toBe(1);
    expect(result.urlMap.size).toBe(1);
    // Only one fetch call for deduplicated URL
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('records failed downloads without throwing', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('network error'));

    const { prefetchAssets } = await import('../../src/render/prefetch.js');

    const assets: IRExternalAsset[] = [
      { url: 'https://example.com/broken.png', type: 'image' },
    ];

    const result = await prefetchAssets(assets, '/tmp/prefetch', { fetchFn: mockFetch as any });

    expect(result.downloaded).toBe(0);
    expect(result.failed).toContain('https://example.com/broken.png');
  });

  it('skips already-cached files', async () => {
    const fs = await import('fs');
    const existsSyncMock = vi.mocked(fs.existsSync);
    existsSyncMock.mockImplementation((p: any) => {
      // Simulate cached file exists
      if (String(p).endsWith('.png')) return true;
      return false;
    });

    const mockFetch = vi.fn();

    const { prefetchAssets } = await import('../../src/render/prefetch.js');

    const assets: IRExternalAsset[] = [
      { url: 'https://example.com/cached.png', type: 'image' },
    ];

    const result = await prefetchAssets(assets, '/tmp/prefetch', { fetchFn: mockFetch as any });

    expect(result.cached).toBe(1);
    expect(result.downloaded).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();

    existsSyncMock.mockReturnValue(false);
  });

  it('returns empty result for no assets', async () => {
    const { prefetchAssets } = await import('../../src/render/prefetch.js');

    const result = await prefetchAssets([], '/tmp/prefetch');

    expect(result.downloaded).toBe(0);
    expect(result.cached).toBe(0);
    expect(result.urlMap.size).toBe(0);
  });
});

describe('applyPrefetchPaths', () => {
  it('sets localPath on assets from urlMap', async () => {
    const { applyPrefetchPaths } = await import('../../src/render/prefetch.js');

    const assets: IRExternalAsset[] = [
      { url: 'https://example.com/img.png', type: 'image' },
      { url: 'https://example.com/vid.mp4', type: 'video' },
    ];

    const urlMap = new Map([
      ['https://example.com/img.png', '/tmp/prefetch/abc123.png'],
      ['https://example.com/vid.mp4', '/tmp/prefetch/def456.mp4'],
    ]);

    applyPrefetchPaths(assets, urlMap);

    expect(assets[0].localPath).toBe('/tmp/prefetch/abc123.png');
    expect(assets[1].localPath).toBe('/tmp/prefetch/def456.mp4');
  });

  it('does not set localPath for missing URLs', async () => {
    const { applyPrefetchPaths } = await import('../../src/render/prefetch.js');

    const assets: IRExternalAsset[] = [
      { url: 'https://example.com/missing.png', type: 'image' },
    ];

    applyPrefetchPaths(assets, new Map());

    expect(assets[0].localPath).toBeUndefined();
  });
});
