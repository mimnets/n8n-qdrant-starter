// src/gpu/vram-budget-tracker.ts — Redis-based VRAM accounting system

import type IORedis from 'ioredis';
import { getRedisConnection } from '../queue/connection.js';
import { config } from '../config/index.js';
import type { GPUSchedulerStatus } from './types.js';

// ---------------------------------------------------------------------------
// Redis Lua scripts (run atomically on the Redis server)
// ---------------------------------------------------------------------------

/**
 * RESERVE_LUA — atomically checks capacity + coexistence constraints,
 * then adds the model to the reservations hash if allowed.
 *
 * KEYS[1] = vram hash key  (e.g. gstack:gpu:gpu-0:vram)
 * ARGV[1] = model name
 * ARGV[2] = requested GB (number as string)
 *
 * Returns 1 on success, 0 if the reservation was rejected.
 */
const RESERVE_LUA = `
local hash_key   = KEYS[1]
local model      = ARGV[1]
local requested  = tonumber(ARGV[2])

local total_gb         = tonumber(redis.call('HGET', hash_key, 'total_gb') or '0')
local safety_margin_gb = tonumber(redis.call('HGET', hash_key, 'safety_margin_gb') or '0')
local reservations_raw = redis.call('HGET', hash_key, 'reservations')

local reservations = {}
if reservations_raw and reservations_raw ~= '' then
  reservations = cjson.decode(reservations_raw)
end

-- Forbidden pairs: flux-klein + hunyuan cannot coexist
if model == 'flux-klein' and reservations['hunyuan'] then
  return 0
end
if model == 'hunyuan' and reservations['flux-klein'] then
  return 0
end

-- flux-dev requires exclusive GPU (only fish-speech allowed alongside)
if model == 'flux-dev' then
  for k, v in pairs(reservations) do
    if k ~= 'fish-speech' then
      return 0
    end
  end
end
if reservations['flux-dev'] and model ~= 'fish-speech' then
  return 0
end

-- Sum current reservations
local used = 0
for k, v in pairs(reservations) do
  used = used + tonumber(v)
end

-- Strict less-than (NOT <=)
if used + requested < total_gb - safety_margin_gb then
  reservations[model] = requested
  redis.call('HSET', hash_key, 'reservations', cjson.encode(reservations))
  return 1
end

return 0
`;

/**
 * RELEASE_LUA — idempotently removes a model from the reservations JSON.
 *
 * KEYS[1] = vram hash key
 * ARGV[1] = model name
 *
 * Returns 1 always (idempotent).
 */
const RELEASE_LUA = `
local hash_key         = KEYS[1]
local model            = ARGV[1]
local reservations_raw = redis.call('HGET', hash_key, 'reservations')

local reservations = {}
if reservations_raw and reservations_raw ~= '' then
  reservations = cjson.decode(reservations_raw)
end

reservations[model] = nil
redis.call('HSET', hash_key, 'reservations', cjson.encode(reservations))
return 1
`;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function vramKey(gpuId: string): string {
  return `gstack:gpu:${gpuId}:vram`;
}

function ttlKey(gpuId: string, model: string): string {
  return `gstack:gpu:${gpuId}:ttl:${model}`;
}

// ---------------------------------------------------------------------------
// VRAMBudgetTracker
// ---------------------------------------------------------------------------

