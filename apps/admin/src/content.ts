// 관리자 페이지에서 직접 고치는 콘텐츠(멤버·수상·프로젝트·FAQ). 동기화·가져오기와 같은 테이블을 쓴다.
// 폼 입력은 여기서 모두 검사하고 다듬은 값만 DB에 넣는다.

export const CONTENT_TABLES = ['members', 'awards', 'projects', 'faqs'] as const;
export type ContentTable = (typeof CONTENT_TABLES)[number];

export function isContentTable(value: string): value is ContentTable {
  return (CONTENT_TABLES as readonly string[]).includes(value);
}

export type FieldKind = 'text' | 'textarea' | 'int' | 'date' | 'list';

export interface FieldDef {
  /** DB 열(Drizzle 속성 이름) */
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  /** 글자 수 상한(list는 항목 하나의 상한) */
  max?: number;
  placeholder?: string;
  help?: string;
  /** 이미 쓰고 있는 값을 입력 후보로 보여 준다. */
  suggest?: boolean;
}

export interface ContentDef {
  table: ContentTable;
  /** 메뉴·제목 */
  label: string;
  /** "멤버 추가"처럼 하나를 가리킬 때 */
  noun: string;
  images: boolean;
  fields: FieldDef[];
  /** 목록에서 굵게 보일 값과 그 아래 한 줄 */
  title(values: ContentValues): string;
  subtitle(values: ContentValues): string;
}

export type ContentValue = string | number | string[] | null;
export type ContentValues = Record<string, ContentValue>;

const SHORT = 100;
const LONG = 5000;

export const CONTENT: Record<ContentTable, ContentDef> = {
  members: {
    table: 'members',
    label: '멤버',
    noun: '멤버',
    images: true,
    fields: [
      { name: 'name', label: '이름', kind: 'text', required: true, max: 40 },
      {
        name: 'lunaGeneration',
        label: '루나 기수',
        kind: 'text',
        max: 20,
        placeholder: '예: 8기',
        suggest: true,
      },
      {
        name: 'position',
        label: '직군',
        kind: 'text',
        max: 40,
        placeholder: '예: 프론트엔드',
        suggest: true,
      },
      {
        name: 'schoolGeneration',
        label: '학교 기수',
        kind: 'text',
        max: 20,
        placeholder: '예: 24기',
        suggest: true,
      },
      { name: 'className', label: '학과', kind: 'text', max: 40, suggest: true },
      { name: 'description', label: '소개', kind: 'textarea', max: 1000 },
      {
        name: 'sort',
        label: '정렬 순서',
        kind: 'int',
        help: '작은 숫자가 앞에 와요. 비우면 0.',
      },
    ],
    title: (v) => text(v.name),
    subtitle: (v) => join([v.lunaGeneration, v.position, v.className]),
  },
  awards: {
    table: 'awards',
    label: '수상',
    noun: '수상',
    images: true,
    fields: [
      { name: 'name', label: '대회 이름', kind: 'text', required: true, max: SHORT },
      { name: 'prize', label: '상', kind: 'text', max: SHORT, placeholder: '예: 대상' },
      { name: 'team', label: '팀 이름', kind: 'text', max: SHORT },
      {
        name: 'memberNames',
        label: '참여 멤버',
        kind: 'list',
        max: 40,
        help: '쉼표로 나눠 적어요. 예: 윤채원, 장태웅',
      },
      { name: 'year', label: '연도', kind: 'text', max: 10, placeholder: '2026', suggest: true },
      { name: 'date', label: '수상일', kind: 'date' },
      { name: 'prizeMoney', label: '상금(원)', kind: 'int', placeholder: '1000000' },
    ],
    title: (v) => text(v.name),
    subtitle: (v) => join([v.year, v.prize, v.team]),
  },
  projects: {
    table: 'projects',
    label: '프로젝트',
    noun: '프로젝트',
    images: true,
    fields: [
      { name: 'name', label: '이름', kind: 'text', required: true, max: SHORT },
      { name: 'year', label: '연도', kind: 'text', max: 10, placeholder: '2026', suggest: true },
      { name: 'description', label: '설명', kind: 'textarea', max: LONG },
      {
        name: 'awardNames',
        label: '받은 상',
        kind: 'list',
        max: SHORT,
        help: '쉼표로 나눠 적어요. 수상 목록의 대회 이름과 같게 적으면 서로 이어져요.',
      },
    ],
    title: (v) => text(v.name),
    subtitle: (v) => join([v.year, Array.isArray(v.awardNames) ? v.awardNames.join(', ') : '']),
  },
  faqs: {
    table: 'faqs',
    label: 'FAQ',
    noun: '질문',
    images: false,
    fields: [
      { name: 'question', label: '질문', kind: 'text', required: true, max: 300 },
      { name: 'answer', label: '답변', kind: 'textarea', max: LONG },
      { name: 'sortOrder', label: '순서', kind: 'int', help: '작은 숫자가 앞에 와요. 비우면 0.' },
    ],
    title: (v) => text(v.question),
    subtitle: (v) => text(v.answer).slice(0, 80),
  },
};

