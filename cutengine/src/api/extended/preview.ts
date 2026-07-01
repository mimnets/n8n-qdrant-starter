import { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { schema } from '../../db/index.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { AppQueues } from '../../queue/queues.js';

export async function previewRoutes(app: FastifyInstance) {
  const db = (app as any).db as BetterSQLite3Database<typeof schema>;

  app.post('/x/v1/render/preview', async (req, reply) => {
    const body = req.body as { timeline: any; output: any; merge?: any[]; callback?: string };
    const id = nanoid(21);

    // Override output for preview: low-res, low fps
    const previewOutput = {
      ...body.output,
      resolution: 'preview',
      fps: 15,
    };

    const timelineStr = JSON.stringify(body.timeline);
    const outputStr = JSON.stringify(previewOutput);

    await db.insert(schema.renders).values({
      id,
      status: 'queued',
      timeline: timelineStr,
      output: outputStr,
      callback: body.callback ?? null,
    });

    const queues = (app as any).queues as AppQueues | undefined;
    if (queues) {
      await queues.render.add('render', {
        renderId: id,
        timeline: timelineStr,
        output: outputStr,
        merge: body.merge,
        callback: body.callback,
      });
    }

    reply.status(201).send({
      success: true,
      message: 'Created',
      response: {
        id,
        owner: 'cutengine',
        status: 'queued',
        url: null,
        data: { output: previewOutput },
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
    });
  });
}
