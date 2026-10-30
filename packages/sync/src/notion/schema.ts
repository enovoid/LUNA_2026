import type { DataSourceObjectResponse } from '@notionhq/client';
import type { DatabaseName } from '../config.js';

type PropertyType = DataSourceObjectResponse['properties'][string]['type'];

/** 요청서 3절의 Notion 속성. 이름은 대소문자까지 그대로 맞아야 한다. */
export const EXPECTED_SCHEMA: Record<DatabaseName, Record<string, PropertyType>> = {
  members: {
    name: 'title',
    lunaGeneration: 'select',
    description: 'rich_text',
    position: 'select',
    generation: 'select',
    class: 'select',
    image: 'files',
  },
  awards: {
    name: 'title',
    year: 'select',
    prize: 'rich_text',
    team: 'rich_text',
    members: 'multi_select',
    date: 'date',
    image: 'files',
    prizemoney: 'number',
  },
  projects: {
    name: 'title',
    year: 'select',
    description: 'rich_text',
    image: 'files',
    awards: 'multi_select',
  },
  faqs: {
    question: 'title',
    order: 'number',
    answer: 'rich_text',
  },
};

export interface SchemaProblem {
  property: string;
  expected: PropertyType;
  /** undefined면 속성이 없다. */
  actual: PropertyType | undefined;
  /** 대소문자만 다른 이름이 있으면 알려 준다. */
  similarName?: string;
}

export interface SchemaReport {
  database: DatabaseName;
  problems: SchemaProblem[];
  /** 표에 없는 속성. 동기화에는 지장이 없어 참고로만 보고한다. */
  extra: string[];
}

export function checkSchema(
  database: DatabaseName,
  schema: DataSourceObjectResponse,
): SchemaReport {
  const expected = EXPECTED_SCHEMA[database];
  const actualNames = Object.keys(schema.properties);
  const problems: SchemaProblem[] = [];

  for (const [property, type] of Object.entries(expected)) {
    const actual = schema.properties[property];
    if (actual?.type === type) continue;
    const problem: SchemaProblem = { property, expected: type, actual: actual?.type };
    if (!actual) {
      const similar = actualNames.find((name) => name.toLowerCase() === property.toLowerCase());
      if (similar) problem.similarName = similar;
    }
    problems.push(problem);
  }

  const extra = actualNames.filter((name) => !(name in expected));
  return { database, problems, extra };
}

export function titlePropertyId(schema: DataSourceObjectResponse): string {
  const title = Object.values(schema.properties).find((property) => property.type === 'title');
  if (!title) throw new Error('제목 속성이 없습니다');
  return title.id;
}

export function formatSchemaReports(reports: readonly SchemaReport[]): string {
  const lines: string[] = [];
  for (const report of reports) {
    if (report.problems.length === 0) {
      lines.push(`${report.database}: 일치`);
    } else {
      lines.push(`${report.database}: 불일치 ${report.problems.length}건`);
      for (const p of report.problems) {
        const actual = p.actual
          ? `실제 타입 ${p.actual}`
          : p.similarName
            ? `없음(대소문자가 다른 "${p.similarName}"이 있음)`
            : '없음';
        lines.push(`  - ${p.property}: 기대 ${p.expected}, ${actual}`);
      }
    }
    if (report.extra.length > 0) lines.push(`  (표에 없는 속성: ${report.extra.join(', ')})`);
  }
  return lines.join('\n');
}

export class SchemaMismatchError extends Error {
  override name = 'SchemaMismatchError';
  constructor(readonly reports: readonly SchemaReport[]) {
    super(`Notion 스키마가 요청서와 다릅니다. 동기화를 멈춥니다.\n${formatSchemaReports(reports)}`);
  }
}
