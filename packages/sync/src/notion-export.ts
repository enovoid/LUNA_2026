import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { unzipSync } from 'fflate';
import type { DatabaseName } from './config.js';
import type { FieldsByDatabase } from './mappers.js';

/**
 * Notion "Markdown & CSV" 내보내기(하위 페이지 포함)를 읽는다. integration을 DB에 공유하지 못했을 때
 * 한 번 옮겨 담는 용도다(`import-cli.ts`). 내보내기 모양:
 *   `Projects <dbid>.csv`, `Projects <dbid>_all.csv`  행 전체(_all은 보기 필터를 무시한 전체)
 *   `Projects/<제목> <pageid>.md`                     행마다 하위 페이지. 첫 줄이 `# <제목>`
 *   `Projects/<제목>/<파일>`                           files 속성에 올린 파일. CSV에는 퍼센트 인코딩된 상대 경로
 */

/** 압축을 푼 내보내기. 경로는 `/` 구분, NFC 정규화. */
export type ExportFiles = Map<string, Uint8Array>;

const nfc = (path: string) => path.normalize('NFC');

/** zip(안에 든 zip 포함)이나 폴더를 읽어 하나로 합친다. Notion은 큰 내보내기를 `Part-1.zip`처럼 zip 안에 나눠 담는다. */
export async function loadExport(inputs: readonly string[]): Promise<ExportFiles> {
  const files: ExportFiles = new Map();
  for (const input of inputs) {
    if ((await stat(input)).isDirectory()) {
      for (const path of await walk(input)) {
        addFile(files, nfc(relative(input, path).split(sep).join('/')), await readFile(path));
      }
    } else {
      addZip(files, await readFile(input));
    }
  }
  return files;
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

function addZip(files: ExportFiles, bytes: Uint8Array): void {
  for (const [path, body] of Object.entries(unzipSync(bytes))) {
    if (path.endsWith('/')) continue;
    addFile(files, nfc(path), body);
  }
}

function addFile(files: ExportFiles, path: string, body: Uint8Array): void {
  if (path.split('/').some((part) => part === '__MACOSX' || part === '.DS_Store')) return;
  if (path.toLowerCase().endsWith('.zip')) addZip(files, body);
  else files.set(path, body);
}

/** RFC 4180 CSV. 따옴표 안의 줄바꿈과 `""`, 앞의 BOM을 처리한다. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^﻿/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((value) => value !== ''));
  if (!header) return [];
  const names = header.map((name) => name.trim());
  return body.map((values) => Object.fromEntries(names.map((name, i) => [name, values[i] ?? ''])));
}

/** 머리글로 어느 DB인지 판단한다. 동기화와 같은 Notion 속성 이름(`notion/schema.ts`)을 기대한다. */
export function detectDatabase(headers: readonly string[]): DatabaseName | undefined {
  const has = (name: string) => headers.includes(name);
  if (has('question')) return 'faqs';
  if (has('prize') || has('prizemoney')) return 'awards';
  if (has('lunaGeneration') || has('position')) return 'members';
  if (has('name') && has('description')) return 'projects';
  return undefined;
}

const NOTION_ID = /([0-9a-f]{32})$/;

/** `abc…` 32자리를 Notion API의 페이지 ID 모양(8-4-4-4-12)으로. */
export function formatNotionId(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface ExportTable {
  database: DatabaseName;
  /** CSV 경로(로그용) */
  csvPath: string;
  /** CSV가 있는 폴더(`''`이면 최상위). 이미지 경로의 기준 */
  baseDir: string;
  rows: Record<string, string>[];
  /** 하위 페이지 제목 → Notion 페이지 ID. 제목이 같은 페이지가 여럿이면 ID도 여럿 */
  pageIds: Map<string, string[]>;
}

/** 내보내기에서 DB 표를 찾는다. 같은 DB의 `X.csv`와 `X_all.csv`가 함께 있으면 `_all`만 쓴다. */
export function findTables(files: ExportFiles): { tables: ExportTable[]; skipped: string[] } {
  const csvs = [...files.keys()].filter((path) => path.toLowerCase().endsWith('.csv'));
  const tables: ExportTable[] = [];
  const skipped: string[] = [];
  for (const csvPath of csvs) {
    const stem = csvPath.slice(0, -4);
    if (!stem.endsWith('_all') && files.has(`${stem}_all.csv`)) continue;
    const rows = parseCsv(new TextDecoder().decode(files.get(csvPath)));
    const database = detectDatabase(Object.keys(rows[0] ?? {}));
    if (!database) {
      skipped.push(csvPath);
      continue;
    }
    const slash = csvPath.lastIndexOf('/');
    const baseDir = slash === -1 ? '' : csvPath.slice(0, slash + 1);
    // `Projects f73e…_all` → `Projects`: 하위 페이지 폴더 이름
    const folder = stem
      .slice(baseDir.length)
      .replace(/_all$/, '')
      .replace(/ [0-9a-f]{32}$/, '');
    tables.push({
      database,
      csvPath,
      baseDir,
      rows,
      pageIds: pageIds(files, `${baseDir}${folder}/`),
    });
  }
  return { tables, skipped };
}

function pageIds(files: ExportFiles, folder: string): Map<string, string[]> {
  const ids = new Map<string, string[]>();
  for (const [path, body] of files) {
    if (!path.startsWith(folder) || !path.endsWith('.md')) continue;
    const name = path.slice(folder.length, -3);
    if (name.includes('/')) continue;
    const hex = NOTION_ID.exec(name)?.[1];
    if (!hex) continue;
    const firstLine = new TextDecoder().decode(body.subarray(0, 4096)).split('\n')[0] ?? '';
    const title = firstLine.startsWith('# ') ? firstLine.slice(2) : name.slice(0, -33);
    const key = nfc(title.trim());
    ids.set(key, [...(ids.get(key) ?? []), formatNotionId(hex)]);
  }
  return ids;
}

const blankToNull = (value: string | undefined): string | null => value?.trim() || null;

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** `1,000,000`, `₩500000` 같은 표시 형식에서 숫자만. */
export function parseNumber(value: string | undefined): number | null {
  const cleaned = (value ?? '').replace(/[^0-9.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n) : null;
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** Notion CSV의 날짜(작업 공간 언어에 따라 `March 5, 2025`, `2025년 3월 5일`, `2025/03/05`)를 `YYYY-MM-DD`로. 기간이면 시작일. */
export function parseDate(value: string | undefined): string | null {
  const start = (value ?? '').split('→')[0]!.trim();
  if (!start) return null;
  const pad = (n: string | number) => String(n).padStart(2, '0');
  let m = /^(\d{4})[-/.]\s*(\d{1,2})[-/.]\s*(\d{1,2})/.exec(start);
  if (m) return `${m[1]}-${pad(m[2]!)}-${pad(m[3]!)}`;
  m = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/.exec(start);
  if (m) return `${m[1]}-${pad(m[2]!)}-${pad(m[3]!)}`;
  m = /^([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})/.exec(start);
  if (m) {
    const month = MONTHS.findIndex((name) => name.startsWith(m![1]!.toLowerCase().slice(0, 3)));
    if (month !== -1) return `${m[3]}-${pad(month + 1)}-${pad(m[2]!)}`;
  }
  return null;
}

/** CSV 한 행을 동기화와 같은 필드로 바꾼다(`mappers.ts`와 같은 규칙: 글은 앞뒤 공백 제거, 빈 select는 null). */
export function rowFields<D extends DatabaseName>(
  database: D,
  row: Record<string, string>,
): FieldsByDatabase[D] {
  const text = (name: string) => (row[name] ?? '').trim();
  const fields: { [K in DatabaseName]: () => FieldsByDatabase[K] } = {
    members: () => ({
      name: text('name'),
      lunaGeneration: blankToNull(row.lunaGeneration),
      description: text('description'),
      position: blankToNull(row.position),
      schoolGeneration: blankToNull(row.generation),
      className: blankToNull(row.class),
    }),
    awards: () => ({
      name: text('name'),
      year: blankToNull(row.year),
      prize: text('prize'),
      team: text('team'),
      memberNames: list(row.members),
      date: parseDate(row.date),
      prizeMoney: parseNumber(row.prizemoney),
    }),
    projects: () => ({
      name: text('name'),
      year: blankToNull(row.year),
      description: text('description'),
      awardNames: list(row.awards),
    }),
    faqs: () => ({
      question: text('question'),
      answer: text('answer'),
      sortOrder: parseNumber(row.order),
    }),
  };
  return fields[database]() as FieldsByDatabase[D];
}

export function titleOf(database: DatabaseName, row: Record<string, string>): string {
  return nfc((database === 'faqs' ? row.question : row.name)?.trim() ?? '');
}

/**
 * 행의 notion_id. 제목이 같은 하위 페이지가 정확히 하나면 그 페이지의 진짜 ID를 써서,
 * 나중에 integration을 공유했을 때 동기화가 같은 행을 그대로 덮어쓰게 한다.
 * 제목이 겹치거나 하위 페이지가 없으면 `notion-export:` 임시 ID. Notion에 없는 ID라
 * 동기화의 삭제 단계가 지우고 진짜 페이지로 새로 만든다.
 */
export function assignNotionIds(table: ExportTable): string[] {
  const titles = table.rows.map((row) => titleOf(table.database, row));
  const count = new Map<string, number>();
  for (const title of titles) count.set(title, (count.get(title) ?? 0) + 1);
  const seen = new Map<string, number>();
  return table.rows.map((row, i) => {
    const title = titles[i]!;
    const ids = table.pageIds.get(title);
    if (ids?.length === 1 && count.get(title) === 1) return ids[0]!;
    const occurrence = (seen.get(title) ?? 0) + 1;
    seen.set(title, occurrence);
    const hash = createHash('sha256')
      .update(JSON.stringify([table.database, row, occurrence]))
      .digest('hex')
      .slice(0, 24);
    return `notion-export:${table.database}:${hash}`;
  });
}

/** 행의 image 칸이 가리키는 파일. 내보내기 안의 상대 경로면 그 바이트, 바깥 주소면 URL. */
export type ImageSource =
  | { kind: 'file'; path: string; body: Uint8Array }
  | { kind: 'url'; url: string };

function decodeSteps(value: string): string[] {
  const out = [value];
  let current = value;
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(current);
      if (next === current) break;
      out.push(next);
      current = next;
    } catch {
      break;
    }
  }
  return out;
}

/**
 * Notion은 경로를 퍼센트 인코딩해 CSV에 적는데, 한글 파일 이름은 zip 안에서도 이미 한 번 인코딩돼 있어
 * 몇 번 풀어야 맞는지 파일마다 다르다. 0~2번 푼 경로를 모두 대 본다. 파일이 여럿이면 `, `로 이어 적는다.
 */
export function resolveImage(
  files: ExportFiles,
  baseDir: string,
  value: string | undefined,
): ImageSource | undefined {
  const raw = (value ?? '').trim();
  if (!raw) return undefined;
  for (const candidate of [raw, ...raw.split(/,\s*/)]) {
    const part = candidate.trim();
    if (/^https?:\/\//.test(part)) return { kind: 'url', url: part };
    for (const decoded of decodeSteps(part)) {
      for (const path of [`${baseDir}${nfc(decoded)}`, nfc(decoded)]) {
        const body = files.get(path);
        if (body) return { kind: 'file', path, body };
      }
    }
  }
  return undefined;
}
