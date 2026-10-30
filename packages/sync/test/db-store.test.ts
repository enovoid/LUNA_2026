import { afterAll, describe, expect, it } from 'vitest';
import { FAQ_ORDER_MISSING, PostgresStore } from '../src/db-store.js';
import { mapPage } from '../src/mappers.js';
import { member, page, prop } from './fixtures.js';

// 실제 Postgres가 필요하다. CI는 마이그레이션을 적용한 임시 DB로 돌린다.
const url = process.env.TEST_DATABASE_URL;
const prefix = `test-${Date.now()}`;

describe.skipIf(!url)('PostgresStore (실제 DB)', () => {
  const store = url ? new PostgresStore(url) : undefined;
  const ids = { m: `${prefix}-m`, f: `${prefix}-f` };

  afterAll(async () => {
    await store?.deleteByNotionIds('members', [ids.m]);
    await store?.deleteByNotionIds('faqs', [ids.f]);
    await store?.close();
  });

  it('upsert는 추가 후 같은 notion_id면 덮어쓴다', async () => {
    const s = store!;
    const syncedAt = new Date('2026-10-30T00:00:00.000Z');
    await s.upsert(
      mapPage('members', member(ids.m, '2026-10-29T10:00:00.000Z', '윤채원')),
      null,
      syncedAt,
    );
    await s.upsert(
      mapPage('members', member(ids.m, '2026-10-29T11:00:00.000Z', '윤채원(수정)')),
      { imageKey: `members/${prefix}`, width: 960, height: 1280 },
      syncedAt,
    );
    const row = (await s.getExisting('members')).get(ids.m);
    expect(row).toEqual({
      notionLastEditedAt: new Date('2026-10-29T11:00:00.000Z'),
      imageKey: `members/${prefix}`,
      imageWidth: 960,
      imageHeight: 1280,
    });
    expect((await s.referencedImageKeys()).has(`members/${prefix}`)).toBe(true);
  });

  it('FAQ order가 비면 맨 뒤 값으로 저장하고, 삭제도 된다', async () => {
    const s = store!;
    const faq = page(ids.f, '2026-10-29T10:00:00.000Z', {
      question: prop.title('Q'),
      order: prop.number(null),
      answer: prop.text('A'),
    });
    await s.upsert(mapPage('faqs', faq), null, new Date());
    expect((await s.getExisting('faqs')).has(ids.f)).toBe(true);
    expect(FAQ_ORDER_MISSING).toBe(2_147_483_647);
    await s.deleteByNotionIds('faqs', [ids.f]);
    expect((await s.getExisting('faqs')).has(ids.f)).toBe(false);
  });

  it('sync_state: lastSyncedAt을 생략하면 이전 값을 유지한다', async () => {
    const s = store!;
    const key = 'members' as const;
    const before = await s.getState(key);
    await s.saveState(key, {
      lastSyncedAt: new Date('2026-10-30T00:00:00.000Z'),
      lastRunAt: new Date(),
      lastResult: { created: 1 },
      lastError: null,
    });
    await s.saveState(key, { lastRunAt: new Date(), lastResult: { failed: 1 }, lastError: 'x' });
    const state = await s.getState(key);
    expect(state?.lastSyncedAt?.toISOString()).toBe('2026-10-30T00:00:00.000Z');
    expect(state?.lastResult).toEqual({ failed: 1 });
    // 원래 상태로 되돌린다.
    if (before) {
      await s.saveState(key, {
        ...(before.lastSyncedAt ? { lastSyncedAt: before.lastSyncedAt } : {}),
        lastRunAt: new Date(),
        lastResult: before.lastResult,
        lastError: null,
      });
    }
  });
});
