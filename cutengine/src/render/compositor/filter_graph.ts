// Core filter_complex builder.
// Converts IRTimeline → FFmpeg filter_complex string for single-pass composition.
//
// Two-phase composition:
// Phase 1: Build per-track video streams (sequential clips with xfade transitions)
// Phase 2: Stack tracks via overlay (bottom-to-top z-index)

import type { IRTimeline, IRScene, IRLayer } from '../parser/types.js';
import type { FFmpegFilterChain } from './types.js';
import type { PreRenderResult } from './pre_renderer.js';
import {
  mapKenBurns,
  mapColorFilter,
  mapTransition,
  getFFmpegTransitionDuration,
} from './filters_ffmpeg.js';
import { canUseDrawtext, buildDrawtextFilter } from './text_renderer.js';

export interface FilterGraphResult {
  /** Complete filter_complex string */
  filterComplex: string;
  /** Final video output label */
  videoOutputLabel: string;
  /** drawtext filters to apply on top of composited video */
  textOverlays: string[];
}

/**
 * Build the FFmpeg filter_complex string from an IRTimeline.
 *
 * Strategy:
 * 1. Create a base canvas (black, full duration)
 * 2. Group visual layers by their original track (z-index order)
 * 3. For each track, chain clips sequentially using xfade for transitions
 * 4. Overlay tracks bottom-to-top onto the base canvas
 * 5. Collect text/drawtext overlays for final application
 */
