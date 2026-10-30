import {
  emptySettings,
  isRecruiting,
  parseSettings,
  recruitPeriod,
  recruitState,
  todayInSeoul,
} from '@luna/db/settings';
import { describe, expect, it } from 'vitest';

describe('parseSettings', () => {
  it('공백을 지우고 없는 칸은 빈 값으로 채운다', () => {
    expect(parseSettings('contact', { email: ' luna@luna.kr ', unknown: 'x' })).toEqual({
      ok: true,
      value: { email: 'luna@luna.kr', instagram: '', github: '' },
    });
  });

  it('https가 아닌 링크와 잘못된 이메일을 거부한다', () => {
    const result = parseSettings('contact', {
      email: 'not-an-email',
      instagram: 'http://instagram.com/luna',
      github: 'javascript:alert(1)',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(3);
  });

  it('너무 긴 값을 거부한다', () => {
    expect(parseSettings('recruit', { generation: 'x'.repeat(21) }).ok).toBe(false);
  });

  it('객체가 아니면 빈 설정', () => {
    expect(parseSettings('recruit', null)).toEqual({ ok: true, value: emptySettings('recruit') });
  });
});

describe('모집 날짜·상태', () => {
  const recruit = {
    generation: '9기',
    status: '',
    startDate: '2027-03-02',
    endDate: '2027-03-15',
    target: '',
    applyUrl: 'https://forms.gle/a',
  };

  it('날짜 형식과 순서를 검사한다', () => {
    expect(parseSettings('recruit', { startDate: '2027-02-30' }).ok).toBe(false);
    expect(parseSettings('recruit', { startDate: '3월 2일' }).ok).toBe(false);
    expect(parseSettings('recruit', { status: 'maybe' }).ok).toBe(false);
    const reversed = parseSettings('recruit', { startDate: '2027-03-15', endDate: '2027-03-02' });
    expect(reversed.ok).toBe(false);
    expect(parseSettings('recruit', recruit).ok).toBe(true);
  });

  it('오늘 날짜에 따라 예정 → 모집 중 → 마감', () => {
    expect(recruitState(recruit, '2027-03-01')).toBe('upcoming');
    expect(recruitState(recruit, '2027-03-02')).toBe('open');
    expect(recruitState(recruit, '2027-03-15')).toBe('open');
    expect(recruitState(recruit, '2027-03-16')).toBe('closed');
  });

  it('마감으로 바꾸면 기간 안이어도 마감, 기수가 없으면 섹션 없음', () => {
    expect(recruitState({ ...recruit, status: 'closed' }, '2027-03-05')).toBe('closed');
    expect(recruitState({ ...recruit, generation: '' }, '2027-03-05')).toBe('none');
  });

  it('지원 링크가 있어야 지원하기 버튼', () => {
    expect(isRecruiting(recruit, '2027-03-05')).toBe(true);
    expect(isRecruiting({ ...recruit, applyUrl: '' }, '2027-03-05')).toBe(false);
    const noDates = { ...recruit, startDate: '', endDate: '' };
    expect(isRecruiting(noDates, '2030-01-01')).toBe(true);
  });

  it('기간을 요일과 함께 쓴다', () => {
    expect(recruitPeriod(recruit)).toBe('3월 2일(화) ~ 3월 15일(월)');
    expect(recruitPeriod({ ...recruit, startDate: '' })).toBe('3월 15일(월)까지');
    expect(recruitPeriod({ ...recruit, startDate: '', endDate: '' })).toBe('');
  });

  it('한국 날짜로 오늘을 정한다', () => {
    // UTC 3월 1일 15:00 = 한국 3월 2일 0시
    expect(todayInSeoul(new Date('2027-03-01T15:00:00Z'))).toBe('2027-03-02');
  });
});
