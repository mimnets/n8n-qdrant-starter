import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createServer } from '../../../src/server.js';
import { schema } from '../../../src/db/index.js';
import { nanoid } from 'nanoid';
import { LocalStorage } from '../../../src/asset/storage/local.js';
import { S3Storage } from '../../../src/asset/storage/s3.js';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// ---------- Serve API Routes ----------

describe('Serve API - Assets', () => {
  let app: Awaited<ReturnType<typeof createServer>>;
  let db: BetterSQLite3Database<typeof schema>;

  beforeAll(async () => {
    app = await createServer({ testing: true });
    db = (app as any).db;
  });

  afterAll(async () => {
    await app.close();
  });

  async function insertAsset(overrides: Partial<{
    id: string; renderId: string; type: string; status: string;
    url: string; filename: string; size: number;
  }> = {}) {
    const id = overrides.id ?? nanoid(21);
    await db.insert(schema.assets).values({
      id,
      renderId: overrides.renderId ?? null,
      type: (overrides.type ?? 'video') as any,
      status: (overrides.status ?? 'ready') as any,
      url: overrides.url ?? `/serve/v1/assets/${id}/output.mp4`,
      filename: overrides.filename ?? 'output.mp4',
      size: overrides.size ?? 1024,
    });
    return id;
  }

  it('GET /serve/v1/assets/:id returns asset details from DB', async () => {
    const id = await insertAsset({ type: 'video', status: 'ready' });

    const res = await app.inject({ method: 'GET', url: `/serve/v1/assets/${id}` });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.response.id).toBe(id);
    expect(body.response.type).toBe('video');
    expect(body.response.status).toBe('ready');
    expect(body.response.url).toBeDefined();
    expect(body.response.filename).toBe('output.mp4');
    expect(body.response.size).toBe(1024);
  });

  it('GET /serve/v1/assets/:unknown returns 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/serve/v1/assets/nonexistent-id' });
    expect(res.statusCode).toBe(404);

    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.message).toBe('Asset not found');
  });

  it('GET /serve/v1/assets/render/:renderId returns assets for a render', async () => {
    const renderId = nanoid(21);

    // Insert a render row first (FK constraint)
    await db.insert(schema.renders).values({
      id: renderId,
      status: 'done',
      timeline: '{}',
      output: '{}',
    });

    const assetId1 = await insertAsset({ renderId, type: 'video' });
    const assetId2 = await insertAsset({ renderId, type: 'image' });

    const res = await app.inject({ method: 'GET', url: `/serve/v1/assets/render/${renderId}` });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.response.assets).toHaveLength(2);
    const ids = body.response.assets.map((a: any) => a.id);
    expect(ids).toContain(assetId1);
    expect(ids).toContain(assetId2);
  });

  it('GET /serve/v1/assets/render/:unknown returns empty array', async () => {
    const res = await app.inject({ method: 'GET', url: '/serve/v1/assets/render/no-such-render' });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.response.assets).toHaveLength(0);
  });

  it('DELETE /serve/v1/assets/:id deletes asset record', async () => {
    const id = await insertAsset();

    const delRes = await app.inject({ method: 'DELETE', url: `/serve/v1/assets/${id}` });
    expect(delRes.statusCode).toBe(200);

    const delBody = JSON.parse(delRes.body);
    expect(delBody.success).toBe(true);
    expect(delBody.message).toBe('Deleted');
    expect(delBody.response.id).toBe(id);

    // Confirm gone
    const getRes = await app.inject({ method: 'GET', url: `/serve/v1/assets/${id}` });
    expect(getRes.statusCode).toBe(404);
  });

  it('DELETE /serve/v1/assets/:unknown returns 404', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/serve/v1/assets/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });

  it('POST /serve/v1/assets/transfer accepts transfer request', async () => {
    const id = await insertAsset({ url: 'http://localhost/test.mp4' });

    const res = await app.inject({
      method: 'POST',
      url: '/serve/v1/assets/transfer',
      payload: {
        id,
        destination: {
          provider: 's3',
          options: {},
        },
      },
    });

    // S3 is a stub, should return 400 with "not configured"
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.message).toContain('not configured');
  });

  it('POST /serve/v1/assets/transfer returns 400 for missing fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/serve/v1/assets/transfer',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /serve/v1/assets/transfer returns 404 for unknown asset', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/serve/v1/assets/transfer',
      payload: {
        id: 'no-such-asset',
        destination: { provider: 'webhook', options: { url: 'http://example.com/hook' } },
      },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------- LocalStorage ----------

describe('LocalStorage', () => {
  const testDir = join(tmpdir(), `cutengine-test-${Date.now()}`);
  let storage: LocalStorage;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    storage = new LocalStorage(testDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('save creates file and returns URL', async () => {
    const data = Buffer.from('test video content');
    const url = await storage.save('abc123', 'output.mp4', data);

    expect(url).toBe('/serve/v1/assets/abc123/output.mp4');

    // Verify file was written on disk
    const filePath = join(testDir, 'abc123', 'output.mp4');
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath).toString()).toBe('test video content');
  });

  it('get returns file content', async () => {
    await storage.save('def456', 'video.mp4', Buffer.from('hello'));
    const result = await storage.get('def456', 'video.mp4');
    expect(result).not.toBeNull();
    expect(result!.toString()).toBe('hello');
  });

  it('get returns null for missing file', async () => {
    const result = await storage.get('missing', 'file.mp4');
    expect(result).toBeNull();
  });

  it('getUrl returns correct URL pattern', () => {
    const url = storage.getUrl('myid', 'render.mp4');
    expect(url).toBe('/serve/v1/assets/myid/render.mp4');
  });

  it('exists returns true for existing file', async () => {
    await storage.save('exist-test', 'file.mp4', Buffer.from('data'));
    expect(await storage.exists('exist-test', 'file.mp4')).toBe(true);
  });

  it('exists returns false for missing file', async () => {
    expect(await storage.exists('nope', 'file.mp4')).toBe(false);
  });

  it('delete removes files', async () => {
    await storage.save('del-test', 'a.mp4', Buffer.from('aaa'));
    await storage.save('del-test', 'b.mp4', Buffer.from('bbb'));

    expect(existsSync(join(testDir, 'del-test'))).toBe(true);

    await storage.delete('del-test');

    expect(existsSync(join(testDir, 'del-test'))).toBe(false);
  });

  it('delete is safe for nonexistent id', async () => {
    // Should not throw
    await storage.delete('never-existed');
  });
});

// ---------- S3Storage (stub) ----------

describe('S3Storage (stub)', () => {
  it('save throws not configured', async () => {
    const s3 = new S3Storage();
    await expect(s3.save('id', 'f', Buffer.from(''))).rejects.toThrow('not configured');
  });

  it('get throws not configured', async () => {
    const s3 = new S3Storage();
    await expect(s3.get('id', 'f')).rejects.toThrow('not configured');
  });

  it('delete throws not configured', async () => {
    const s3 = new S3Storage();
    await expect(s3.delete('id')).rejects.toThrow('not configured');
  });
});
