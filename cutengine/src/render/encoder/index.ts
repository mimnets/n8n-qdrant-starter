import { spawn } from 'child_process';
import { existsSync, statSync } from 'fs';
import { IROutput, IRAudioMix } from '../parser/types.js';
import { buildAudioMix } from './audio-mixer.js';
import { resolveCodec, getQualityArgs, getPresetArgs, type HWCodec } from './hwaccel.js';
import { config } from '../../config/index.js';

export interface EncodeOptions {
  frameDir: string;
  framePattern: string;
  frameCount: number;
  output: IROutput;
  audio?: IRAudioMix;
  outputPath: string;
  /** Actual capture FPS (may differ from output.fps when frameSkip is used) */
  captureFps?: number;
  /** Target output FPS for interpolation */
  outputFps?: number;
}

export async function encode(opts: EncodeOptions): Promise<string> {
  const args = buildFFmpegArgs(opts);

  // Log the full FFmpeg command for debugging audio issues
  const logEntry = {
    event: 'ffmpeg_encode',
    args: ['ffmpeg', ...args].join(' '),
    frameCount: opts.frameCount,
    hasAudio: !!(opts.audio && (opts.audio.clips.length > 0 || opts.audio.soundtrack)),
    audioClips: opts.audio?.clips.length ?? 0,
    hasSoundtrack: !!opts.audio?.soundtrack,
  };

  // Validate audio files exist and are non-empty
  if (opts.audio) {
    const audioFiles: { src: string; size: number; exists: boolean }[] = [];
    for (const clip of opts.audio.clips) {
      const exists = existsSync(clip.src);
      const size = exists ? statSync(clip.src).size : 0;
      audioFiles.push({ src: clip.src, size, exists });
      if (!exists || size === 0) {
        console.error(JSON.stringify({
          event: 'audio_file_invalid',
          src: clip.src,
          exists,
          size,
        }));
      }
    }
    if (opts.audio.soundtrack) {
      const exists = existsSync(opts.audio.soundtrack.src);
      const size = exists ? statSync(opts.audio.soundtrack.src).size : 0;
      audioFiles.push({ src: opts.audio.soundtrack.src, size, exists });
      if (!exists || size === 0) {
        console.error(JSON.stringify({
          event: 'audio_file_invalid',
          src: opts.audio.soundtrack.src,
          exists,
          size,
          type: 'soundtrack',
        }));
      }
    }
    (logEntry as any).audioFiles = audioFiles;
  }

  if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'test') {
    console.log(JSON.stringify(logEntry));
  }

  return runFFmpeg(args, opts.outputPath);
}

export function buildFFmpegArgs(opts: EncodeOptions, codecOverride?: HWCodec): string[] {
  const { output, frameDir, framePattern } = opts;
  const codec = codecOverride ?? resolveCodec(config.encoder.codec);
  const [qualityFlag, qualityValue] = getQualityArgs(output.quality, codec, config.encoder.crf);
  const presetArgs = getPresetArgs(codec);

  // When frameSkip was used, input framerate matches capture fps,
  // and we add -r to interpolate up to the target output fps
  const inputFps = opts.captureFps ?? output.fps;
  const needsInterpolation = opts.outputFps && opts.outputFps !== inputFps;
  const interpolationArgs = needsInterpolation ? ['-r', String(opts.outputFps)] : [];

  switch (output.format) {
    case 'mp4': {
      const hasAudio = opts.audio && (opts.audio.clips.length > 0 || opts.audio.soundtrack);

      if (hasAudio) {
        const totalDuration = opts.frameCount / inputFps;
        const mix = buildAudioMix(opts.audio!, totalDuration);

        if (mix.filterComplex) {
          // Use explicit -t instead of -shortest to avoid known FFmpeg issues
          // where -shortest + image sequence + filter_complex can produce silent audio.
          // All audio streams are already padded to totalDuration via apad, so -t is safe.
          return [
            '-framerate', String(inputFps),
            '-i', `${frameDir}/${framePattern}`,
            ...mix.inputArgs,
            '-filter_complex', mix.filterComplex,
            ...mix.mapArgs,
            '-c:v', codec,
            ...presetArgs,
            qualityFlag, qualityValue,
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-ac', '2',
            '-b:a', '128k',
            ...interpolationArgs,
            '-t', String(totalDuration),
            '-movflags', '+faststart',
            '-y',
            opts.outputPath,
          ];
        }
      }

      return [
        '-framerate', String(inputFps),
        '-i', `${frameDir}/${framePattern}`,
        '-c:v', codec,
        ...presetArgs,
        qualityFlag, qualityValue,
        '-pix_fmt', 'yuv420p',
        ...interpolationArgs,
        '-movflags', '+faststart',
        '-y',
        opts.outputPath,
      ];
    }
    case 'gif':
      return [
        '-framerate', String(inputFps),
        '-i', `${frameDir}/${framePattern}`,
        '-filter_complex', '[0:v] split [a][b]; [a] palettegen [pal]; [b][pal] paletteuse',
        '-y',
        opts.outputPath,
      ];
    case 'jpg':
    case 'png':
    case 'bmp':
      return [
        '-i', `${frameDir}/frame_00001.png`,
        '-frames:v', '1',
        '-y',
        opts.outputPath,
      ];
    default:
      return ['-i', `${frameDir}/${framePattern}`, '-y', opts.outputPath];
  }
}

function runFFmpeg(args: string[], outputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code: number | null) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
    });
    proc.on('error', reject);
  });
}
