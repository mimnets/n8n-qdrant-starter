import { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { schema } from '../../db/index.js';
import { eq } from 'drizzle-orm';
import type {} from '../../types/fastify.js';

export async function renderRoutes(app: FastifyInstance) {
  app.post('/edit/v1/render', async (req, reply) => {
    const body = req.body as any;
    const id = nanoid(21);

    const timelineStr = JSON.stringify(body.timeline);
    const outputStr = JSON.stringify(body.output);

    await app.db.insert(schema.renders).values({
      id,
      status: 'queued',
      timeline: timelineStr,
      output: outputStr,
      callback: body.callback ?? null,
    });

    // Enqueue render job if queues are available (not in test mode)
    if (app.queues) {
      await app.queues.render.add('render', {
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
        data: null,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
    });
  });

  app.get('/edit/v1/render/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const [render] = await app.db.select().from(schema.renders).where(eq(schema.renders.id, id));

    if (!render) {
      return reply.status(404).send({ success: false, message: 'Render not found' });
    }

    reply.send({
      success: true,
      message: 'OK',
      response: {
        id: render.id,
        owner: 'cutengine',
        status: render.status,
        url: render.url,
        poster: render.poster,
        thumbnail: render.thumbnail,
        error: render.error,
        data: {
          output: JSON.parse(render.output ?? '{}'),
        },
        created: render.createdAt,
        updated: render.updatedAt,
      },
    });
  });
}
