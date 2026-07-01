import { FastifyInstance } from 'fastify';
import type { AppQueues } from '../../queue/queues.js';

async function getQueueCounts(queue: any) {
  try {
    const [waiting, active, completed, failed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
    ]);
    return { waiting, active, completed, failed };
  } catch {
    // If queue is not available (e.g., in test mode without Redis)
    return { waiting: 0, active: 0, completed: 0, failed: 0 };
  }
}

export async function queueStatusRoutes(app: FastifyInstance) {
  app.get('/x/v1/queue/status', async (_req, reply) => {
    const queues = (app as any).queues as AppQueues | undefined;

    if (!queues) {
      // Test mode or no queues available — return zeroes
      const zeroCounts = { waiting: 0, active: 0, completed: 0, failed: 0 };
      return reply.send({
        render: zeroCounts,
        ingest: zeroCounts,
        create: zeroCounts,
        transfer: zeroCounts,
      });
    }

    const [render, ingest, create, transfer] = await Promise.all([
      getQueueCounts(queues.render),
      getQueueCounts(queues.ingest),
      getQueueCounts(queues.create),
      getQueueCounts(queues.transfer),
    ]);

    reply.send({ render, ingest, create, transfer });
  });
}
