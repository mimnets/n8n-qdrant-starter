import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { schema } from '../db/index.js';
import type { AppQueues } from '../queue/queues.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: BetterSQLite3Database<typeof schema>;
    queues: AppQueues | null;
  }
}
