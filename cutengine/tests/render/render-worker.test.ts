import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ioredis
vi.mock('ioredis', () => {
  class RedisMock {
    status = 'ready';
    options = { maxRetriesPerRequest: null };
    disconnect() {}
    duplicate() { return new RedisMock(); }
  }
  return { default: RedisMock };
});

// Mock bullmq Worker to capture the processor
vi.mock('bullmq', () => {
  class MockWorker {
    name: string;
    processor: any;
    opts: any;
    constructor(name: string, processor: any, opts: any) {
      this.name = name;
      this.processor = processor;
      this.opts = opts;
    }
    async close() {}
    async processJob(data: any) {
      const job = { data, id: 'test-job-id' };
      return this.processor(job);
    }
  }
  return {
    Worker: MockWorker,
    Queue: class MockQueue {
      name: string;
      constructor(name: string) { this.name = name; }
      async close() {}
    },
    Job: class {},
  };
});

// Mock the pipeline
vi.mock('../../src/render/pipeline.js', () => ({
  executePipeline: vi.fn(),
}));

// Mock fs.mkdirSync
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
  };
});

import { createRenderWorker } from '../../src/queue/workers/render-worker.js';
import { executePipeline } from '../../src/render/pipeline.js';
import { getDb, schema } from '../../src/db/index.js';
import { eq } from 'drizzle-orm';

const mockExecutePipeline = vi.mocked(executePipeline);

describe('createRenderWorker', () => {
  let db: ReturnType<typeof getDb>;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = getDb(':memory:', { migrate: true });
  });

  async function insertRender(id: string) {
    await db.insert(schema.renders).values({
      id,
      status: 'queued',
      timeline: JSON.stringify({ tracks: [{ clips: [] }] }),
      output: JSON.stringify({ format: 'mp4', resolution: 'hd' }),
    });
  }

  it('creates a worker for the render queue', () => {
    const worker = createRenderWorker(db);
    expect(worker).toBeDefined();
    expect((worker as any).name).toBe('render');
  });

  it('processes a job and updates DB status to done', async () => {
    const renderId = 'test-render-001';
    await insertRender(renderId);

    mockExecutePipeline.mockResolvedValue({
      outputPath: '/tmp/renders/test-render-001/output.mp4',
      format: 'mp4',
      duration: 5,
    });

    const worker = createRenderWorker(db);
    await (worker as any).processJob({
      renderId,
      timeline: JSON.stringify({ tracks: [{ clips: [] }] }),
      output: JSON.stringify({ format: 'mp4', resolution: 'hd' }),
    });

    const [render] = await db.select().from(schema.renders).where(eq(schema.renders.id, renderId));
    expect(render.status).toBe('done');
    expect(render.url).toContain(`/serve/v1/assets/${renderId}/output.mp4`);
  });

  it('on failure updates DB status to failed with error message', async () => {
    const renderId = 'test-render-002';
    await insertRender(renderId);

    mockExecutePipeline.mockRejectedValue(new Error('FFmpeg crashed'));

    const worker = createRenderWorker(db);

    await expect(
      (worker as any).processJob({
        renderId,
        timeline: JSON.stringify({ tracks: [{ clips: [] }] }),
        output: JSON.stringify({ format: 'mp4', resolution: 'hd' }),
      }),
    ).rejects.toThrow('FFmpeg crashed');

    const [render] = await db.select().from(schema.renders).where(eq(schema.renders.id, renderId));
    expect(render.status).toBe('failed');
    expect(render.error).toBe('FFmpeg crashed');
  });

  it('updates status during pipeline execution via onStatus callback', async () => {
    const renderId = 'test-render-003';
    await insertRender(renderId);

    const statusesRecorded: string[] = [];
    mockExecutePipeline.mockImplementation(async (_editJson, _workDir, onStatus) => {
      await onStatus?.('fetching');
      statusesRecorded.push('fetching');
      await onStatus?.('rendering');
      statusesRecorded.push('rendering');
      await onStatus?.('saving');
      statusesRecorded.push('saving');
      return { outputPath: '/tmp/output.mp4', format: 'mp4', duration: 5 };
    });

    const worker = createRenderWorker(db);
    await (worker as any).processJob({
      renderId,
      timeline: JSON.stringify({ tracks: [{ clips: [] }] }),
      output: JSON.stringify({ format: 'mp4', resolution: 'hd' }),
    });

    expect(statusesRecorded).toEqual(['fetching', 'rendering', 'saving']);
  });
});
