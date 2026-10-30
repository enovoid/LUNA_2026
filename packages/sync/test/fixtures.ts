import type { DataSourceObjectResponse, PageObjectResponse } from '@notionhq/client';
import type { DatabaseName } from '../src/config.js';
import { EXPECTED_SCHEMA } from '../src/notion/schema.js';

type Prop = PageObjectResponse['properties'][string];

const rich = (plain: string) => ({
  type: 'text',
  text: { content: plain, link: null },
  annotations: {},
  plain_text: plain,
  href: null,
});

export const prop = {
  title: (...parts: string[]) =>
    ({ id: 'title', type: 'title', title: parts.map(rich) }) as unknown as Prop,
  text: (...parts: string[]) =>
    ({ id: 'x', type: 'rich_text', rich_text: parts.map(rich) }) as unknown as Prop,
  select: (name: string | null) =>
    ({
      id: 'x',
      type: 'select',
      select: name ? { id: name, name, color: 'default' } : null,
    }) as unknown as Prop,
  multi: (...names: string[]) =>
    ({
      id: 'x',
      type: 'multi_select',
      multi_select: names.map((name) => ({ id: name, name, color: 'default' })),
    }) as unknown as Prop,
  number: (value: number | null) => ({ id: 'x', type: 'number', number: value }) as unknown as Prop,
  date: (start: string | null) =>
    ({
      id: 'x',
      type: 'date',
      date: start ? { start, end: null, time_zone: null } : null,
    }) as unknown as Prop,
  file: (url: string, name = 'photo.jpg') =>
    ({
      id: 'x',
      type: 'files',
      files: [{ type: 'file', name, file: { url, expiry_time: '' } }],
    }) as unknown as Prop,
  external: (url: string) =>
    ({
      id: 'x',
      type: 'files',
      files: [{ type: 'external', name: 'ext', external: { url } }],
    }) as unknown as Prop,
  noFiles: () => ({ id: 'x', type: 'files', files: [] }) as unknown as Prop,
};

export function page(
  id: string,
  lastEdited: string,
  properties: Record<string, Prop>,
): PageObjectResponse {
  return {
    object: 'page',
    id,
    last_edited_time: lastEdited,
    created_time: lastEdited,
    in_trash: false,
    archived: false,
    properties,
  } as unknown as PageObjectResponse;
}

export function schemaFor(
  database: DatabaseName,
  override: Record<string, string | undefined> = {},
): DataSourceObjectResponse {
  const properties: Record<string, { id: string; name: string; type: string }> = {};
  for (const [name, type] of Object.entries({ ...EXPECTED_SCHEMA[database], ...override })) {
    if (type) properties[name] = { id: type === 'title' ? 'title' : `id-${name}`, name, type };
  }
  return {
    object: 'data_source',
    id: `ds-${database}`,
    properties,
  } as unknown as DataSourceObjectResponse;
}

export function member(id: string, lastEdited: string, name: string, imageUrl?: string) {
  return page(id, lastEdited, {
    name: prop.title(name),
    lunaGeneration: prop.select('LUNA 8기'),
    description: prop.text('뱁새'),
    position: prop.select('Designer'),
    generation: prop.select('23기'),
    class: prop.select('디지털콘텐츠과'),
    image: imageUrl ? prop.file(imageUrl) : prop.noFiles(),
  });
}
