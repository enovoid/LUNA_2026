export type DatabaseName = 'members' | 'awards' | 'projects' | 'faqs';

export const DATABASE_NAMES: readonly DatabaseName[] = ['members', 'awards', 'projects', 'faqs'];

export interface CliOptions {
  /** 마지막 동기화 시각을 무시하고 모든 페이지를 다시 읽는다. */
  full: boolean;
  /** DB·R2 쓰기와 dispatch 없이 무엇이 바뀔지만 보여 준다. */
  dryRun: boolean;
  /** Notion 스키마만 확인하고 끝낸다. */
  checkSchema: boolean;
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export interface SyncConfig {
  notionToken: string;
  notionDatabaseIds: Record<DatabaseName, string>;
  databaseUrl: string | undefined;
  r2: R2Config | undefined;
  dispatch: { token: string; repository: string } | undefined;
  /** 쓰이지 않게 된 R2 이미지를 지우기 전에 기다리는 시간. 배포 중인 옛 사이트가 깨지지 않게 한다. */
  orphanGraceMs: number;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { full: false, dryRun: false, checkSchema: false };
  for (const arg of argv) {
    if (arg === '--full') options.full = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--check-schema') options.checkSchema = true;
    else if (arg === '--') continue;
    else
      throw new ConfigError(
        `알 수 없는 옵션: ${arg} (사용 가능: --full, --dry-run, --check-schema)`,
      );
  }
  return options;
}

type Env = Record<string, string | undefined>;

function read(env: Env, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

/**
 * 환경 변수를 읽는다. 실제 실행에는 전부 필요하고, --dry-run과 --check-schema는
 * Notion 값만 있으면 돌아간다(DB가 없으면 "첫 실행"처럼 전체를 새 항목으로 본다).
 */
export function loadConfig(env: Env, options: CliOptions): SyncConfig {
  const missing: string[] = [];
  const need = (key: string): string => {
    const value = read(env, key);
    if (!value) missing.push(key);
    return value ?? '';
  };

  const notionToken = need('NOTION_TOKEN');
  const notionDatabaseIds: Record<DatabaseName, string> = {
    members: need('NOTION_DB_MEMBERS'),
    awards: need('NOTION_DB_AWARDS'),
    projects: need('NOTION_DB_PROJECTS'),
    faqs: need('NOTION_DB_FAQ'),
  };

  const writes = !options.dryRun && !options.checkSchema;
  let databaseUrl = read(env, 'DATABASE_URL');
  let r2: R2Config | undefined;
  let dispatch: SyncConfig['dispatch'];

  if (writes) {
    databaseUrl = need('DATABASE_URL');
    r2 = {
      accountId: need('R2_ACCOUNT_ID'),
      accessKeyId: need('R2_ACCESS_KEY_ID'),
      secretAccessKey: need('R2_SECRET_ACCESS_KEY'),
      bucket: need('R2_BUCKET'),
    };
    dispatch = {
      token: need('GITHUB_DISPATCH_TOKEN'),
      repository: read(env, 'GITHUB_DISPATCH_REPOSITORY') ?? 'enovoid/LUNA_2026',
    };
  }

  if (missing.length > 0) {
    throw new ConfigError(`환경 변수가 비어 있습니다: ${missing.join(', ')}`);
  }

  const graceMinutes = Number(read(env, 'SYNC_ORPHAN_GRACE_MINUTES') ?? '120');
  if (!Number.isFinite(graceMinutes) || graceMinutes < 0) {
    throw new ConfigError('SYNC_ORPHAN_GRACE_MINUTES는 0 이상의 숫자여야 합니다');
  }

  return {
    notionToken,
    notionDatabaseIds,
    databaseUrl,
    r2,
    dispatch,
    orphanGraceMs: graceMinutes * 60_000,
  };
}
