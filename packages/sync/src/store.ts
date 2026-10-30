import type { DatabaseName } from './config.js';
import type { ProcessedImage } from './images.js';
import type { MappedPage } from './mappers.js';

export interface ExistingRow {
  notionLastEditedAt: Date;
  imageKey: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
}

export interface RunResult {
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
  failed: number;
  imagesUploaded: number;
  durationMs: number;
  errors: string[];
}

export interface SyncStateRecord {
  lastSyncedAt: Date | null;
  lastResult: unknown;
}

export interface SyncStateWrite {
  /** undefined면 이전 값을 그대로 둔다. */
  lastSyncedAt?: Date;
  lastRunAt: Date;
  lastResult: unknown;
  lastError: string | null;
}

/**
 * sync_state에는 Notion DB 이름 말고도 작업 내부 상태를 같은 모양으로 둔다.
 * - `_r2_orphans`: 쓰이지 않게 된 이미지와 처음 발견한 시각(유예 뒤 삭제)
 * - `_dispatch`: 빌드 호출이 실패해 다음 실행에서 다시 불러야 하는지
 * - `_image_cache`: Notion 파일 주소 → 이미 올린 image_key와 크기(같은 사진을 다시 내려받지 않게)
 * - `_running`: 지금 실행 중인 동기화(겹침 방지 잠금). `db-store.ts`의 acquireRunLock 참고
 */
export type StateKey = DatabaseName | '_r2_orphans' | '_dispatch' | '_image_cache' | '_running';

export interface ContentStore {
  getExisting(database: DatabaseName): Promise<Map<string, ExistingRow>>;
  upsert(page: MappedPage, image: ProcessedImage | null, syncedAt: Date): Promise<void>;
  deleteByNotionIds(database: DatabaseName, notionIds: readonly string[]): Promise<void>;
  /** 모든 테이블에서 쓰고 있는 image_key 접두어. */
  referencedImageKeys(): Promise<Set<string>>;
  getState(key: StateKey): Promise<SyncStateRecord | undefined>;
  saveState(key: StateKey, state: SyncStateWrite): Promise<void>;
  close(): Promise<void>;
}

/** 읽기는 그대로 하고 쓰기는 버린다(--dry-run). */
export function readOnly(store: ContentStore): ContentStore {
  return {
    getExisting: (database) => store.getExisting(database),
    referencedImageKeys: () => store.referencedImageKeys(),
    getState: (key) => store.getState(key),
    upsert: async () => {},
    deleteByNotionIds: async () => {},
    saveState: async () => {},
    close: () => store.close(),
  };
}

/** DATABASE_URL 없이 --dry-run 할 때. 첫 실행처럼 모든 페이지를 새 항목으로 본다. */
export function emptyStore(): ContentStore {
  return {
    getExisting: async () => new Map(),
    referencedImageKeys: async () => new Set(),
    getState: async () => undefined,
    upsert: async () => {},
    deleteByNotionIds: async () => {},
    saveState: async () => {},
    close: async () => {},
  };
}
