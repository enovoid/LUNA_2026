import type { PageObjectResponse } from '@notionhq/client';
import PQueue from 'p-queue';
import { type CliOptions, DATABASE_NAMES, type DatabaseName } from './config.js';
import type { Dispatcher } from './dispatch.js';
import { deserializeCache, ImagePipeline, serializeCache } from './image-pipeline.js';
import type { ProcessedImage } from './images.js';
import { errorMessage, type Logger } from './logger.js';
import { DATABASES_WITH_IMAGES, hasImages, mapPage } from './mappers.js';
import type { NotionReader, NotionSource } from './notion/client.js';
import {
  checkSchema,
  formatSchemaReports,
  SchemaMismatchError,
  titlePropertyId,
} from './notion/schema.js';
import type { ObjectStore } from './r2.js';
import type { ContentStore, ExistingRow, RunResult } from './store.js';

/**
 * Notion의 last_edited_time은 분 단위로 잘리고, 쿼리 색인에 바로 반영되지 않을 때도 있다.
 * 그래서 지난 실행 시각보다 조금 앞부터 다시 조회한다. 겹쳐 읽은 페이지는 수정 시각이 같으면 건너뛴다.
 */
export const INCREMENTAL_OVERLAP_MS = 5 * 60_000;
/** 페이지(이미지 다운로드·변환·업로드 포함)를 동시에 몇 개까지 처리할지. Notion API 요청은 별도 대기열을 거친다. */
const PAGE_CONCURRENCY = 4;

export interface SyncDeps {
  notion: NotionReader;
  store: ContentStore;
  /** undefined면 이미지를 올리지도 지우지도 않는다(--dry-run). */
  objects: ObjectStore | undefined;
  /** undefined면 빌드를 호출하지 않는다(--dry-run). */
  dispatch: Dispatcher | undefined;
  logger: Logger;
  databaseIds: Record<DatabaseName, string>;
  orphanGraceMs: number;
  now?: () => Date;
}

export interface SyncSummary {
  dryRun: boolean;
  full: boolean;
  results: Partial<Record<DatabaseName, RunResult>>;
  changed: number;
  imagesUploaded: number;
  imagesDeleted: number;
  dispatched: boolean;
  durationMs: number;
  errors: string[];
}

function emptyResult(): RunResult {
  return {
    created: 0,
    updated: 0,
    unchanged: 0,
    deleted: 0,
    failed: 0,
    imagesUploaded: 0,
    durationMs: 0,
    errors: [],
  };
}

function pageLabel(page: PageObjectResponse): string {
  const title = Object.values(page.properties).find((p) => p.type === 'title');
  const text = title?.type === 'title' ? title.title.map((t) => t.plain_text).join('') : '';
  return text ? `"${text}" (${page.id})` : page.id;
}

/** 자주 생기는 Notion 설정 문제에 고칠 방법을 덧붙인다. */
export function notionHint(error: unknown): string {
  const code = (error as { code?: unknown }).code;
  if (code === 'unauthorized') return ' (NOTION_TOKEN이 틀렸거나 integration이 삭제됨)';
  if (code === 'object_not_found' || code === 'restricted_resource') {
    return ' (DB ID가 맞는지, 그 DB의 "연결"에 integration을 추가했는지 확인)';
  }
  return '';
}

/** Notion 스키마를 확인한다. 하나라도 다르면 SchemaMismatchError. */
export async function verifySchemas(
  notion: NotionReader,
  databaseIds: Record<DatabaseName, string>,
): Promise<{ sources: Record<DatabaseName, NotionSource>; report: string }> {
  const sources = Object.fromEntries(
    await Promise.all(
      DATABASE_NAMES.map(async (name) => {
        try {
          return [name, await notion.resolveSource(databaseIds[name])] as const;
        } catch (error) {
          throw new Error(
            `${name} DB(${databaseIds[name]})를 읽지 못했습니다: ${errorMessage(error)}${notionHint(error)}`,
            { cause: error },
          );
        }
      }),
    ),
  ) as Record<DatabaseName, NotionSource>;
  const reports = DATABASE_NAMES.map((name) => checkSchema(name, sources[name].schema));
  if (reports.some((report) => report.problems.length > 0)) throw new SchemaMismatchError(reports);
  return { sources, report: formatSchemaReports(reports) };
}

