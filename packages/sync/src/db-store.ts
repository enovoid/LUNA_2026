import { awards, createDb, type Db, faqs, members, projects, syncState } from '@luna/db';
import { eq, inArray, isNotNull } from 'drizzle-orm';
import type { DatabaseName } from './config.js';
import type { ProcessedImage } from './images.js';
import type { FieldsByDatabase, MappedPage } from './mappers.js';
import type {
  ContentStore,
  ExistingRow,
  StateKey,
  SyncStateRecord,
  SyncStateWrite,
} from './store.js';

/** faqs.sort_order는 NOT NULL이라, Notion `order`가 비어 있으면 맨 뒤로 보낸다. */
export const FAQ_ORDER_MISSING = 2_147_483_647;

const tables = { members, awards, projects, faqs } as const;
const imageTables = [members, awards, projects] as const;

function imageColumns(image: ProcessedImage | null) {
  return {
    imageKey: image?.imageKey ?? null,
    imageWidth: image?.width ?? null,
    imageHeight: image?.height ?? null,
  };
}

export class PostgresStore implements ContentStore {
  readonly #db: Db;

  constructor(url: string) {
    this.#db = createDb(url);
  }

  async getExisting(database: DatabaseName): Promise<Map<string, ExistingRow>> {
    const table = tables[database];
    const rows =
      database === 'faqs'
        ? (
            await this.#db
              .select({ notionId: faqs.notionId, notionLastEditedAt: faqs.notionLastEditedAt })
              .from(faqs)
          ).map((row) => ({ ...row, imageKey: null, imageWidth: null, imageHeight: null }))
        : await this.#db
            .select({
              notionId: (table as typeof members).notionId,
              notionLastEditedAt: (table as typeof members).notionLastEditedAt,
              imageKey: (table as typeof members).imageKey,
              imageWidth: (table as typeof members).imageWidth,
              imageHeight: (table as typeof members).imageHeight,
            })
            .from(table as typeof members);
    return new Map(rows.map(({ notionId, ...rest }) => [notionId, rest]));
  }

  async upsert(page: MappedPage, image: ProcessedImage | null, syncedAt: Date): Promise<void> {
    const base = {
      notionId: page.notionId,
      notionLastEditedAt: page.notionLastEditedAt,
      syncedAt,
    };
    const { notionId: _id, ...update } = { ...base, ...this.#values(page, image) };
    const table = tables[page.database];
    await this.#db
      .insert(table)
      .values({ notionId: page.notionId, ...update } as typeof table.$inferInsert)
      .onConflictDoUpdate({ target: table.notionId, set: update });
  }

  #values(page: MappedPage, image: ProcessedImage | null): Record<string, unknown> {
    switch (page.database) {
      case 'members':
        return { ...(page.fields as FieldsByDatabase['members']), ...imageColumns(image) };
      case 'awards':
        return { ...(page.fields as FieldsByDatabase['awards']), ...imageColumns(image) };
      case 'projects':
        return { ...(page.fields as FieldsByDatabase['projects']), ...imageColumns(image) };
      case 'faqs': {
        const fields = page.fields as FieldsByDatabase['faqs'];
        return { ...fields, sortOrder: fields.sortOrder ?? FAQ_ORDER_MISSING };
      }
    }
  }

  async deleteByNotionIds(database: DatabaseName, notionIds: readonly string[]): Promise<void> {
    if (notionIds.length === 0) return;
    const table = tables[database];
    await this.#db.delete(table).where(inArray(table.notionId, [...notionIds]));
  }

  async referencedImageKeys(): Promise<Set<string>> {
    const keys = new Set<string>();
    for (const table of imageTables) {
      const rows = await this.#db
        .select({ imageKey: table.imageKey })
        .from(table)
        .where(isNotNull(table.imageKey));
      for (const row of rows) if (row.imageKey) keys.add(row.imageKey);
    }
    return keys;
  }

  async getState(key: StateKey): Promise<SyncStateRecord | undefined> {
    const [row] = await this.#db
      .select({ lastSyncedAt: syncState.lastSyncedAt, lastResult: syncState.lastResult })
      .from(syncState)
      .where(eq(syncState.database, key));
    return row;
  }

  async saveState(key: StateKey, state: SyncStateWrite): Promise<void> {
    const values = {
      database: key,
      lastRunAt: state.lastRunAt,
      lastResult: state.lastResult,
      lastError: state.lastError,
      ...(state.lastSyncedAt ? { lastSyncedAt: state.lastSyncedAt } : {}),
    };
    const { database: _key, ...update } = values;
    await this.#db
      .insert(syncState)
      .values(values)
      .onConflictDoUpdate({ target: syncState.database, set: update });
  }

  async close(): Promise<void> {
    await this.#db.$client.end({ timeout: 5 });
  }
}
