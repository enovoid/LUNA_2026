// 빌드 시점에만 실행된다. 방문자 요청은 DB에 닿지 않는다.
import {
  awards,
  createDb,
  emptySettings,
  faqs,
  imageFiles,
  members,
  parseSettings,
  projects,
  type SettingsKey,
  siteSettings,
} from '@luna/db';
import { inArray } from 'drizzle-orm';
import { toImageRef } from './image-ref';
import type { SiteData, SiteSettings } from './types';

export async function loadFromDb(url: string): Promise<SiteData> {
  const db = createDb(url);
  try {
    const [memberRows, awardRows, projectRows, faqRows, settingRows] = await Promise.all([
      db.select().from(members),
      db.select().from(awards),
      db.select().from(projects),
      db.select().from(faqs),
      db.select().from(siteSettings),
    ]);

    return {
      source: 'db',
      members: memberRows.map((m) => ({
        id: m.notionId,
        name: m.name,
        lunaGeneration: m.lunaGeneration ?? '',
        description: m.description ?? '',
        position: m.position ?? '',
        schoolGeneration: m.schoolGeneration ?? '',
        className: m.className ?? '',
        image: toImageRef(m.imageKey, m.imageWidth, m.imageHeight),
      })),
      awards: awardRows.map((a) => ({
        id: a.notionId,
        name: a.name,
        year: a.year ?? '',
        prize: a.prize ?? '',
        team: a.team ?? '',
        memberNames: a.memberNames ?? [],
        date: a.date ?? null,
        prizeMoney: a.prizeMoney ?? null,
        image: toImageRef(a.imageKey, a.imageWidth, a.imageHeight),
      })),
      projects: projectRows.map((p) => ({
        id: p.notionId,
        name: p.name,
        year: p.year ?? '',
        description: p.description ?? '',
        awardNames: p.awardNames ?? [],
        image: toImageRef(p.imageKey, p.imageWidth, p.imageHeight),
      })),
      faqs: faqRows.map((f) => ({
        id: f.notionId,
        question: f.question,
        answer: f.answer ?? '',
        order: f.sortOrder ?? null,
      })),
      settings: {
        recruit: readSetting(settingRows, 'recruit'),
        contact: readSetting(settingRows, 'contact'),
      },
    };
  } finally {
    await closeDb(db);
  }
}

/** image_files에서 주어진 키의 WebP 파일을 꺼낸다. 없는 키는 결과에 빠진다. */
export async function loadImageFilesFromDb(
  url: string,
  keys: readonly string[],
): Promise<Map<string, Uint8Array<ArrayBuffer>>> {
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  if (keys.length === 0) return files;
  const db = createDb(url);
  try {
    for (let i = 0; i < keys.length; i += 200) {
      const rows = await db
        .select({ key: imageFiles.key, body: imageFiles.body })
        .from(imageFiles)
        .where(inArray(imageFiles.key, keys.slice(i, i + 200)));
      // Response 본문은 ArrayBuffer 기반이어야 해서 Buffer를 복사해 둔다.
      for (const row of rows) files.set(row.key, new Uint8Array(row.body));
    }
    return files;
  } finally {
    await closeDb(db);
  }
}

/** 관리자 페이지가 저장할 때 검사하지만, 손으로 고쳐 깨진 값이면 빌드를 멈추지 않고 비운 채 경고한다. */
function readSetting<K extends SettingsKey>(
  rows: { key: string; value: unknown }[],
  key: K,
): SiteSettings[K] {
  const row = rows.find((r) => r.key === key);
  if (!row) return emptySettings(key);
  const parsed = parseSettings(key, row.value);
  if (parsed.ok) return parsed.value;
  console.warn(
    `[data] site_settings.${key}이(가) 올바르지 않아 비웁니다: ${parsed.errors.join(' ')}`,
  );
  return emptySettings(key);
}

async function closeDb(db: unknown) {
  const client = (db as { $client?: { end?: () => Promise<void> } }).$client;
  await client?.end?.().catch(() => {});
}