export async function runSync(options: CliOptions, deps: SyncDeps): Promise<SyncSummary> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const { logger, store } = deps;
  const summary: SyncSummary = {
    dryRun: options.dryRun,
    full: options.full,
    results: {},
    changed: 0,
    imagesUploaded: 0,
    imagesDeleted: 0,
    dispatched: false,
    durationMs: 0,
    errors: [],
  };

  // 1. 스키마 확인. 다르면 아무것도 쓰지 않고 멈춘다.
  let sources: Record<DatabaseName, NotionSource>;
  try {
    const verified = await verifySchemas(deps.notion, deps.databaseIds);
    sources = verified.sources;
    logger.info(`Notion 스키마 확인 완료\n${verified.report}`);
  } catch (error) {
    const message = errorMessage(error);
    for (const name of DATABASE_NAMES) {
      await store.saveState(name, {
        lastRunAt: startedAt,
        lastResult: { aborted: true },
        lastError: message,
      });
    }
    throw error;
  }

  const imageCache = deserializeCache((await store.getState('_image_cache'))?.lastResult);
  const images = new ImagePipeline(deps.objects, imageCache);

  // 2. DB마다 바뀐 페이지를 읽어 반영한다. 한 DB가 실패해도 다음 DB는 계속한다.
  for (const name of DATABASE_NAMES) {
    const result = await syncDatabase(name, sources[name], options, deps, images, now).catch(
      (error) => {
        const r = emptyResult();
        r.failed = 1;
        r.errors.push(`${name}: ${errorMessage(error)}`);
        return r;
      },
    );
    summary.results[name] = result;
    summary.changed += result.created + result.updated + result.deleted;
    summary.imagesUploaded += result.imagesUploaded;
    summary.errors.push(...result.errors);
  }

  // 3. 쓰이지 않게 된 이미지 정리.
  let referenced: Set<string> | undefined;
  try {
    referenced = await store.referencedImageKeys();
    if (deps.objects && !options.dryRun) {
      summary.imagesDeleted = await collectOrphans(
        deps.objects,
        store,
        referenced,
        deps.orphanGraceMs,
        now(),
        logger,
      );
    }
  } catch (error) {
    summary.errors.push(`이미지 정리: ${errorMessage(error)}`);
  }
  if (referenced) {
    await store
      .saveState('_image_cache', {
        lastRunAt: startedAt,
        lastResult: serializeCache(images.cache, referenced),
        lastError: null,
      })
      .catch((error) => summary.errors.push(`이미지 캐시 저장: ${errorMessage(error)}`));
  }

  // 4. 바뀐 게 있으면(또는 지난번 호출이 실패했으면) 빌드를 부른다.
  const pendingDispatch = isPending(
    (await store.getState('_dispatch').catch(() => undefined))?.lastResult,
  );
  if (deps.dispatch && !options.dryRun && (summary.changed > 0 || pendingDispatch)) {
    try {
      await deps.dispatch({
        changed: summary.changed,
        retried: pendingDispatch && summary.changed === 0,
      });
      summary.dispatched = true;
      await store.saveState('_dispatch', {
        lastRunAt: now(),
        lastResult: { pending: false },
        lastError: null,
      });
    } catch (error) {
      const message = errorMessage(error);
      summary.errors.push(message);
      await store
        .saveState('_dispatch', {
          lastRunAt: now(),
          lastResult: { pending: true },
          lastError: message,
        })
        .catch(() => {});
    }
  }

  summary.durationMs = now().getTime() - startedAt.getTime();
  return summary;
}

function isPending(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && (value as { pending?: unknown }).pending === true
  );
}

