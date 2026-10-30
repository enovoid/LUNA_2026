import { describe, expect, it, vi } from 'vitest';
import { type AppDeps, handle } from '../src/app.js';
import type { GitHub } from '../src/github.js';
import type { AdminStore, StoredSettings } from '../src/store.js';

const ORIGIN = 'https://admin.example';

function setup(overrides: Partial<AppDeps> = {}) {
  const saved: StoredSettings = {};
  const store: AdminStore = {
    syncStates: vi.fn(async () => [
      {
        database: 'members',
        lastSyncedAt: new Date('2026-10-30T10:00:00Z'),
        lastRunAt: new Date('2026-10-30T10:00:00Z'),
        lastResult: { created: 2, updated: 0, deleted: 0, failed: 0 },
        lastError: null,
      },
    ]),
    settings: vi.fn(async () => saved),
    saveSetting: vi.fn(async (key, value, email) => {
      (saved as Record<string, unknown>)[key] = { value, updatedAt: new Date(), updatedBy: email };
    }),
  };
  const github: GitHub = {
    runSync: vi.fn(async () => {}),
    deploySite: vi.fn(async () => {}),
    recentRuns: vi.fn(async () => []),
  };
  const deps: AppDeps = {
    authenticate: async () => ({ email: 'staff@luna.kr' }),
    store: () => store,
    github: () => github,
    now: () => new Date('2026-10-30T10:10:00Z'),
    ...overrides,
  };
  return { deps, store, github };
}

const get = (path: string) => new Request(`${ORIGIN}${path}`);
const post = (path: string, body: Record<string, string>, origin: string | null = ORIGIN) =>
  new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: origin ? { origin } : {},
    body: new URLSearchParams(body),
  });

describe('handle', () => {
  it('Access 검증에 실패하면 어떤 주소도 403', async () => {
    const { deps, store } = setup({
      authenticate: async () => {
        throw new Error('no token');
      },
    });
    for (const request of [get('/admin/'), post('/admin/sync', {})]) {
      const response = await handle(request, deps);
      expect(response.status).toBe(403);
    }
    expect(store.syncStates).not.toHaveBeenCalled();
  });

  it('/ 와 /admin 은 /admin/ 으로 보낸다', async () => {
    const { deps } = setup();
    for (const path of ['/', '/admin']) {
      const response = await handle(get(path), deps);
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/admin/');
    }
  });

  it('화면에 운영진 이메일과 동기화 결과를 그리고, 캐시·색인을 막는다', async () => {
    const { deps } = setup();
    const response = await handle(get('/admin/'), deps);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('staff@luna.kr');
    expect(body).toContain('추가 2');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('DB가 실패해도 화면은 그리고 오류를 보여 준다', async () => {
    const { deps } = setup({
      store: () => {
        throw new Error('DATABASE_URL이 설정되지 않았습니다.');
      },
    });
    const body = await (await handle(get('/admin/'), deps)).text();
    expect(body).toContain('동기화 상태를 읽지 못했어요');
    expect(body).toContain('DATABASE_URL이 설정되지 않았습니다.');
  });

  it('다른 출처에서 온 POST는 막는다(CSRF)', async () => {
    const { deps, github } = setup();
    const evil = await handle(post('/admin/sync', {}, 'https://evil.example'), deps);
    expect(evil.status).toBe(403);
    const none = await handle(post('/admin/sync', {}, null), deps);
    expect(none.status).toBe(403);
    expect(github.runSync).not.toHaveBeenCalled();
  });

  it('동기화 버튼은 sync.yml을 부른다(--full 체크 반영)', async () => {
    const { deps, github } = setup();
    const response = await handle(post('/admin/sync', { full: '1' }), deps);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin/?notice=sync-started');
    expect(github.runSync).toHaveBeenCalledWith({ full: true });
  });

  it('GitHub 호출이 실패하면 오류 안내로 보낸다', async () => {
    const { deps, github } = setup();
    vi.mocked(github.deploySite).mockRejectedValueOnce(new Error('403'));
    const response = await handle(post('/admin/deploy', {}), deps);
    expect(response.headers.get('location')).toBe('/admin/?notice=github-failed');
  });

  it('모집 정보를 저장하고 사이트 배포를 시작한다', async () => {
    const { deps, store, github } = setup();
    const response = await handle(
      post('/admin/settings/recruit', {
        generation: ' 9기 ',
        period: '3월 2일 ~ 3월 15일',
        target: '',
        applyUrl: 'https://forms.gle/abc',
        extra: 'ignored',
      }),
      deps,
    );
    expect(response.headers.get('location')).toBe('/admin/?notice=saved');
    expect(store.saveSetting).toHaveBeenCalledWith(
      'recruit',
      {
        generation: '9기',
        period: '3월 2일 ~ 3월 15일',
        target: '',
        applyUrl: 'https://forms.gle/abc',
      },
      'staff@luna.kr',
    );
    expect(github.deploySite).toHaveBeenCalledOnce();
  });

  it('잘못된 값은 저장하지 않고 입력을 유지한 채 오류를 보여 준다', async () => {
    const { deps, store } = setup();
    const response = await handle(
      post('/admin/settings/recruit', {
        generation: '<b>9기</b>',
        applyUrl: 'javascript:alert(1)',
      }),
      deps,
    );
    const body = await response.text();
    expect(response.status).toBe(422);
    expect(store.saveSetting).not.toHaveBeenCalled();
    expect(body).toContain('https://로 시작하는 주소를 넣어 주세요');
    // 입력값은 이스케이프되어 다시 보인다.
    expect(body).toContain('value="&lt;b&gt;9기&lt;/b&gt;"');
    expect(body).not.toContain('<b>9기</b>');
  });

  it('저장은 됐지만 배포 호출이 실패하면 그 사실을 알린다', async () => {
    const { deps, github } = setup();
    vi.mocked(github.deploySite).mockRejectedValueOnce(new Error('down'));
    const response = await handle(post('/admin/settings/contact', { email: 'luna@luna.kr' }), deps);
    expect(response.headers.get('location')).toBe('/admin/?notice=saved-deploy-failed');
  });

  it('알 수 없는 notice 값은 무시한다', async () => {
    const { deps } = setup();
    const body = await (await handle(get('/admin/?notice=<script>'), deps)).text();
    expect(body).not.toContain('<script>');
    expect(body).not.toContain('class="notice ok" role="status"');
  });

  it('없는 주소는 404', async () => {
    const { deps } = setup();
    expect((await handle(get('/admin/nope'), deps)).status).toBe(404);
    expect((await handle(post('/admin/settings/secret', {}), deps)).status).toBe(404);
  });
});
