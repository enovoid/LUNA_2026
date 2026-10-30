// 서버 안에서 도는 작업: Notion 동기화, Notion 내보내기(zip) 가져오기, 사이트 빌드.
// 모두 자식 프로세스로 실행하고 한 번에 하나씩만 돌린다.
// - 동기화: packages/sync를 그대로 실행한다. 바뀐 게 있으면 SYNC_NOTIFY_FILE을 남기고, 그러면 이어서 사이트를 다시 만든다.
// - 빌드: Astro가 DB를 읽어 새 폴더에 사이트를 만든다. 성공하면 그 폴더로 바꾸고, 실패하면 이전 사이트를 그대로 둔다.
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Site } from './site.js';

export type JobKind = 'sync' | 'import' | 'build';

export interface JobRun {
  kind: JobKind;
  /** 누가·왜 시작했는지(관리자 이름, "15분 자동 실행" 등) */
  reason: string;
  full?: boolean;
  startedAt: Date;
  finishedAt?: Date;
  ok?: boolean;
  /** 실패했을 때 보여 줄 마지막 출력 몇 줄 */
  output?: string;
}

export interface JobsStatus {
  running: JobRun | undefined;
  queued: JobKind[];
  /** 최근 것부터 */
  recent: JobRun[];
  /** 마지막 빌드가 실패해 다음 자동 실행 때 다시 만든다. */
  buildPending: boolean;
}

export interface Jobs {
  sync(options: { full: boolean; reason: string; trigger: 'admin' | 'cron' }): void;
  build(reason: string): void;
  /** 올린 Notion 내보내기 zip을 DB에 넣는다. 끝나면 파일을 지우고 사이트를 다시 만든다. */
  importZip(file: string, reason: string): void;
  status(): JobsStatus;
  /** 다음 작업이 없고 지금 도는 작업도 끝날 때까지 기다린다(테스트용). */
  idle(): Promise<void>;
  stop(): void;
}

export interface RunResult {
  code: number;
  output: string;
}

export type Runner = (
  args: string[],
  env: Record<string, string | undefined>,
  signal: AbortSignal,
) => Promise<RunResult>;

export interface JobsOptions {
  site: Site;
  /** 빌드한 사이트 폴더를 둘 곳 */
  workDir: string;
  /** 동기화·빌드에 넘길 환경 변수 */
  env: Record<string, string | undefined>;
  run: Runner;
  log?: (message: string) => void;
  now?: () => Date;
}

const HISTORY = 12;
const KIND_LOG: Record<JobKind, string> = { sync: '동기화', import: '가져오기', build: '빌드' };
const OUTPUT_LINES = 30;

