import type { PageObjectResponse } from '@notionhq/client';
import { describe, expect, it, vi } from 'vitest';
import type { CliOptions, DatabaseName } from '../src/config.js';
import type { ObjectStore } from '../src/image-store.js';
import type { ProcessedImage } from '../src/images.js';
import type { Logger } from '../src/logger.js';
import type { MappedPage } from '../src/mappers.js';
import type { NotionReader, NotionSource } from '../src/notion/client.js';
import { SchemaMismatchError } from '../src/notion/schema.js';
import type {
  ContentStore,
  ExistingRow,
  StateKey,
  SyncStateRecord,
  SyncStateWrite,
} from '../src/store.js';
import { INCREMENTAL_OVERLAP_MS, runSync } from '../src/sync.js';
import { member, page, prop, schemaFor } from './fixtures.js';

const DBS: DatabaseName[] = ['members', 'awards', 'projects', 'faqs'];
const ids = {
  members: 'db-members',
  awards: 'db-awards',
  projects: 'db-projects',
  faqs: 'db-faqs',
};

class FakeNotion implements NotionReader {
  pages: Record<DatabaseName, PageObjectResponse[]> = {
    members: [],
    awards: [],
    projects: [],
    faqs: [],
  };
  schemas: Partial<Record<DatabaseName, Record<string, string | undefined>>> = {};
  queries: { db: DatabaseName; since: Date | undefined }[] = [];
  failList = false;

  async resolveSource(id: string): Promise<NotionSource> {
    const db = DBS.find((name) => ids[name] === id)!;
    return { configuredId: id, dataSourceId: `ds-${db}`, schema: schemaFor(db, this.schemas[db]) };
  }
  #db(dataSourceId: string) {
    return dataSourceId.replace('ds-', '') as DatabaseName;
  }
  async queryPages(dataSourceId: string, since: Date | undefined) {
    const db = this.#db(dataSourceId);
    this.queries.push({ db, since });
    return this.pages[db].filter((p) => !since || new Date(p.last_edited_time) >= since);
  }
  async listPageIds(dataSourceId: string) {
    if (this.failList) throw new Error('list failed');
    return new Set(this.pages[this.#db(dataSourceId)].map((p) => p.id));
  }
}

interface Row extends ExistingRow {
  fields: unknown;
}

class FakeStore implements ContentStore {
  rows: Record<DatabaseName, Map<string, Row>> = {
    members: new Map(),
    awards: new Map(),
    projects: new Map(),
    faqs: new Map(),
  };
  states = new Map<StateKey, SyncStateRecord & { lastError: string | null }>();
  failUpsertFor = new Set<string>();

  async getExisting(db: DatabaseName) {
    return new Map(this.rows[db]);
  }
  async upsert(p: MappedPage, image: ProcessedImage | null) {
    if (this.failUpsertFor.has(p.notionId)) throw new Error('db write failed');
    this.rows[p.database].set(p.notionId, {
      notionLastEditedAt: p.notionLastEditedAt,
      imageKey: image?.imageKey ?? null,
      imageWidth: image?.width ?? null,
      imageHeight: image?.height ?? null,
      fields: p.fields,
    });
  }
  async deleteByNotionIds(db: DatabaseName, notionIds: readonly string[]) {
    for (const id of notionIds) this.rows[db].delete(id);
  }
  async referencedImageKeys() {
    const keys = new Set<string>();
    for (const db of DBS)
      for (const row of this.rows[db].values()) if (row.imageKey) keys.add(row.imageKey);
    return keys;
  }
  async getState(key: StateKey) {
    return this.states.get(key);
  }
  async saveState(key: StateKey, state: SyncStateWrite) {
    const prev = this.states.get(key);
    this.states.set(key, {
      lastSyncedAt: state.lastSyncedAt ?? prev?.lastSyncedAt ?? null,
      lastResult: state.lastResult,
      lastError: state.lastError,
    });
  }
  async close() {}
}

class FakeObjects implements ObjectStore {
  files = new Set<string>();
  async exists(key: string) {
    return this.files.has(key);
  }
  async put(key: string) {
    this.files.add(key);
  }
  async listKeys(prefix: string) {
    return [...this.files].filter((k) => k.startsWith(prefix));
  }
  async deleteKeys(keys: readonly string[]) {
    for (const k of keys) this.files.delete(k);
  }
}

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const run = (o: Partial<CliOptions> = {}): CliOptions => ({
  full: false,
  dryRun: false,
  checkSchema: false,
  ...o,
});

function setup() {
  const notion = new FakeNotion();
  const store = new FakeStore();
  const objects = new FakeObjects();
  const dispatch = vi.fn(async (_payload: Record<string, unknown>) => {});
  let clock = new Date('2026-10-30T00:00:00.000Z');
  const deps = {
    notion,
    store,
    objects,
    dispatch,
    logger: silent,
    databaseIds: ids,
    orphanGraceMs: 60 * 60_000,
    now: () => clock,
  };
  const advance = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };
  return { notion, store, objects, dispatch, deps, advance, now: () => clock };
}

