import { spawn } from 'child_process';

export interface MediaMetadata {
  width?: number;
  height?: number;
  fps?: number;
  duration?: number;
  codec?: string;
  format?: string;
  bitrate?: number;
  size?: number;
  audioCodec?: string;
  audioSampleRate?: number;
  audioChannels?: number;
}

interface FFProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
}

interface FFProbeFormat {
  format_name?: string;
  duration?: string;
  size?: string;
  bit_rate?: string;
}

interface FFProbeOutput {
  streams?: FFProbeStream[];
  format?: FFProbeFormat;
}

/**
 * Run ffprobe on a URL and return parsed media metadata.
 */
export async function inspectMedia(url: string): Promise<MediaMetadata> {
  const output = await runFFProbe(url);
  return parseFFProbeOutput(output);
}

/**
 * Spawn ffprobe and collect JSON output.
 */
export function runFFProbe(url: string): Promise<FFProbeOutput> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      url,
    ];

    const proc = spawn('ffprobe', args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as FFProbeOutput);
      } catch {
        reject(new Error(`Failed to parse ffprobe output: ${stdout}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`ffprobe not found or failed to start: ${err.message}`));
    });
  });
}

/**
 * Parse ffprobe JSON output into MediaMetadata.
 */
export function parseFFProbeOutput(output: FFProbeOutput): MediaMetadata {
  const metadata: MediaMetadata = {};

  // Find video stream
  const videoStream = output.streams?.find(s => s.codec_type === 'video');
  if (videoStream) {
    metadata.width = videoStream.width;
    metadata.height = videoStream.height;
    metadata.codec = videoStream.codec_name;

    // Parse frame rate (e.g. "25/1" or "30000/1001")
    if (videoStream.r_frame_rate) {
      const parts = videoStream.r_frame_rate.split('/');
      if (parts.length === 2) {
        const num = parseInt(parts[0], 10);
        const den = parseInt(parts[1], 10);
        if (den > 0) {
          metadata.fps = Math.round((num / den) * 100) / 100;
        }
      }
    }
  }

  // Find audio stream
  const audioStream = output.streams?.find(s => s.codec_type === 'audio');
  if (audioStream) {
    metadata.audioCodec = audioStream.codec_name;
    if (audioStream.sample_rate) {
      metadata.audioSampleRate = parseInt(audioStream.sample_rate, 10);
    }
    metadata.audioChannels = audioStream.channels;
  }

  // Format info
  if (output.format) {
    if (output.format.duration) {
      metadata.duration = parseFloat(output.format.duration);
    }
    if (output.format.size) {
      metadata.size = parseInt(output.format.size, 10);
    }
    if (output.format.bit_rate) {
      metadata.bitrate = parseInt(output.format.bit_rate, 10);
    }
    if (output.format.format_name) {
      // ffprobe may return comma-separated formats (e.g. "mov,mp4,m4a,3gp,3g2,mj2")
      // Use the most common short name
      const formats = output.format.format_name.split(',');
      metadata.format = formats.includes('mp4') ? 'mp4'
        : formats.includes('webm') ? 'webm'
        : formats.includes('mov') ? 'mov'
        : formats[0];
    }
  }

  return metadata;
}
