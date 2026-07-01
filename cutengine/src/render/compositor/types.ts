// Types for the FFmpeg filter_complex compositor.
// Represents the intermediate form between IR and FFmpeg command-line arguments.

export interface FFmpegInput {
  path: string;
  /** For images: loop and set duration to create a video stream */
  loop?: boolean;
  /** Duration in seconds (required for looped images) */
  duration?: number;
  /** Seek offset for trimmed videos */
  trim?: number;
  /** Input index assigned during buildInputs */
  index: number;
}

export interface FFmpegFilterChain {
  /** Input labels (e.g., '[0:v]', '[img0]') */
  inputs: string[];
  /** Filter expression (e.g., 'scale=1920:1080,zoompan=...') */
  filters: string;
  /** Output label (e.g., '[v0]') */
  output: string;
}

export interface FFmpegFilterGraph {
  /** All input arguments (-loop 1 -t D -i path ...) */
  inputArgs: string[];
  /** Map from asset src path to input index */
  inputIndexMap: Map<string, number>;
  /** Filter chains that compose the video */
  videoChains: FFmpegFilterChain[];
  /** Final video output label (e.g., '[vout]') */
  videoOutputLabel: string;
}

export interface CompositorOptions {
  onProgress?: (percent: number) => void;
}

export interface CompositorResult {
  outputPath: string;
  durationMs: number;
}

export interface RouteDecision {
  eligible: boolean;
  reason?: string;
}
