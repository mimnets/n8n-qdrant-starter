import { describe, it, expect, vi, afterAll } from 'vitest';

// Mock ioredis before importing queues
vi.mock('ioredis', () => {
  class RedisMock {
    status = 'ready';
    options = { maxRetriesPerRequest: null };
    disconnect() {}
    duplicate() { return new RedisMock(); }
  }
  return { default: RedisMock };
});

import { createQueues } from '../../src/queue/queues.js';
import IORedis from 'ioredis';

describe('Queue Setup', () => {
  const mockConn = new IORedis() as any;
  const queues = createQueues(mockConn);

  afterAll(async () => {
    await Promise.all(
      Object.values(queues).map((q) => q.close()),
    );
  });

  it('should create all four queues', () => {
    expect(queues.render).toBeDefined();
    expect(queues.ingest).toBeDefined();
    expect(queues.create).toBeDefined();
    expect(queues.transfer).toBeDefined();
  });

  it('should assign correct queue names', () => {
    expect(queues.render.name).toBe('render');
    expect(queues.ingest.name).toBe('ingest');
    expect(queues.create.name).toBe('create');
    expect(queues.transfer.name).toBe('transfer');
  });

  it('render queue should have 600s timeout', () => {
    const opts = queues.render.defaultJobOptions;
    expect(opts.timeout).toBe(600000);
  });

  it('transfer queue should have 120s timeout', () => {
    const opts = queues.transfer.defaultJobOptions;
    expect(opts.timeout).toBe(120000);
  });

  it('all queues should have exponential backoff with 3 attempts', () => {
    for (const q of Object.values(queues)) {
      const opts = q.defaultJobOptions;
      expect(opts.attempts).toBe(3);
      expect(opts.backoff).toEqual({ type: 'exponential', delay: 2000 });
    }
  });
});