function text(value: ContentValue | undefined): string {
  return typeof value === 'string'
    ? value
    : value === null || value === undefined
      ? ''
      : String(value);
}

function join(values: (ContentValue | undefined)[]): string {
  return values.map(text).filter(Boolean).join(' · ');
}

/** 보이지 않는 제어 문자는 지우고 줄바꿈은 \n으로 맞춘다. */
function clean(value: string, multiline: boolean): string {
  const normalized = value.replace(/\r\n?/g, '\n');
  let stripped = '';
  for (const char of normalized) {
    const code = char.codePointAt(0) ?? 0;
    const control = code < 0x20 || code === 0x7f;
    if (!control || (multiline && (char === '\n' || char === '\t'))) stripped += char;
  }
  return multiline ? stripped.trim() : stripped.replace(/\s+/g, ' ').trim();
}

const INT_MAX = 2_000_000_000;

export type ParseResult = { ok: true; values: ContentValues } | { ok: false; errors: string[] };

/** 폼 입력을 검사해 DB에 넣을 값으로 바꾼다. 정의에 없는 이름은 버린다. */
export function parseContent(def: ContentDef, input: Record<string, string>): ParseResult {
  const values: ContentValues = {};
  const errors: string[] = [];
  for (const field of def.fields) {
    const raw = clean(input[field.name] ?? '', field.kind === 'textarea');
    if (field.required && !raw) {
      errors.push(`${field.label}을(를) 적어 주세요.`);
      continue;
    }
    switch (field.kind) {
      case 'text':
      case 'textarea': {
        if (field.max && raw.length > field.max) {
          errors.push(`${field.label}은(는) ${field.max}자까지 적을 수 있어요.`);
        }
        // 선택 열(null 가능)과 필수 문자열 열을 구분한다: 기본값이 ''인 열은 빈 문자열로 둔다.
        values[field.name] = raw || (EMPTY_STRING_COLUMNS.has(field.name) ? '' : null);
        break;
      }
      case 'int': {
        if (!raw) {
          values[field.name] = ZERO_DEFAULT_COLUMNS.has(field.name) ? 0 : null;
          break;
        }
        const n = Number(raw.replaceAll(',', ''));
        if (!Number.isInteger(n) || Math.abs(n) > INT_MAX) {
          errors.push(`${field.label}은(는) 정수로 적어 주세요.`);
        } else if (field.name === 'prizeMoney' && n < 0) {
          errors.push(`${field.label}은(는) 0 이상이어야 해요.`);
        } else {
          values[field.name] = n;
        }
        break;
      }
      case 'date': {
        if (!raw) {
          values[field.name] = null;
        } else if (!isDate(raw)) {
          errors.push(`${field.label}은(는) 날짜(YYYY-MM-DD)로 골라 주세요.`);
        } else {
          values[field.name] = raw;
        }
        break;
      }
      case 'list': {
        const items = [
          ...new Set(
            raw
              .split(/[,，\n]/)
              .map((item) => item.trim())
              .filter(Boolean),
          ),
        ];
        if (items.length > 50) errors.push(`${field.label}은(는) 50개까지 적을 수 있어요.`);
        if (field.max && items.some((item) => item.length > (field.max ?? 0))) {
          errors.push(`${field.label}의 항목은 하나에 ${field.max}자까지 적을 수 있어요.`);
        }
        values[field.name] = items;
        break;
      }
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, values };
}

/** NOT NULL DEFAULT ''인 열 */
const EMPTY_STRING_COLUMNS = new Set(['description', 'prize', 'team', 'answer']);
/** NOT NULL DEFAULT 0인 열 */
const ZERO_DEFAULT_COLUMNS = new Set(['sort', 'sortOrder']);

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** 폼에 다시 채울 문자열 */
export function formValue(value: ContentValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}
