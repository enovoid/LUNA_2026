import { ConfigError, loadConfig, parseArgs } from './config.js';
import { PostgresStore } from './db-store.js';
import { createDispatcher } from './dispatch.js';
import { createConsoleLogger, errorMessage } from './logger.js';
import { NotionApi } from './notion/client.js';
import { SchemaMismatchError } from './notion/schema.js';
import { R2Store } from './r2.js';
import { type ContentStore, emptyStore, readOnly } from './store.js';
import { runSync, verifySchemas } from './sync.js';

/** 이 시간이 지난 `_running` 잠금은 죽은 실행이 남긴 것으로 보고 가져간다. */
const RUN_LOCK_TTL_MS = 30 * 60_000;

/**
 * 종료 코드
 * 0: 성공
 * 1: 일부 페이지·DB 실패(나머지는 반영됨, 다음 실행에서 다시 시도)
 * 2: 시작하지 못함(환경 변수, Notion 권한, 스키마 불일치 등) — 사람이 고쳐야 한다
 */
async function main(): Promise<number> {
  const logger = createConsoleLogger();
  let store: ContentStore | undefined;
  let lock: { db: PostgresStore; lockedAt: Date } | undefined;
  try {
    const options = parseArgs(process.argv.slice(2));
    const config = loadConfig(process.env, options);
    const notion = new NotionApi(config.notionToken, logger);

    if (options.checkSchema) {
      const { report } = await verifySchemas(notion, config.notionDatabaseIds);
      logger.info(`Notion 스키마가 요청서와 일치합니다\n${report}`);
      return 0;
    }

    if (config.databaseUrl) {
      const db = new PostgresStore(config.databaseUrl);
      store = options.dryRun ? readOnly(db) : db;
      if (!options.dryRun) {
        // SYNC_TRIGGER: 누가 시작했는지(기본 cron, 관리자 페이지의 수동 실행은 admin). 관리자 페이지에 보인다.
        const lockedAt = await db.acquireRunLock(
          process.env.SYNC_TRIGGER?.trim() || 'cron',
          RUN_LOCK_TTL_MS,
        );
        if (!lockedAt) {
          logger.warn('다른 동기화가 실행 중이라 이번 실행은 건너뜁니다');
          return 0;
        }
        lock = { db, lockedAt };
      }
    } else {
      logger.warn('DATABASE_URL이 없어 모든 페이지를 새 항목으로 보고 확인합니다(--dry-run)');
      store = emptyStore();
    }

    logger.info(
      `동기화 시작${options.full ? ' (--full)' : ''}${options.dryRun ? ' (--dry-run: 쓰기 없음)' : ''}`,
    );
    const summary = await runSync(options, {
      notion,
      store,
      objects: options.dryRun || !config.r2 ? undefined : new R2Store(config.r2),
      dispatch: options.dryRun || !config.dispatch ? undefined : createDispatcher(config.dispatch),
      logger,
      databaseIds: config.notionDatabaseIds,
      orphanGraceMs: config.orphanGraceMs,
    });

    const line = {
      changed: summary.changed,
      imagesUploaded: summary.imagesUploaded,
      imagesDeleted: summary.imagesDeleted,
      dispatched: summary.dispatched,
      durationMs: summary.durationMs,
      errors: summary.errors.length,
    };
    if (summary.errors.length > 0) {
      logger.error(`동기화 끝(오류 ${summary.errors.length}건)`, line);
      for (const error of summary.errors) logger.error(`  - ${error}`);
      return 1;
    }
    logger.info(
      summary.changed > 0
        ? `동기화 끝: ${summary.changed}건 반영${summary.dryRun ? ' 예정' : ''}`
        : '동기화 끝: 바뀐 내용 없음',
      line,
    );
    return 0;
  } catch (error) {
    if (error instanceof SchemaMismatchError || error instanceof ConfigError) {
      logger.error(error.message);
    } else {
      logger.error(`동기화를 시작하지 못했습니다: ${errorMessage(error)}`);
      if (error instanceof Error && error.stack) logger.error(error.stack);
    }
    return 2;
  } finally {
    if (lock) await lock.db.releaseRunLock(lock.lockedAt).catch(() => {});
    await store?.close().catch(() => {});
  }
}

process.exitCode = await main();