async function syncDatabase(
  name: DatabaseName,
  source: NotionSource,
  options: CliOptions,
  deps: SyncDeps,
  images: ImagePipeline,
  now: () => Date,
): Promise<RunResult> {
  const { logger, store, notion } = deps;
  const started = now();
  const result = emptyResult();

  const previous = await store.getState(name);
  const since =
    options.full || !previous?.lastSyncedAt
      ? undefined
      : new Date(previous.lastSyncedAt.getTime() - INCREMENTAL_OVERLAP_MS);
  // 커서는 조회를 시작한 시각. 조회 도중 수정된 페이지는 다음 실행에서 다시 잡힌다.
  const queryStartedAt = now();

  const [pages, existing] = await Promise.all([
    notion.queryPages(source.dataSourceId, since),
    store.getExisting(name),
  ]);
  logger.info(
    `${name}: ${since ? `${since.toISOString()} 이후 수정` : '전체'} ${pages.length}건 조회`,
  );

  const work = new PQueue({ concurrency: PAGE_CONCURRENCY });
  for (const page of pages) {
    void work.add(async () => {
      const row = existing.get(page.id);
      if (
        !options.full &&
        row &&
        row.notionLastEditedAt.getTime() === new Date(page.last_edited_time).getTime()
      ) {
        result.unchanged++;
        return;
      }
      try {
        const uploaded = await syncPage(name, page, row, deps, images, now());
        if (uploaded) result.imagesUploaded++;
        if (row) result.updated++;
        else result.created++;
      } catch (error) {
        result.failed++;
        const message = `${name} ${pageLabel(page)}: ${errorMessage(error)}`;
        result.errors.push(message);
        logger.error(message);
      }
    });
  }
  await work.onIdle();

  // 삭제 감지: 지금 Notion에 살아 있는 페이지 목록과 DB를 비교한다(휴지통·보관 페이지는 목록에 없다).
  const liveIds = await notion.listPageIds(source.dataSourceId, titlePropertyId(source.schema));
  const toDelete = [...existing.keys()].filter((id) => !liveIds.has(id));
  if (toDelete.length > 0 && liveIds.size === 0 && !options.full) {
    // 권한이 빠지거나 잘못된 DB를 가리켜 빈 목록이 오면 전부 지워 버릴 수 있다. 정말 비운 거라면 --full로 실행.
    result.errors.push(
      `${name}: Notion 목록이 비어 있어 ${toDelete.length}건 삭제를 건너뜀(의도한 거라면 --full)`,
    );
  } else if (toDelete.length > 0) {
    await store.deleteByNotionIds(name, toDelete);
    result.deleted = toDelete.length;
  }

  result.durationMs = now().getTime() - started.getTime();
  const failed = result.failed > 0;
  await store.saveState(name, {
    // 실패한 페이지가 있으면 커서를 옮기지 않는다. 다음 실행에서 그 페이지를 다시 읽는다.
    ...(failed ? {} : { lastSyncedAt: queryStartedAt }),
    lastRunAt: started,
    lastResult: {
      created: result.created,
      updated: result.updated,
      unchanged: result.unchanged,
      deleted: result.deleted,
      failed: result.failed,
      imagesUploaded: result.imagesUploaded,
      durationMs: result.durationMs,
      full: options.full,
    },
    lastError: result.errors.length > 0 ? result.errors.join('\n').slice(0, 4000) : null,
  });

  logger.info(`${name}: 완료`, {
    created: result.created,
    updated: result.updated,
    unchanged: result.unchanged,
    deleted: result.deleted,
    failed: result.failed,
    imagesUploaded: result.imagesUploaded,
    durationMs: result.durationMs,
  });
  return result;
}

/** 페이지 하나를 반영한다. 새로 올린 이미지가 있으면 true. */
async function syncPage(
  name: DatabaseName,
  page: PageObjectResponse,
  row: ExistingRow | undefined,
  deps: SyncDeps,
  images: ImagePipeline,
  syncedAt: Date,
): Promise<boolean> {
  const mapped = mapPage(name, page);
  let image: ProcessedImage | null = null;
  let uploaded = false;
  if (hasImages(name) && mapped.image) {
    try {
      const outcome = await images.process(name, mapped.image);
      image = outcome.image;
      uploaded = outcome.uploaded;
    } catch (error) {
      throw new Error(`이미지 처리 실패: ${errorMessage(error)}`, { cause: error });
    }
  }
  if (row && image && row.imageKey !== image.imageKey) {
    deps.logger.info(`${name} ${page.id}: 사진 바뀜 ${row.imageKey ?? '없음'} → ${image.imageKey}`);
  }
  await deps.store.upsert(mapped, image, syncedAt);
  return uploaded;
}

/**
 * DB 어디에서도 쓰지 않는 R2 이미지를 지운다.
 * 바로 지우면 아직 배포 중인 옛 사이트의 사진이 깨지니, 처음 발견한 뒤 유예 시간이 지나야 지운다.
 */
async function collectOrphans(
  objects: ObjectStore,
  store: ContentStore,
  referenced: ReadonlySet<string>,
  graceMs: number,
  now: Date,
  logger: Logger,
): Promise<number> {
  const previous = (await store.getState('_r2_orphans'))?.lastResult;
  const firstSeen = new Map<string, string>(
    previous && typeof previous === 'object'
      ? Object.entries(previous as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        )
      : [],
  );

  const orphanKeys = new Map<string, string[]>();
  for (const prefix of DATABASES_WITH_IMAGES) {
    for (const key of await objects.listKeys(`${prefix}/`)) {
      const imageKey = key.replace(/-\d+\.webp$/, '');
      if (referenced.has(imageKey)) continue;
      const list = orphanKeys.get(imageKey) ?? [];
      list.push(key);
      orphanKeys.set(imageKey, list);
    }
  }

  const nextSeen: Record<string, string> = {};
  const expired: string[] = [];
  for (const [imageKey, keys] of orphanKeys) {
    const seen = firstSeen.get(imageKey) ?? now.toISOString();
    if (now.getTime() - Date.parse(seen) >= graceMs) expired.push(...keys);
    else nextSeen[imageKey] = seen;
  }

  if (expired.length > 0) {
    await objects.deleteKeys(expired);
    logger.info(`R2: 쓰이지 않는 이미지 파일 ${expired.length}개 삭제`);
  }
  await store.saveState('_r2_orphans', { lastRunAt: now, lastResult: nextSeen, lastError: null });
  return expired.length;
}
