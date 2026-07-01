import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema.js';

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // Create tables from schema definitions
  sqlite.exec(`
    CREATE TABLE renders (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'queued',
      timeline TEXT NOT NULL,
      output TEXT,
      url TEXT,
      poster TEXT,
      thumbnail TEXT,
      error TEXT,
      callback TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      template TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE assets (
      id TEXT PRIMARY KEY,
      render_id TEXT REFERENCES renders(id),
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      url TEXT,
      filename TEXT,
      size INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE sources (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      local_path TEXT,
      error TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

describe('Database Schema', () => {
  let db: ReturnType<typeof createTestDb>['db'];
  let sqlite: InstanceType<typeof Database>;

  beforeAll(() => {
    const result = createTestDb();
    db = result.db;
    sqlite = result.sqlite;
  });

  afterAll(() => {
    sqlite.close();
  });

  describe('renders table', () => {
    it('should insert and query a render', () => {
      const now = new Date();
      db.insert(schema.renders).values({
        id: 'render-1',
        status: 'queued',
        timeline: JSON.stringify({ tracks: [] }),
        createdAt: now,
        updatedAt: now,
      }).run();

      const rows = db.select().from(schema.renders).all();
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe('render-1');
      expect(rows[0].status).toBe('queued');
      expect(rows[0].timeline).toBe(JSON.stringify({ tracks: [] }));
    });

    it('should update render status through lifecycle', () => {
      const statuses = ['fetching', 'rendering', 'saving', 'done'] as const;
      for (const status of statuses) {
        db.update(schema.renders)
          .set({ status, updatedAt: new Date() })
          .where(eq(schema.renders.id, 'render-1'))
          .run();
      }

      const row = db.select().from(schema.renders).where(eq(schema.renders.id, 'render-1')).get();
      expect(row?.status).toBe('done');
    });

    it('should store optional fields (output, url, poster, thumbnail, error, callback)', () => {
      db.update(schema.renders)
        .set({
          output: '/data/output.mp4',
          url: 'https://cdn.example.com/output.mp4',
          poster: 'https://cdn.example.com/poster.jpg',
          thumbnail: 'https://cdn.example.com/thumb.jpg',
          callback: 'https://webhook.example.com/done',
        })
        .where(eq(schema.renders.id, 'render-1'))
        .run();

      const row = db.select().from(schema.renders).where(eq(schema.renders.id, 'render-1')).get();
      expect(row?.output).toBe('/data/output.mp4');
      expect(row?.url).toBe('https://cdn.example.com/output.mp4');
      expect(row?.poster).toBe('https://cdn.example.com/poster.jpg');
      expect(row?.thumbnail).toBe('https://cdn.example.com/thumb.jpg');
      expect(row?.callback).toBe('https://webhook.example.com/done');
    });
  });

  describe('templates table', () => {
    it('should insert and query a template', () => {
      const now = new Date();
      db.insert(schema.templates).values({
        id: 'tpl-1',
        name: 'Intro Template',
        template: JSON.stringify({ timeline: { tracks: [] } }),
        version: 1,
        createdAt: now,
        updatedAt: now,
      }).run();

      const row = db.select().from(schema.templates).where(eq(schema.templates.id, 'tpl-1')).get();
      expect(row).toBeDefined();
      expect(row?.name).toBe('Intro Template');
      expect(row?.version).toBe(1);
    });
  });

  describe('assets table', () => {
    it('should insert an asset linked to a render', () => {
      const now = new Date();
      db.insert(schema.assets).values({
        id: 'asset-1',
        renderId: 'render-1',
        type: 'video',
        status: 'queued',
        url: 'https://example.com/clip.mp4',
        filename: 'clip.mp4',
        size: 1024000,
        createdAt: now,
      }).run();

      const row = db.select().from(schema.assets).where(eq(schema.assets.id, 'asset-1')).get();
      expect(row).toBeDefined();
      expect(row?.renderId).toBe('render-1');
      expect(row?.type).toBe('video');
      expect(row?.size).toBe(1024000);
    });

    it('should allow asset without render (standalone)', () => {
      const now = new Date();
      db.insert(schema.assets).values({
        id: 'asset-standalone',
        type: 'image',
        status: 'ready',
        createdAt: now,
      }).run();

      const row = db.select().from(schema.assets).where(eq(schema.assets.id, 'asset-standalone')).get();
      expect(row).toBeDefined();
      expect(row?.renderId).toBeNull();
    });
  });

  describe('sources table', () => {
    it('should insert and query a source', () => {
      const now = new Date();
      db.insert(schema.sources).values({
        id: 'src-1',
        url: 'https://youtube.com/watch?v=abc',
        status: 'queued',
        createdAt: now,
      }).run();

      const row = db.select().from(schema.sources).where(eq(schema.sources.id, 'src-1')).get();
      expect(row).toBeDefined();
      expect(row?.url).toBe('https://youtube.com/watch?v=abc');
      expect(row?.status).toBe('queued');
    });

    it('should update source through import lifecycle', () => {
      db.update(schema.sources)
        .set({ status: 'importing' })
        .where(eq(schema.sources.id, 'src-1'))
        .run();

      db.update(schema.sources)
        .set({ status: 'ready', localPath: '/data/sources/abc.mp4' })
        .where(eq(schema.sources.id, 'src-1'))
        .run();

      const row = db.select().from(schema.sources).where(eq(schema.sources.id, 'src-1')).get();
      expect(row?.status).toBe('ready');
      expect(row?.localPath).toBe('/data/sources/abc.mp4');
    });
  });
});

describe('getDb factory', () => {
  it('should create an in-memory database', async () => {
    const { getDb } = await import('../../src/db/index.js');
    const db = getDb(':memory:');
    expect(db).toBeDefined();
  });
});
