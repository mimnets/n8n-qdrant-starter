import { Worker, Job } from 'bullmq';
import { getRedisConnection } from '../queue/connection.js';
import { VRAMBudgetTracker } from './vram-budget-tracker.js';
import { config } from '../config/index.js';
import type { GPUSchedulerJob } from './types.js';
import type { GPUMemoryManager } from '../create/gpu/memory-manager.js';

class VRAMUnavailableError extends Error {
  constructor(model: string, gb: number) {
    super(`VRAM unavailable: ${model} needs ${gb}GB`);
    this.name = 'VRAMUnavailableError';
  }
}

class ServiceUnavailableError extends Error {
  constructor(service: string) {
    super(`Service unreachable: ${service}`);
    this.name = 'ServiceUnavailableError';
  }
}

async function checkHealth(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

function healthUrl(model: string): string {
  switch (model) {
    case 'flux-klein':
    case 'flux-dev':
      return `http://${config.comfyui.host}:${config.comfyui.port}/system_stats`;
    case 'hunyuan':
      return `http://${config.hunyuan.host}:${config.hunyuan.port}/health`;
    default:
      return '';
  }
}

export function createGPUSchedulerWorker(
  tracker: VRAMBudgetTracker,
  gpuManager?: GPUMemoryManager,
) {
  const gpuId = config.gpuScheduler.gpu_id;

  const worker = new Worker<GPUSchedulerJob>('gpu-scheduler', async (job: Job<GPUSchedulerJob>) => {
    const { model_needed, vram_gb, visual_priority, request } = job.data;

    // 1. Health check
    const url = healthUrl(model_needed);
    if (url) {
      const healthy = await checkHealth(url);
      if (!healthy) {
        throw new ServiceUnavailableError(model_needed);
      }
    }

    // 2. Reserve VRAM
    const reserved = await tracker.reserve(model_needed, vram_gb);
    if (!reserved) {
      if (visual_priority === 'high' && (job.attemptsMade ?? 0) >= 3) {
        return { fallback: true, provider: 'seedance-remote' };
      }
      throw new VRAMUnavailableError(model_needed, vram_gb);
    }

    // 3. TTL refresh interval
    const ttlRefresh = setInterval(
      () => tracker.refreshTTL(model_needed),
      20_000,
    );

    try {
      // 4. Model swap if needed
      if (gpuManager) {
        await gpuManager.ensureLoaded(model_needed as any);
      }

      // 5. Dispatch to service (placeholder for actual HTTP call)
      return { model: model_needed, status: 'done', request };
    } finally {
      clearInterval(ttlRefresh);
      await tracker.release(model_needed);
    }
  }, {
    connection: getRedisConnection(),
    concurrency: 1,
  });

  return worker;
}
