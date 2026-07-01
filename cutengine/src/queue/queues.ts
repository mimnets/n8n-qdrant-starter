import { Queue } from 'bullmq';
import { getRedisConnection } from './connection.js';
import type IORedis from 'ioredis';

export interface AppQueues {
  render: Queue;
  ingest: Queue;
  create: Queue;
  transfer: Queue;
  'gpu-scheduler': Queue;
}

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

export function createQueues(conn?: IORedis): AppQueues {
  const connection = conn ?? getRedisConnection();

  const baseOpts = {
    connection,
    defaultJobOptions,
  };

  return {
    render: new Queue('render', {
      ...baseOpts,
      // @ts-expect-error timeout removed in BullMQ v5 type defs but still works at runtime
      defaultJobOptions: { ...defaultJobOptions, timeout: 600000 },
    }),
    ingest: new Queue('ingest', {
      ...baseOpts,
      // @ts-expect-error timeout removed in BullMQ v5 type defs but still works at runtime
      defaultJobOptions: { ...defaultJobOptions, timeout: 300000 },
    }),
    create: new Queue('create', {
      ...baseOpts,
      // @ts-expect-error timeout removed in BullMQ v5 type defs but still works at runtime
      defaultJobOptions: { ...defaultJobOptions, timeout: 300000 },
    }),
    transfer: new Queue('transfer', {
      ...baseOpts,
      // @ts-expect-error timeout removed in BullMQ v5 type defs but still works at runtime
      defaultJobOptions: { ...defaultJobOptions, timeout: 120000 },
    }),
    'gpu-scheduler': new Queue('gpu-scheduler', {
      ...baseOpts,
      defaultJobOptions: {
        ...defaultJobOptions,
        attempts: 5,
        backoff: { type: 'exponential' as const, delay: 5000 },
        // @ts-expect-error timeout removed in BullMQ v5 type defs but still works at runtime
        timeout: 600000,
      },
    }),
  };
}
