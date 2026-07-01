import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../../src/server.js';

describe('Extended API', () => {
  let app: Awaited<ReturnType<typeof createServer>>;

  beforeAll(async () => {
    app = await createServer({ testing: true });
  });

  afterAll(async () => {
    await app.close();
  });

  const sampleRender = {
    timeline: {
      tracks: [{
        clips: [{
          asset: { type: 'image', src: 'https://example.com/test.jpg' },
          start: 0,
          length: 5,
        }],
      }],
    },
    output: { format: 'mp4', resolution: 'hd' },
  };

  describe('POST /x/v1/render/batch', () => {
    it('submits 3 renders and returns 201 with 3 render ids', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/x/v1/render/batch',
        payload: {
          renders: [sampleRender, sampleRender, sampleRender],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.response).toHaveLength(3);
      for (const r of body.response) {
        expect(r.id).toBeDefined();
        expect(r.status).toBe('queued');
      }

      // Verify each id is unique
      const ids = body.response.map((r: any) => r.id);
      expect(new Set(ids).size).toBe(3);
    });

    it('returns 400 for empty renders array', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/x/v1/render/batch',
        payload: { renders: [] },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /x/v1/render/preview', () => {
    it('creates render with preview resolution and 15fps', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/x/v1/render/preview',
        payload: sampleRender,
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.response.id).toBeDefined();
      expect(body.response.status).toBe('queued');
      expect(body.response.data.output.resolution).toBe('preview');
      expect(body.response.data.output.fps).toBe(15);
    });
  });

  describe('GET /x/v1/queue/status', () => {
    it('returns 200 with queue counts for all queues', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/x/v1/queue/status',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      for (const queueName of ['render', 'ingest', 'create', 'transfer']) {
        expect(body[queueName]).toBeDefined();
        expect(body[queueName]).toHaveProperty('waiting');
        expect(body[queueName]).toHaveProperty('active');
        expect(body[queueName]).toHaveProperty('completed');
        expect(body[queueName]).toHaveProperty('failed');
      }
    });
  });
});
