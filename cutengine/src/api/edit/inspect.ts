import { FastifyInstance } from 'fastify';
import { inspectMedia } from '../../asset/inspect.js';

export async function inspectRoutes(app: FastifyInstance) {
  app.get('/edit/v1/inspect', async (req, reply) => {
    const { url } = req.query as { url?: string };

    if (!url) {
      return reply.status(400).send({
        success: false,
        message: 'Missing required query parameter: url',
      });
    }

    try {
      const metadata = await inspectMedia(url);

      return reply.status(200).send({
        success: true,
        response: {
          url,
          metadata,
        },
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: `Failed to inspect media: ${error.message}`,
      });
    }
  });
}
