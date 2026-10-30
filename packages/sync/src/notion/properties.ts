import type { PageObjectResponse } from '@notionhq/client';

type Property = PageObjectResponse['properties'][string];
type RichTextItem = Extract<Property, { type: 'rich_text' }>['rich_text'][number];

/** 이미지로 쓸 파일 하나. Notion 내부 파일의 url은 1시간 뒤 만료되니 저장하지 말고 내려받는 데만 쓴다. */
export interface FileRef {
  url: string;
  name: string;
  /**
   * Notion에 올린 파일이면 서명 쿼리를 뺀 주소(파일마다 고정). 같은 파일을 다시 내려받지 않는 데 쓴다.
   * 외부 링크는 같은 주소라도 내용이 바뀔 수 있어 undefined.
   */
  stableId: string | undefined;
}

export function stableFileId(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return undefined;
  }
}

function get(page: PageObjectResponse, name: string): Property | undefined {
  return page.properties[name];
}

/** rich_text·title 조각을 일반 텍스트로 합친다. 줄바꿈은 plain_text 안에 그대로 남는다. */
export function joinRichText(items: readonly RichTextItem[]): string {
  return items.map((item) => item.plain_text).join('');
}

export function text(page: PageObjectResponse, name: string): string {
  const property = get(page, name);
  if (property?.type === 'title') return joinRichText(property.title).trim();
  if (property?.type === 'rich_text') return joinRichText(property.rich_text).trim();
  return '';
}

export function select(page: PageObjectResponse, name: string): string | null {
  const property = get(page, name);
  if (property?.type !== 'select') return null;
  return property.select?.name ?? null;
}

export function multiSelect(page: PageObjectResponse, name: string): string[] {
  const property = get(page, name);
  if (property?.type !== 'multi_select') return [];
  return property.multi_select.map((option) => option.name);
}

export function number(page: PageObjectResponse, name: string): number | null {
  const property = get(page, name);
  if (property?.type !== 'number') return null;
  return property.number;
}

/** date 속성의 시작일을 'YYYY-MM-DD'로. 시간이 있어도 날짜만 쓴다(Notion이 준 현지 날짜 그대로). */
export function dateOnly(page: PageObjectResponse, name: string): string | null {
  const property = get(page, name);
  if (property?.type !== 'date' || !property.date) return null;
  return property.date.start.slice(0, 10);
}

/** files 속성의 첫 번째 파일. 이름이나 확장자로 거르지 않고 sharp가 읽을 수 있는지로 판단한다. */
export function firstFile(page: PageObjectResponse, name: string): FileRef | undefined {
  const property = get(page, name);
  if (property?.type !== 'files') return undefined;
  for (const file of property.files) {
    if (file.type === 'file')
      return { url: file.file.url, name: file.name, stableId: stableFileId(file.file.url) };
    if (file.type === 'external')
      return { url: file.external.url, name: file.name, stableId: undefined };
  }
  return undefined;
}
