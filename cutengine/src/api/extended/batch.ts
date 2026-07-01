import { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { schema } from '../../db/index.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { AppQueues } from '../../queue/queues.js';

export async function batchRoutes(app: FastifyInstance) {
  const db = (app as any).db as BetterSQLite3Database<typeof schema>;

  app.post('/x/v1/render/batch', async (req, reply) => {
    const body = req.body as { renders: Array<{ timeline: any; output: any; merge?: any[]; callback?: string }> };

    if (!body.renders || !Array.isArray(body.renders) || body.renders.length === 0) {
      return reply.status(400).send({ success: false, message: 'renders array is required and must not be empty' });
    }

    const queues = (app as any).queues as AppQueues | undefined;
    const results: Array<{ id: string; status: string }> = [];

    for (const render of body.renders) {
      const id = nanoid(21);
      const timelineStr = JSON.stringify(render.timeline);
      const outputStr = JSON.stringify(render.output);

      await db.insert(schema.renders).values({
        id,
        status: 'queued',
        timeline: timelineStr,
        output: outputStr,
        callback: render.callback ?? null,
      });

      if (queues) {
        await queues.render.add('render', {
          renderId: id,
          timeline: timelineStr,
          output: outputStr,
          merge: render.merge,
          callback: render.callback,
        });
      }

      results.push({ id, status: 'queued' });
    }

    reply.status(201).send({
      success: true,
      response: results,
    });
  });
}
