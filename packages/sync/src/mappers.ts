import type { PageObjectResponse } from '@notionhq/client';
import type { DatabaseName } from './config.js';
import {
  dateOnly,
  type FileRef,
  firstFile,
  multiSelect,
  number,
  select,
  text,
} from './notion/properties.js';

interface Base {
  notionId: string;
  notionLastEditedAt: Date;
}

export interface MemberFields {
  name: string;
  lunaGeneration: string | null;
  description: string;
  position: string | null;
  schoolGeneration: string | null;
  className: string | null;
}

export interface AwardFields {
  name: string;
  year: string | null;
  prize: string;
  team: string;
  memberNames: string[];
  date: string | null;
  prizeMoney: number | null;
}

export interface ProjectFields {
  name: string;
  year: string | null;
  description: string;
  awardNames: string[];
}

export interface FaqFields {
  question: string;
  answer: string;
  sortOrder: number | null;
}

export interface FieldsByDatabase {
  members: MemberFields;
  awards: AwardFields;
  projects: ProjectFields;
  faqs: FaqFields;
}

/** Notion 페이지 하나를 DB 행으로 바꾼 결과. 이미지는 아직 내려받기 전이다. */
export interface MappedPage<D extends DatabaseName = DatabaseName> extends Base {
  database: D;
  fields: FieldsByDatabase[D];
  /** 이미지 속성이 없는 테이블(faqs)은 항상 undefined. */
  image: FileRef | undefined;
}

export const DATABASES_WITH_IMAGES = ['members', 'awards', 'projects'] as const;
export type ImageDatabase = (typeof DATABASES_WITH_IMAGES)[number];

export function hasImages(database: DatabaseName): database is ImageDatabase {
  return (DATABASES_WITH_IMAGES as readonly string[]).includes(database);
}

function integerOrNull(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}

const mappers: { [D in DatabaseName]: (page: PageObjectResponse) => FieldsByDatabase[D] } = {
  members: (page) => ({
    name: text(page, 'name'),
    lunaGeneration: select(page, 'lunaGeneration'),
    description: text(page, 'description'),
    position: select(page, 'position'),
    schoolGeneration: select(page, 'generation'),
    className: select(page, 'class'),
  }),
  awards: (page) => ({
    name: text(page, 'name'),
    year: select(page, 'year'),
    prize: text(page, 'prize'),
    team: text(page, 'team'),
    memberNames: multiSelect(page, 'members'),
    date: dateOnly(page, 'date'),
    prizeMoney: integerOrNull(number(page, 'prizemoney')),
  }),
  projects: (page) => ({
    name: text(page, 'name'),
    year: select(page, 'year'),
    description: text(page, 'description'),
    awardNames: multiSelect(page, 'awards'),
  }),
  faqs: (page) => ({
    question: text(page, 'question'),
    answer: text(page, 'answer'),
    sortOrder: integerOrNull(number(page, 'order')),
  }),
};

export function mapPage<D extends DatabaseName>(
  database: D,
  page: PageObjectResponse,
): MappedPage<D> {
  return {
    database,
    notionId: page.id,
    notionLastEditedAt: new Date(page.last_edited_time),
    fields: mappers[database](page),
    image: hasImages(database) ? firstFile(page, 'image') : undefined,
  };
}
