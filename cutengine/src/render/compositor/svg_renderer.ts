// SVG pre-renderer for the FFmpeg compositor.
// Converts SVG layers to transparent PNGs before FFmpeg composition.
//
// Two SVG types:
// 1. External SVG file (layer.asset.src = .svg path) → Sharp resize + PNG export
// 2. Programmatic SVG (layer.asset.shapes array) → existing renderSvg() → Puppeteer screenshot
//
// Follows the same pattern as pre_renderer.ts (Phase B).

import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import type { IRTimeline } from '../parser/types.js';
import type { PreRenderResult, HtmlLayerInfo } from './pre_renderer.js';
import { wrapInHtmlTransparent } from './pre_renderer.js';
import { renderSvg } from '../assets/svg.js';
import { acquirePage, releasePage } from '../capture/browser-pool.js';
import type { PreRenderCache } from './cache_manager.js';

// ---- Types ----

export interface SvgLayerInfo {
  sceneIndex: number;
  layerIndex: number;
  /** External SVG file path (after prefetch) */
  src?: string;
  /** Programmatic shapes array */
  shapes?: any[];
  width: number;
  height: number;
  timing: { start: number; duration: number };
}

// ---- Core API ----

/**
 * Scan IR timeline and collect all SVG-type visual layers.
 */
export function collectSvgLayers(ir: IRTimeline): SvgLayerInfo[] {
  const layers: SvgLayerInfo[] = [];
  const { width, height } = ir.output;

  for (let si = 0; si < ir.scenes.length; si++) {
    const scene = ir.scenes[si];
    for (let li = 0; li < scene.layers.length; li++) {
      const layer = scene.layers[li];
      if (layer.type !== 'visual') continue;
      if (layer.asset.type !== 'svg') continue;

      layers.push({
        sceneIndex: si,
        layerIndex: li,
        src: layer.asset.src,
        shapes: layer.asset.shapes,
        width: layer.asset.width ?? width,
        height: layer.asset.height ?? height,
        timing: {
          start: layer.timing.start,
          duration: layer.timing.duration,
        },
      });
    }
  }

  return layers;
}

/**
 * Batch pre-render all SVG layers to transparent PNGs.
 * External SVGs use Sharp (fast, no browser needed).
 * Programmatic SVGs use Puppeteer (like HTML captions).
 *
 * Returns empty array if no SVG layers found.
 */
export async function preRenderSvgLayers(
  ir: IRTimeline,
  workDir: string,
  width: number,
  height: number,
  cache?: PreRenderCache,
): Promise<PreRenderResult[]> {
  const svgLayers = collectSvgLayers(ir);
  if (svgLayers.length === 0) return [];

  const preRenderDir = join(workDir, 'pre_render');
  if (!existsSync(preRenderDir)) {
    mkdirSync(preRenderDir, { recursive: true });
  }

  const results: PreRenderResult[] = [];
  const programmaticLayers: SvgLayerInfo[] = [];

  // Resolve prefetch directory for path validation
  const prefetchDir = resolve(join(workDir, 'prefetch'));

  // Pass 1: Handle external SVG files via Sharp
  for (const layer of svgLayers) {
    if (!layer.src || !layer.src.endsWith('.svg')) {
      programmaticLayers.push(layer);
      continue;
    }

    // S2: Path traversal guard — ensure SVG src is within prefetch directory
    const resolvedSrc = resolve(layer.src);
    if (!resolvedSrc.startsWith(prefetchDir) && !resolvedSrc.startsWith(preRenderDir)) {
      // SVG path outside expected directories — skip to prevent directory traversal
      continue;
    }

    const pngName = `svg_${layer.sceneIndex}_${layer.layerIndex}.png`;
    const pngPath = join(preRenderDir, pngName);

    // Read SVG content once (avoid triple-read on cache miss)
    let svgContent: string;
    try {
      svgContent = readFileSync(resolvedSrc, 'utf-8');
    } catch {
      // File not found or unreadable — skip
      continue;
    }

    // Check cache (reuse already-read svgContent)
    const cacheKey = cache?.computeKey(svgContent, layer.width, layer.height);
    if (cache && cacheKey) {
      const cached = cache.get(cacheKey);
      if (cached) {
        results.push({
          pngPath: cached,
          sceneIndex: layer.sceneIndex,
          layerIndex: layer.layerIndex,
          timing: { ...layer.timing },
        });
        continue;
      }
    }

    try {
      // Dynamic import to avoid hard dependency when Sharp isn't needed
      const sharp = (await import('sharp')).default;
      await sharp(Buffer.from(svgContent))
        .resize(layer.width, layer.height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(pngPath);

      results.push({
        pngPath,
        sceneIndex: layer.sceneIndex,
        layerIndex: layer.layerIndex,
        timing: { ...layer.timing },
      });

      // Store in cache
      if (cache && cacheKey) {
        cache.set(cacheKey, pngPath);
      }
    } catch {
      // Sharp conversion failed — skip this SVG layer
    }
  }

  // Pass 2: Handle programmatic SVGs via Puppeteer
  if (programmaticLayers.length > 0) {
    const page = await acquirePage(width, height);

    try {
      for (const layer of programmaticLayers) {
        const pngName = `svg_${layer.sceneIndex}_${layer.layerIndex}.png`;
        const pngPath = join(preRenderDir, pngName);

        // Sanitize shapes — strip any non-SVG properties that could inject scripts
        const sanitizedShapes = (layer.shapes ?? []).map((s: any) => {
          const { onclick, onload, onerror, onmouseover, ...safe } = s;
          // Strip any attribute starting with 'on' (event handlers)
          for (const key of Object.keys(safe)) {
            if (key.startsWith('on')) delete safe[key];
          }
          return safe;
        });

        // Build SVG HTML using existing renderer
        const mockLayer = {
          type: 'visual' as const,
          asset: { type: 'svg', shapes: sanitizedShapes },
          timing: { start: 0, duration: 1 },
          effects: {},
          position: { fit: 'contain' },
        };
        const rendered = renderSvg(mockLayer as any, layer.layerIndex);

        const cacheContent = JSON.stringify(sanitizedShapes);

        // Check cache
        if (cache) {
          const key = cache.computeKey(cacheContent, layer.width, layer.height);
          const cached = cache.get(key);
          if (cached) {
            results.push({
              pngPath: cached,
              sceneIndex: layer.sceneIndex,
              layerIndex: layer.layerIndex,
              timing: { ...layer.timing },
            });
            continue;
          }
        }

        const fullHtml = wrapInHtmlTransparent(
          rendered.html,
          rendered.css,
          layer.width,
          layer.height,
          '', // No custom fonts for SVG shapes
        );

        try {
          await page.setContent(fullHtml, { waitUntil: 'domcontentloaded', timeout: 3000 });
        } catch {
          // Content load timeout — skip
          continue;
        }

        await page.screenshot({
          type: 'png',
          omitBackground: true,
          path: pngPath,
        });

        results.push({
          pngPath,
          sceneIndex: layer.sceneIndex,
          layerIndex: layer.layerIndex,
          timing: { ...layer.timing },
        });

        // Store in cache
        if (cache) {
          const key = cache.computeKey(cacheContent, layer.width, layer.height);
          cache.set(key, pngPath);
        }
      }
    } finally {
      await releasePage(page);
    }
  }

  return results;
}
