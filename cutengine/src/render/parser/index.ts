import type {
  ShotstackEdit,
  ShotstackClip,
  ShotstackAsset,
  ShotstackMergeField,
  IRTimeline,
  IRScene,
  IRLayer,
  IRAsset,
  IRTiming,
  IREffects,
  IRPosition,
  IRCrop,
  IRAudioMix,
  IRAudioClip,
  IRExternalAsset,
  IRTween,
  IRTransform,
} from './types.js';
import { resolveOutput } from './resolve-output.js';
import { resolveTiming, calculateTrackDuration } from './resolve-timing.js';

/**
 * Parse a Shotstack Edit JSON into Internal Representation (IR).
 *
 * Steps:
 * 1. Substitute merge fields ({{KEY}} -> value)
 * 2. Resolve output settings
 * 3. Walk tracks (tracks[0] = topmost z-index) and clips
 * 4. Collect audio clips
 * 5. Handle soundtrack
 * 6. Collect external asset URLs
 */
export function parseTimeline(edit: ShotstackEdit): IRTimeline {
  // 1. Substitute merge fields
  const merged = edit.merge?.length
    ? applyMergeFields(edit, edit.merge)
    : edit;

  // 2. Resolve output
  const output = resolveOutput(merged.output);

  // 3. Parse tracks into scenes/layers
  const { scenes, audioClips, externalAssets } = parseTracks(merged.timeline.tracks);

  // 4. Collect font assets
  const fontAssets: IRExternalAsset[] = (merged.timeline.fonts ?? []).map(f => ({
    url: f.src,
    type: 'font' as const,
  }));

  // 5. Handle soundtrack
  const audio: IRAudioMix = {
    clips: audioClips,
  };
  if (merged.timeline.soundtrack) {
    const st = merged.timeline.soundtrack;
    audio.soundtrack = {
      src: st.src,
      effect: st.effect,
      volume: st.volume ?? 1,
    };
    externalAssets.push({ url: st.src, type: 'audio' });
  }

  return {
    scenes,
    audio,
    output,
    assets: [...externalAssets, ...fontAssets],
  };
}

// ---- Merge fields ----