export function buildFilterGraph(
  ir: IRTimeline,
  inputIndexMap: Map<string, number>,
  prefetchDir: string,
  preRendered?: PreRenderResult[],
  overlayInputMap?: Map<string, number>,
): FilterGraphResult {
  const { width, height, fps } = ir.output;
  const totalDuration = ir.scenes.reduce((sum, s) => sum + s.duration, 0);

  const chains: string[] = [];
  const textOverlays: string[] = [];
  let labelCounter = 0;

  const nextLabel = (prefix: string): string => `${prefix}${labelCounter++}`;

  // Separate layers into visual media (image/video) and text overlays
  const mediaLayers: IRLayer[] = [];
  const textLayers: IRLayer[] = [];

  for (const scene of ir.scenes) {
    for (const layer of scene.layers) {
      if (layer.type !== 'visual') continue;

      if (layer.asset.type === 'text' || layer.asset.type === 'caption') {
        if (canUseDrawtext(layer)) {
          textLayers.push(layer);
        }
        // HTML text that can't use drawtext is skipped in Phase A
        continue;
      }

      if (layer.asset.type === 'html' || layer.asset.type === 'svg') {
        // HTML/SVG overlays are pre-rendered to PNG and overlaid separately (Phase B/C)
        continue;
      }

      if (layer.asset.type === 'image' || layer.asset.type === 'video') {
        mediaLayers.push(layer);
      }
    }
  }

  // Build text drawtext filters
  for (const tl of textLayers) {
    const dt = buildDrawtextFilter(tl, width, height, prefetchDir);
    if (dt) textOverlays.push(dt);
  }

  if (mediaLayers.length === 0) {
    // No visual media — just a base canvas
    const baseLabel = `[${nextLabel('base')}]`;
    chains.push(`color=c=black:s=${width}x${height}:d=${totalDuration}:r=${fps}${baseLabel}`);
    return {
      filterComplex: chains.join(';\n'),
      videoOutputLabel: baseLabel,
      textOverlays,
    };
  }

  // Sort media layers by start time for sequential processing
  const sortedLayers = [...mediaLayers].sort((a, b) => a.timing.start - b.timing.start);

  // Phase 1: Process each clip individually
  const clipLabels: { label: string; start: number; duration: number; layer: IRLayer }[] = [];

  for (const layer of sortedLayers) {
    const src = layer.asset.src;
    if (!src) continue;

    const inputIdx = inputIndexMap.get(src);
    if (inputIdx === undefined) continue;

    const clipLabel = nextLabel('v');
    const filterParts: string[] = [];

    // Scale to output resolution (lanczos for sharper upscaling)
    filterParts.push(`scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos`);
    filterParts.push(`pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`);

    // Ken Burns motion effect
    if (layer.effects.motion) {
      const kb = mapKenBurns(layer.effects.motion, layer.timing.duration, width, height, fps);
      if (kb) {
        // For images with zoompan, replace scale+pad with zoompan
        // zoompan handles scaling internally
        filterParts.length = 0; // clear scale/pad
        filterParts.push(kb);
      }
    }

    // Color filter
    if (layer.effects.filter) {
      const cf = mapColorFilter(layer.effects.filter);
      if (cf) filterParts.push(cf);
    }

    // Trim to exact duration
    filterParts.push(`trim=duration=${layer.timing.duration}`);
    filterParts.push('setpts=PTS-STARTPTS');

    // Set frame rate
    filterParts.push(`fps=${fps}`);

    const inputLabel = `[${inputIdx}:v]`;
    const outputLabel = `[${clipLabel}]`;
    chains.push(`${inputLabel}${filterParts.join(',')}${outputLabel}`);

    clipLabels.push({
      label: clipLabel,
      start: layer.timing.start,
      duration: layer.timing.duration,
      layer,
    });
  }

  // Phase 2: Compose clips onto timeline
  if (clipLabels.length === 0) {
    const baseLabel = `[${nextLabel('base')}]`;
    chains.push(`color=c=black:s=${width}x${height}:d=${totalDuration}:r=${fps}${baseLabel}`);
    return {
      filterComplex: chains.join(';\n'),
      videoOutputLabel: baseLabel,
      textOverlays,
    };
  }

  // Check if clips are sequential (same track) and can use xfade
  // or if they overlap (multi-track) and need overlay
  const sequential = areSequential(clipLabels);

  let compositeLabel: string;

  if (sequential && clipLabels.length > 1) {
    // Sequential clips: chain with xfade transitions
    compositeLabel = buildSequentialChain(clipLabels, chains, nextLabel);
  } else if (clipLabels.length === 1) {
    compositeLabel = clipLabels[0].label;
  } else {
    // Overlapping or complex layout: overlay onto base canvas
    compositeLabel = buildOverlayComposite(
      clipLabels, chains, nextLabel, width, height, totalDuration, fps,
    );
  }

  // Apply text overlays as drawtext on the final composite
  if (textOverlays.length > 0) {
    const withTextLabel = nextLabel('vt');
    const drawtextChain = textOverlays.join(',');
    chains.push(`[${compositeLabel}]${drawtextChain}[${withTextLabel}]`);
    compositeLabel = withTextLabel;
  }

  // Phase B: Apply pre-rendered HTML caption PNG overlays
  if (preRendered && preRendered.length > 0 && overlayInputMap) {
    compositeLabel = buildHtmlOverlayChain(
      preRendered, overlayInputMap, compositeLabel, chains, nextLabel,
    );
  }

  return {
    filterComplex: chains.join(';\n'),
    videoOutputLabel: `[${compositeLabel}]`,
    textOverlays: [], // already applied in filter_complex
  };
}

/**
 * Build FFmpeg overlay chain for pre-rendered HTML caption PNGs.
 *
 * Each PNG is overlaid at 0:0 (full-frame, CSS positioning already baked in)
 * with timing-gated enable=between() filter.
 * Overlays are chained sequentially: base → overlay1 → overlay2 → ... → final.
 *
 * @returns Final composite label after all overlays applied
 */
export function buildHtmlOverlayChain(
  preRendered: PreRenderResult[],
  overlayInputMap: Map<string, number>,
  baseLabel: string,
  chains: string[],
  nextLabel: (prefix: string) => string,
): string {
  let currentLabel = baseLabel;

  // Sort by start time for deterministic overlay order
  const sorted = [...preRendered].sort((a, b) => a.timing.start - b.timing.start);

  for (const pr of sorted) {
    const inputIdx = overlayInputMap.get(pr.pngPath);
    if (inputIdx === undefined) continue;

    const outLabel = nextLabel('ho');
    const start = pr.timing.start;
    const end = start + pr.timing.duration;

    chains.push(
      `[${currentLabel}][${inputIdx}:v]overlay=0:0:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'[${outLabel}]`,
    );

    currentLabel = outLabel;
  }

  return currentLabel;
}

/**
 * Check if clips are sequential (non-overlapping, ordered by start time).
 */
