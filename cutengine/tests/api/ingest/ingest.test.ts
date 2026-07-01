import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../../src/server.js';

describe('Ingest API', () => {
  let app: Awaited<ReturnType<typeof createServer>>;

  beforeAll(async () => {
    app = await createServer({ testing: true });
  });

  afterAll(async () => {
    await app.close();
  });

  // --- Sources Routes ---

  describe('POST /ingest/v1/sources', () => {
    it('returns 201 with source id and status queued', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/ingest/v1/sources',
        payload: { url: 'https://example.com/video.mp4' },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.response.id).toBeDefined();
      expect(body.response.status).toBe('queued');
      expect(body.response.url).toBe('https://example.com/video.mp4');
    });

    it('returns 400 when url is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/ingest/v1/sources',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
    });
  });

  describe('GET /ingest/v1/sources/:id', () => {
    it('returns 200 with source details', async () => {
      // Create a source first
      const createRes = await app.inject({
        method: 'POST',
        url: '/ingest/v1/sources',
        payload: { url: 'https://example.com/audio.mp3' },
      });
      const { response: { id } } = JSON.parse(createRes.body);

      const res = await app.inject({
        method: 'GET',
        url: `/ingest/v1/sources/${id}`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.response.id).toBe(id);
      expect(body.response.url).toBe('https://example.com/audio.mp3');
      expect(body.response.status).toBe('queued');
    });

    it('returns 404 for unknown source', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ingest/v1/sources/nonexistent',
      });
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
    });
  });

  describe('GET /ingest/v1/sources', () => {
    it('returns 200 with array of sources', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ingest/v1/sources',
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.response.sources)).toBe(true);
      expect(body.response.sources.length).toBeGreaterThan(0);
    });
  });

  describe('DELETE /ingest/v1/sources/:id', () => {
    it('returns 200 and deletes the source', async () => {
      // Create a source
      const createRes = await app.inject({
        method: 'POST',
        url: '/ingest/v1/sources',
        payload: { url: 'https://example.com/delete-me.mp4' },
      });
      const { response: { id } } = JSON.parse(createRes.body);

      // Delete it
      const delRes = await app.inject({
        method: 'DELETE',
        url: `/ingest/v1/sources/${id}`,
      });
      expect(delRes.statusCode).toBe(200);
      const delBody = JSON.parse(delRes.body);
      expect(delBody.success).toBe(true);
      expect(delBody.response.id).toBe(id);

      // Confirm it's gone
      const getRes = await app.inject({
        method: 'GET',
        url: `/ingest/v1/sources/${id}`,
      });
      expect(getRes.statusCode).toBe(404);
    });

    it('returns 404 for unknown source', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/ingest/v1/sources/nonexistent',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // --- Upload Route ---

  describe('POST /ingest/v1/upload', () => {
    it('returns 200 with upload URL and source id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/ingest/v1/upload',
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.response.id).toBeDefined();
      expect(body.response.url).toContain('/ingest/v1/upload/');
      expect(body.response.status).toBe('queued');
    });
  });
});
