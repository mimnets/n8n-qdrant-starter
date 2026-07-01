import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { config } from '../config/index.js';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS renders (
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

  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    template TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    render_id TEXT REFERENCES renders(id),
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    url TEXT,
    filename TEXT,
    size INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    local_path TEXT,
    error TEXT,
    created_at INTEGER NOT NULL
  );
`;

export function getDb(path?: string, opts?: { migrate?: boolean }) {
  const dbPath = path ?? config.db.sqlitePath;
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  if (opts?.migrate) {
    for (const stmt of CREATE_TABLES_SQL.split(';')) {
      const trimmed = stmt.trim();
      if (trimmed) {
        sqlite.prepare(trimmed).run();
      }
    }
  }

  const db = drizzle(sqlite, { schema });
  return db;
}

export { schema };