function areSequential(
  clips: { start: number; duration: number }[],
): boolean {
  for (let i = 1; i < clips.length; i++) {
    const prevEnd = clips[i - 1].start + clips[i - 1].duration;
    const currStart = clips[i].start;
    // Allow small overlap for transitions (up to 1 second)
    if (currStart < prevEnd - 1.0) return false;
  }
  return true;
}

/**
 * Chain sequential clips using xfade transitions.
 * Returns the label of the final composed stream.
 */
function buildSequentialChain(
  clips: { label: string; start: number; duration: number; layer: IRLayer }[],
  chains: string[],
  nextLabel: (prefix: string) => string,
): string {
  let currentLabel = clips[0].label;
  let currentDuration = clips[0].duration;

  for (let i = 1; i < clips.length; i++) {
    const clip = clips[i];
    const prevLayer = clips[i - 1].layer;
    const outLabel = nextLabel('xf');

    // Determine transition type from the incoming clip or outgoing clip
    const transitionName = clip.layer.timing.transitionIn ?? prevLayer.timing.transitionOut ?? 'fade';
    const ffmpegTransition = mapTransition(transitionName) ?? 'fade';
    const transDuration = getFFmpegTransitionDuration(transitionName);

    // xfade offset = point in the output stream where transition starts
    const offset = Math.max(0, currentDuration - transDuration);

    chains.push(
      `[${currentLabel}][${clip.label}]xfade=transition=${ffmpegTransition}:duration=${transDuration}:offset=${offset.toFixed(3)}[${outLabel}]`,
    );

    currentLabel = outLabel;
    // After xfade: combined duration = prev + curr - transition overlap
    currentDuration = currentDuration + clip.duration - transDuration;
  }

  return currentLabel;
}

/**
 * Compose clips by overlaying onto a base canvas (for multi-track/overlapping clips).
 * Returns the label of the final composite.
 */
function buildOverlayComposite(
  clips: { label: string; start: number; duration: number; layer: IRLayer }[],
  chains: string[],
  nextLabel: (prefix: string) => string,
  width: number,
  height: number,
  totalDuration: number,
  fps: number,
): string {
  // Create base canvas
  const baseLabel = nextLabel('base');
  chains.push(
    `color=c=black:s=${width}x${height}:d=${totalDuration}:r=${fps}[${baseLabel}]`,
  );

  let currentLabel = baseLabel;

  for (const clip of clips) {
    const outLabel = nextLabel('comp');
    const start = clip.start;
    const end = start + clip.duration;

    // Calculate position offsets
    const offsetX = Math.round((clip.layer.position.offsetX ?? 0) * width);
    const offsetY = Math.round((clip.layer.position.offsetY ?? 0) * height);

    // Static opacity (tween opacity is rejected by router)
    const opacity = typeof clip.layer.effects.opacity === 'number'
      ? clip.layer.effects.opacity
      : 1.0;

    // Build overlay with enable timing
    let overlayFilter = `overlay=${offsetX}:${offsetY}:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'`;

    // Apply fade-in transition via overlay format
    if (clip.layer.timing.transitionIn === 'fade') {
      const fadeDur = getFFmpegTransitionDuration(clip.layer.timing.transitionIn);
      // Apply fade to the clip stream before overlaying
      const fadedLabel = nextLabel('fd');
      chains.push(
        `[${clip.label}]format=rgba,fade=t=in:d=${fadeDur}:alpha=1[${fadedLabel}]`,
      );
      chains.push(
        `[${currentLabel}][${fadedLabel}]${overlayFilter}:format=auto[${outLabel}]`,
      );
    } else if (opacity < 1.0) {
      // Apply static opacity via colorchannelmixer
      const opLabel = nextLabel('op');
      chains.push(
        `[${clip.label}]format=rgba,colorchannelmixer=aa=${opacity}[${opLabel}]`,
      );
      chains.push(
        `[${currentLabel}][${opLabel}]${overlayFilter}:format=auto[${outLabel}]`,
      );
    } else {
      chains.push(
        `[${currentLabel}][${clip.label}]${overlayFilter}[${outLabel}]`,
      );
    }

    currentLabel = outLabel;
  }

  return currentLabel;
}
