import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import { metricsRegistry } from '../../src/api/metrics.js';

describe('Observability - Metrics', () => {
  let app: Awaited<ReturnType<typeof createServer>>;

  beforeAll(async () => {
    app = await createServer({ testing: true });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /metrics returns 200 with Prometheus format containing cutengine_render_total', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('cutengine_render_total');
  });

  it('metrics registry has all 4 custom metrics defined', () => {
    const metricNames = (metricsRegistry.getMetricsAsArray() as any[]).map(m => m.name);
    expect(metricNames).toContain('cutengine_render_total');
    expect(metricNames).toContain('cutengine_render_duration_seconds');
    expect(metricNames).toContain('cutengine_queue_depth');
    expect(metricNames).toContain('cutengine_active_workers');
  });

  it('GET /metrics includes histogram and gauge metrics', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.body).toContain('cutengine_render_duration_seconds');
    expect(res.body).toContain('cutengine_queue_depth');
    expect(res.body).toContain('cutengine_active_workers');
  });
});
