import { emptySettings, isRecruiting, parseSettings } from '@luna/db/settings';
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

describe('isRecruiting', () => {
  it('기수와 지원 링크가 모두 있어야 모집 중', () => {
    const recruit = { generation: '9기', period: '', target: '', applyUrl: '' };
    expect(isRecruiting(recruit)).toBe(false);
    expect(isRecruiting({ ...recruit, applyUrl: 'https://forms.gle/a' })).toBe(true);
  });
});
