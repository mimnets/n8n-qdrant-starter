import { FastifyInstance } from 'fastify';
import { schema } from '../../db/index.js';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { transferAsset, type TransferRequest } from '../../asset/destinations/index.js';

export async function assetsRoutes(app: FastifyInstance) {
  const db = (app as any).db as BetterSQLite3Database<typeof schema>;

  // GET /serve/v1/assets/:id — Get asset by ID
  app.get('/serve/v1/assets/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const [asset] = await db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.id, id));

    if (!asset) {
      return reply.status(404).send({
        success: false,
        message: 'Asset not found',
      });
    }

    reply.send({
      success: true,
      message: 'OK',
      response: {
        id: asset.id,
        renderId: asset.renderId,
        type: asset.type,
        status: asset.status,
        url: asset.url,
        filename: asset.filename,
        size: asset.size,
        created: asset.createdAt,
      },
    });
  });

  // DELETE /serve/v1/assets/:id — Delete asset
  app.delete('/serve/v1/assets/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const [asset] = await db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.id, id));

    if (!asset) {
      return reply.status(404).send({
        success: false,
        message: 'Asset not found',
      });
    }

    await db.delete(schema.assets).where(eq(schema.assets.id, id));

    reply.send({
      success: true,
      message: 'Deleted',
      response: {
        id: asset.id,
      },
    });
  });

  // GET /serve/v1/assets/render/:id — Get assets by render ID
  app.get('/serve/v1/assets/render/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.renderId, id));

    reply.send({
      success: true,
      message: 'OK',
      response: {
        assets: rows.map((a) => ({
          id: a.id,
          renderId: a.renderId,
          type: a.type,
          status: a.status,
          url: a.url,
          filename: a.filename,
          size: a.size,
          created: a.createdAt,
        })),
      },
    });
  });

  // POST /serve/v1/assets/transfer — Transfer asset to external destination
  app.post('/serve/v1/assets/transfer', async (req, reply) => {
    const body = req.body as TransferRequest;

    if (!body.id || !body.destination?.provider) {
      return reply.status(400).send({
        success: false,
        message: 'Missing required fields: id, destination.provider',
      });
    }

    const [asset] = await db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.id, body.id));

    if (!asset) {
      return reply.status(404).send({
        success: false,
        message: 'Asset not found',
      });
    }

    const result = await transferAsset(body, {
      url: asset.url,
      filename: asset.filename,
      type: asset.type,
      size: asset.size,
    });

    const statusCode = result.success ? 200 : 400;
    reply.status(statusCode).send({
      success: result.success,
      message: result.message,
      response: {
        provider: result.provider,
        data: result.data ?? null,
      },
    });
  });
}
