import { readFileSync, existsSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { config as loadDotenv } from 'dotenv';

loadDotenv();

function loadConfigFile(): Record<string, any> {
  const paths = ['config.yaml', 'config.yml'];
  for (const p of paths) {
    if (existsSync(p)) {
      return parseYaml(readFileSync(p, 'utf-8')) ?? {};
    }
  }
  return {};
}

const file = loadConfigFile();

export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  host: process.env.HOST ?? '0.0.0.0',
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  chromium: {
    wsEndpoint: process.env.CHROMIUM_WS ?? 'ws://localhost:3001',
    assetBaseUrl: process.env.CHROMIUM_ASSET_BASE ?? '',
  },
  storage: {
    driver: (process.env.STORAGE_DRIVER ?? 'local') as 'local' | 's3',
    path: process.env.STORAGE_PATH ?? './data/assets',
    s3: {
      endpoint: process.env.S3_ENDPOINT,
      bucket: process.env.S3_BUCKET ?? 'cutengine',
      accessKey: process.env.S3_ACCESS_KEY,
      secretKey: process.env.S3_SECRET_KEY,
    },
  },
  db: {
    driver: (process.env.DB_DRIVER ?? 'sqlite') as 'sqlite' | 'pg',
    sqlitePath: process.env.SQLITE_PATH ?? './data/cutengine.db',
    pgUrl: process.env.DATABASE_URL,
  },
  auth: {
    enabled: process.env.AUTH_ENABLED === 'true',
    apiKeys: (process.env.API_KEYS ?? '').split(',').filter(Boolean),
    jwtSecret: process.env.JWT_SECRET ?? '',
  },
  create: file.create ?? {},
  gpu: {
    enabled: process.env.GPU_ENABLED === 'true',
    vramBudget: parseInt(process.env.GPU_VRAM_BUDGET ?? '22528', 10),
    swapStrategy: process.env.GPU_SWAP_STRATEGY ?? 'queue',
    concurrency: parseInt(process.env.GPU_CONCURRENCY ?? '1', 10),
  },
  comfyui: {
    host: process.env.COMFYUI_HOST ?? 'localhost',
    port: parseInt(process.env.COMFYUI_PORT ?? '8188', 10),
    protocol: (process.env.COMFYUI_PROTOCOL ?? 'ws') as 'ws' | 'wss',
  },
  hunyuan: {
    host: process.env.HUNYUAN_HOST ?? 'localhost',
    port: parseInt(process.env.HUNYUAN_PORT ?? '8190', 10),
    enableStepDistill: process.env.HUNYUAN_STEP_DISTILL !== 'false',
    cpuOffload: process.env.HUNYUAN_CPU_OFFLOAD !== 'false',
  },
  voicecore: {
    host: process.env.VOICECORE_HOST ?? 'localhost',
    port: parseInt(process.env.VOICECORE_PORT ?? '8080', 10),
    enabled: process.env.VOICECORE_ENABLED === 'true',
  },
  qc: {
    enabled: process.env.QC_ENABLED === 'true',
    clipThreshold: parseFloat(process.env.QC_CLIP_THRESHOLD ?? '0.25'),
    aestheticThreshold: parseFloat(process.env.QC_AESTHETIC_THRESHOLD ?? '5.0'),
    nsfwThreshold: parseFloat(process.env.QC_NSFW_THRESHOLD ?? '0.3'),
  },
  profilecore: {
    enabled: process.env.PROFILECORE_ENABLED === 'true',
    host: process.env.PROFILECORE_HOST ?? 'localhost',
    port: parseInt(process.env.PROFILECORE_PORT ?? '3001', 10),
    mode: (process.env.PROFILECORE_MODE ?? 'http') as 'http' | 'cli',
    cliPath: process.env.PROFILECORE_CLI_PATH,
  },
  cubeinsight: {
    enabled: process.env.CUBEINSIGHT_ENABLED === 'true',
    host: process.env.CUBEINSIGHT_HOST ?? 'localhost',
    port: parseInt(process.env.CUBEINSIGHT_PORT ?? '8000', 10),
    api_key: process.env.CUBEINSIGHT_API_KEY,
  },
  gpuScheduler: {
    enabled: process.env.GPU_SCHEDULER_ENABLED === 'true',
    gpu_id: process.env.GPU_ID ?? 'gpu-0',
    total_gb: parseInt(process.env.GPU_TOTAL_GB ?? '24', 10),
    safety_margin_gb: parseInt(process.env.GPU_SAFETY_MARGIN_GB ?? '2', 10),
    ttl_seconds: parseInt(process.env.GPU_RESERVATION_TTL ?? '60', 10),
    cleanup_interval_seconds: parseInt(process.env.GPU_CLEANUP_INTERVAL ?? '30', 10),
    max_swap_timeout_ms: parseInt(process.env.GPU_MAX_SWAP_TIMEOUT ?? '30000', 10),
  },
  encoder: {
    codec: process.env.ENCODER_CODEC ?? 'auto',
    crf: process.env.ENCODER_CRF ? parseInt(process.env.ENCODER_CRF, 10) : undefined,
  },
  compositor: {
    enabled: process.env.COMPOSITOR_ENABLED !== 'false',
    forceMode: (process.env.COMPOSITOR_FORCE as 'ffmpeg' | 'puppeteer' | 'auto') ?? 'auto',
    cacheEnabled: process.env.COMPOSITOR_CACHE !== 'false',
    parallelWorkers: parseInt(process.env.COMPOSITOR_WORKERS ?? '0', 10),
  },
} as const;
