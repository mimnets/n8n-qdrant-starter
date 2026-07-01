import { FastifyInstance } from 'fastify';
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

export const metricsRegistry = new Registry();

// Collect default Node.js metrics
collectDefaultMetrics({ register: metricsRegistry });

export const renderTotal = new Counter({
  name: 'cutengine_render_total',
  help: 'Total number of render jobs processed',
  labelNames: ['status'] as const,
  registers: [metricsRegistry],
});

export const renderDuration = new Histogram({
  name: 'cutengine_render_duration_seconds',
  help: 'Duration of render jobs in seconds',
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600],
  registers: [metricsRegistry],
});

export const queueDepth = new Gauge({
  name: 'cutengine_queue_depth',
  help: 'Current number of jobs waiting in queues',
  labelNames: ['queue'] as const,
  registers: [metricsRegistry],
});

export const activeWorkers = new Gauge({
  name: 'cutengine_active_workers',
  help: 'Number of currently active worker instances',
  labelNames: ['worker'] as const,
  registers: [metricsRegistry],
});

export async function metricsRoutes(app: FastifyInstance) {
  app.get('/metrics', async (_req, reply) => {
    const metrics = await metricsRegistry.metrics();
    reply.header('Content-Type', metricsRegistry.contentType).send(metrics);
  });
}
