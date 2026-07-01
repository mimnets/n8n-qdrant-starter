/**
 * VoiceCore — Fish Speech TTS Provider
 *
 * Generates speech audio via Fish Speech v1.5 running locally.
 * Communicates over REST API for text-to-speech synthesis.
 *
 * Key specs:
 *   - Model: Fish Speech v1.5
 *   - VRAM: ~2GB (always resident)
 *   - Output: WAV audio
 *   - Endpoint: POST /v1/tts
 */

import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import {
  type GenerateProvider,
  type GenerateRequest,
  type GenerateResponse,
  type ProviderName,
} from '@gstack/types';
import { logger } from '../config/logger.js';

interface VoiceCoreConfig {
  host: string;
  port: number;
}

export class VoiceCoreTTSProvider implements GenerateProvider {
  readonly name: ProviderName = 'voicecore-tts';

  private config: VoiceCoreConfig;
  private baseUrl: string;

  constructor(config: VoiceCoreConfig) {
    this.config = config;
    this.baseUrl = `http://${config.host}:${config.port}`;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/tts`, {
        method: 'OPTIONS',
        signal: AbortSignal.timeout(3000),
      });
      // Fish Speech may not support OPTIONS, so also accept connection success
      return true;
    } catch {
      // Fallback: try a lightweight GET or just check connection
      try {
        const res = await fetch(`${this.baseUrl}/`, {
          signal: AbortSignal.timeout(3000),
        });
        return true;
      } catch {
        return false;
      }
    }
  }

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    const startTime = Date.now();
    const id = randomUUID();

    try {
      if (!req.prompt || req.prompt.trim().length === 0) {
        throw new Error('TTS requires a non-empty text prompt');
      }

      const url = `${this.baseUrl}/v1/tts`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: req.prompt,
          reference_id: req.style ?? 'default',
          format: 'wav',
          streaming: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`TTS failed: ${response.status} ${response.statusText}`);
      }

      // Save audio to storage
      const audioBuffer = Buffer.from(await response.arrayBuffer());
      const outputDir = process.env.STORAGE_PATH ?? './data/assets';
      const filename = `tts_${Date.now()}.wav`;
      const outputPath = join(outputDir, 'tts', filename);

      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, audioBuffer);

      const gpuTimeMs = Date.now() - startTime;

      logger.info('VoiceCore TTS generation complete', {
        id,
        textLength: req.prompt.length,
        audioSize: audioBuffer.length,
        gpuTimeMs,
      });

      return {
        id,
        status: 'done',
        provider: this.name,
        output: {
          url: `/serve/v1/assets/tts/${filename}`,
          width: 0,
          height: 0,
          format: 'wav',
        },
        cost: 0,
        gpu_time_ms: gpuTimeMs,
        created_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('VoiceCore TTS generation failed', { id, error: message });

      return {
        id,
        status: 'failed',
        provider: this.name,
        cost: 0,
        error: message,
        created_at: new Date(startTime).toISOString(),
      };
    }
  }
}
