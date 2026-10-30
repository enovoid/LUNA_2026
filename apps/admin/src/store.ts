// 관리자 페이지가 읽고 쓰는 Postgres. 공개 사이트는 이 서버를 거치지 않는다(빌드 때만 DB를 읽음).
import { randomUUID } from 'node:crypto';
import { ADMIN_ID_PREFIX } from '@luna/db/content';
import {
  awards,
  faqs,
  imageFiles,
  members,
  projects,
  siteSettings,
  syncState,
} from '@luna/db/schema';
import {
  emptySettings,
  parseSettings,
  SETTINGS_KEYS,
  type SettingsByKey,
  type SettingsKey,
} from '@luna/db/settings';
import { asc, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { ContentTable, ContentValues } from './content.js';

export interface SyncStateRow {
  database: string;
  lastSyncedAt: Date | null;
  lastRunAt: Date | null;
  lastResult: unknown;
  lastError: string | null;
}

export interface StoredSetting<K extends SettingsKey> {
  value: SettingsByKey[K];
  updatedAt: Date;
  updatedBy: string | null;
}

export type StoredSettings = { [K in SettingsKey]?: StoredSetting<K> };

export interface AdminStore extends ContentStore {
  syncStates(): Promise<SyncStateRow[]>;
  settings(): Promise<StoredSettings>;
  saveSetting<K extends SettingsKey>(
    key: K,
    value: SettingsByKey[K],
    editor: string,
  ): Promise<void>;
  /** 멤버 DB에 있는 루나 기수 번호(예: "LUNA 8기" → 8). 모집 기수 선택지를 만든다. */
  generations(): Promise<number[]>;
  /** 관리자 화면에서 추가한 운영진 이메일(Railway 변수 ADMIN_EMAILS와 별개) */
  adminEmails(): Promise<StoredAdmins>;
  saveAdminEmails(emails: string[], editor: string): Promise<void>;
}

/** 관리자 화면에서 다루는 콘텐츠 한 행 */
export interface ContentRow {
  id: number;
  /** Notion 페이지 id, 또는 관리자 페이지에서 만든 행이면 `admin:` 접두어 */
  notionId: string;
  values: ContentValues;
  imageKey: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  /** 마지막으로 바뀐 시각(Notion 수정 시각 또는 관리자 저장 시각) */
  editedAt: Date;
}

export interface ContentImage {
  imageKey: string;
  width: number;
  height: number;
}

export interface ContentStore {
  listContent(table: ContentTable): Promise<ContentRow[]>;
  getContent(table: ContentTable, id: number): Promise<ContentRow | undefined>;
  /** id가 없으면 새로 만든다. 사진은 undefined면 그대로, null이면 뺀다. 저장한 행의 id를 돌려준다. */
  saveContent(
    table: ContentTable,
    id: number | undefined,
    values: ContentValues,
    image: ContentImage | null | undefined,
  ): Promise<number | undefined>;
  deleteContent(table: ContentTable, id: number): Promise<boolean>;
  /** 열마다 이미 쓰고 있는 값(입력 후보) */
  distinctValues(table: ContentTable, column: string): Promise<string[]>;
  putImageFile(key: string, body: Buffer): Promise<void>;
  imageFileExists(key: string): Promise<boolean>;
  imageFile(key: string): Promise<Buffer | undefined>;
}

export interface StoredAdmins {
  emails: string[];
  updatedAt: Date | null;
  updatedBy: string | null;
}

/** site_settings에 운영진 목록을 두는 키. 사이트 빌드는 읽지 않는다. */
const ADMINS_KEY = 'admins';

/** "LUNA 8기", "8기", "8" 같은 값에서 기수 번호만 뽑는다. */
export function generationNumber(value: string | null): number | undefined {
  const match = value?.match(/(\d+)\s*기?\s*$/);
  return match ? Number(match[1]) : undefined;
}

export function createStore(url: string): { store: AdminStore; close: () => Promise<void> } {
  // 운영진 몇 명이 가끔 쓰는 화면이라 연결은 적게 둔다.
  const client = postgres(url, { max: 3, idle_timeout: 60, connect_timeout: 10 });
  const db = drizzle({ client });

  const store: Omit<AdminStore, keyof ContentStore> = {
    async syncStates() {
      return db.select().from(syncState);
    },
    async settings() {
      const rows = await db.select().from(siteSettings);
      const result: StoredSettings = {};
      for (const row of rows) {
        const key = SETTINGS_KEYS.find((k) => k === row.key);
        if (!key) continue;
        const parsed = parseSettings(key, row.value);
        // 저장할 때 검사하므로 실패할 일은 없지만, 손으로 고친 값이 깨져 있으면 빈 값으로 보여 준다.
        (result as Record<SettingsKey, StoredSetting<SettingsKey>>)[key] = {
          value: parsed.ok ? parsed.value : emptySettings(key),
          updatedAt: row.updatedAt,
          updatedBy: row.updatedBy,
        };
      }
      return result;
    },
    async saveSetting(key, value, editor) {
      const now = new Date();
      await db
        .insert(siteSettings)
        .values({ key, value, updatedAt: now, updatedBy: editor })
        .onConflictDoUpdate({
          target: siteSettings.key,
          set: { value, updatedAt: now, updatedBy: editor },
        });
    },
    async generations() {
      const rows = await db.selectDistinct({ generation: members.lunaGeneration }).from(members);
      const numbers = rows
        .map((row) => generationNumber(row.generation))
        .filter((n): n is number => n !== undefined);
      return [...new Set(numbers)].sort((a, b) => a - b);
    },
    async adminEmails() {
      const [row] = await db.select().from(siteSettings).where(eq(siteSettings.key, ADMINS_KEY));
      const value = row?.value as { emails?: unknown } | undefined;
      const emails = Array.isArray(value?.emails)
        ? value.emails.filter((e): e is string => typeof e === 'string')
        : [];
      return { emails, updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy ?? null };
    },
    async saveAdminEmails(emails, editor) {
      const now = new Date();
      const value = { emails };
      await db
        .insert(siteSettings)
        .values({ key: ADMINS_KEY, value, updatedAt: now, updatedBy: editor })
        .onConflictDoUpdate({
          target: siteSettings.key,
          set: { value, updatedAt: now, updatedBy: editor },
        });
    },
  };

  return { store: { ...store, ...contentStore(db) }, close: () => client.end({ timeout: 5 }) };
}

const TABLES = { members, awards, projects, faqs } as const;
type AnyTable = typeof members;

/** 목록 순서: 사이트와 비슷하게(멤버는 기수·정렬, 수상·프로젝트는 최신 연도, FAQ는 순서) */
function listOrder(table: ContentTable) {
  switch (table) {
    case 'members':
      return [desc(members.lunaGeneration), asc(members.sort), asc(members.name)];
    case 'awards':
      return [desc(awards.year), desc(awards.date), asc(awards.name)];
    case 'projects':
      return [desc(projects.year), asc(projects.name)];
    case 'faqs':
      return [asc(faqs.sortOrder), asc(faqs.id)];
  }
}

const META_COLUMNS = new Set(['id', 'notionId', 'notionLastEditedAt', 'syncedAt']);
const IMAGE_COLUMNS = new Set(['imageKey', 'imageWidth', 'imageHeight']);

function toRow(row: Record<string, unknown>): ContentRow {
  const values: ContentValues = {};
  for (const [key, value] of Object.entries(row)) {
    if (META_COLUMNS.has(key) || IMAGE_COLUMNS.has(key)) continue;
    values[key] = value as ContentValues[string];
  }
  return {
    id: row.id as number,
    notionId: row.notionId as string,
    values,
    imageKey: (row.imageKey as string | null | undefined) ?? null,
    imageWidth: (row.imageWidth as number | null | undefined) ?? null,
    imageHeight: (row.imageHeight as number | null | undefined) ?? null,
    editedAt: row.notionLastEditedAt as Date,
  };
}

function contentStore(db: ReturnType<typeof drizzle>): ContentStore {
  const table = (name: ContentTable) => TABLES[name] as unknown as AnyTable;
  return {
    async listContent(name) {
      const rows = await db
        .select()
        .from(table(name))
        .orderBy(...listOrder(name));
      return rows.map((row) => toRow(row));
    },
    async getContent(name, id) {
      const [row] = await db
        .select()
        .from(table(name))
        .where(eq(table(name).id, id));
      return row ? toRow(row) : undefined;
    },
    async saveContent(name, id, values, image) {
      const t = table(name);
      const now = new Date();
      const imageValues =
        image === undefined || name === 'faqs'
          ? {}
          : {
              imageKey: image?.imageKey ?? null,
              imageWidth: image?.width ?? null,
              imageHeight: image?.height ?? null,
            };
      // 관리자 저장 시각을 수정 시각으로 둔다. Notion에서 온 행은 Notion에서 다시 고치면 그 내용으로 바뀐다.
      const set = { ...values, ...imageValues, notionLastEditedAt: now, syncedAt: now };
      if (id === undefined) {
        const [row] = await db
          .insert(t)
          .values({
            ...set,
            notionId: `${ADMIN_ID_PREFIX}${randomUUID()}`,
          } as typeof t.$inferInsert)
          .returning({ id: t.id });
        return row?.id;
      }
      const [row] = await db.update(t).set(set).where(eq(t.id, id)).returning({ id: t.id });
      return row?.id;
    },
    async deleteContent(name, id) {
      const t = table(name);
      const rows = await db.delete(t).where(eq(t.id, id)).returning({ id: t.id });
      return rows.length > 0;
    },
    async distinctValues(name, column) {
      const t = table(name) as unknown as Record<string, unknown>;
      const col = t[column];
      if (!col || typeof col !== 'object') return [];
      const rows = await db.selectDistinct({ value: col as typeof members.name }).from(table(name));
      return rows
        .map((row) => row.value)
        .filter((v): v is string => typeof v === 'string' && v !== '')
        .sort((a, b) => a.localeCompare(b, 'ko'));
    },
    async putImageFile(key, body) {
      // 키에 원본 해시가 들어 있어 같은 키의 내용은 바뀌지 않는다.
      await db
        .insert(imageFiles)
        .values({ key, body, contentType: 'image/webp' })
        .onConflictDoNothing();
    },
    async imageFileExists(key) {
      const rows = await db
        .select({ key: imageFiles.key })
        .from(imageFiles)
        .where(eq(imageFiles.key, key));
      return rows.length > 0;
    },
    async imageFile(key) {
      const [row] = await db
        .select({ body: imageFiles.body })
        .from(imageFiles)
        .where(eq(imageFiles.key, key));
      return row?.body;
    },
  };
}
