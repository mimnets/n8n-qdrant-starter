import type { ShotstackOutput, IROutput } from './types.js';

const RESOLUTION_MAP: Record<string, { width: number; height: number; fps: number }> = {
  preview: { width: 512, height: 288, fps: 15 },
  mobile: { width: 640, height: 360, fps: 25 },
  sd: { width: 1024, height: 576, fps: 25 },
  hd: { width: 1280, height: 720, fps: 25 },
  '1080': { width: 1920, height: 1080, fps: 25 },
  '4k': { width: 3840, height: 2160, fps: 25 },
};

const ASPECT_RATIO_MAP: Record<string, [number, number]> = {
  '16:9': [16, 9],
  '9:16': [9, 16],
  '1:1': [1, 1],
  '4:5': [4, 5],
  '4:3': [4, 3],
};

/**
 * Resolve Shotstack output config into concrete IROutput dimensions.
 *
 * Priority:
 * 1. Explicit `size` overrides everything
 * 2. `resolution` preset gives base dimensions
 * 3. `aspectRatio` swaps/adjusts dimensions to match the ratio
 * 4. `fps` override replaces preset fps
 * 5. Defaults to sd if nothing specified
 */
export function resolveOutput(output: ShotstackOutput): IROutput {
  // Start with base dimensions from resolution preset or default to sd
  const preset = output.resolution ?? 'sd';
  const base = RESOLUTION_MAP[preset] ?? RESOLUTION_MAP.sd;

  let width = base.width;
  let height = base.height;
  let fps = base.fps;

  // Explicit size overrides preset
  if (output.size) {
    width = output.size.width;
    height = output.size.height;
  } else if (output.aspectRatio) {
    // Adjust dimensions to match aspect ratio while keeping the larger dimension
    const ratio = ASPECT_RATIO_MAP[output.aspectRatio];
    if (ratio) {
      const [rw, rh] = ratio;
      if (rw >= rh) {
        // Landscape or square: keep width, compute height
        height = Math.round(width * rh / rw);
      } else {
        // Portrait: swap — keep height as width-based, compute accordingly
        // For 9:16 with 1080 preset (1920x1080): result should be 1080x1920
        const baseHeight = width; // use the larger dimension
        height = baseHeight;
        width = Math.round(baseHeight * rw / rh);
      }
    }
  }

  // FPS override
  if (output.fps) {
    fps = output.fps;
  }

  return {
    width,
    height,
    fps,
    format: output.format ?? 'mp4',
    quality: output.quality ?? 'medium',
    scaleTo: output.scaleTo,
    range: output.range,
    poster: output.poster,
    thumbnail: output.thumbnail,
    destinations: output.destinations,
    mute: output.mute,
    repeat: output.repeat,
  };
}
