import { resolve } from 'node:path';
import { DATABASE_NAMES } from './config.js';
import { PostgresStore } from './db-store.js';
import { ImagePipeline } from './image-pipeline.js';
import { download, type ProcessedImage } from './images.js';
import { createConsoleLogger, errorMessage } from './logger.js';
import { hasImages } from './mappers.js';
import {
  assignNotionIds,
  type ExportTable,
  findTables,
  loadExport,
  resolveImage,
  rowFields,
  titleOf,
} from './notion-export.js';

/**
 * Notion "Markdown & CSV" 내보내기를 Postgres에 한 번 옮겨 담는다(사용법은 README "내보내기로 가져오기").
 *
 * 동기화와 겹치지 않게:
 * - 가져온 행의 notion_last_edited_at은 1970-01-01. 어떤 실제 페이지보다 오래돼 동기화가 언제나 덮어쓴다.
 * - 동기화가 이미 쓴 행(수정 시각이 1970이 아닌 행)은 건드리지 않는다.
 * - notion_id는 하위 페이지의 진짜 ID(못 찾으면 `notion-export:` 임시 ID, 동기화가 지우고 새로 만든다).
 * - sync_state는 건드리지 않는다. 연결 뒤 첫 동기화는 전체 조회가 된다.
 *
 * 종료 코드: 0 성공, 1 일부 행 실패, 2 시작하지 못함.
 */
const IMPORTED_AT = new Date(0);

const USAGE = '사용법: pnpm import:notion [--dry-run] <내보내기.zip 또는 폴더> [...]';

async function main(): Promise<number> {
  const logger = createConsoleLogger();
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const dryRun = args.includes('--dry-run');
  const unknown = args.filter((arg) => arg.startsWith('--') && arg !== '--dry-run');
  // pnpm --filter는 패키지 폴더에서 실행하므로 상대 경로는 명령을 친 폴더(INIT_CWD) 기준으로 푼다.
  const base = process.env.INIT_CWD ?? process.cwd();
  const inputs = args.filter((arg) => !arg.startsWith('--')).map((arg) => resolve(base, arg));
  if (unknown.length > 0 || inputs.length === 0) {
    logger.error(unknown.length > 0 ? `알 수 없는 옵션: ${unknown.join(', ')}\n${USAGE}` : USAGE);
    return 2;
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl && !dryRun) {
    logger.error('DATABASE_URL이 비어 있습니다. 확인만 하려면 --dry-run');
    return 2;
  }

  let files: Awaited<ReturnType<typeof loadExport>>;
  try {
    files = await loadExport(inputs);
  } catch (error) {
    logger.error(`내보내기를 읽지 못했습니다: ${errorMessage(error)}`);
    return 2;
  }
  const { tables, skipped } = findTables(files);
  for (const path of skipped) logger.warn(`어느 DB인지 모르는 CSV라 건너뜀: ${path}`);
  const found = new Set(tables.map((table) => table.database));
  const duplicated = DATABASE_NAMES.filter(
    (name) => tables.filter((table) => table.database === name).length > 1,
  );
  if (duplicated.length > 0) {
    logger.error(`같은 DB의 CSV가 여러 개입니다: ${duplicated.join(', ')}. 하나씩 나눠 실행하세요`);
    return 2;
  }
  if (tables.length === 0) {
    logger.error('members·awards·projects·faqs 중 어느 CSV도 찾지 못했습니다');
    return 2;
  }
  logger.info(
    `찾은 DB: ${tables.map((t) => `${t.database}(${t.rows.length}행, ${t.csvPath})`).join(', ')}`,
  );
  const missing = DATABASE_NAMES.filter((name) => !found.has(name));
  if (missing.length > 0) logger.info(`이번에 없는 DB(그대로 둠): ${missing.join(', ')}`);

  const db = databaseUrl ? new PostgresStore(databaseUrl) : undefined;
  const images = new ImagePipeline(dryRun ? undefined : db?.images, new Map());
  let failed = 0;
  try {
    for (const table of tables) {
      failed += await importTable(table, files, db, images, dryRun, logger);
    }
  } finally {
    await db?.close().catch(() => {});
  }

  if (failed > 0) {
    logger.error(`가져오기 끝(실패 ${failed}행). 고친 뒤 다시 실행하면 같은 행을 덮어씁니다`);
    return 1;
  }
  logger.info(
    dryRun
      ? '확인 끝(--dry-run: 쓰기 없음)'
      : '가져오기 끝. 관리자 페이지에서 "사이트 만들기"를 누르면 사이트에 반영됩니다',
  );
  return 0;
}

async function importTable(
  table: ExportTable,
  files: Awaited<ReturnType<typeof loadExport>>,
  db: PostgresStore | undefined,
  images: ImagePipeline,
  dryRun: boolean,
  logger: ReturnType<typeof createConsoleLogger>,
): Promise<number> {
  const { database } = table;
  const ids = assignNotionIds(table);
  const existing = db ? await db.getExisting(database) : new Map();
  const counts = { created: 0, updated: 0, keptSynced: 0, tempIds: 0, noImage: 0, failed: 0 };
  const syncedAt = new Date();

  for (const [i, row] of table.rows.entries()) {
    const notionId = ids[i]!;
    const label = `${database} "${titleOf(database, row)}"`;
    if (notionId.startsWith('notion-export:')) counts.tempIds++;
    const current = existing.get(notionId);
    if (current && current.notionLastEditedAt.getTime() !== IMPORTED_AT.getTime()) {
      counts.keptSynced++;
      continue;
    }
    try {
      let image: ProcessedImage | null = null;
      if (hasImages(database)) {
        const source = resolveImage(files, table.baseDir, row.image);
        if (source) {
          const bytes =
            source.kind === 'file' ? source.body : await download(source.url, { maxAttempts: 2 });
          const name = source.kind === 'file' ? source.path : source.url;
          image = (await images.processBytes(database, bytes, name)).image;
        } else {
          counts.noImage++;
          if (row.image?.trim())
            logger.warn(`${label}: 사진 파일을 내보내기에서 못 찾음 (${row.image})`);
        }
      }
      if (!dryRun && db) {
        await db.upsert(
          {
            database,
            notionId,
            notionLastEditedAt: IMPORTED_AT,
            fields: rowFields(database, row),
            image: undefined,
          },
          image,
          syncedAt,
        );
      }
      if (current) counts.updated++;
      else counts.created++;
    } catch (error) {
      counts.failed++;
      logger.error(`${label}: ${errorMessage(error)}`);
    }
  }

  // 지난 가져오기에만 있던 행(이번 내보내기에서 빠짐)을 지운다. 동기화가 쓴 행은 그대로.
  const keep = new Set(ids);
  const stale = [...existing]
    .filter(
      ([id, row]) => !keep.has(id) && row.notionLastEditedAt.getTime() === IMPORTED_AT.getTime(),
    )
    .map(([id]) => id);
  if (stale.length > 0 && !dryRun && db && counts.failed === 0) {
    await db.deleteByNotionIds(database, stale);
  }

  logger.info(`${database}: ${dryRun ? '확인' : '완료'}`, {
    rows: table.rows.length,
    created: counts.created,
    updated: counts.updated,
    deleted: counts.failed === 0 ? stale.length : 0,
    keptSynced: counts.keptSynced,
    realNotionIds: table.rows.length - counts.tempIds,
    tempIds: counts.tempIds,
    noImage: counts.noImage,
    failed: counts.failed,
  });
  return counts.failed;
}

process.exitCode = await main();
