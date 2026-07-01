import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createServer } from '../../../src/server.js';
import { generations } from '../../../src/api/create/generate.js';
import { config } from '../../../src/config/index.js';

// Mock generateAIAsset
vi.mock('../../../src/render/assets/ai.js', () => ({
  generateAIAsset: vi.fn().mockResolvedValue({
    url: 'https://cdn.example.com/generated/image-123.png',
    type: 'image',
  }),
}));

describe('Create API - Generate', () => {
  let app: Awaited<ReturnType<typeof createServer>>;
  const originalCreate = { ...config.create };

  beforeAll(async () => {
    app = await createServer({ testing: true });
  });

  afterAll(async () => {
    await app.close();
    Object.assign(config, { create: originalCreate });
  });

  beforeEach(() => {
    generations.clear();
  });

  describe('POST /create/v1/generate', () => {
    it('returns 501 when provider is not configured', async () => {
      // Ensure no provider is configured
      (config as any).create = {};

      const res = await app.inject({
        method: 'POST',
        url: '/create/v1/generate',
        payload: {
          type: 'text-to-image',
          prompt: 'A sunset over mountains',
          width: 1280,
          height: 720,
        },
      });

      expect(res.statusCode).toBe(501);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
      expect(body.message).toContain('Provider not configured');
      expect(body.message).toContain('text-to-image');
      expect(body.status).toBe(501);
    });

    it('returns 501 for image-to-video when not configured', async () => {
      (config as any).create = {};

      const res = await app.inject({
        method: 'POST',
        url: '/create/v1/generate',
        payload: {
          type: 'image-to-video',
          src: 'https://example.com/input.jpg',
          duration: 5,
        },
      });

      expect(res.statusCode).toBe(501);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
      expect(body.message).toContain('image-to-video');
    });

    it('returns 201 with generation id when provider is configured', async () => {
      (config as any).create = {
        'text-to-image': {
          url: 'https://api.seedream.example.com/v1/generate',
          apiKey: 'test-key-123',
          model: 'seedream-v1',
        },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/create/v1/generate',
        payload: {
          type: 'text-to-image',
          prompt: 'A sunset over mountains',
          width: 1280,
          height: 720,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.response.id).toBeDefined();
      expect(body.response.type).toBe('text-to-image');
      expect(body.response.status).toBe('queued');
      expect(body.response.created).toBeDefined();
    });

    it('returns 201 for image-to-video when configured', async () => {
      (config as any).create = {
        'image-to-video': {
          url: 'https://api.seedance.example.com/v1/generate',
          apiKey: 'test-key-456',
          model: 'seedance-v1',
        },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/create/v1/generate',
        payload: {
          type: 'image-to-video',
          src: 'https://example.com/input.jpg',
          prompt: 'Make it fly',
          duration: 5,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.response.type).toBe('image-to-video');
      expect(body.response.status).toBe('queued');
    });

    it('returns 400 for invalid type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/create/v1/generate',
        payload: {
          type: 'text-to-video',
          prompt: 'Invalid type',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
    });

    it('stores generation record in memory', async () => {
      (config as any).create = {
        'text-to-image': {
          url: 'https://api.example.com/generate',
          apiKey: 'key',
        },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/create/v1/generate',
        payload: {
          type: 'text-to-image',
          prompt: 'Test prompt',
        },
      });

      const { response } = JSON.parse(res.body);
      const record = generations.get(response.id);
      expect(record).toBeDefined();
      expect(record!.type).toBe('text-to-image');
      expect(record!.prompt).toBe('Test prompt');
      expect(record!.status).toBe('queued');
    });
  });

  describe('GET /create/v1/generate/:id', () => {
    it('returns generation status for known id', async () => {
      (config as any).create = {
        'text-to-image': {
          url: 'https://api.example.com/generate',
          apiKey: 'key',
        },
      };

      // Create a generation first
      const createRes = await app.inject({
        method: 'POST',
        url: '/create/v1/generate',
        payload: {
          type: 'text-to-image',
          prompt: 'Check status',
          width: 512,
          height: 512,
        },
      });

      const { response: { id } } = JSON.parse(createRes.body);

      const res = await app.inject({
        method: 'GET',
        url: `/create/v1/generate/${id}`,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.response.id).toBe(id);
      expect(body.response.type).toBe('text-to-image');
      expect(body.response.status).toBe('queued');
      expect(body.response.url).toBeNull();
    });

    it('returns 404 for unknown generation id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/create/v1/generate/nonexistent-id',
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
      expect(body.message).toContain('not found');
    });

    it('returns completed status with result url', async () => {
      // Manually insert a completed generation
      const id = 'test-completed-gen';
      generations.set(id, {
        id,
        type: 'text-to-image',
        status: 'done',
        prompt: 'Completed prompt',
        resultUrl: 'https://cdn.example.com/result.png',
        resultType: 'image',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const res = await app.inject({
        method: 'GET',
        url: `/create/v1/generate/${id}`,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.response.status).toBe('done');
      expect(body.response.url).toBe('https://cdn.example.com/result.png');
      expect(body.response.resultType).toBe('image');
    });

    it('returns failed status with error', async () => {
      const id = 'test-failed-gen';
      generations.set(id, {
        id,
        type: 'image-to-video',
        status: 'failed',
        src: 'https://example.com/img.jpg',
        error: 'Provider API timeout',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const res = await app.inject({
        method: 'GET',
        url: `/create/v1/generate/${id}`,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.response.status).toBe('failed');
      expect(body.response.error).toBe('Provider API timeout');
    });
  });
});

describe('AI Asset Handler', () => {
  it('generateAIAsset returns result with mocked provider', async () => {
    const { generateAIAsset } = await import('../../../src/render/assets/ai.js');

    const result = await generateAIAsset(
      { type: 'text-to-image', prompt: 'A test image', width: 512, height: 512 },
      { url: 'https://api.example.com/generate', apiKey: 'test-key' },
    );

    expect(result).toBeDefined();
    expect(result.url).toBe('https://cdn.example.com/generated/image-123.png');
    expect(result.type).toBe('image');
  });
});
