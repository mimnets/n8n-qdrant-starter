import { Worker, Job } from 'bullmq';
import { getRedisConnection } from '../connection.js';
import { getDb, schema } from '../../db/index.js';
import { eq } from 'drizzle-orm';
import { mkdirSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import { config } from '../../config/index.js';

export function createIngestWorker(db?: ReturnType<typeof getDb>) {
  const database = db ?? getDb();

  const worker = new Worker('ingest', async (job: Job) => {
    const { sourceId, url } = job.data;

    // Update status to importing
    await database.update(schema.sources)
      .set({ status: 'importing' as any })
      .where(eq(schema.sources.id, sourceId));

    try {
      // Download file from URL
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download: HTTP ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      // Determine filename from URL
      const urlObj = new URL(url);
      const filename = basename(urlObj.pathname) || 'source';

      // Save to local storage
      const dir = join(config.storage.path, 'sources', sourceId);
      mkdirSync(dir, { recursive: true });
      const filePath = join(dir, filename);
      writeFileSync(filePath, buffer);

      // Update source status to ready
      await database.update(schema.sources)
        .set({ status: 'ready' as any, localPath: filePath })
        .where(eq(schema.sources.id, sourceId));

      return { sourceId, localPath: filePath };
    } catch (error: any) {
      // Update source status to failed
      await database.update(schema.sources)
        .set({ status: 'failed' as any, error: error.message })
        .where(eq(schema.sources.id, sourceId));
      throw error;
    }
  }, {
    connection: getRedisConnection(),
    concurrency: 4,
  });

  return worker;
}
