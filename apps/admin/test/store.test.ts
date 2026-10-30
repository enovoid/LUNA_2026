import { afterAll, describe, expect, it } from 'vitest';
import { createStore } from '../src/store.js';

// 실제 Postgres가 필요하다. CI는 마이그레이션을 적용한 임시 DB로 돌린다.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('콘텐츠 저장소 (실제 DB)', () => {
  const db = url ? createStore(url) : undefined;
  const created: number[] = [];
  const key = `awards/${'b'.repeat(64)}`;

  afterAll(async () => {
    for (const id of created) await db?.store.deleteContent('awards', id);
    await db?.close();
  });

  it('추가·조회·수정·삭제하고 admin: id를 붙인다', async () => {
    const store = db!.store;
    const id = await store.saveContent(
      'awards',
      undefined,
      {
        name: '테스트 해커톤',
        prize: '대상',
        team: '',
        memberNames: ['윤채원'],
        year: '2026',
        date: '2026-05-01',
        prizeMoney: 1000000,
      },
      { imageKey: key, width: 1600, height: 900 },
    );
    expect(id).toBeTypeOf('number');
    created.push(id!);

    const row = await store.getContent('awards', id!);
    expect(row?.notionId).toMatch(/^admin:[0-9a-f-]{36}$/);
    expect(row?.values).toMatchObject({
      name: '테스트 해커톤',
      memberNames: ['윤채원'],
      date: '2026-05-01',
    });
    expect(row).toMatchObject({ imageKey: key, imageWidth: 1600, imageHeight: 900 });
    expect((await store.listContent('awards')).some((r) => r.id === id)).toBe(true);
    expect(await store.distinctValues('awards', 'year')).toContain('2026');

    // 사진은 undefined면 그대로, null이면 뺀다.
    await store.saveContent('awards', id, { ...row!.values, prize: '금상' }, undefined);
    expect((await store.getContent('awards', id!))?.imageKey).toBe(key);
    await store.saveContent('awards', id, { ...row!.values }, null);
    expect((await store.getContent('awards', id!))?.imageKey).toBeNull();

    expect(await store.deleteContent('awards', id!)).toBe(true);
    expect(await store.deleteContent('awards', id!)).toBe(false);
    expect(await store.saveContent('awards', id, row!.values, undefined)).toBeUndefined();
  });

  it('사진 파일을 넣고 꺼낸다(같은 키는 그대로 둔다)', async () => {
    const store = db!.store;
    const file = `${key}-480.webp`;
    await store.putImageFile(file, Buffer.from('one'));
    await store.putImageFile(file, Buffer.from('two'));
    expect(await store.imageFileExists(file)).toBe(true);
    expect((await store.imageFile(file))?.toString()).toBe('one');
  });
});
