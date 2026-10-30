import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJobs, type Runner } from '../src/jobs.js';
import type { Site } from '../src/site.js';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'luna-jobs-test-'));
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function setup(behaviour: { syncChanged?: boolean; syncCode?: number; buildCode?: number[] }) {
  const calls: { args: string[]; env: Record<string, string | undefined> }[] = [];
  const buildCodes = [...(behaviour.buildCode ?? [])];
  const run: Runner = vi.fn(async (args, env) => {
    calls.push({ args, env });
    if (args.includes('@luna/sync')) {
      if (behaviour.syncChanged && env.SYNC_NOTIFY_FILE) {
        await writeFile(env.SYNC_NOTIFY_FILE, '{"changed":1}');
      }
      return { code: behaviour.syncCode ?? 0, output: 'sync log' };
    }
    const code = buildCodes.shift() ?? 0;
    if (code === 0 && env.LUNA_OUT_DIR) await mkdir(env.LUNA_OUT_DIR, { recursive: true });
    return { code, output: code === 0 ? 'ok' : 'line1\nbuild failed: DB 연결 실패' };
  });
  const site: Site = {
    ready: () => true,
    use: vi.fn(async () => undefined),
    serve: async () => new Response(),
  };
  const jobs = createJobs({ site, workDir, env: { DATABASE_URL: 'postgres://x' }, run });
  return { jobs, run, site, calls };
}

describe('작업', () => {
  it('동기화에서 바뀐 게 있으면 이어서 사이트를 만든다', async () => {
    const { jobs, calls, site } = setup({ syncChanged: true });
    jobs.sync({ full: true, reason: '김운영', trigger: 'admin' });
    await jobs.idle();
    expect(calls.map((c) => c.args)).toEqual([
      ['--filter', '@luna/sync', 'start', '--full'],
      ['--filter', '@luna/web', 'build'],
    ]);
    expect(calls[0]?.env.SYNC_TRIGGER).toBe('admin');
    expect(calls[1]?.env.LUNA_DATA_SOURCE).toBe('db');
    expect(site.use).toHaveBeenCalledWith(calls[1]?.env.LUNA_OUT_DIR);
    const { recent } = jobs.status();
    expect(recent.map((r) => [r.kind, r.ok])).toEqual([
      ['build', true],
      ['sync', true],
    ]);
  });

  it('바뀐 게 없으면 빌드하지 않는다', async () => {
    const { jobs, calls } = setup({});
    jobs.sync({ full: false, reason: '15분 자동 실행', trigger: 'cron' });
    await jobs.idle();
    expect(calls).toHaveLength(1);
  });

  it('빌드가 실패하면 이전 사이트를 두고 다음 동기화 때 다시 만든다', async () => {
    const { jobs, calls, site } = setup({ buildCode: [1, 0] });
    jobs.build('서버 시작');
    await jobs.idle();
    expect(site.use).not.toHaveBeenCalled();
    const status = jobs.status();
    expect(status.buildPending).toBe(true);
    expect(status.recent[0]?.output).toContain('build failed: DB 연결 실패');

    jobs.sync({ full: false, reason: '15분 자동 실행', trigger: 'cron' });
    await jobs.idle();
    expect(calls.map((c) => c.args[1])).toEqual(['@luna/web', '@luna/sync', '@luna/web']);
    expect(jobs.status().buildPending).toBe(false);
  });

  it('도는 동안 들어온 요청은 하나로 합쳐 차례로 실행한다', async () => {
    const { jobs, calls } = setup({});
    jobs.build('서버 시작');
    jobs.build('김운영');
    jobs.build('이운영');
    jobs.sync({ full: false, reason: 'a', trigger: 'cron' });
    jobs.sync({ full: true, reason: 'b', trigger: 'admin' });
    await jobs.idle();
    expect(calls.map((c) => c.args.join(' '))).toEqual([
      '--filter @luna/web build',
      '--filter @luna/sync start --full',
      '--filter @luna/web build',
    ]);
  });

  it('동기화가 시작하지 못하면(종료 코드 2) 실패로 남긴다', async () => {
    const { jobs } = setup({ syncCode: 2 });
    jobs.sync({ full: false, reason: 'a', trigger: 'cron' });
    await jobs.idle();
    expect(jobs.status().recent[0]).toMatchObject({ kind: 'sync', ok: false, output: 'sync log' });
  });
});
