// Notion에서 관리하지 않는 사이트 설정. 관리자 페이지(apps/admin)가 쓰고 사이트 빌드(apps/web)가 읽는다.
// 의존성이 없어 관리자 서버와 Astro 빌드 양쪽에서 그대로 가져다 쓴다.

export interface RecruitSettings {
  /** 예) "9기". 비면 사이트가 모집 섹션을 숨긴다. */
  generation: string;
  /** 'closed'면 날짜와 상관없이 마감으로 보인다. 빈 값은 'open'과 같다. */
  status: string;
  /** 지원 시작일(YYYY-MM-DD, 한국 시간). 비면 바로 시작 */
  startDate: string;
  /** 지원 마감일(YYYY-MM-DD, 그날까지 지원 가능). 비면 마감일 없음 */
  endDate: string;
  /** 지원 대상 */
  target: string;
  /** 지원서 링크(https://…) */
  applyUrl: string;
}

export interface ContactSettings {
  email: string;
  instagram: string;
  github: string;
}

export interface SettingsByKey {
  recruit: RecruitSettings;
  contact: ContactSettings;
}

export type SettingsKey = keyof SettingsByKey;

export const SETTINGS_KEYS: readonly SettingsKey[] = ['recruit', 'contact'];

const FIELDS: { [K in SettingsKey]: { [F in keyof SettingsByKey[K]]: FieldRule } } = {
  recruit: {
    generation: { label: '모집 기수', max: 20 },
    status: { label: '모집 상태', max: 10, kind: 'status' },
    startDate: { label: '지원 시작일', max: 10, kind: 'date' },
    endDate: { label: '지원 마감일', max: 10, kind: 'date' },
    target: { label: '지원 대상', max: 120 },
    applyUrl: { label: '지원서 링크', max: 500, kind: 'url' },
  },
  contact: {
    email: { label: '이메일', max: 120, kind: 'email' },
    instagram: { label: 'Instagram', max: 300, kind: 'url' },
    github: { label: 'GitHub', max: 300, kind: 'url' },
  },
};

interface FieldRule {
  label: string;
  max: number;
  kind?: 'url' | 'email' | 'date' | 'status';
}

export const RECRUIT_STATUSES = { open: '모집 중', closed: '마감' } as const;

export type SettingsResult<K extends SettingsKey> =
  | { ok: true; value: SettingsByKey[K] }
  | { ok: false; errors: string[] };

/**
 * 입력(폼이나 DB jsonb)을 검사해 설정 값으로 바꾼다. 앞뒤 공백을 지우고, 빈 값은 ''로 둔다.
 * 링크는 https만, 이메일은 간단한 형식만 확인한다.
 */
export function parseSettings<K extends SettingsKey>(key: K, input: unknown): SettingsResult<K> {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const rules = FIELDS[key] as Record<string, FieldRule>;
  const value: Record<string, string> = {};
  const errors: string[] = [];

  for (const [field, rule] of Object.entries(rules)) {
    const raw = source[field];
    const text = typeof raw === 'string' ? raw.trim() : '';
    value[field] = text;
    if (!text) continue;
    if (text.length > rule.max) errors.push(`${rule.label}: ${rule.max}자 이하로 적어 주세요.`);
    else if (rule.kind === 'url' && !isHttpsUrl(text))
      errors.push(`${rule.label}: https://로 시작하는 주소를 넣어 주세요.`);
    else if (rule.kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text))
      errors.push(`${rule.label}: 주소 형식이 올바르지 않아요.`);
    else if (rule.kind === 'date' && !isDate(text))
      errors.push(`${rule.label}: 날짜를 골라 주세요(예: 2027-03-02).`);
    else if (rule.kind === 'status' && !Object.hasOwn(RECRUIT_STATUSES, text))
      errors.push(`${rule.label}: 모집 중이나 마감 중에서 골라 주세요.`);
  }
  if (key === 'recruit' && value.startDate && value.endDate && value.startDate > value.endDate) {
    errors.push('지원 마감일이 시작일보다 빨라요.');
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: value as unknown as SettingsByKey[K] };
}

/** 모든 칸이 빈 설정. 저장된 값이 없을 때 쓴다(사이트는 모집 섹션·연락처를 숨긴다). */
export function emptySettings<K extends SettingsKey>(key: K): SettingsByKey[K] {
  const value: Record<string, string> = {};
  for (const field of Object.keys(FIELDS[key])) value[field] = '';
  return value as unknown as SettingsByKey[K];
}

export function settingsLabel(key: SettingsKey, field: string): string {
  return (FIELDS[key] as Record<string, FieldRule>)[field]?.label ?? field;
}

export function settingsFields<K extends SettingsKey>(key: K): (keyof SettingsByKey[K] & string)[] {
  return Object.keys(FIELDS[key]) as (keyof SettingsByKey[K] & string)[];
}

/**
 * 오늘(한국 날짜, YYYY-MM-DD) 기준 모집 상태.
 * - none: 모집 기수가 없음 → 모집 섹션을 숨긴다
 * - upcoming: 시작일 전 → 일정만 보여 준다
 * - open: 지원 가능 → "지원하기" 버튼
 * - closed: 마감으로 바꿨거나 마감일이 지남 → "모집 마감"
 * 사이트는 빌드할 때 이 값을 정하므로, 사이트 서버가 매일 0시(한국 시간)에 다시 빌드한다.
 */
export type RecruitState = 'none' | 'upcoming' | 'open' | 'closed';

export function recruitState(recruit: RecruitSettings, today = todayInSeoul()): RecruitState {
  if (!recruit.generation) return 'none';
  if (recruit.status === 'closed') return 'closed';
  if (recruit.endDate && today > recruit.endDate) return 'closed';
  if (recruit.startDate && today < recruit.startDate) return 'upcoming';
  return recruit.applyUrl ? 'open' : 'upcoming';
}

/** "지원하기" 버튼을 보일지. */
export function isRecruiting(recruit: RecruitSettings, today = todayInSeoul()): boolean {
  return recruitState(recruit, today) === 'open';
}

/** 예) "3월 2일(월) ~ 3월 15일(일)", "3월 15일(일)까지". 날짜가 없으면 ''. */
export function recruitPeriod(recruit: RecruitSettings): string {
  const start = recruit.startDate ? formatDay(recruit.startDate) : '';
  const end = recruit.endDate ? formatDay(recruit.endDate) : '';
  if (start && end) return `${start} ~ ${end}`;
  if (start) return `${start}부터`;
  if (end) return `${end}까지`;
  return '';
}

export function todayInSeoul(now = new Date()): string {
  // sv-SE 로캘은 YYYY-MM-DD로 쓴다.
  return now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function formatDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}월 ${day}일(${weekday})`;
}

function isDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isHttpsUrl(text: string): boolean {
  try {
    return new URL(text).protocol === 'https:';
  } catch {
    return false;
  }
}
