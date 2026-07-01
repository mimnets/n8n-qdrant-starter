import { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { schema } from '../../db/index.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { AppQueues } from '../../queue/queues.js';
import {
  createTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
  deleteTemplate,
} from '../../template/crud.js';
import { applyMergeFields } from '../../template/merge.js';

export async function templateRoutes(app: FastifyInstance) {
  const db = (app as any).db as BetterSQLite3Database<typeof schema>;

  // Create template
  app.post('/edit/v1/template', async (req, reply) => {
    const body = req.body as { name: string; template: any };
    const templateStr =
      typeof body.template === 'string'
        ? body.template
        : JSON.stringify(body.template);

    const result = await createTemplate(db, {
      name: body.name,
      template: templateStr,
    });

    reply.status(201).send({
      success: true,
      message: 'Created',
      response: result,
    });
  });

  // List templates
  app.get('/edit/v1/template', async (_req, reply) => {
    const templates = await listTemplates(db);
    reply.send({
      success: true,
      message: 'OK',
      response: templates,
    });
  });

  // Get template
  app.get('/edit/v1/template/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const template = await getTemplate(db, id);

    if (!template) {
      return reply
        .status(404)
        .send({ success: false, message: 'Template not found' });
    }

    reply.send({
      success: true,
      message: 'OK',
      response: template,
    });
  });

  // Update template
  app.put('/edit/v1/template/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; template?: any };

    const updates: { name?: string; template?: string } = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.template !== undefined) {
      updates.template =
        typeof body.template === 'string'
          ? body.template
          : JSON.stringify(body.template);
    }

    const updated = await updateTemplate(db, id, updates);

    if (!updated) {
      return reply
        .status(404)
        .send({ success: false, message: 'Template not found' });
    }

    reply.send({
      success: true,
      message: 'OK',
      response: updated,
    });
  });

  // Delete template
  app.delete('/edit/v1/template/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = await deleteTemplate(db, id);

    if (!deleted) {
      return reply
        .status(404)
        .send({ success: false, message: 'Template not found' });
    }

    reply.send({ success: true, message: 'OK' });
  });

  // Render from template with merge fields
  app.post('/edit/v1/template/:id/render', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      merge?: Array<{ find: string; replace: string }>;
    };

    const template = await getTemplate(db, id);
    if (!template) {
      return reply
        .status(404)
        .send({ success: false, message: 'Template not found' });
    }

    // Apply merge fields
    let templateJson = template.template;
    if (body.merge && body.merge.length > 0) {
      templateJson = applyMergeFields(templateJson, body.merge);
    }

    // Parse the merged template and submit as render job
    const parsed = JSON.parse(templateJson);
    const renderId = nanoid(21);
    const timelineStr = JSON.stringify(parsed.timeline);
    const outputStr = JSON.stringify(parsed.output);

    await db.insert(schema.renders).values({
      id: renderId,
      status: 'queued',
      timeline: timelineStr,
      output: outputStr,
      callback: parsed.callback ?? null,
    });

    // Enqueue render job if queues are available
    const queues = (app as any).queues as AppQueues | undefined;
    if (queues) {
      await queues.render.add('render', {
        renderId,
        timeline: timelineStr,
        output: outputStr,
        callback: parsed.callback,
      });
    }

    reply.status(201).send({
      success: true,
      message: 'Created',
      response: {
        id: renderId,
        owner: 'cutengine',
        status: 'queued',
        url: null,
        data: null,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
    });
  });
}
