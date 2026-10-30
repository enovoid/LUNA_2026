// 빌드 시점에만 실행된다. 방문자 요청은 DB에 닿지 않는다.
import { awards, createDb, faqs, members, projects } from '@luna/db';
import { toImageRef } from './image-ref';
import type { SiteData } from './types';

export async function loadFromDb(url: string): Promise<SiteData> {
  const db = createDb(url);
  try {
    const [memberRows, awardRows, projectRows, faqRows] = await Promise.all([
      db.select().from(members),
      db.select().from(awards),
      db.select().from(projects),
      db.select().from(faqs),
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
    };
  } finally {
    await closeDb(db);
  }
}

async function closeDb(db: unknown) {
  const client = (db as { $client?: { end?: () => Promise<void> } }).$client;
  await client?.end?.().catch(() => {});
}
