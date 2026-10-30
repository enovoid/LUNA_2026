import { describe, expect, it } from 'vitest';
import { mapPage } from '../src/mappers.js';
import { checkSchema, formatSchemaReports } from '../src/notion/schema.js';
import { member, page, prop, schemaFor } from './fixtures.js';

describe('mapPage', () => {
  it('Members 속성을 DB 열로 바꾸고 rich_text 조각을 줄바꿈째 합친다', () => {
    const p = page('m1', '2026-10-01T10:00:00.000Z', {
      name: prop.title('윤', '채원'),
      lunaGeneration: prop.select('LUNA 8기'),
      description: prop.text('첫 줄\n', '둘째 줄'),
      position: prop.select('Designer'),
      generation: prop.select('23기'),
      class: prop.select(null),
      image: prop.file(
        'https://prod-files-secure.s3.us-west-2.amazonaws.com/ws/f1/a.jpg?X-Amz-Signature=abc',
      ),
    });
    const mapped = mapPage('members', p);
    expect(mapped.fields).toEqual({
      name: '윤채원',
      lunaGeneration: 'LUNA 8기',
      description: '첫 줄\n둘째 줄',
      position: 'Designer',
      schoolGeneration: '23기',
      className: null,
    });
    expect(mapped.notionLastEditedAt.toISOString()).toBe('2026-10-01T10:00:00.000Z');
    // 서명 쿼리를 뺀 주소가 파일 식별자다. 만료되는 url 자체는 내려받는 데만 쓴다.
    expect(mapped.image?.stableId).toBe(
      'https://prod-files-secure.s3.us-west-2.amazonaws.com/ws/f1/a.jpg',
    );
  });

  it('Awards: multi_select 이름 목록, 날짜, 상금', () => {
    const p = page('a1', '2026-10-01T10:00:00.000Z', {
      name: prop.title('모두의 대회'),
      year: prop.select('2026'),
      prize: prop.text('1위'),
      team: prop.text('푸르미르'),
      members: prop.multi('장태웅', '윤채원'),
      date: prop.date('2026-08-07'),
      image: prop.external('https://example.com/award.png'),
      prizemoney: prop.number(100000),
    });
    const mapped = mapPage('awards', p);
    expect(mapped.fields).toEqual({
      name: '모두의 대회',
      year: '2026',
      prize: '1위',
      team: '푸르미르',
      memberNames: ['장태웅', '윤채원'],
      date: '2026-08-07',
      prizeMoney: 100000,
    });
    // 외부 링크는 같은 주소라도 내용이 바뀔 수 있어 캐시하지 않는다.
    expect(mapped.image).toEqual({
      url: 'https://example.com/award.png',
      name: 'ext',
      stableId: undefined,
    });
  });

  it('빈 값은 null·빈 문자열·빈 배열로', () => {
    const p = page('a2', '2026-10-01T10:00:00.000Z', {
      name: prop.title('대회'),
      year: prop.select(null),
      prize: prop.text(),
      team: prop.text(),
      members: prop.multi(),
      date: prop.date('2026-08-07T09:00:00.000+09:00'),
      image: prop.noFiles(),
      prizemoney: prop.number(null),
    });
    const mapped = mapPage('awards', p);
    expect(mapped.fields).toMatchObject({
      year: null,
      prize: '',
      memberNames: [],
      prizeMoney: null,
      date: '2026-08-07',
    });
    expect(mapped.image).toBeUndefined();
  });

  it('FAQ와 Projects', () => {
    const faq = mapPage(
      'faqs',
      page('f1', '2026-10-01T10:00:00.000Z', {
        question: prop.title('루나는?'),
        order: prop.number(1),
        answer: prop.text('IT 소셜벤처 동아리'),
      }),
    );
    expect(faq.fields).toEqual({ question: '루나는?', answer: 'IT 소셜벤처 동아리', sortOrder: 1 });
    expect(faq.image).toBeUndefined();

    const project = mapPage(
      'projects',
      page('p1', '2026-10-01T10:00:00.000Z', {
        name: prop.title('Correct'),
        year: prop.select('2025'),
        description: prop.text('설명'),
        image: prop.noFiles(),
        awards: prop.multi('2025 전국 청소년창업경진대회 우수상'),
      }),
    );
    expect(project.fields).toEqual({
      name: 'Correct',
      year: '2025',
      description: '설명',
      awardNames: ['2025 전국 청소년창업경진대회 우수상'],
    });
  });

  it('fixture의 member()도 같은 모양', () => {
    expect(mapPage('members', member('m', '2026-10-01T00:00:00.000Z', '홍길동')).fields.name).toBe(
      '홍길동',
    );
  });
});

describe('checkSchema', () => {
  it('표와 같으면 문제 없음', () => {
    expect(checkSchema('members', schemaFor('members')).problems).toEqual([]);
  });

  it('없는 속성, 타입이 다른 속성, 대소문자만 다른 이름을 알려 준다', () => {
    const report = checkSchema(
      'awards',
      schemaFor('awards', {
        prizemoney: undefined,
        prizeMoney: 'number',
        year: 'number',
        비고: 'rich_text',
      }),
    );
    expect(report.problems).toEqual([
      { property: 'year', expected: 'select', actual: 'number' },
      { property: 'prizemoney', expected: 'number', actual: undefined, similarName: 'prizeMoney' },
    ]);
    expect(report.extra).toEqual(['prizeMoney', '비고']);
    expect(formatSchemaReports([report])).toContain('대소문자가 다른 "prizeMoney"');
  });
});
