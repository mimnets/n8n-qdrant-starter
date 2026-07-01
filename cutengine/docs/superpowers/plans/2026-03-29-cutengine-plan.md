# CutEngine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shotstack API v1 풀 호환 셀프호스팅 영상 렌더 엔진을 구축한다.

**Architecture:** 모듈러 모놀리스 — Fastify API + BullMQ 큐 + Puppeteer 프레임 캡처 + FFmpeg 인코딩. 5개 모듈(API, Queue, Render, Template, Asset)이 하나의 프로세스에서 동작하되 명확한 경계를 유지.

**Tech Stack:** TypeScript, Fastify, BullMQ, Redis, Puppeteer, FFmpeg, Sharp, Drizzle ORM, SQLite, Vitest, Docker

**Spec:** `docs/superpowers/specs/2026-03-29-cutengine-design.md`

---

## Phase 1: Foundation (프로젝트 초기화 + 인프라)

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/index.ts`
- Create: `src/config/index.ts`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Initialize git repo**

```bash
cd /Users/james_cafe24/영상편집기
git init
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "cutengine",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 3: Install core dependencies**

```bash
pnpm add fastify @fastify/cors @fastify/static bullmq ioredis puppeteer-core sharp drizzle-orm better-sqlite3 ajv pino nanoid dotenv yaml
pnpm add -D typescript tsx vitest @types/node @types/better-sqlite3 drizzle-kit
```

- [ ] **Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 5: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
});
```

- [ ] **Step 6: Create config module**

File: `src/config/index.ts`
```typescript
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
  },
  create: file.create ?? {},
} as const;
```

- [ ] **Step 7: Create entry point**

File: `src/index.ts`
```typescript
import { config } from './config/index.js';

console.log(`CutEngine v0.1.0 starting on port ${config.port}...`);
```

- [ ] **Step 8: Create .gitignore and .env.example**

`.gitignore`:
```
node_modules/
dist/
data/
.env
*.db
.superpowers/
```

`.env.example`:
```
PORT=3000
REDIS_URL=redis://localhost:6379
CHROMIUM_WS=ws://localhost:3001
STORAGE_DRIVER=local
STORAGE_PATH=./data/assets
DB_DRIVER=sqlite
SQLITE_PATH=./data/cutengine.db
AUTH_ENABLED=false
API_KEYS=
```

- [ ] **Step 9: Verify project runs**

```bash
pnpm dev
```
Expected: `CutEngine v0.1.0 starting on port 3000...`

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: project scaffolding with config module"
```

---

### Task 2: Database Schema + Drizzle ORM

**Files:**
- Create: `src/db/schema.ts`
- Create: `src/db/index.ts`
- Create: `tests/db/schema.test.ts`

- [ ] **Step 1: Write test for DB connection and render table**

File: `tests/db/schema.test.ts`
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb } from '../../src/db/index.js';