function applyMergeFields(
  edit: ShotstackEdit,
  mergeFields: ShotstackMergeField[],
): ShotstackEdit {
  let json = JSON.stringify(edit);
  for (const { find, replace } of mergeFields) {
    const pattern = new RegExp(`\\{\\{${escapeRegex(find)}\\}\\}`, 'g');
    json = json.replace(pattern, String(replace));
  }
  return JSON.parse(json) as ShotstackEdit;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---- Track / clip parsing ----

interface ParsedTracks {
  scenes: IRScene[];
  audioClips: IRAudioClip[];
  externalAssets: IRExternalAsset[];
}

function parseTracks(tracks: ShotstackEdit['timeline']['tracks']): ParsedTracks {
  const allLayers: IRLayer[] = [];
  const audioClips: IRAudioClip[] = [];
  const externalAssets: IRExternalAsset[] = [];

  // tracks[0] = topmost z-index (rendered last / on top)
  for (let trackIdx = 0; trackIdx < tracks.length; trackIdx++) {
    const track = tracks[trackIdx];
    const totalDuration = calculateTrackDuration(track.clips);
    let prevEnd = 0;

    for (const clip of track.clips) {
      const timing = resolveTiming(clip, prevEnd, totalDuration);
      prevEnd = timing.start + timing.duration;

      const asset = extractAsset(clip.asset);
      // Pass Shotstack clip-level position string (top/center/bottom) to asset for text rendering
      if (clip.position && typeof clip.position === 'string') {
        asset.clipPosition = clip.position;
      }
      const irTiming = extractTiming(timing.start, timing.duration, clip);
      const effects = extractEffects(clip);
      const position = extractPosition(clip);
      const crop = extractCrop(clip);

      // Determine layer type
      const isAudio = clip.asset.type === 'audio';

      const layer: IRLayer = {
        type: isAudio ? 'audio' : 'visual',
        asset,
        timing: irTiming,
        effects,
        position,
      };
      if (crop) layer.crop = crop;

      allLayers.push(layer);

      // Collect audio clips
      if (isAudio && clip.asset.src) {
        audioClips.push({
          src: clip.asset.src,
          start: timing.start,
          duration: timing.duration,
          volume: clip.asset.volume ?? 1,
          volumeEffect: clip.asset.volumeEffect,
          speed: clip.asset.speed,
        });
      }

      // Collect external assets
      if (clip.asset.src) {
        const assetType = inferAssetType(clip.asset.type);
        if (assetType) {
          externalAssets.push({ url: clip.asset.src, type: assetType });
        }
      }
    }
  }

  // Group all layers into a single scene for now.
  // Future: scene splitting based on transitions between tracks.
  const scene = buildScene(allLayers);

  return {
    scenes: scene ? [scene] : [],
    audioClips,
    externalAssets,
  };
}

function buildScene(layers: IRLayer[]): IRScene | null {
  if (layers.length === 0) return null;

  let minStart = Infinity;
  let maxEnd = 0;
  for (const l of layers) {
    if (l.timing.start < minStart) minStart = l.timing.start;
    const end = l.timing.start + l.timing.duration;
    if (end > maxEnd) maxEnd = end;
  }

  return {
    startTime: minStart === Infinity ? 0 : minStart,
    duration: maxEnd - (minStart === Infinity ? 0 : minStart),
    layers,
  };
}

// ---- Asset extraction ----

function extractAsset(asset: ShotstackAsset): IRAsset {
  const result: IRAsset = { type: asset.type };
  if (asset.src != null) result.src = asset.src;
  if (asset.text != null) result.text = asset.text;
  if (asset.html != null) result.html = asset.html;
  if (asset.css != null) result.css = asset.css;
  if (asset.font) result.font = { ...asset.font };
  if (asset.stroke) result.stroke = { ...asset.stroke };
  if (asset.background != null) result.background = asset.background;
  if (asset.alignment) result.alignment = { ...asset.alignment };
  if (asset.volume != null) result.volume = asset.volume;
  if (asset.volumeEffect) result.volumeEffect = asset.volumeEffect;
  if (asset.speed != null) result.speed = asset.speed;
  if (asset.trim != null) result.trim = asset.trim;
  return result;
}

// ---- Timing extraction ----

function extractTiming(
  start: number,
  duration: number,
  clip: ShotstackClip,
): IRTiming {
  const t: IRTiming = { start, duration };
  if (clip.transition?.in) t.transitionIn = clip.transition.in;
  if (clip.transition?.out) t.transitionOut = clip.transition.out;
  return t;
}

// ---- Effects extraction ----

function extractEffects(clip: ShotstackClip): IREffects {
  const effects: IREffects = {};

  if (clip.effect) effects.motion = clip.effect;
  if (clip.filter) effects.filter = clip.filter;

  if (clip.opacity != null) {
    if (Array.isArray(clip.opacity)) {
      effects.opacity = clip.opacity.map(t => ({ ...t })) as IRTween[];
    } else {
      effects.opacity = clip.opacity;
    }
  }

  if (clip.transform) {
    const transform: IRTransform = {};
    if (clip.transform.rotate) transform.rotate = { angle: clip.transform.rotate.angle ?? 0 };
    if (clip.transform.skew) transform.skew = { x: clip.transform.skew.x ?? 0, y: clip.transform.skew.y ?? 0 };
    if (clip.transform.flip) transform.flip = { ...clip.transform.flip };
    effects.transform = transform;
  }

  return effects;
}

// ---- Position extraction ----

function extractPosition(clip: ShotstackClip): IRPosition {
  return {
    fit: clip.fit ?? 'crop',
    scale: clip.scale ?? 1,
    offsetX: clip.offset?.x ?? 0,
    offsetY: clip.offset?.y ?? 0,
  };
}

// ---- Crop extraction ----

function extractCrop(clip: ShotstackClip): IRCrop | undefined {
  if (!clip.crop) return undefined;
  return {
    top: clip.crop.top ?? 0,
    bottom: clip.crop.bottom ?? 0,
    left: clip.crop.left ?? 0,
    right: clip.crop.right ?? 0,
  };
}

// ---- Helpers ----

function inferAssetType(assetType: string): IRExternalAsset['type'] | null {
  switch (assetType) {
    case 'video':
    case 'image-to-video':
      return 'video';
    case 'image':
    case 'text-to-image':
      return 'image';
    case 'audio':
      return 'audio';
    default:
      return null;
  }
}

export { resolveOutput } from './resolve-output.js';
export { resolveTiming, calculateTrackDuration } from './resolve-timing.js';
export type * from './types.js';
