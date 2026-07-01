import { Worker, Job } from 'bullmq';
import { getRedisConnection } from '../connection.js';
import { executePipeline } from '../../render/pipeline.js';
import { getDb, schema } from '../../db/index.js';
import { eq } from 'drizzle-orm';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { config } from '../../config/index.js';

/**
 * Send a callback webhook with Shotstack-compatible payload.
 * Retries up to 3 times with exponential backoff on failure.
 */
export async function sendCallback(
  callbackUrl: string,
  payload: CallbackPayload,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetchFn(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      // Consider 2xx as success
      if (res.ok) return;

      // Non-2xx response — treat as failure and retry
      if (attempt === maxRetries) return;
    } catch {
      // Network error — retry
      if (attempt === maxRetries) return;
    }

    // Exponential backoff: 1s, 2s, 4s
    const delay = Math.pow(2, attempt - 1) * 1000;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

export interface CallbackPayload {
  type: 'render';
  action: 'render';
  id: string;
  owner: string;
  status: 'done' | 'failed';
  url: string | null;
  error: string | null;
  completed: string;
}

export function buildCallbackPayload(
  renderId: string,
  status: 'done' | 'failed',
  url: string | null,
  error: string | null,
): CallbackPayload {
  return {
    type: 'render',
    action: 'render',
    id: renderId,
    owner: 'cutengine',
    status,
    url,
    error,
    completed: new Date().toISOString(),
  };
}

export function createRenderWorker(db?: ReturnType<typeof getDb>) {
  const database = db ?? getDb();

  const worker = new Worker('render', async (job: Job) => {
    const { renderId, timeline, output, merge, callback } = job.data;
    const workDir = join(config.storage.path, 'renders', renderId);
    mkdirSync(workDir, { recursive: true });

    const updateStatus = async (status: string) => {
      await database.update(schema.renders)
        .set({ status: status as any, updatedAt: new Date() })
        .where(eq(schema.renders.id, renderId));
    };

    try {
      const result = await executePipeline(
        { timeline: JSON.parse(timeline), output: JSON.parse(output), merge },
        workDir,
        updateStatus,
        renderId,
      );

      // Update render record with result URL
      const assetUrl = `/serve/v1/assets/renders/${renderId}/output.${result.format}`;
      await database.update(schema.renders)
        .set({ status: 'done', url: assetUrl, updatedAt: new Date() })
        .where(eq(schema.renders.id, renderId));

      // Fire callback webhook if configured
      if (callback) {
        const payload = buildCallbackPayload(renderId, 'done', assetUrl, null);
        await sendCallback(callback, payload);
      }

      return result;
    } catch (error: any) {
      await database.update(schema.renders)
        .set({ status: 'failed', error: error.message, updatedAt: new Date() })
        .where(eq(schema.renders.id, renderId));

      // Fire failure callback webhook if configured
      if (callback) {
        const payload = buildCallbackPayload(renderId, 'failed', null, error.message);
        await sendCallback(callback, payload);
      }

      throw error;
    }
  }, {
    connection: getRedisConnection(),
    concurrency: 2,
  });

  return worker;
}
