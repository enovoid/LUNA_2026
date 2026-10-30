// 관리자 페이지가 읽고 쓰는 Postgres. 공개 사이트는 이 서버를 거치지 않는다(빌드 때만 DB를 읽음).
import { members, siteSettings, syncState } from '@luna/db/schema';
import {
  emptySettings,
  parseSettings,
  SETTINGS_KEYS,
  type SettingsByKey,
  type SettingsKey,
} from '@luna/db/settings';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

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

export interface AdminStore {
  syncStates(): Promise<SyncStateRow[]>;
  settings(): Promise<StoredSettings>;
  saveSetting<K extends SettingsKey>(
    key: K,
    value: SettingsByKey[K],
    editor: string,
  ): Promise<void>;
  /** 멤버 DB에 있는 루나 기수 번호(예: "LUNA 8기" → 8). 모집 기수 선택지를 만든다. */
  generations(): Promise<number[]>;
}

/** "LUNA 8기", "8기", "8" 같은 값에서 기수 번호만 뽑는다. */
export function generationNumber(value: string | null): number | undefined {
  const match = value?.match(/(\d+)\s*기?\s*$/);
  return match ? Number(match[1]) : undefined;
}

export function createStore(url: string): { store: AdminStore; close: () => Promise<void> } {
  // 운영진 몇 명이 가끔 쓰는 화면이라 연결은 적게 둔다.
  const client = postgres(url, { max: 3, idle_timeout: 60, connect_timeout: 10 });
  const db = drizzle({ client });

  const store: AdminStore = {
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
  };

  return { store, close: () => client.end({ timeout: 5 }) };
}