describe('runSync', () => {
  it('첫 실행은 전체를 읽고, 다음 실행은 바뀐 페이지만 반영한다', async () => {
    const { notion, store, dispatch, deps, advance } = setup();
    notion.pages.members = [
      member('m1', '2026-10-29T10:00:00.000Z', '윤채원'),
      member('m2', '2026-10-29T10:00:00.000Z', '장태웅'),
    ];
    notion.pages.faqs = [
      page('f1', '2026-10-29T10:00:00.000Z', {
        question: prop.title('Q'),
        order: prop.number(1),
        answer: prop.text('A'),
      }),
    ];

    const first = await runSync(run(), deps);
    expect(first.results.members).toMatchObject({ created: 2, updated: 0 });
    expect(first.changed).toBe(3);
    expect(notion.queries.every((q) => q.since === undefined)).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(store.states.get('members')?.lastSyncedAt?.toISOString()).toBe(
      '2026-10-30T00:00:00.000Z',
    );

    // 아무것도 안 바뀜 → 겹쳐 읽은 페이지는 건너뛰고 dispatch하지 않는다.
    advance(15 * 60_000);
    notion.queries = [];
    notion.pages.members[0] = member('m1', '2026-10-29T23:58:00.000Z', '윤채원');
    store.rows.members.get('m1')!.notionLastEditedAt = new Date('2026-10-29T23:58:00.000Z');
    const quiet = await runSync(run(), deps);
    expect(quiet.changed).toBe(0);
    expect(quiet.results.members?.unchanged).toBe(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(notion.queries[0]?.since?.getTime()).toBe(
      new Date('2026-10-30T00:00:00.000Z').getTime() - INCREMENTAL_OVERLAP_MS,
    );

    // 한 명 수정 → 그 한 명만 갱신, dispatch.
    advance(15 * 60_000);
    notion.pages.members[1] = member('m2', '2026-10-30T00:20:00.000Z', '장태웅(수정)');
    const edited = await runSync(run(), deps);
    expect(edited.results.members).toMatchObject({ updated: 1, created: 0 });
    expect((store.rows.members.get('m2')!.fields as { name: string }).name).toBe('장태웅(수정)');
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('스키마가 다르면 아무것도 쓰지 않고 멈춘다', async () => {
    const { notion, store, dispatch, deps } = setup();
    notion.schemas.members = { lunaGeneration: undefined, LunaGeneration: 'select' };
    notion.pages.members = [member('m1', '2026-10-29T10:00:00.000Z', '윤채원')];
    await expect(runSync(run(), deps)).rejects.toBeInstanceOf(SchemaMismatchError);
    expect(store.rows.members.size).toBe(0);
    expect(store.states.get('members')?.lastError).toContain('LunaGeneration');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('한 페이지가 실패해도 나머지는 반영하고, 커서를 옮기지 않아 다음에 다시 시도한다', async () => {
    const { notion, store, deps, advance } = setup();
    notion.pages.members = [
      member('m1', '2026-10-29T10:00:00.000Z', '윤채원'),
      member('m2', '2026-10-29T10:00:00.000Z', '장태웅'),
    ];
    store.failUpsertFor.add('m2');
    const summary = await runSync(run(), deps);
    expect(summary.results.members).toMatchObject({ created: 1, failed: 1 });
    expect(summary.errors[0]).toContain('"장태웅" (m2)');
    expect(store.states.get('members')?.lastSyncedAt).toBeNull();
    expect(store.states.get('members')?.lastError).toContain('db write failed');
    // 다른 DB는 정상 진행
    expect(store.states.get('faqs')?.lastSyncedAt).not.toBeNull();

    advance(15 * 60_000);
    store.failUpsertFor.clear();
    notion.queries = [];
    const retry = await runSync(run(), deps);
    expect(notion.queries.find((q) => q.db === 'members')?.since).toBeUndefined();
    expect(retry.results.members).toMatchObject({ created: 1, unchanged: 1, failed: 0 });
    expect(store.states.get('members')?.lastError).toBeNull();
  });

  it('Notion에서 사라진 페이지는 지우고, 목록이 통째로 비면 지우지 않는다', async () => {
    const { notion, store, deps } = setup();
    notion.pages.members = [
      member('m1', '2026-10-29T10:00:00.000Z', 'A'),
      member('m2', '2026-10-29T10:00:00.000Z', 'B'),
    ];
    await runSync(run(), deps);
    // 관리자 페이지에서 만든 행은 Notion에 없어도 지우지 않는다.
    store.rows.members.set('admin:x1', {
      notionLastEditedAt: new Date('2026-10-29T10:00:00.000Z'),
      imageKey: null,
      imageWidth: null,
      imageHeight: null,
      fields: { name: 'C' },
    });
    notion.pages.members = [notion.pages.members[0]!];
    const removed = await runSync(run(), deps);
    expect(removed.results.members?.deleted).toBe(1);
    expect([...store.rows.members.keys()]).toEqual(['m1', 'admin:x1']);

    notion.pages.members = [];
    const guarded = await runSync(run(), deps);
    expect(guarded.results.members?.deleted).toBe(0);
    expect(guarded.errors.join()).toContain('--full');
    expect(store.rows.members.size).toBe(2);

    const forced = await runSync(run({ full: true }), deps);
    expect(forced.results.members?.deleted).toBe(1);
    expect([...store.rows.members.keys()]).toEqual(['admin:x1']);
  });

  it('DB 하나의 조회가 실패해도 다른 DB는 계속한다', async () => {
    const { notion, store, deps } = setup();
    notion.pages.faqs = [
      page('f1', '2026-10-29T10:00:00.000Z', {
        question: prop.title('Q'),
        order: prop.number(1),
        answer: prop.text('A'),
      }),
    ];
    notion.failList = true;
    const summary = await runSync(run(), deps);
    expect(summary.errors.length).toBe(4);
    // 조회해서 반영한 행은 남는다(삭제 단계만 실패).
    expect(store.rows.faqs.size).toBe(1);
  });

  it('dispatch가 실패하면 다음 실행에서 바뀐 게 없어도 다시 부른다', async () => {
    const { notion, store, dispatch, deps } = setup();
    notion.pages.members = [member('m1', '2026-10-29T10:00:00.000Z', 'A')];
    dispatch.mockRejectedValueOnce(new Error('repository_dispatch 실패: HTTP 502'));
    const failed = await runSync(run(), deps);
    expect(failed.dispatched).toBe(false);
    expect(failed.errors).toContain('repository_dispatch 실패: HTTP 502');
    expect(store.states.get('_dispatch')?.lastResult).toEqual({ pending: true });

    const retry = await runSync(run(), deps);
    expect(retry.changed).toBe(0);
    expect(retry.dispatched).toBe(true);
    expect(dispatch).toHaveBeenLastCalledWith({ changed: 0, retried: true });
    expect(store.states.get('_dispatch')?.lastResult).toEqual({ pending: false });
  });

  it('--dry-run은 쓰지도, 빌드를 부르지도 않는다', async () => {
    const { notion, store, objects, dispatch, deps } = setup();
    notion.pages.members = [member('m1', '2026-10-29T10:00:00.000Z', 'A')];
    const { readOnly } = await import('../src/store.js');
    const summary = await runSync(run({ dryRun: true }), {
      ...deps,
      store: readOnly(store),
      objects: undefined,
      dispatch: undefined,
    });
    expect(summary.changed).toBe(1);
    expect(store.rows.members.size).toBe(0);
    expect(store.states.size).toBe(0);
    expect(objects.files.size).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('쓰이지 않게 된 이미지 파일은 유예 시간이 지난 뒤 지운다', async () => {
    const { store, objects, deps, advance } = setup();
    objects.files = new Set([
      'members/old-480.webp',
      'members/old-960.webp',
      'members/old-1600.webp',
      'members/used-480.webp',
    ]);
    store.rows.members.set('m1', {
      notionLastEditedAt: new Date(0),
      imageKey: 'members/used',
      imageWidth: 1,
      imageHeight: 1,
      fields: {},
    });
    const deps2 = { ...deps, notion: Object.assign(new FakeNotion(), {}) };
    deps2.notion.pages.members = [member('m1', '1970-01-01T00:00:00.000Z', 'A')];

    const first = await runSync(run(), deps2);
    expect(first.imagesDeleted).toBe(0);
    expect(objects.files.has('members/old-1600.webp')).toBe(true);

    advance(61 * 60_000);
    const later = await runSync(run(), deps2);
    expect(later.imagesDeleted).toBe(3);
    expect([...objects.files]).toEqual(['members/used-480.webp']);
  });
});