export class VRAMBudgetTracker {
  private readonly redis: IORedis;
  private readonly gpuId: string;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(redis?: IORedis, gpuId?: string) {
    this.redis = redis ?? getRedisConnection();
    this.gpuId = gpuId ?? config.gpuScheduler.gpu_id;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Creates the Redis hash if it does not exist yet and pins fish-speech as
   * a permanent reservation (2 GB).
   */
  async initialize(): Promise<void> {
    const key = vramKey(this.gpuId);

    // Only create the hash if it does not already exist
    const exists = await this.redis.exists(key);
    if (!exists) {
      await this.redis.hset(key, {
        total_gb: config.gpuScheduler.total_gb,
        safety_margin_gb: config.gpuScheduler.safety_margin_gb,
        reservations: JSON.stringify({}),
      });
    }

    // fish-speech is always present (2 GB) — set unconditionally so
    // repeated initialize() calls are idempotent.
    const raw = await this.redis.hget(key, 'reservations');
    const reservations: Record<string, number> = raw ? JSON.parse(raw) : {};

    if (!reservations['fish-speech']) {
      reservations['fish-speech'] = 2;
      await this.redis.hset(key, 'reservations', JSON.stringify(reservations));
    }
  }

  // -------------------------------------------------------------------------
  // Core operations
  // -------------------------------------------------------------------------

  /**
   * Attempts to reserve `gb` GB for `model`.
   * Returns true on success, false if rejected (insufficient VRAM or
   * coexistence violation).
   */
  async reserve(model: string, gb: number): Promise<boolean> {
    // redis.eval() executes a Lua script atomically on the Redis server.
    // This is NOT JavaScript eval — it is the ioredis API for server-side Lua.
    const result = await (this.redis as any).eval(
      RESERVE_LUA,
      1,
      vramKey(this.gpuId),
      model,
      String(gb),
    ) as number;

    if (result === 1) {
      await this.redis.set(
        ttlKey(this.gpuId, model),
        '1',
        'EX',
        config.gpuScheduler.ttl_seconds,
      );
    }

    return result === 1;
  }

  /**
   * Releases the reservation for `model` (idempotent).
   */
  async release(model: string): Promise<void> {
    await (this.redis as any).eval(
      RELEASE_LUA,
      1,
      vramKey(this.gpuId),
      model,
    );

    await this.redis.del(ttlKey(this.gpuId, model));
  }

  /**
   * Extends the TTL of the liveness key for `model`.
   */
  async refreshTTL(model: string): Promise<void> {
    await this.redis.expire(
      ttlKey(this.gpuId, model),
      config.gpuScheduler.ttl_seconds,
    );
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  /** Returns the current GPU scheduler status. */
  async getStatus(): Promise<GPUSchedulerStatus> {
    const key = vramKey(this.gpuId);
    const [totalRaw, safetyRaw, reservationsRaw] = await Promise.all([
      this.redis.hget(key, 'total_gb'),
      this.redis.hget(key, 'safety_margin_gb'),
      this.redis.hget(key, 'reservations'),
    ]);

    const total_gb = Number(totalRaw ?? config.gpuScheduler.total_gb);
    const safety_margin_gb = Number(safetyRaw ?? config.gpuScheduler.safety_margin_gb);
    const reservations: Record<string, number> = reservationsRaw
      ? JSON.parse(reservationsRaw)
      : {};

    const used_gb = Object.values(reservations).reduce((a, b) => a + b, 0);
    const available_gb = total_gb - safety_margin_gb - used_gb;

    return {
      gpu_id: this.gpuId,
      total_gb,
      available_gb,
      safety_margin_gb,
      reservations,
      queue_depth: 0,
      // GPUStatus fields
      model: null,
      vram_used_gb: used_gb,
      vram_total_gb: total_gb,
      utilization_pct: total_gb > 0 ? Math.round((used_gb / total_gb) * 100) : 0,
      is_busy: available_gb <= 0,
      last_updated: new Date().toISOString(),
    } as unknown as GPUSchedulerStatus;
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  /**
   * Checks all active reservations; releases any whose TTL key has expired.
   * fish-speech is never released by cleanup (permanent reservation).
   */
  async cleanupExpired(): Promise<void> {
    const key = vramKey(this.gpuId);
    const raw = await this.redis.hget(key, 'reservations');
    if (!raw) return;

    const reservations: Record<string, number> = JSON.parse(raw);

    await Promise.all(
      Object.keys(reservations).map(async (model) => {
        if (model === 'fish-speech') return; // permanent — never clean up

        const exists = await this.redis.exists(ttlKey(this.gpuId, model));
        if (!exists) {
          await this.release(model);
        }
      }),
    );
  }

  /** Starts a periodic cleanup loop (every `cleanup_interval_seconds`). */
  startCleanupLoop(): void {
    if (this.cleanupTimer) return;
    const intervalMs = config.gpuScheduler.cleanup_interval_seconds * 1000;
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired().catch(() => {/* swallow errors in background loop */});
    }, intervalMs);
  }

  /** Stops the periodic cleanup loop. */
  stopCleanupLoop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}
