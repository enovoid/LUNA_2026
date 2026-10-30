import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cwd = fileURLToPath(new URL('..', import.meta.url));

// Vitest는 모듈을 변환해서 실행하므로, 실제 Node ESM에서만 드러나는 import 문제(CommonJS 패키지 등)를 여기서 잡는다.
function cli(args: string[], env: Record<string, string> = {}) {
  return spawnSync('pnpm', ['exec', 'tsx', 'src/index.ts', ...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
  });
}

describe('CLI', () => {
  it('환경 변수가 없으면 빠진 이름을 알려 주고 종료 코드 2', () => {
    const result = cli(['--dry-run']);
    expect(result.stderr).toContain('환경 변수가 비어 있습니다: NOTION_TOKEN');
    expect(result.status).toBe(2);
  });

  it('모르는 옵션은 거부한다', () => {
    const result = cli(['--fulll']);
    expect(result.stderr).toContain('알 수 없는 옵션: --fulll');
    expect(result.status).toBe(2);
  });
});