describe('Database Schema', () => {
  let db: ReturnType<typeof getDb>;

  beforeAll(() => {
    db = getDb(':memory:');
  });

  it('should create renders table', () => {
    const result = db.select().from('renders').all();
    expect(Array.isArray(result)).toBe(true);
  });

  it('should insert and query a render', () => {
    // Will be implemented with actual Drizzle queries
  });
});
```

- [ ] **Step 2: Create schema**

File: `src/db/schema.ts`
```typescript
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const renders = sqliteTable('renders', {
  id: text('id').primaryKey(),
  status: text('status', { enum: ['queued', 'fetching', 'rendering', 'saving', 'done', 'failed'] }).notNull().default('queued'),
  timeline: text('timeline').notNull(),        // Shotstack JSON
  output: text('output'),                       // Output config JSON
  url: text('url'),                             // Result URL
  poster: text('poster'),                       // Poster URL
  thumbnail: text('thumbnail'),                 // Thumbnail URL
  error: text('error'),
  callback: text('callback'),                   // Webhook URL
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const templates = sqliteTable('templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  template: text('template').notNull(),         // Shotstack Edit JSON
  version: integer('version').notNull().default(1),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  renderId: text('render_id').references(() => renders.id),
  type: text('type', { enum: ['video', 'image', 'audio'] }).notNull(),
  status: text('status', { enum: ['queued', 'ready', 'failed', 'deleted'] }).notNull().default('queued'),
  url: text('url'),
  filename: text('filename'),
  size: integer('size'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(),
  url: text('url').notNull(),
  status: text('status', { enum: ['queued', 'importing', 'ready', 'failed'] }).notNull().default('queued'),
  localPath: text('local_path'),
  error: text('error'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});
```

- [ ] **Step 3: Create DB connection factory**

File: `src/db/index.ts`
```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';
import { config } from '../config/index.js';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

export function getDb(path?: string) {
  const dbPath = path ?? config.db.sqlitePath;
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  return db;
}

export { schema };
```

- [ ] **Step 4: Run tests**

```bash
pnpm test
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: database schema with Drizzle ORM (renders, templates, assets, sources)"
```

---

### Task 3: Fastify Server + Health Check

**Files:**
- Create: `src/server.ts`
- Modify: `src/index.ts`
- Create: `tests/api/health.test.ts`

- [ ] **Step 1: Write test for health endpoint**

File: `tests/api/health.test.ts`
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';

describe('Health Check', () => {
  let app: Awaited<ReturnType<typeof createServer>>;

  beforeAll(async () => {
    app = await createServer({ testing: true });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET / returns 200 with version', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.name).toBe('cutengine');
    expect(body.version).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/api/health.test.ts
```
Expected: FAIL — `createServer` not found

- [ ] **Step 3: Create server**

File: `src/server.ts`
```typescript
import Fastify from 'fastify';
import cors from '@fastify/cors';

export async function createServer(opts?: { testing?: boolean }) {
  const app = Fastify({
    logger: opts?.testing ? false : {
      transport: { target: 'pino-pretty' },
    },
  });

  await app.register(cors);

  app.get('/', async () => ({
    name: 'cutengine',
    version: '0.1.0',
    status: 'ok',
  }));

  if (!opts?.testing) {
    await app.ready();
  }

  return app;
}
```

- [ ] **Step 4: Update entry point**

File: `src/index.ts`
```typescript
import { config } from './config/index.js';
import { createServer } from './server.js';

async function main() {
  const app = await createServer();
  await app.listen({ port: config.port, host: config.host });
  console.log(`CutEngine v0.1.0 listening on ${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 5: Run test**

```bash
pnpm test tests/api/health.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: Fastify server with health check endpoint"
```

---

### Task 4: Docker Compose Infrastructure

**Files:**
- Create: `docker/Dockerfile`
- Create: `docker/docker-compose.yml`
- Create: `docker/docker-compose.dev.yml`

- [ ] **Step 1: Create Dockerfile**

File: `docker/Dockerfile`
```dockerfile
FROM node:20-slim AS base
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM base AS runtime
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Create docker-compose.yml**

File: `docker/docker-compose.yml`
```yaml
services:
  cutengine:
    build:
      context: ..
      dockerfile: docker/Dockerfile
    ports:
      - "3000:3000"
    depends_on:
      redis:
        condition: service_healthy
    environment:
      - REDIS_URL=redis://redis:6379
      - CHROMIUM_WS=ws://chromium:3000
      - STORAGE_DRIVER=local
      - STORAGE_PATH=/data/assets
    volumes:
      - assets:/data/assets
      - db:/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  chromium:
    image: browserless/chrome:latest
    ports:
      - "3001:3000"
    environment:
      - MAX_CONCURRENT_SESSIONS=4
      - CONNECTION_TIMEOUT=600000

volumes:
  assets:
  db:
```

- [ ] **Step 3: Create dev compose override**

File: `docker/docker-compose.dev.yml`
```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  chromium:
    image: browserless/chrome:latest
    ports:
      - "3001:3000"
    environment:
      - MAX_CONCURRENT_SESSIONS=2
```

- [ ] **Step 4: Test dev infra starts**

```bash
docker compose -f docker/docker-compose.dev.yml up -d
docker compose -f docker/docker-compose.dev.yml ps
```
Expected: redis and chromium running

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: Docker Compose infrastructure (redis, chromium, production Dockerfile)"
```

---

## Phase 2: Edit API + Job Queue (핵심 렌더 파이프라인 빼대)

### Task 5: BullMQ Queue Setup

**Files:**
- Create: `src/queue/queues.ts`
- Create: `src/queue/connection.ts`
- Create: `tests/queue/queues.test.ts`

- [ ] **Step 1: Write test for queue creation**

File: `tests/queue/queues.test.ts`
```typescript
import { describe, it, expect } from 'vitest';
import { createQueues } from '../../src/queue/queues.js';

describe('Queue Setup', () => {
  it('should create all four queues', () => {
    const queues = createQueues();
    expect(queues.render).toBeDefined();
    expect(queues.ingest).toBeDefined();
    expect(queues.create).toBeDefined();
    expect(queues.transfer).toBeDefined();
  });
});
```

- [ ] **Step 2: Create Redis connection factory**

File: `src/queue/connection.ts`
```typescript
import IORedis from 'ioredis';
import { config } from '../config/index.js';

let connection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(config.redis.url, { maxRetriesPerRequest: null });
  }
  return connection;
}
```

- [ ] **Step 3: Create queue definitions**

File: `src/queue/queues.ts`
```typescript
import { Queue } from 'bullmq';
import { getRedisConnection } from './connection.js';

const defaultOpts = {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 2000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
};

export function createQueues() {
  return {
    render: new Queue('render', {
      ...defaultOpts,
      defaultJobOptions: { ...defaultOpts.defaultJobOptions, timeout: 600000 },
    }),
    ingest: new Queue('ingest', {
      ...defaultOpts,
      defaultJobOptions: { ...defaultOpts.defaultJobOptions, timeout: 300000 },
    }),
    create: new Queue('create', {
      ...defaultOpts,
      defaultJobOptions: { ...defaultOpts.defaultJobOptions, timeout: 300000 },
    }),
    transfer: new Queue('transfer', {
      ...defaultOpts,
      defaultJobOptions: { ...defaultOpts.defaultJobOptions, timeout: 120000 },
    }),
  };
}
```

- [ ] **Step 4: Run test**

```bash
pnpm test tests/queue/queues.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: BullMQ queue setup (render, ingest, create, transfer)"
```

---

### Task 6: Edit API — POST /render + GET /render/:id

**Files:**
- Create: `src/api/edit/render.ts`
- Create: `src/api/middleware/auth.ts`
- Create: `tests/api/edit/render.test.ts`

- [ ] **Step 1: Write test for POST /render**

File: `tests/api/edit/render.test.ts`
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../../src/server.js';

describe('Edit API - Render', () => {
  let app: Awaited<ReturnType<typeof createServer>>;

  beforeAll(async () => {
    app = await createServer({ testing: true });
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /edit/v1/render returns 201 with render id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/edit/v1/render',
      payload: {
        timeline: {
          tracks: [{
            clips: [{
              asset: { type: 'image', src: 'https://example.com/test.jpg' },
              start: 0,
              length: 5,
            }],
          }],
        },
        output: { format: 'mp4', resolution: 'hd' },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.response.id).toBeDefined();
    expect(body.response.status).toBe('queued');
  });

  it('GET /edit/v1/render/:id returns render status', async () => {
    // First create a render
    const createRes = await app.inject({
      method: 'POST',
      url: '/edit/v1/render',
      payload: {
        timeline: { tracks: [{ clips: [{ asset: { type: 'image', src: 'https://example.com/test.jpg' }, start: 0, length: 5 }] }] },
        output: { format: 'mp4', resolution: 'hd' },
      },
    });
    const { response: { id } } = JSON.parse(createRes.body);

    const res = await app.inject({ method: 'GET', url: `/edit/v1/render/${id}` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.response.id).toBe(id);
    expect(body.response.status).toBeDefined();
  });

  it('GET /edit/v1/render/:unknown returns 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/edit/v1/render/nonexistent' });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/api/edit/render.test.ts
```

- [ ] **Step 3: Create auth middleware**

File: `src/api/middleware/auth.ts`
```typescript
import { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../../config/index.js';

export async function authMiddleware(req: FastifyRequest, reply: FastifyReply) {
  if (!config.auth.enabled) return;

  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (!apiKey || !config.auth.apiKeys.includes(apiKey)) {
    reply.status(401).send({ success: false, message: 'Unauthorized: invalid API key' });
  }
}
```

- [ ] **Step 4: Create render routes**

File: `src/api/edit/render.ts`
```typescript
import { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { getDb, schema } from '../../db/index.js';
import { eq } from 'drizzle-orm';

export async function renderRoutes(app: FastifyInstance) {
  const db = getDb();

  app.post('/edit/v1/render', async (req, reply) => {
    const body = req.body as any;
    const id = nanoid(21);

    await db.insert(schema.renders).values({
      id,
      status: 'queued',
      timeline: JSON.stringify(body.timeline),
      output: JSON.stringify(body.output),
      callback: body.callback ?? null,
    });

    // TODO: Add to render queue when worker is ready

    reply.status(201).send({
      success: true,
      message: 'Created',
      response: {
        id,
        owner: 'cutengine',
        status: 'queued',
        url: null,
        data: null,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
    });
  });

  app.get('/edit/v1/render/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const [render] = await db.select().from(schema.renders).where(eq(schema.renders.id, id));

    if (!render) {
      return reply.status(404).send({ success: false, message: 'Render not found' });
    }

    reply.send({
      success: true,
      message: 'OK',
      response: {
        id: render.id,
        owner: 'cutengine',
        status: render.status,
        url: render.url,
        poster: render.poster,
        thumbnail: render.thumbnail,
        error: render.error,
        data: {
          output: JSON.parse(render.output ?? '{}'),
        },
        created: render.createdAt,
        updated: render.updatedAt,
      },
    });
  });
}
```

- [ ] **Step 5: Register routes in server.ts**

Add to `src/server.ts`:
```typescript
import { renderRoutes } from './api/edit/render.js';

// Inside createServer, after cors:
await app.register(renderRoutes);
```

- [ ] **Step 6: Run test**

```bash
pnpm test tests/api/edit/render.test.ts
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: Edit API - POST /render and GET /render/:id with Shotstack response format"
```

---

## Phase 3: Render Pipeline Core (Timeline Parser → Scene Builder → Frame Capture → Encoder)

### Task 7: Timeline Parser — JSON → IR

**Files:**
- Create: `src/render/parser/index.ts`
- Create: `src/render/parser/types.ts`
- Create: `src/render/parser/resolve-timing.ts`
- Create: `src/render/parser/resolve-output.ts`
- Create: `tests/render/parser/parser.test.ts`

- [ ] **Step 1: Define IR types**

File: `src/render/parser/types.ts` — Full TypeScript interfaces for Internal Representation: `IRTimeline`, `IRScene`, `IRLayer`, `IRAsset`, `IRTiming`, `IREffects`, `IRAudio`, `IROutput`. Match the IR structure from the spec.

- [ ] **Step 2: Write parser tests**

Test cases:
- Parse minimal Shotstack JSON (1 track, 1 image clip) → valid IR
- Resolve `start: "auto"` → calculated start time
- Resolve `length: "auto"` → asset duration placeholder
- Resolve output resolution presets (hd → 1280x720)
- Merge field substitution (`{{NAME}}` → value)
- Track ordering → z-index (tracks[0] = topmost layer)

- [ ] **Step 3: Implement parser**

Core logic:
- Validate JSON against Shotstack schema (ajv)
- Substitute merge fields
- Resolve smart clip properties (auto, end, alias://)
- Convert tracks → layers with z-index
- Resolve output presets to concrete dimensions/fps
- Collect external asset URLs

- [ ] **Step 4: Run tests, verify pass**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat: Timeline Parser - Shotstack JSON to Internal Representation"
```

---

### Task 8: Scene Builder — IR → HTML/CSS

**Files:**
- Create: `src/render/builder/index.ts`
- Create: `src/render/builder/html-template.ts`
- Create: `src/render/assets/image.ts`
- Create: `src/render/assets/text.ts`
- Create: `src/render/effects/kenburns.ts`
- Create: `src/render/effects/filters.ts`
- Create: `src/render/effects/transitions.ts`
- Create: `tests/render/builder/builder.test.ts`

- [ ] **Step 1: Write tests for HTML generation**

Test cases:
- ImageAsset → `<img>` tag with correct CSS (fit, position, filter)
- TextAsset → `<div>` with font family, size, color, stroke (text-shadow)
- KenBurns zoomIn → CSS animation with scale transform
- Filter boost → `filter: contrast(1.2) saturate(1.3)`
- Full scene HTML → valid HTML document with viewport matching output resolution

- [ ] **Step 2: Implement asset renderers (image, text)**

Each asset renderer returns an HTML string + CSS string for the asset.

- [ ] **Step 3: Implement effects (kenburns, filters)**

`src/render/effects/kenburns.ts`:
- Map each Shotstack effect to CSS `@keyframes` animation
- `zoomIn` → `scale(1) → scale(1.3)` with `ease-in-out`
- `slideLeft` → `translateX(0) → translateX(-10%)` with `ease-in-out`
- Speed variants: Slow=8s, default=5s, Fast=3s

`src/render/effects/filters.ts`:
- Map each filter to CSS `filter` value
- `boost` → `contrast(1.2) saturate(1.3)`
- `greyscale` → `grayscale(1)`

- [ ] **Step 4: Implement scene builder**

Combines asset HTML + effects CSS into a full HTML page per scene. Sets viewport to output dimensions.

- [ ] **Step 5: Run tests**
- [ ] **Step 6: Commit**

```bash
git commit -m "feat: Scene Builder - IR to HTML/CSS with KenBurns and filters"
```

---

### Task 9: Frame Capture — Puppeteer

**Files:**
- Create: `src/render/capture/index.ts`
- Create: `src/render/capture/browser-pool.ts`
- Create: `tests/render/capture/capture.test.ts`

- [ ] **Step 1: Write test for frame capture**

Test: Given a simple HTML page with a red background (1280x720), capture 1 frame → PNG file exists with correct dimensions.

- [ ] **Step 2: Create browser pool**

File: `src/render/capture/browser-pool.ts`
- Connect to Chromium via `puppeteer.connect({ browserWSEndpoint })`
- Pool management: `acquirePage()` / `releasePage()`

- [ ] **Step 3: Implement frame capture**

File: `src/render/capture/index.ts`
- Load HTML into Puppeteer page
- Set viewport to output dimensions
- For animated scenes: advance time frame-by-frame using `page.clock.fastForward()`
- Capture each frame as PNG to temp directory
- Optimization: static scenes → single frame + repeat count

- [ ] **Step 4: Run test (requires chromium docker running)**

```bash
docker compose -f docker/docker-compose.dev.yml up -d chromium
pnpm test tests/render/capture/capture.test.ts
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: Frame Capture - Puppeteer frame-by-frame PNG capture"
```

---

### Task 10: Encoder — FFmpeg

**Files:**
- Create: `src/render/encoder/index.ts`
- Create: `src/render/encoder/audio-mixer.ts`
- Create: `tests/render/encoder/encoder.test.ts`

- [ ] **Step 1: Write test for video encoding**

Test: Given a directory of 125 PNG frames (5 seconds @ 25fps), encode to MP4 → output file exists, duration ~5s.

- [ ] **Step 2: Implement video encoder**

File: `src/render/encoder/index.ts`
- Build FFmpeg command from IR output config
- Map resolution/quality/fps to FFmpeg flags
- Execute via `child_process.spawn` with progress parsing
- Support formats: mp4, gif, jpg, png, bmp, mp3

- [ ] **Step 3: Implement audio mixer**

File: `src/render/encoder/audio-mixer.ts`
- Place audio clips on timeline (start time + duration)
- Apply volume, volumeEffect (fadeIn/Out), speed (atempo)
- Mix soundtrack with clips
- Build FFmpeg filter_complex for multi-track mixing

- [ ] **Step 4: Run tests**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat: FFmpeg Encoder - video encoding + audio mixing"
```

---

### Task 11: Render Worker — End-to-End Pipeline

**Files:**
- Create: `src/queue/workers/render-worker.ts`
- Create: `src/render/pipeline.ts`
- Create: `tests/render/pipeline.test.ts`

- [ ] **Step 1: Write integration test**

Test: Submit a minimal Shotstack JSON (1 image, 5 seconds, HD, no audio) → pipeline produces MP4 file.

- [ ] **Step 2: Create render pipeline orchestrator**

File: `src/render/pipeline.ts`
- Orchestrates the 4 stages: parse → download assets → build → capture → encode
- Updates render status in DB at each stage
- Handles errors and cleanup

- [ ] **Step 3: Create BullMQ render worker**

File: `src/queue/workers/render-worker.ts`
- Picks jobs from render queue
- Calls pipeline.execute(job.data)
- Updates DB status on completion/failure
- Fires callback webhook if configured

- [ ] **Step 4: Wire worker into server startup**
- [ ] **Step 5: Run integration test**

```bash
docker compose -f docker/docker-compose.dev.yml up -d
pnpm test tests/render/pipeline.test.ts
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: Render Worker - end-to-end pipeline (parse → build → capture → encode)"
```

---

## Phase 4: Remaining Asset Types + Effects

### Task 12: Video + Audio Asset Handlers

**Files:**
- Create: `src/render/assets/video.ts`
- Create: `src/render/assets/audio.ts`
- Create: `tests/render/assets/video.test.ts`

- Implement VideoAsset: FFmpeg frame extraction → HTML `<img>` per frame, volume=0, speed, trim, crop
- Implement AudioAsset: FFmpeg audio processing — volume, volumeEffect, speed, trim
- Test: Video clip with trim=2, speed=1.5 produces correct frames

- [ ] **Steps: Write tests → Implement → Verify → Commit**

---

### Task 13: RichText, HTML, Shape, SVG, Title, Luma Asset Handlers

**Files:**
- Create: `src/render/assets/richtext.ts`
- Create: `src/render/assets/html.ts`
- Create: `src/render/assets/shape.ts`
- Create: `src/render/assets/svg.ts`
- Create: `src/render/assets/title.ts`
- Create: `src/render/assets/luma.ts`

Each asset type:
- RichTextAsset → HTML insertion with CSS gradient/shadow/animation support
- HtmlAsset → Direct HTML/CSS insertion in Puppeteer
- ShapeAsset → CSS shapes (rectangle, circle) or SVG fallback
- SvgAsset → Inline SVG (12 shape types + fill variants + stroke + shadow + transform)
- TitleAsset → Preset HTML templates with CSS animations
- LumaAsset → CSS mask-image compositing

- [ ] **Steps: Write tests → Implement each → Verify → Commit per asset type**

---

### Task 14: Full Effects Suite (Transitions, Tween, ChromaKey, Transform, Speed)

**Files:**
- Create: `src/render/effects/tween.ts`
- Create: `src/render/effects/chromakey.ts`
- Modify: `src/render/effects/transitions.ts` (full set)

- Transitions: All 20+ types (fade, reveal, wipe, slide, carousel, shuffle, zoom) with Speed variants
- Tween: CSS `@keyframes` with `cubic-bezier()` easing for opacity, offset, rotation, skew, volume
- ChromaKey: Canvas API pixel manipulation or FFmpeg `chromakey` filter
- Transform: rotate, skew, flip → CSS `transform`
- Speed: Video playback speed control

- [ ] **Steps: Write tests → Implement → Verify → Commit**

---

## Phase 5: Ingest, Serve, Template, Create APIs

### Task 15: Ingest API

**Files:**
- Create: `src/api/ingest/sources.ts`
- Create: `src/api/ingest/upload.ts`
- Create: `src/queue/workers/ingest-worker.ts`

Endpoints: POST /sources, GET /sources, GET /sources/:id, DELETE /sources/:id, POST /upload
Worker: Fetch URL → save to storage → update status

- [ ] **Steps: Write tests → Implement routes + worker → Verify → Commit**

---

### Task 16: Serve API

**Files:**
- Create: `src/api/serve/assets.ts`
- Create: `src/asset/storage/local.ts`
- Create: `src/asset/storage/s3.ts`
- Create: `src/asset/destinations/index.ts`

Endpoints: GET /assets/:id, DELETE /assets/:id, GET /assets/render/:id, POST /assets/transfer
Storage: Pluggable local FS / S3 driver
Destinations: S3, Mux, Webhook transfer

- [ ] **Steps: Write tests → Implement → Verify → Commit**

---

### Task 17: Template API

**Files:**
- Create: `src/api/edit/templates.ts`
- Create: `src/template/crud.ts`
- Create: `src/template/merge.ts`

Endpoints: CRUD + POST /:id/render with merge field substitution
Merge: `{{PLACEHOLDER}}` → value replacement in JSON

- [ ] **Steps: Write tests → Implement → Verify → Commit**

---

### Task 18: Create API (Optional Module)

**Files:**
- Create: `src/api/create/generate.ts`
- Create: `src/render/assets/ai.ts`
- Create: `src/queue/workers/create-worker.ts`

Endpoints: POST /generate, GET /generate/:id
Providers: Seedream (T2I), Seedance (I2V) — configurable via config.yaml
501 response when provider not configured

- [ ] **Steps: Write tests → Implement → Verify → Commit**

---

## Phase 6: Extended API + Auth + Observability

### Task 19: Auth Middleware (x-api-key + JWT)

**Files:**
- Modify: `src/api/middleware/auth.ts`

Add JWT validation for SaaS mode. Toggle with `AUTH_ENABLED` env var.

- [ ] **Steps: Write tests → Implement → Verify → Commit**

---

### Task 20: Extended API (Batch, Preview, Queue Status, WebSocket)

**Files:**
- Create: `src/api/extended/batch.ts`
- Create: `src/api/extended/preview.ts`
- Create: `src/api/extended/queue-status.ts`
- Create: `src/api/extended/websocket.ts`

POST /x/v1/render/batch, POST /x/v1/render/preview, GET /x/v1/queue/status, WebSocket /ws/render/:id

- [ ] **Steps: Write tests → Implement → Verify → Commit**

---

### Task 21: Observability (Logging + Metrics)

**Files:**
- Create: `src/api/metrics.ts`
- Modify: `src/render/pipeline.ts` (structured stage logging)

Pino structured logging with render ID correlation.
Prometheus metrics: render_total, render_duration, queue_depth, active_workers.
GET /metrics endpoint.

- [ ] **Steps: Write tests → Implement → Verify → Commit**

---

## Phase 7: Media Inspect + Callback + Polish

### Task 22: Media Inspect (ffprobe)

**Files:**
- Create: `src/asset/inspect.ts`
- Create: `src/api/edit/inspect.ts`

GET /edit/v1/inspect — ffprobe wrapper returning resolution, codec, duration, bitrate.

- [ ] **Steps: Write tests → Implement → Verify → Commit**

---

### Task 23: Callback Webhooks

**Files:**
- Modify: `src/queue/workers/render-worker.ts`

On render complete/fail: POST to callback URL with status payload.

- [ ] **Steps: Write tests → Implement → Verify → Commit**

---

### Task 24: Beyond Orbit Compatibility Test

**Files:**
- Create: `tests/compatibility/beyond-orbit.test.ts`

Take actual Shotstack JSON payloads from `beyond-orbit-automation/sns_v3_workflow.json` and verify:
1. API accepts the payload without errors
2. Render completes with status: done
3. Output file is a valid MP4 with correct resolution
4. Audio tracks are correctly mixed

- [ ] **Steps: Extract sample payloads → Write tests → Fix any incompatibilities → Commit**

---

## Phase Summary

| Phase | Tasks | Description | Prerequisite |
|-------|-------|-------------|-------------|
| 1 | 1-4 | Foundation: scaffolding, DB, server, Docker | — |
| 2 | 5-6 | Edit API + Job Queue | Phase 1 |
| 3 | 7-11 | Render Pipeline Core (parse → build → capture → encode) | Phase 2 |
| 4 | 12-14 | All Asset Types + Full Effects Suite | Phase 3 |
| 5 | 15-18 | Ingest, Serve, Template, Create APIs | Phase 2 |
| 6 | 19-21 | Extended API, Auth, Observability | Phase 5 |
| 7 | 22-24 | Inspect, Callbacks, Compatibility Testing | Phase 6 |

Phase 3 and Phase 5 can run **in parallel** (independent modules).
