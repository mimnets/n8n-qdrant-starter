import { execFileSync } from 'child_process';

export type HWCodec = 'libx264' | 'h264_nvenc' | 'h264_videotoolbox' | 'h264_qsv';

const HW_PRIORITY: HWCodec[] = ['h264_nvenc', 'h264_videotoolbox', 'h264_qsv'];

let cachedCodec: HWCodec | null = null;

/**
 * Detect available hardware encoders by querying `ffmpeg -encoders`.
 * Result is cached for the process lifetime.
 */
export function detectHWCodec(): HWCodec {
  if (cachedCodec) return cachedCodec;

  try {
    const output = execFileSync('ffmpeg', ['-encoders', '-hide_banner'], {
      timeout: 5000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    for (const codec of HW_PRIORITY) {
      if (output.includes(codec)) {
        cachedCodec = codec;
        return codec;
      }
    }
  } catch {
    // ffmpeg not available or error — fall through to software
  }

  cachedCodec = 'libx264';
  return 'libx264';
}

/**
 * Resolve the codec to use based on config preference.
 * 'auto' triggers detection; explicit values are returned as-is.
 */
export function resolveCodec(preference: string): HWCodec {
  if (preference === 'auto') return detectHWCodec();
  if (['libx264', 'h264_nvenc', 'h264_videotoolbox', 'h264_qsv'].includes(preference)) {
    return preference as HWCodec;
  }
  return 'libx264';
}

/** CRF-equivalent quality mapping per codec. */
const QUALITY_MAP: Record<string, Record<HWCodec, { flag: string; value: number }>> = {
  verylow: {
    libx264: { flag: '-crf', value: 35 },
    h264_nvenc: { flag: '-cq', value: 35 },
    h264_videotoolbox: { flag: '-q:v', value: 80 },
    h264_qsv: { flag: '-global_quality', value: 35 },
  },
  low: {
    libx264: { flag: '-crf', value: 28 },
    h264_nvenc: { flag: '-cq', value: 28 },
    h264_videotoolbox: { flag: '-q:v', value: 55 },
    h264_qsv: { flag: '-global_quality', value: 28 },
  },
  medium: {
    libx264: { flag: '-crf', value: 23 },
    h264_nvenc: { flag: '-cq', value: 23 },
    h264_videotoolbox: { flag: '-q:v', value: 40 },
    h264_qsv: { flag: '-global_quality', value: 23 },
  },
  high: {
    libx264: { flag: '-crf', value: 18 },
    h264_nvenc: { flag: '-cq', value: 18 },
    h264_videotoolbox: { flag: '-q:v', value: 25 },
    h264_qsv: { flag: '-global_quality', value: 18 },
  },
  veryhigh: {
    libx264: { flag: '-crf', value: 15 },
    h264_nvenc: { flag: '-cq', value: 15 },
    h264_videotoolbox: { flag: '-q:v', value: 15 },
    h264_qsv: { flag: '-global_quality', value: 15 },
  },
};

export function getQualityArgs(quality: string, codec: HWCodec, crfOverride?: number): [string, string] {
  const entry = QUALITY_MAP[quality]?.[codec] ?? QUALITY_MAP.medium[codec];
  // When crfOverride is set and codec uses CRF (-crf flag), override the value
  if (crfOverride !== undefined && entry.flag === '-crf') {
    return [entry.flag, String(crfOverride)];
  }
  return [entry.flag, String(entry.value)];
}

/**
 * Get codec-specific preset.
 * NVENC uses 'p4' (balanced), VideoToolbox has no preset, QSV uses 'medium'.
 */
export function getPresetArgs(codec: HWCodec): string[] {
  switch (codec) {
    case 'libx264': return ['-preset', 'medium'];
    case 'h264_nvenc': return ['-preset', 'p4'];
    case 'h264_qsv': return ['-preset', 'medium'];
    case 'h264_videotoolbox': return [];
  }
}

/** Reset cached codec (for testing). */
export function resetCodecCache(): void {
  cachedCodec = null;
}
