import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';

describe('Health Check', () => {
  let app: Awaited<ReturnType<typeof createServer>>;

  beforeAll(async () => {
    app = await createServer({ testing: true });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET / returns 200 with version', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.name).toBe('cutengine');
    expect(body.version).toBeDefined();
  });

  it('GET /health returns basic liveness response', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.uptime).toBeTypeOf('number');
    expect(body.version).toBe('0.4.0');
    expect(body.checks).toBeUndefined();
  });

  it('GET /health?detail=1 returns all check sections', async () => {
    const res = await app.inject({ method: 'GET', url: '/health?detail=1' });
    const body = res.json();
    expect(body.version).toBe('0.4.0');
    expect(body.uptime).toBeTypeOf('number');
    expect(body.checks).toBeDefined();
    expect(body.checks.redis).toBeDefined();
    expect(body.checks.chromium).toBeDefined();
    expect(body.checks.ffmpeg).toBeDefined();
    expect(body.checks.disk).toBeDefined();
    expect(body.checks.gpu).toBeDefined();
  });

  it('returns 503 when critical service (redis) is down', async () => {
    const res = await app.inject({ method: 'GET', url: '/health?detail=1' });
    const body = res.json();
    // In test env Redis is not running → critical failure
    if (body.checks.redis.status === 'error') {
      expect(res.statusCode).toBe(503);
      expect(body.status).toBe('error');
    }
  });

  it('ffmpeg check returns version string when available', async () => {
    const res = await app.inject({ method: 'GET', url: '/health?detail=1' });
    const body = res.json();
    if (body.checks.ffmpeg.status === 'ok') {
      expect(body.checks.ffmpeg.version).toBeTypeOf('string');
    }
  });

  it('disk check includes free_gb and path', async () => {
    const res = await app.inject({ method: 'GET', url: '/health?detail=1' });
    const body = res.json();
    if (body.checks.disk.status === 'ok') {
      expect(body.checks.disk.free_gb).toBeTypeOf('number');
      expect(body.checks.disk.path).toBeTypeOf('string');
    }
  });

  it('gpu check reflects disabled state', async () => {
    const res = await app.inject({ method: 'GET', url: '/health?detail=1' });
    const body = res.json();
    expect(body.checks.gpu.status).toBe('ok');
    expect(body.checks.gpu.enabled).toBe(false);
  });
});
