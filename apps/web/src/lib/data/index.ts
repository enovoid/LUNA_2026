// 빌드 시점 데이터 진입점. 어떤 데이터를 쓸지 정하고, 행 단위로 검증한다.
//
// LUNA_DATA_SOURCE
//   db   : DATABASE_URL에서 읽는다. 연결·조회가 실패하면 빌드를 멈춘다(깨진 사이트를 배포하지 않기 위해).
//   mock : 목업 데이터. PR 미리보기·로컬 개발용.
//   (없음): DATABASE_URL이 있으면 db, 없으면 mock(경고 출력).
//          단 CI(CI=true)에서 DATABASE_URL이 없으면 멈춘다. 비밀 값이 빠진 배포가 목업으로 나가는 것을 막는다.
import { CI, DATABASE_URL, LUNA_DATA_SOURCE } from 'astro:env/server';
import { mockData } from './mock';
import type { SiteData } from './types';

let cached: Promise<SiteData> | undefined;

export function loadSiteData(): Promise<SiteData> {
  cached ??= resolve();
  return cached;
}

async function resolve(): Promise<SiteData> {
  const mode = LUNA_DATA_SOURCE;
  const url = DATABASE_URL;

  if (!mode && !url && CI) {
    throw new Error(
      '[data] CI에서 DATABASE_URL이 없습니다. 목업으로 빌드하려면 LUNA_DATA_SOURCE=mock을 지정하세요.',
    );
  }
  if (mode === 'mock' || (!mode && !url)) {
    if (!mode)
      console.warn(
        '[data] DATABASE_URL이 없어 목업 데이터로 빌드합니다. 배포 빌드는 LUNA_DATA_SOURCE=db로 실행하세요.',
      );
    return sanitize(mockData);
  }
  if (!url) {
    throw new Error(
      '[data] LUNA_DATA_SOURCE=db인데 DATABASE_URL이 없습니다. 배포 빌드를 멈춥니다.',
    );
  }

  const { loadFromDb } = await import('./db');
  try {
    return sanitize(await loadFromDb(url));
  } catch (error) {
    throw new Error(
      `[data] Postgres에서 콘텐츠를 읽지 못했습니다. 이전 배포가 그대로 유지됩니다. 원인: ${describe(error)}`,
      {
        cause: error,
      },
    );
  }
}

/**
 * 사이트에 쓰이는 사진 파일(WebP)을 DB에서 꺼낸다. `pages/img/[...file].ts`가 정적 파일로 내보낸다.
 * 목업 데이터에는 사진이 없어 빈 결과다.
 */
export async function loadImageFiles(
  keys: readonly string[],
): Promise<Map<string, Uint8Array<ArrayBuffer>>> {
  const data = await loadSiteData();
  if (data.source !== 'db' || !DATABASE_URL) return new Map();
  const { loadImageFilesFromDb } = await import('./db');
  try {
    return await loadImageFilesFromDb(DATABASE_URL, keys);
  } catch (error) {
    throw new Error(`[data] Postgres에서 사진 파일을 읽지 못했습니다. 원인: ${describe(error)}`, {
      cause: error,
    });
  }
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** 이름(제목)이 빈 행은 화면에 그릴 수 없으므로 빼고 경고만 남긴다. 한 행 때문에 전체 빌드를 멈추지 않는다. */
function sanitize(data: SiteData): SiteData {
  const keep = <T extends { id: string }>(kind: string, rows: T[], ok: (row: T) => boolean) =>
    rows.filter((row) => {
      if (ok(row)) return true;
      console.warn(`[data] ${kind} ${row.id}: 필수 값이 비어 있어 건너뜁니다.`);
      return false;
    });

  return {
    source: data.source,
    settings: data.settings,
    members: keep('member', data.members, (m) => m.name.trim() !== ''),
    awards: keep('award', data.awards, (a) => a.name.trim() !== ''),
    projects: keep('project', data.projects, (p) => p.name.trim() !== ''),
    faqs: keep('faq', data.faqs, (f) => f.question.trim() !== '' && f.answer.trim() !== ''),
  };
}

export type { Award, Faq, ImageRef, Member, Project, SiteData } from './types';
