import { describe, expect, it } from 'vitest';
import {
  assignNotionIds,
  type ExportFiles,
  findTables,
  parseCsv,
  parseDate,
  parseNumber,
  resolveImage,
  rowFields,
} from '../src/notion-export.js';

const enc = (text: string) => new TextEncoder().encode(text);

function exportOf(entries: Record<string, string>): ExportFiles {
  return new Map(Object.entries(entries).map(([path, body]) => [path, enc(body)]));
}

describe('parseCsv', () => {
  it('BOM, 따옴표 안의 쉼표·줄바꿈·"" 를 처리하고 빈 행은 버린다', () => {
    const rows = parseCsv('﻿question,order,answer\n"a, b?",1,"첫 줄\n""둘째"""\n,,\n');
    expect(rows).toEqual([{ question: 'a, b?', order: '1', answer: '첫 줄\n"둘째"' }]);
  });
});

describe('findTables', () => {
  const files = exportOf({
    'Projects f73e99abb9ea4817b2d6c6333d152242.csv':
      'name,year,description,image,awards\nA,2025,x,,\n',
    'Projects f73e99abb9ea4817b2d6c6333d152242_all.csv':
      'name,awards,description,image,year\nA,"상1, 상2",x,,2025\n샛별,,x,,2024\n샛별,,y,,2025\n',
    'Projects/A 2da962a6fa5480adb8a7fea11c1c9c3b.md': '# A\n',
    'Projects/샛별 1ab962a6fa548050a635faf581828100.md': '# 샛별\n',
    'Projects/샛별 2de962a6fa5480b0ac10cb79019fc90c.md': '# 샛별\n',
    'FAQ 5153a7c657844eebaa62b737c726447d.csv': 'question,order,answer\nQ?,2,A\n',
    'notes.csv': 'foo,bar\n1,2\n',
  });

  it('_all.csv만 쓰고 머리글로 DB를 알아낸다', () => {
    const { tables, skipped } = findTables(files);
    expect(tables.map((t) => [t.database, t.csvPath])).toEqual([
      ['projects', 'Projects f73e99abb9ea4817b2d6c6333d152242_all.csv'],
      ['faqs', 'FAQ 5153a7c657844eebaa62b737c726447d.csv'],
    ]);
    expect(skipped).toEqual(['notes.csv']);
  });

  it('제목이 하나뿐이면 하위 페이지의 진짜 ID, 겹치면 임시 ID', () => {
    const projects = findTables(files).tables[0]!;
    const ids = assignNotionIds(projects);
    expect(ids[0]).toBe('2da962a6-fa54-80ad-b8a7-fea11c1c9c3b');
    expect(ids[1]).toMatch(/^notion-export:projects:[0-9a-f]{24}$/);
    expect(ids[2]).toMatch(/^notion-export:projects:[0-9a-f]{24}$/);
    expect(ids[1]).not.toBe(ids[2]);
    // 다시 실행해도 같은 ID(같은 행을 덮어쓴다)
    expect(assignNotionIds(projects)).toEqual(ids);
  });
});

describe('rowFields', () => {
  it('동기화와 같은 규칙으로 바꾼다', () => {
    expect(
      rowFields('projects', { name: ' Correct ', year: '2025', description: 'd', awards: 'a, b' }),
    ).toEqual({ name: 'Correct', year: '2025', description: 'd', awardNames: ['a', 'b'] });
    expect(
      rowFields('awards', {
        name: 'n',
        year: '',
        prize: '대상',
        team: '',
        members: '',
        date: 'March 5, 2025',
        prizemoney: '₩1,000,000',
      }),
    ).toEqual({
      name: 'n',
      year: null,
      prize: '대상',
      team: '',
      memberNames: [],
      date: '2025-03-05',
      prizeMoney: 1000000,
    });
    expect(rowFields('faqs', { question: 'Q', answer: 'A', order: '' })).toEqual({
      question: 'Q',
      answer: 'A',
      sortOrder: null,
    });
  });

  it('여러 날짜 형식', () => {
    expect(parseDate('2025년 3월 5일')).toBe('2025-03-05');
    expect(parseDate('2025/03/05 → 2025/03/07')).toBe('2025-03-05');
    expect(parseDate('Dec 1, 2024 10:00 AM')).toBe('2024-12-01');
    expect(parseDate('')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });
});

describe('resolveImage', () => {
  it('한 번이나 두 번 퍼센트 인코딩된 경로를 찾는다', () => {
    const files = exportOf({
      'Projects/요해/%E1%84%8B%E1%85%AD.png': 'png',
      'Projects/A B/a.png': 'png2',
    });
    const twice = resolveImage(
      files,
      '',
      'Projects/%EC%9A%94%ED%95%B4/%25E1%2584%258B%25E1%2585%25AD.png',
    );
    expect(twice?.kind === 'file' && twice.path).toBe('Projects/요해/%E1%84%8B%E1%85%AD.png');
    const once = resolveImage(files, '', 'Projects/A%20B/a.png');
    expect(once?.kind === 'file' && once.path).toBe('Projects/A B/a.png');
    expect(resolveImage(files, '', 'https://example.com/x.png')).toEqual({
      kind: 'url',
      url: 'https://example.com/x.png',
    });
    expect(resolveImage(files, '', 'Projects/없음.png')).toBeUndefined();
  });
});
