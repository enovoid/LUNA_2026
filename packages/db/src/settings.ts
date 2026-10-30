// Notion에서 관리하지 않는 사이트 설정. 관리자 페이지(apps/admin)가 쓰고 사이트 빌드(apps/web)가 읽는다.
// 의존성이 없어 Worker와 Astro 빌드 양쪽에서 그대로 가져다 쓴다.

export interface RecruitSettings {
  /** 예) "9기". generation·applyUrl 중 하나라도 비면 사이트가 모집 섹션을 숨긴다. */
  generation: string;
  /** 예) "3월 2일 ~ 3월 15일" */
  period: string;
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
    period: { label: '모집 기간', max: 60 },
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
  kind?: 'url' | 'email';
}

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

/** 모집 섹션과 "지원하기" 버튼을 보일지. */
export function isRecruiting(recruit: RecruitSettings): boolean {
  return Boolean(recruit.generation && recruit.applyUrl);
}

function isHttpsUrl(text: string): boolean {
  try {
    return new URL(text).protocol === 'https:';
  } catch {
    return false;
  }
}
