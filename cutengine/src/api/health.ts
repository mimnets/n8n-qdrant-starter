import { FastifyInstance } from 'fastify';
import { execFile } from 'child_process';
import { statfsSync } from 'fs';
import { config } from '../config/index.js';
import { getRedisConnection } from '../queue/connection.js';

const startedAt = Date.now();

interface CheckResult {
  status: 'ok' | 'error';
  [key: string]: unknown;
}

async function checkRedis(timeoutMs = 3000): Promise<CheckResult> {
  const start = Date.now();
  try {
    const redis = getRedisConnection();
    const result = await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), timeoutMs),
      ),
    ]);
    if (result !== 'PONG') throw new Error(`unexpected: ${result}`);
    return { status: 'ok', latency: Date.now() - start };
  } catch {
    return { status: 'error', latency: Date.now() - start };
  }
}

async function checkChromium(timeoutMs = 5000): Promise<CheckResult> {
  const start = Date.now();
  try {
    const wsUrl = config.chromium.wsEndpoint;
    const httpUrl = wsUrl.replace(/^ws/, 'http').replace(/\/devtools\/.*$/, '');
    const res = await Promise.race([
      fetch(`${httpUrl}/json/version`),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), timeoutMs),
      ),
    ]);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { status: 'ok', latency: Date.now() - start };
  } catch {
    return { status: 'error', latency: Date.now() - start };
  }
}

async function checkFFmpeg(timeoutMs = 3000): Promise<CheckResult> {
  return new Promise((resolve) => {
    const child = execFile('ffmpeg', ['-version'], { timeout: timeoutMs }, (err, stdout) => {
      if (err) {
        resolve({ status: 'error' });
        return;
      }
      const match = stdout.match(/ffmpeg version (\S+)/);
      resolve({ status: 'ok', version: match?.[1] ?? 'unknown' });
    });
    child.on('error', () => resolve({ status: 'error' }));
  });
}

function checkDisk(): CheckResult {
  try {
    const stats = statfsSync(config.storage.path);
    const freeGb = Math.round((stats.bfree * stats.bsize) / (1024 ** 3) * 10) / 10;
    return { status: freeGb < 1 ? 'error' : 'ok', free_gb: freeGb, path: config.storage.path };
  } catch {
    return { status: 'error', path: config.storage.path };
  }
}

function checkGpu(): CheckResult {
  if (!config.gpu.enabled) {
    return { status: 'ok', enabled: false };
  }
  return { status: 'ok', enabled: true, vram_budget_mb: config.gpu.vramBudget };
}

type OverallStatus = 'ok' | 'degraded' | 'error';

function resolveStatus(checks: Record<string, CheckResult>): OverallStatus {
  const critical = ['redis', 'ffmpeg'];
  for (const key of critical) {
    if (checks[key]?.status === 'error') return 'error';
  }
  for (const result of Object.values(checks)) {
    if (result.status === 'error') return 'degraded';
  }
  return 'ok';
}

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (req, reply) => {
    const detail = (req.query as Record<string, string>).detail === '1';
    const uptime = Math.floor((Date.now() - startedAt) / 1000);

    if (!detail) {
      return reply.send({ status: 'ok', uptime, version: '0.4.0' });
    }

    const [redis, chromium, ffmpeg] = await Promise.all([
      checkRedis(),
      checkChromium(),
      checkFFmpeg(),
    ]);
    const disk = checkDisk();
    const gpu = checkGpu();

    const checks = { redis, chromium, ffmpeg, disk, gpu };
    const status = resolveStatus(checks);
    const code = status === 'error' ? 503 : 200;

    return reply.code(code).send({ status, uptime, version: '0.4.0', checks });
  });
}
