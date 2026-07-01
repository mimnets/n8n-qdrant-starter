// Google Fonts .woff2 local cache resolver.
// Downloads font files on first use, returns @font-face CSS for Puppeteer injection.
// Permanent cache — once downloaded, never re-fetched (per RENDERING-COMPARISON.md Phase B spec).

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { get as httpsGet } from 'https';
import type { HtmlLayerInfo } from './pre_renderer.js';

/** Default font families used in BOS pipeline */
const DEFAULT_FAMILIES = ['Montserrat'];

/** Weights to request from Google Fonts */
const FONT_WEIGHTS = [400, 700, 800];

/**
 * Extract unique font-family values from HTML layer inline styles.
 * Falls back to DEFAULT_FAMILIES if none found.
 */
export function extractFontFamilies(htmlLayers: HtmlLayerInfo[]): string[] {
  const families = new Set<string>();

  for (const layer of htmlLayers) {
    const html = layer.html ?? '';
    // Match font-family in inline style attributes (allow quotes inside value)
    const matches = html.matchAll(/font-family:\s*([^;]+?)(?:;|"|$)/gi);
    for (const m of matches) {
      // Take the first family in the list (before any comma fallback)
      const raw = m[1].trim().split(',')[0].trim();
      // Strip quotes
      const clean = raw.replace(/['"]/g, '');
      if (clean) families.add(clean);
    }
  }

  if (families.size === 0) {
    return [...DEFAULT_FAMILIES];
  }

  return [...families];
}

/**
 * Ensure font files are available locally. Downloads from Google Fonts API on first use.
 * Returns @font-face CSS block for Puppeteer page injection.
 *
 * @param families - Font family names (e.g., ['Montserrat', 'Inter'])
 * @param cacheDir - Directory to store font files (e.g., workDir/fonts/)
 * @returns @font-face CSS string, or empty string on failure (CDN fallback)
 */
export async function ensureFonts(
  families: string[],
  cacheDir: string,
): Promise<string> {
  const fontsDir = join(cacheDir, 'fonts');

  try {
    if (!existsSync(fontsDir)) {
      mkdirSync(fontsDir, { recursive: true });
    }
  } catch {
    return ''; // Can't create dir — fall back to CDN
  }

  const fontFaceBlocks: string[] = [];

  for (const family of families) {
    for (const weight of FONT_WEIGHTS) {
      const fileName = `${family.replace(/\s/g, '_')}-${weight}.woff2`;
      const filePath = join(fontsDir, fileName);

      if (existsSync(filePath)) {
        // Already cached — just build the @font-face block
        fontFaceBlocks.push(buildFontFace(family, weight, filePath));
        continue;
      }

      // Download from Google Fonts
      try {
        const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`;
        const css = await fetchText(cssUrl);
        const woff2Url = extractWoff2Url(css);

        if (woff2Url) {
          const fontData = await fetchBinary(woff2Url);
          writeFileSync(filePath, fontData);
          fontFaceBlocks.push(buildFontFace(family, weight, filePath));
        }
      } catch {
        // Network failure — skip this font/weight, CDN fallback will handle it
      }
    }
  }

  return fontFaceBlocks.join('\n');
}

function buildFontFace(family: string, weight: number, filePath: string): string {
  return `@font-face {
  font-family: '${family}';
  font-weight: ${weight};
  font-style: normal;
  src: url('file://${filePath}') format('woff2');
}`;
}

/**
 * Extract the first .woff2 URL from Google Fonts CSS response.
 * Google Fonts CSS2 API returns woff2 format for modern User-Agents.
 */
export function extractWoff2Url(css: string): string | null {
  // Match src: url(...) format('woff2')
  const match = css.match(/src:\s*url\(([^)]+)\)\s*format\(['"]woff2['"]\)/);
  if (match) return match[1];

  // Fallback: any url() pointing to a woff2 file
  const fallback = css.match(/url\((https?:\/\/[^)]+\.woff2[^)]*)\)/);
  return fallback ? fallback[1] : null;
}

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(url, {
      headers: {
        // Modern UA to get woff2 response (not ttf)
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      timeout: 5000,
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function fetchBinary(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(url, { timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}
