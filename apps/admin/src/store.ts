// 관리자 페이지가 읽고 쓰는 Postgres. 공개 사이트는 이 Worker를 거치지 않는다(빌드 때만 DB를 읽음).
import { siteSettings, syncState } from '@luna/db/schema';
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
  saveSetting<K extends SettingsKey>(key: K, value: SettingsByKey[K], email: string): Promise<void>;
}

export function createStore(url: string): { store: AdminStore; close: () => Promise<void> } {
  // Worker 요청 하나에 연결 하나. prepare는 Hyperdrive·프록시와 부딪히지 않게 끈다.
  const client = postgres(url, { max: 1, prepare: false, fetch_types: false, connect_timeout: 10 });
  const db = drizzle(client);

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
    async saveSetting(key, value, email) {
      const now = new Date();
      await db
        .insert(siteSettings)
        .values({ key, value, updatedAt: now, updatedBy: email })
        .onConflictDoUpdate({
          target: siteSettings.key,
          set: { value, updatedAt: now, updatedBy: email },
        });
    },
  };

  return { store, close: () => client.end({ timeout: 5 }) };
}
