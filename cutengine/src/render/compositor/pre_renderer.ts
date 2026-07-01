// HTML caption pre-renderer for the FFmpeg compositor.
// Converts HTML caption layers to full-frame transparent PNGs via Puppeteer one-shot screenshots.
// Each PNG is rendered at the exact output resolution with CSS positioning preserved.
//
// Called at build-time (before FFmpeg), not per-frame. One screenshot per caption.

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { IRTimeline, IRLayer } from '../parser/types.js';
import { acquirePage, releasePage } from '../capture/browser-pool.js';
import { extractFontFamilies, ensureFonts } from './font_resolver.js';
import type { PreRenderCache } from './cache_manager.js';

// ---- Types ----

export interface HtmlLayerInfo {
  sceneIndex: number;
  layerIndex: number;
  html: string;
  css: string;
  width: number;
  height: number;
  /** Absolute start time in the timeline (seconds) */
  timing: { start: number; duration: number };
}

export interface PreRenderResult {
  /** Path to the full-frame transparent PNG */
  pngPath: string;
  sceneIndex: number;
  layerIndex: number;
  /** Absolute timing for FFmpeg enable=between() filter */
  timing: { start: number; duration: number };
}

// ---- Core API ----

/**
 * Scan IR timeline and collect all HTML-type visual layers with absolute timing.
 *
 * IR parser (resolve-timing.ts) stores timing.start as timeline-absolute values
 * (not scene-relative), so we use layer.timing.start directly.
 */
export function collectHtmlLayers(ir: IRTimeline): HtmlLayerInfo[] {
  const layers: HtmlLayerInfo[] = [];
  const { width, height } = ir.output;

  for (let si = 0; si < ir.scenes.length; si++) {
    const scene = ir.scenes[si];
    for (let li = 0; li < scene.layers.length; li++) {
      const layer = scene.layers[li];
      if (layer.type !== 'visual') continue;
      if (layer.asset.type !== 'html') continue;

      const html = layer.asset.html ?? '';
      if (!html) continue;

      layers.push({
        sceneIndex: si,
        layerIndex: li,
        html,
        css: layer.asset.css ?? '',
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
 * Generate a full HTML page for transparent-background Puppeteer screenshot.
 *
 * Unlike the existing wrapInHtml() (builder/html-template.ts) which uses
 * `background: #000`, this sets `background: transparent` for alpha-channel PNGs.
 * Local @font-face CSS is injected alongside the Google Fonts CDN link (fallback).
 */
export function wrapInHtmlTransparent(
  html: string,
  css: string,
  width: number,
  height: number,
  fontFaceCss: string,
): string {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Noto+Sans:wght@400;600;700&family=Montserrat:wght@400;700;800&family=Open+Sans:wght@400;600;700&family=Lato:wght@400;700&family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
<style>
${fontFaceCss}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { width: ${width}px; height: ${height}px; overflow: hidden; background: transparent; }
${css}
</style>
</head><body>${html}</body></html>`;
}

/**
 * Batch pre-render all HTML layers to full-frame transparent PNGs.
 *
 * Returns empty array if no HTML layers found (no Puppeteer connection needed).
 * Uses a single Puppeteer page, reused sequentially for all captions.
 *
 * @param ir - Parsed timeline
 * @param workDir - Working directory for output PNGs
 * @param width - Output width (from ir.output.width)
 * @param height - Output height (from ir.output.height)
 * @returns Array of pre-rendered PNG results with timing info
 */
export async function preRenderHtmlLayers(
  ir: IRTimeline,
  workDir: string,
  width: number,
  height: number,
  cache?: PreRenderCache,
): Promise<PreRenderResult[]> {
  const htmlLayers = collectHtmlLayers(ir);
  if (htmlLayers.length === 0) return [];

  // Ensure output directory
  const preRenderDir = join(workDir, 'pre_render');
  if (!existsSync(preRenderDir)) {
    mkdirSync(preRenderDir, { recursive: true });
  }

  // Resolve fonts (local cache + @font-face CSS)
  const families = extractFontFamilies(htmlLayers);
  let fontFaceCss = '';
  try {
    fontFaceCss = await ensureFonts(families, workDir);
  } catch {
    // Font resolution failed — CDN link in HTML template serves as fallback
  }

  // Acquire a single Puppeteer page for all captions
  const page = await acquirePage(width, height);
  const results: PreRenderResult[] = [];

  try {
    for (const layer of htmlLayers) {
      const pngName = `caption_${layer.sceneIndex}_${layer.layerIndex}.png`;
      const pngPath = join(preRenderDir, pngName);

      // Cache check (Phase C) — skip Puppeteer if content unchanged
      if (cache) {
        const cacheContent = (layer.html ?? '') + (layer.css ?? '');
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
        layer.html,
        layer.css,
        layer.width,
        layer.height,
        fontFaceCss,
      );

      // Load HTML with timeout — fall back to domcontentloaded on timeout
      try {
        await page.setContent(fullHtml, {
          waitUntil: 'networkidle0',
          timeout: 5000,
        });
      } catch {
        // networkidle0 timed out (slow CDN) — retry with domcontentloaded
        await page.setContent(fullHtml, {
          waitUntil: 'domcontentloaded',
          timeout: 3000,
        });
      }

      // Wait for fonts to load (2s hard cap to prevent CDN stall)
      try {
        await page.waitForFunction(
          () => (document as any).fonts.ready.then(() => true),
          { timeout: 2000 },
        );
      } catch {
        // Font loading timed out — proceed with whatever fonts are available
      }

      // Screenshot with transparent background
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

      // Store in cache (Phase C)
      if (cache) {
        const cacheContent = (layer.html ?? '') + (layer.css ?? '');
        const key = cache.computeKey(cacheContent, layer.width, layer.height);
        cache.set(key, pngPath);
      }
    }
  } finally {
    await releasePage(page);
  }

  return results;
}
