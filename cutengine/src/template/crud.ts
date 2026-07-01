import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { schema } from '../db/index.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

type Db = BetterSQLite3Database<typeof schema>;

export async function createTemplate(
  db: Db,
  data: { name: string; template: string }
) {
  const id = nanoid(21);
  await db.insert(schema.templates).values({
    id,
    name: data.name,
    template: data.template,
    version: 1,
  });
  return { id, name: data.name, version: 1 };
}

export async function getTemplate(db: Db, id: string) {
  const [row] = await db
    .select()
    .from(schema.templates)
    .where(eq(schema.templates.id, id));
  return row ?? null;
}

export async function listTemplates(db: Db) {
  return db.select().from(schema.templates);
}

export async function updateTemplate(
  db: Db,
  id: string,
  data: { name?: string; template?: string }
) {
  const existing = await getTemplate(db, id);
  if (!existing) return null;

  const updates: Record<string, unknown> = {
    updatedAt: new Date(),
    version: existing.version + 1,
  };
  if (data.name !== undefined) updates.name = data.name;
  if (data.template !== undefined) updates.template = data.template;

  await db
    .update(schema.templates)
    .set(updates)
    .where(eq(schema.templates.id, id));

  return getTemplate(db, id);
}

export async function deleteTemplate(db: Db, id: string) {
  const existing = await getTemplate(db, id);
  if (!existing) return false;
  await db.delete(schema.templates).where(eq(schema.templates.id, id));
  return true;
}
