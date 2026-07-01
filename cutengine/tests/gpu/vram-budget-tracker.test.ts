// tests/gpu/vram-budget-tracker.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import IORedis from 'ioredis';
import { VRAMBudgetTracker } from '../../src/gpu/vram-budget-tracker.js';

const TEST_GPU_ID = 'test-gpu';

/** All Redis keys used by the test GPU */
function testKeys(redis: IORedis): Promise<string[]> {
  return redis.keys(`gstack:gpu:${TEST_GPU_ID}:*`);
}

/** Delete all test-gpu Redis keys */
async function cleanupRedisKeys(redis: IORedis): Promise<void> {
  const keys = await testKeys(redis);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

describe('VRAMBudgetTracker', () => {
  let redis: IORedis;
  let tracker: VRAMBudgetTracker;

  beforeEach(async () => {
    redis = new IORedis('redis://localhost:6379', { maxRetriesPerRequest: null });
    await cleanupRedisKeys(redis);
    tracker = new VRAMBudgetTracker(redis, TEST_GPU_ID);
    await tracker.initialize();
  });

  afterEach(async () => {
    tracker.stopCleanupLoop();
    await cleanupRedisKeys(redis);
    await redis.quit();
  });

  // -------------------------------------------------------------------------

  it('should reserve VRAM for a model (flux-klein 8 GB)', async () => {
    const ok = await tracker.reserve('flux-klein', 8);
    expect(ok).toBe(true);

    const status = await tracker.getStatus();
    expect(status.reservations['flux-klein']).toBe(8);
    // fish-speech (2) + flux-klein (8) = 10 used; total 24 − safety 2 = 22 budget
    expect(status.available_gb).toBe(12); // 22 − 10
  });

  // -------------------------------------------------------------------------

  it('should reject when VRAM is insufficient', async () => {
    // hunyuan 14 GB reserved first; fish-speech already takes 2 GB → used = 16
    const ok1 = await tracker.reserve('hunyuan', 14);
    expect(ok1).toBe(true);

    // used = 16, requested = 8 → 16 + 8 = 24, budget = 22 → 24 >= 22 → reject
    const ok2 = await tracker.reserve('flux-klein', 8);
    expect(ok2).toBe(false);
  });

  // -------------------------------------------------------------------------

  it('should enforce forbidden pairs (flux-klein blocks hunyuan)', async () => {
    const ok1 = await tracker.reserve('flux-klein', 8);
    expect(ok1).toBe(true);

    const ok2 = await tracker.reserve('hunyuan', 14);
    expect(ok2).toBe(false);
  });

  // -------------------------------------------------------------------------

  it('should release VRAM idempotently', async () => {
    await tracker.reserve('flux-klein', 8);
    await tracker.release('flux-klein');

    // Second release must not throw
    await expect(tracker.release('flux-klein')).resolves.toBeUndefined();

    const status = await tracker.getStatus();
    expect(status.reservations['flux-klein']).toBeUndefined();
  });

  // -------------------------------------------------------------------------

  it('should keep fish-speech as a permanent reservation after initialize()', async () => {
    const status = await tracker.getStatus();
    expect(status.reservations['fish-speech']).toBe(2);
  });

  // -------------------------------------------------------------------------

  it('should clean up expired reservations (simulate orphan by deleting TTL key)', async () => {
    await tracker.reserve('flux-klein', 8);

    // Manually remove the TTL liveness key to simulate an expired reservation
    await redis.del(`gstack:gpu:${TEST_GPU_ID}:ttl:flux-klein`);

    await tracker.cleanupExpired();

    const status = await tracker.getStatus();
    expect(status.reservations['flux-klein']).toBeUndefined();
    // fish-speech must survive cleanup
    expect(status.reservations['fish-speech']).toBe(2);
  });
});
