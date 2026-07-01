import { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { schema } from '../../db/index.js';
import { eq } from 'drizzle-orm';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { config } from '../../config/index.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

export async function uploadRoutes(app: FastifyInstance) {
  const db = (app as any).db as BetterSQLite3Database<typeof schema>;

  // POST /ingest/v1/upload — Returns an upload URL for direct upload
  app.post('/ingest/v1/upload', async (_req, reply) => {
    const id = nanoid(21);

    await db.insert(schema.sources).values({
      id,
      url: `upload://${id}`,
      status: 'queued',
    });

    reply.send({
      success: true,
      message: 'OK',
      response: {
        id,
        url: `/ingest/v1/upload/${id}`,
        status: 'queued',
      },
    });
  });

  // PUT /ingest/v1/upload/:id — Direct file upload endpoint
  app.put('/ingest/v1/upload/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const [source] = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.id, id));

    if (!source) {
      return reply.status(404).send({
        success: false,
        message: 'Upload target not found',
      });
    }

    try {
      await db
        .update(schema.sources)
        .set({ status: 'importing' as any })
        .where(eq(schema.sources.id, id));

      const dir = join(config.storage.path, 'sources', id);
      mkdirSync(dir, { recursive: true });

      const rawBody = await req.rawBody;
      const body = rawBody ?? (req.body as Buffer);
      const filename = 'upload';
      const filePath = join(dir, filename);
      writeFileSync(filePath, body);

      await db
        .update(schema.sources)
        .set({ status: 'ready' as any, localPath: filePath })
        .where(eq(schema.sources.id, id));

      reply.send({
        success: true,
        message: 'Uploaded',
        response: {
          id,
          status: 'ready',
          localPath: filePath,
        },
      });
    } catch (error: any) {
      await db
        .update(schema.sources)
        .set({ status: 'failed' as any, error: error.message })
        .where(eq(schema.sources.id, id));

      reply.status(500).send({
        success: false,
        message: error.message,
      });
    }
  });
}
