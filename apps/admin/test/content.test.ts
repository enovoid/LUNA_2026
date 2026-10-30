import { describe, expect, it } from 'vitest';
import { CONTENT, parseContent } from '../src/content.js';
import { sniffImage } from '../src/images.js';

describe('parseContent', () => {
  it('다듬어서 열 이름별 값으로 바꾼다', () => {
    const result = parseContent(CONTENT.awards, {
      name: ' 해커톤\u0000 ',
      prize: '',
      memberNames: '윤채원, 장태웅,윤채원,, ',
      year: '2026',
      date: '2026-05-01',
      prizeMoney: '1,000,000',
    });
    expect(result).toEqual({
      ok: true,
      values: {
        name: '해커톤',
        prize: '',
        team: '',
        memberNames: ['윤채원', '장태웅'],
        year: '2026',
        date: '2026-05-01',
        prizeMoney: 1000000,
      },
    });
  });

  it('필수 칸·길이·숫자·날짜를 검사한다', () => {
    const result = parseContent(CONTENT.members, { name: '', sort: '1.5' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      '이름을(를) 적어 주세요.',
      '정렬 순서은(는) 정수로 적어 주세요.',
    ]);
    const long = parseContent(CONTENT.faqs, { question: 'Q'.repeat(301) });
    expect(long.ok).toBe(false);
    const negative = parseContent(CONTENT.awards, { name: 'A', prizeMoney: '-1' });
    expect(negative.ok).toBe(false);
  });
});

describe('sniffImage', () => {
  it('파일 앞부분으로 형식을 알아본다', () => {
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(
      'png',
    );
    expect(sniffImage(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(
      sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">')),
    ).toBeUndefined();
  });
});
