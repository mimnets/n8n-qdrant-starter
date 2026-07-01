import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../../src/server.js';

describe('Edit API - Render', () => {
  let app: Awaited<ReturnType<typeof createServer>>;

  beforeAll(async () => {
    app = await createServer({ testing: true });
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /edit/v1/render returns 201 with render id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/edit/v1/render',
      payload: {
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
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.response.id).toBeDefined();
    expect(body.response.status).toBe('queued');
  });

  it('GET /edit/v1/render/:id returns render status', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/edit/v1/render',
      payload: {
        timeline: { tracks: [{ clips: [{ asset: { type: 'image', src: 'https://example.com/test.jpg' }, start: 0, length: 5 }] }] },
        output: { format: 'mp4', resolution: 'hd' },
      },
    });
    const { response: { id } } = JSON.parse(createRes.body);

    const res = await app.inject({ method: 'GET', url: `/edit/v1/render/${id}` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.response.id).toBe(id);
    expect(body.response.status).toBeDefined();
  });

  it('GET /edit/v1/render/:unknown returns 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/edit/v1/render/nonexistent' });
    expect(res.statusCode).toBe(404);
  });
});
