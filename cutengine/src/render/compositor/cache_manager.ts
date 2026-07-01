// Content-addressable pre-render cache for HTML/SVG → PNG outputs.
// Cache key = SHA256(content + dimensions). Stored as PNGs in workDir/cache/.
// No TTL — cache lives as long as the workDir (per-render-job scope).
// Follows the same permanent-cache pattern as font_resolver.ts.

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join, resolve, relative } from 'path';

interface CacheIndex {
  [key: string]: string; // hash → relative PNG path
}

export class PreRenderCache {
  private readonly cacheDir: string;
  private readonly indexPath: string;
  private index: CacheIndex;
  private dirty = false;

  constructor(workDir: string) {
    this.cacheDir = join(workDir, 'cache');
    this.indexPath = join(this.cacheDir, 'cache_index.json');

    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }

    // Load existing index if present (e.g., resumed render)
    if (existsSync(this.indexPath)) {
      try {
        this.index = JSON.parse(readFileSync(this.indexPath, 'utf-8'));
      } catch {
        this.index = {};
      }
    } else {
      this.index = {};
    }
  }

  /**
   * Compute a deterministic cache key from content and output dimensions.
   * Uses SHA256 for collision resistance.
   */
  computeKey(content: string, width: number, height: number): string {
    return createHash('sha256')
      .update(`${width}x${height}:${content}`)
      .digest('hex');
  }

  /**
   * Look up a cached PNG by its content hash.
   * Returns the absolute PNG path if found and the file exists, null otherwise.
   */
  get(key: string): string | null {
    const relPath = this.index[key];
    if (!relPath) return null;

    // Validate path stays within cache directory (prevent traversal via crafted index)
    const absPath = resolve(this.cacheDir, relPath);
    if (!absPath.startsWith(this.cacheDir)) {
      delete this.index[key];
      this.dirty = true;
      return null;
    }

    if (!existsSync(absPath)) {
      // Stale entry — file was deleted
      delete this.index[key];
      this.dirty = true;
      return null;
    }

    return absPath;
  }

  /**
   * Store a rendered PNG in the cache.
   * Copies the PNG to the cache directory (original stays in pre_render/).
   */
  set(key: string, sourcePngPath: string): void {
    // Use full SHA256 hex for filename — 16-char truncation had 64-bit collision risk
    const fileName = `${key}.png`;
    const destPath = join(this.cacheDir, fileName);

    try {
      copyFileSync(sourcePngPath, destPath);
      this.index[key] = fileName;
      this.dirty = true;
    } catch {
      // Copy failed — skip caching this entry
    }
  }

  /**
   * Persist the cache index to disk.
   * Call once after all pre-rendering is complete.
   */
  flush(): void {
    if (!this.dirty) return;

    try {
      writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2), 'utf-8');
      this.dirty = false;
    } catch {
      // Index write failed — cache will rebuild next render
    }
  }

  /** Number of entries currently in the cache index */
  get size(): number {
    return Object.keys(this.index).length;
  }
}
