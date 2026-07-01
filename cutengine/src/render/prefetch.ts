import { createHash } from 'crypto';
import { mkdirSync, existsSync, createWriteStream } from 'fs';
import { join, extname, relative, resolve } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import type { IRExternalAsset } from './parser/types.js';
import { config } from '../config/index.js';

export interface PrefetchResult {
  /** Map from original URL to local file path */
  urlMap: Map<string, string>;
  /** Number of assets downloaded (cache misses) */
  downloaded: number;
  /** Number of assets already cached (skipped) */
  cached: number;
  /** URLs that failed to download */
  failed: string[];
}

function hashUrl(url: string): string {
  return createHash('md5').update(url).digest('hex').slice(0, 16);
}

function guessExt(url: string, contentType?: string): string {
  // Try from URL path first
  const urlExt = extname(new URL(url, 'https://dummy').pathname).slice(1);
  if (urlExt && urlExt.length <= 5) return urlExt;

  // Fall back to content-type
  if (contentType) {
    const mime = contentType.split(';')[0].trim();
    const map: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav',
      'audio/ogg': 'ogg',
      'font/woff2': 'woff2',
      'font/woff': 'woff',
      'font/ttf': 'ttf',
    };
    if (map[mime]) return map[mime];
  }

  return 'bin';
}

async function downloadFile(
  url: string,
  destPath: string,
  timeoutMs = 30000,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!res.body) throw new Error('No response body');

    const nodeStream = Readable.fromWeb(res.body as any);
    await pipeline(nodeStream, createWriteStream(destPath));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Download external assets to local disk before rendering.
 * Skips already-downloaded files (cache hit by URL hash).
 * Downloads in parallel with concurrency limit.
 */
export async function prefetchAssets(
  assets: IRExternalAsset[],
  prefetchDir: string,
  opts?: { concurrency?: number; timeoutMs?: number; fetchFn?: typeof fetch },
): Promise<PrefetchResult> {
  mkdirSync(prefetchDir, { recursive: true });

  const concurrency = opts?.concurrency ?? 4;
  const timeoutMs = opts?.timeoutMs ?? 30000;
  const fetchFn = opts?.fetchFn ?? fetch;

  // Deduplicate by URL
  const uniqueUrls = [...new Set(assets.map(a => a.url))];

  const urlMap = new Map<string, string>();
  let downloaded = 0;
  let cached = 0;
  const failed: string[] = [];

  // Process with concurrency limit
  let idx = 0;

  async function worker(): Promise<void> {
    while (idx < uniqueUrls.length) {
      const url = uniqueUrls[idx++];
      const hash = hashUrl(url);

      // Check if already downloaded (any extension)
      const existingPattern = join(prefetchDir, `${hash}.*`);
      // Simple check: try common extensions
      let existingPath: string | null = null;
      for (const ext of ['jpg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mp3', 'wav', 'ogg', 'woff2', 'woff', 'ttf', 'bin']) {
        const candidate = join(prefetchDir, `${hash}.${ext}`);
        if (existsSync(candidate)) {
          existingPath = candidate;
          break;
        }
      }

      if (existingPath) {
        urlMap.set(url, existingPath);
        cached++;
        continue;
      }

      try {
        // Do a HEAD-like fetch to get content-type, then download
        const ext = guessExt(url);
        const destPath = join(prefetchDir, `${hash}.${ext}`);
        await downloadFile(url, destPath, timeoutMs, fetchFn);
        urlMap.set(url, destPath);
        downloaded++;
      } catch {
        failed.push(url);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, uniqueUrls.length) }, () => worker());
  await Promise.all(workers);

  return { urlMap, downloaded, cached, failed };
}

/**
 * Replace external URLs in IR assets with local paths from prefetch result.
 * Mutates the assets array in place.
 */
export function applyPrefetchPaths(assets: IRExternalAsset[], urlMap: Map<string, string>): void {
  for (const asset of assets) {
    const localPath = urlMap.get(asset.url);
    if (localPath) {
      asset.localPath = localPath;
    }
  }
}

/**
 * Convert a local file path to a URL accessible by Docker Chromium.
 * Uses CHROMIUM_ASSET_BASE env var if set, otherwise derives from
 * host.docker.internal + server port + static serve prefix.
 */
export function resolveAssetUrl(localPath: string): string {
  if (config.chromium.assetBaseUrl) {
    const relPath = relative(resolve(config.storage.path), localPath);
    return `${config.chromium.assetBaseUrl}/${relPath}`;
  }
  const relPath = relative(resolve(config.storage.path), localPath);
  return `http://host.docker.internal:${config.port}/serve/v1/assets/${relPath}`;
}
