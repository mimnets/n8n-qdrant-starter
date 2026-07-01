import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const renders = sqliteTable('renders', {
  id: text('id').primaryKey(),
  status: text('status', { enum: ['queued', 'fetching', 'rendering', 'saving', 'done', 'failed'] }).notNull().default('queued'),
  timeline: text('timeline').notNull(),
  output: text('output'),
  url: text('url'),
  poster: text('poster'),
  thumbnail: text('thumbnail'),
  error: text('error'),
  callback: text('callback'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const templates = sqliteTable('templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  template: text('template').notNull(),
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
