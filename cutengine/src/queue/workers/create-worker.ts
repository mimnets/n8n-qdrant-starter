import { Worker, Job } from 'bullmq';
import { getRedisConnection } from '../connection.js';
import { generateAIAsset } from '../../render/assets/ai.js';
import { generations } from '../../api/create/generate.js';
import { config } from '../../config/index.js';
import type { AIGenerateRequest, ProviderConfig } from '../../render/assets/ai.js';
import type { ProviderRouter } from '../../create/providers/router.js';

export function createCreateWorker(router?: ProviderRouter) {
  // GPU concurrency: default 1 to prevent model swap thrashing on single GPU
  // TTS (Fish Speech) is always-resident and doesn't need GPU swaps
  const gpuConcurrency = config.gpu.enabled ? config.gpu.concurrency : 2;

  const worker = new Worker('create', async (job: Job) => {
    const { generationId, request, providerConfig } = job.data as {
      generationId: string;
      request: AIGenerateRequest;
      providerConfig: ProviderConfig;
    };

    const record = generations.get(generationId);
    if (record) {
      record.status = 'processing';
      record.updatedAt = new Date().toISOString();
    }

    try {
      // TTS requests: Fish Speech is always-resident (2GB), no GPU swap needed.
      // Process immediately without waiting for GPU queue.
      if (router && request.type === 'tts') {
        const provider = await router.route({
          type: 'tts',
          prompt: request.prompt ?? '',
          style: (request as any).style,
        });
        const result = await provider.generate({
          type: 'tts',
          prompt: request.prompt ?? '',
          style: (request as any).style,
        });
        if (record) {
          record.status = result.status === 'done' ? 'done' : 'failed';
          record.resultUrl = result.output?.url;
          record.resultType = 'audio';
          record.error = result.error;
          record.updatedAt = new Date().toISOString();
        }
        return { url: result.output?.url, type: 'audio' };
      }

      // GPU tasks: route to gpu-scheduler queue for VRAM-safe processing
      if (router && config.gpuScheduler.enabled) {
        const { calculatePriority, resolveModel } = await import('../../gpu/priority-calculator.js');
        const { Queue, QueueEvents } = await import('bullmq');

        const { model, vram_gb } = resolveModel(request.type);
        const tier = (request as any).tier ?? 'T5';
        const priority = calculatePriority(tier, request.type);

        const gpuQueue = new Queue('gpu-scheduler', {
          connection: getRedisConnection(),
        });

        const gpuJob = await gpuQueue.add('gpu-generate', {
          type: request.type,
          model_needed: model,
          vram_gb,
          tier,
          channel_id: (request as any).channel_id ?? '',
          visual_priority: (request as any).visual_priority ?? 'normal',
          request: {
            prompt: request.prompt,
            src: request.src,
            style: (request as any).style,
            aspect_ratio: (request as any).aspect_ratio,
            resolution: (request as any).resolution,
            duration: request.duration,
            seed: (request as any).seed,
            upscale_factor: (request as any).upscale_factor,
            is_thumbnail: (request as any).is_thumbnail,
          },
          callback_url: (request as any).callback_url,
        }, { priority });

        // Wait for gpu-scheduler to complete
        const queueEvents = new QueueEvents('gpu-scheduler', { connection: getRedisConnection() });
        try {
          const result = await gpuJob.waitUntilFinished(queueEvents, 600_000);

          if (record) {
            record.status = 'done';
            record.resultUrl = result?.url;
            record.resultType = result?.type;
            record.updatedAt = new Date().toISOString();
          }
          return result;
        } finally {
          await queueEvents.close();
        }
      }

      // GPU tasks: use ProviderRouter for local GPU inference (sequential)
      if (router) {
        const provider = await router.route({
          type: request.type as 'text-to-image' | 'image-to-video' | 'upscale',
          prompt: request.prompt ?? '',
          source_image_url: request.src,
          visual_priority: (request as any).visual_priority ?? 'normal',
          style: (request as any).style,
          aspect_ratio: (request as any).aspect_ratio,
          resolution: (request as any).resolution,
          duration: request.duration,
          seed: (request as any).seed,
          upscale_factor: (request as any).upscale_factor,
          is_thumbnail: (request as any).is_thumbnail,
        });

        const result = await provider.generate({
          type: request.type as 'text-to-image' | 'image-to-video' | 'upscale',
          prompt: request.prompt ?? '',
          source_image_url: request.src,
          visual_priority: (request as any).visual_priority ?? 'normal',
          style: (request as any).style,
          aspect_ratio: (request as any).aspect_ratio,
          resolution: (request as any).resolution,
          duration: request.duration,
          seed: (request as any).seed,
          upscale_factor: (request as any).upscale_factor,
          is_thumbnail: (request as any).is_thumbnail,
        });

        if (record) {
          record.status = result.status === 'done' ? 'done' : 'failed';
          record.resultUrl = result.output?.url;
          record.resultType = result.output?.format === 'mp4' ? 'video' : 'image';
          record.error = result.error;
          record.updatedAt = new Date().toISOString();
        }

        return { url: result.output?.url, type: result.output?.format === 'mp4' ? 'video' : 'image' };
      }

      // Fallback: existing behavior (external API via generateAIAsset)
      const result = await generateAIAsset(request, providerConfig);

      if (record) {
        record.status = 'done';
        record.resultUrl = result.url;
        record.resultType = result.type;
        record.updatedAt = new Date().toISOString();
      }

      return result;
    } catch (error: any) {
      if (record) {
        record.status = 'failed';
        record.error = error.message;
        record.updatedAt = new Date().toISOString();
      }
      throw error;
    }
  }, {
    connection: getRedisConnection(),
    concurrency: gpuConcurrency,
  });

  return worker;
}