export function createJobs(options: JobsOptions): Jobs {
  const { site, workDir, env, run } = options;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => {});
  const recent: JobRun[] = [];
  let pendingSync: { full: boolean; reason: string; trigger: string } | undefined;
  let pendingBuild: string | undefined;
  const pendingImports: { file: string; reason: string }[] = [];
  let running: JobRun | undefined;
  let buildPending = false;
  let worker: Promise<void> | undefined;
  let counter = 0;
  const abort = new AbortController();

  const kick = () => {
    worker ??= loop().finally(() => {
      worker = undefined;
    });
  };

  async function loop() {
    while (!abort.signal.aborted) {
      // 동기화를 먼저: 끝나면 바뀐 내용까지 한 번에 빌드한다.
      if (pendingSync) {
        const job = pendingSync;
        pendingSync = undefined;
        await runSync(job);
      } else if (pendingImports.length > 0) {
        const job = pendingImports.shift();
        if (job) await runImport(job);
      } else if (pendingBuild !== undefined) {
        const reason = pendingBuild;
        pendingBuild = undefined;
        await runBuild(reason);
      } else {
        return;
      }
    }
  }

  async function track(job: JobRun, work: () => Promise<boolean>) {
    running = job;
    log(`${KIND_LOG[job.kind]} 시작: ${job.reason}`);
    try {
      job.ok = await work();
    } catch (error) {
      job.ok = false;
      job.output = error instanceof Error ? error.message : String(error);
    }
    job.finishedAt = now();
    running = undefined;
    recent.unshift(job);
    recent.length = Math.min(recent.length, HISTORY);
    log(`${KIND_LOG[job.kind]} ${job.ok ? '성공' : '실패'}: ${job.reason}`);
  }

  async function runSync(input: { full: boolean; reason: string; trigger: string }) {
    const job: JobRun = { kind: 'sync', reason: input.reason, full: input.full, startedAt: now() };
    await track(job, async () => {
      await mkdir(workDir, { recursive: true });
      const notifyFile = join(workDir, `sync-${process.pid}-${++counter}.json`);
      await rm(notifyFile, { force: true });
      const result = await run(
        ['--filter', '@luna/sync', 'start', ...(input.full ? ['--full'] : [])],
        { ...env, SYNC_TRIGGER: input.trigger, SYNC_NOTIFY_FILE: notifyFile },
        abort.signal,
      );
      const changed = await readFile(notifyFile, 'utf8').then(
        () => true,
        () => false,
      );
      await rm(notifyFile, { force: true });
      // 0: 성공, 1: 일부 실패(나머지는 반영됨), 2: 시작하지 못함
      if (changed || buildPending) queueBuild('Notion 변경 반영');
      if (result.code !== 0) job.output = tail(result.output);
      return result.code === 0;
    });
  }

  async function runImport(input: { file: string; reason: string }) {
    const job: JobRun = { kind: 'import', reason: input.reason, startedAt: now() };
    await track(job, async () => {
      try {
        const result = await run(
          ['--filter', '@luna/sync', 'import:start', input.file],
          { ...env },
          abort.signal,
        );
        // 0: 성공, 1: 일부 실패(나머지는 반영됨), 2: 시작하지 못함
        if (result.code === 0 || result.code === 1) queueBuild('Notion 내보내기 반영');
        job.output = tail(result.output);
        return result.code === 0;
      } finally {
        await rm(input.file, { force: true });
      }
    });
  }

  async function runBuild(reason: string) {
    const job: JobRun = { kind: 'build', reason, startedAt: now() };
    await track(job, async () => {
      const outDir = join(workDir, `site-${Date.now()}-${++counter}`);
      await mkdir(workDir, { recursive: true });
      const result = await run(
        ['--filter', '@luna/web', 'build'],
        { ...env, LUNA_OUT_DIR: outDir, LUNA_DATA_SOURCE: env.LUNA_DATA_SOURCE || 'db' },
        abort.signal,
      );
      if (result.code !== 0) {
        await rm(outDir, { recursive: true, force: true });
        buildPending = true;
        job.output = tail(result.output);
        return false;
      }
      const previous = await site.use(outDir);
      buildPending = false;
      if (previous) await rm(previous, { recursive: true, force: true });
      return true;
    });
  }

  function queueBuild(reason: string) {
    // 이미 대기 중인 빌드가 있으면 하나로 합친다.
    pendingBuild = pendingBuild === undefined ? reason : pendingBuild;
  }

  return {
    sync({ full, reason, trigger }) {
      pendingSync = {
        full: full || (pendingSync?.full ?? false),
        reason: pendingSync?.reason ?? reason,
        trigger: pendingSync?.trigger ?? trigger,
      };
      kick();
    },
    build(reason) {
      queueBuild(reason);
      kick();
    },
    importZip(file, reason) {
      pendingImports.push({ file, reason });
      kick();
    },
    status() {
      const queued: JobKind[] = [];
      if (pendingSync) queued.push('sync');
      for (const _ of pendingImports) queued.push('import');
      if (pendingBuild !== undefined) queued.push('build');
      return { running, queued, recent: [...recent], buildPending };
    },
    async idle() {
      while (worker) await worker;
    },
    stop() {
      abort.abort();
    },
  };
}

function tail(output: string): string {
  return output.trimEnd().split('\n').slice(-OUTPUT_LINES).join('\n');
}

/** pnpm을 자식 프로세스로 실행한다. 출력은 서버 로그(Railway)에도 그대로 흘려보낸다. */
export function pnpmRunner(cwd: string): Runner {
  return (args, env, signal) =>
    new Promise((resolve) => {
      const child = spawn('pnpm', args, { cwd, env, signal, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      const collect = (chunk: Buffer, stream: NodeJS.WriteStream) => {
        stream.write(chunk);
        output += chunk.toString();
        // 실패했을 때 마지막 줄만 보여 주므로 앞부분은 버린다.
        if (output.length > 200_000) output = output.slice(-100_000);
      };
      child.stdout.on('data', (chunk: Buffer) => collect(chunk, process.stdout));
      child.stderr.on('data', (chunk: Buffer) => collect(chunk, process.stderr));
      child.on('error', (error) => resolve({ code: -1, output: `${output}\n${error.message}` }));
      child.on('close', (code) => resolve({ code: code ?? -1, output }));
    });
}
