import { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { schema } from '../../db/index.js';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { AppQueues } from '../../queue/queues.js';

export async function sourcesRoutes(app: FastifyInstance) {
  const db = (app as any).db as BetterSQLite3Database<typeof schema>;

  // POST /ingest/v1/sources — Fetch a source from URL (enqueue download job)
  app.post('/ingest/v1/sources', async (req, reply) => {
    const body = req.body as { url?: string };

    if (!body.url) {
      return reply.status(400).send({
        success: false,
        message: 'Missing required field: url',
      });
    }

    const id = nanoid(21);

    await db.insert(schema.sources).values({
      id,
      url: body.url,
      status: 'queued',
    });

    // Enqueue ingest job if queues are available
    const queues = (app as any).queues as AppQueues | undefined;
    if (queues) {
      await queues.ingest.add('ingest', {
        sourceId: id,
        url: body.url,
      });
    }

    reply.status(201).send({
      success: true,
      message: 'Created',
      response: {
        id,
        url: body.url,
        status: 'queued',
        created: new Date().toISOString(),
      },
    });
  });

  // GET /ingest/v1/sources — List all sources
  app.get('/ingest/v1/sources', async (_req, reply) => {
    const rows = await db.select().from(schema.sources);

    reply.send({
      success: true,
      message: 'OK',
      response: {
        sources: rows.map((s) => ({
          id: s.id,
          url: s.url,
          status: s.status,
          localPath: s.localPath,
          error: s.error,
          created: s.createdAt,
        })),
      },
    });
  });

  // GET /ingest/v1/sources/:id — Get source status
  app.get('/ingest/v1/sources/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const [source] = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.id, id));

    if (!source) {
      return reply.status(404).send({
        success: false,
        message: 'Source not found',
      });
    }

    reply.send({
      success: true,
      message: 'OK',
      response: {
        id: source.id,
        url: source.url,
        status: source.status,
        localPath: source.localPath,
        error: source.error,
        created: source.createdAt,
      },
    });
  });

  // DELETE /ingest/v1/sources/:id — Delete a source
  app.delete('/ingest/v1/sources/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const [source] = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.id, id));

    if (!source) {
      return reply.status(404).send({
        success: false,
        message: 'Source not found',
      });
    }

    await db.delete(schema.sources).where(eq(schema.sources.id, id));

    reply.send({
      success: true,
      message: 'Deleted',
      response: {
        id: source.id,
      },
    });
  });
}
