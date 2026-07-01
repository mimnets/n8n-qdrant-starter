import { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { config } from '../../config/index.js';
import type { AppQueues } from '../../queue/queues.js';
import type { AIGenerateRequest } from '../../render/assets/ai.js';

export interface GenerationRecord {
  id: string;
  type: 'text-to-image' | 'image-to-video' | 'upscale' | 'tts';
  status: 'queued' | 'processing' | 'done' | 'failed';
  prompt?: string;
  priority?: 'normal' | 'high';
  style?: string;
  src?: string;
  width?: number;
  height?: number;
  duration?: number;
  resultUrl?: string;
  resultType?: 'image' | 'video' | 'audio';
  error?: string;
  createdAt: string;
  updatedAt: string;
}

// In-memory store for generation tracking
export const generations = new Map<string, GenerationRecord>();

function getProviderConfig(type: string): any | null {
  const createConfig = config.create as Record<string, any>;
  if (!createConfig || typeof createConfig !== 'object') return null;

  if (type === 'text-to-image') {
    return createConfig['text-to-image'] ?? createConfig.textToImage ?? null;
  }
  if (type === 'image-to-video') {
    return createConfig['image-to-video'] ?? createConfig.imageToVideo ?? null;
  }
  if (type === 'tts') {
    return createConfig['tts'] ?? createConfig.tts ?? null;
  }
  return null;
}

export async function createRoutes(app: FastifyInstance) {
  app.post('/create/v1/generate', async (req, reply) => {
    const body = req.body as AIGenerateRequest;
    const { type } = body;

    if (!type || !['text-to-image', 'image-to-video', 'upscale', 'tts'].includes(type)) {
      return reply.status(400).send({
        success: false,
        message: 'Invalid type. Must be "text-to-image", "image-to-video", "upscale", or "tts"',
        status: 400,
      });
    }

    const provider = getProviderConfig(type);
    if (!provider) {
      return reply.status(501).send({
        success: false,
        message: `Provider not configured for ${type}`,
        status: 501,
      });
    }

    const id = nanoid(21);
    const now = new Date().toISOString();

    const record: GenerationRecord = {
      id,
      type: type as 'text-to-image' | 'image-to-video' | 'upscale',
      status: 'queued',
      prompt: body.prompt,
      priority: (body as any).priority ?? 'normal',
      style: (body as any).style,
      src: body.src,
      width: body.width,
      height: body.height,
      duration: body.duration,
      createdAt: now,
      updatedAt: now,
    };

    generations.set(id, record);

    // Enqueue create job if queues are available
    const queues = (app as any).queues as AppQueues | undefined;
    if (queues) {
      await queues.create.add('generate', {
        generationId: id,
        request: body,
        providerConfig: provider,
      });
    }

    reply.status(201).send({
      success: true,
      message: 'Generation queued',
      response: {
        id,
        type,
        status: 'queued',
        created: now,
        updated: now,
      },
    });
  });

  app.get('/create/v1/generate/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const record = generations.get(id);

    if (!record) {
      return reply.status(404).send({
        success: false,
        message: 'Generation not found',
      });
    }

    reply.send({
      success: true,
      message: 'OK',
      response: {
        id: record.id,
        type: record.type,
        status: record.status,
        url: record.resultUrl ?? null,
        resultType: record.resultType ?? null,
        error: record.error ?? null,
        created: record.createdAt,
        updated: record.updatedAt,
      },
    });
  });
}
