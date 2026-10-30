import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AppDeps, handle } from '../src/app.js';
import { createAuth, SESSION_COOKIE } from '../src/auth.js';
import type { Jobs } from '../src/jobs.js';
import type { Site } from '../src/site.js';
import type { AdminStore, StoredSettings } from '../src/store.js';

const ORIGIN = 'https://admin.example';
const PASSWORD = 'correct horse battery';

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
    saveSetting: vi.fn(async (key, value, editor) => {
      (saved as Record<string, unknown>)[key] = { value, updatedAt: new Date(), updatedBy: editor };
    }),
    generations: vi.fn(async () => [6, 7, 8]),
  };
  const jobs: Jobs = {
    sync: vi.fn(),
    build: vi.fn(),
    status: vi.fn(() => ({ running: undefined, queued: [], recent: [], buildPending: false })),
    idle: async () => {},
    stop: () => {},
  };
  const site: Site = {
    ready: vi.fn(() => true),
    use: vi.fn(async () => undefined),
    serve: vi.fn(async () => new Response('site')),
  };
  const deps: AppDeps = {
    auth: createAuth(PASSWORD),
    store: () => store,
    site,
    jobs,
    now: () => new Date('2026-10-30T10:10:00Z'),
    ...overrides,
  };
  return { deps, store, jobs, site };
}

/** 테스트마다 로그인해 받은 세션 쿠키. */
let session = '';

const get = (path: string, cookie: string | null = session) =>
  new Request(`${ORIGIN}${path}`, { headers: cookie ? { cookie } : {} });
const post = (
  path: string,
  body: Record<string, string>,
  origin: string | null = ORIGIN,
  cookie: string | null = session,
) => {
  const headers: Record<string, string> = {};
  if (origin) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers,
    body: new URLSearchParams(body),
  });
};

async function loginAs(deps: AppDeps, name = '김운영') {
  const response = await handle(
    post('/admin/login', { name, password: PASSWORD }, ORIGIN, null),
    deps,
  );
  const cookie = response.headers.get('set-cookie') ?? '';
  return cookie.split(';')[0] ?? '';
}

describe('로그인', () => {
  it('로그인하지 않으면 화면은 로그인으로 보내고, 쓰기는 403', async () => {
    const { deps, store, jobs } = setup();
    const page = await handle(get('/admin/', null), deps);
    expect(page.status).toBe(303);
    expect(page.headers.get('location')).toBe('/admin/login');
    const write = await handle(post('/admin/sync', {}, ORIGIN, null), deps);
    expect(write.status).toBe(403);
    expect(store.syncStates).not.toHaveBeenCalled();
    expect(jobs.sync).not.toHaveBeenCalled();
  });

  it('비밀번호가 맞으면 세션 쿠키를 주고 관리자 화면으로 보낸다', async () => {
    const { deps } = setup();
    const response = await handle(
      post('/admin/login', { name: ' 김운영 ', password: PASSWORD }, ORIGIN, null),
      deps,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin/');
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    const body = await (await handle(get('/admin/', cookie.split(';')[0] ?? ''), deps)).text();
    expect(body).toContain('김운영');
  });

  it('비밀번호가 틀리면 401, 다섯 번 틀리면 맞는 비밀번호도 잠시 막는다', async () => {
    const { deps } = setup();
    for (let i = 0; i < 5; i++) {
      const wrong = await handle(
        post('/admin/login', { name: 'x', password: 'wrong' }, ORIGIN, null),
        deps,
        '1.2.3.4',
      );
      expect(wrong.status).toBe(401);
    }
    const blocked = await handle(
      post('/admin/login', { name: 'x', password: PASSWORD }, ORIGIN, null),
      deps,
      '1.2.3.4',
    );
    expect(await blocked.text()).toContain('10분 뒤');
    // 다른 주소는 막히지 않는다.
    const other = await handle(
      post('/admin/login', { name: 'x', password: PASSWORD }, ORIGIN, null),
      deps,
      '5.6.7.8',
    );
    expect(other.status).toBe(303);
  });

  it('이름이 비면 로그인하지 않는다', async () => {
    const { deps } = setup();
    const response = await handle(
      post('/admin/login', { name: '  ', password: PASSWORD }, ORIGIN, null),
      deps,
    );
    expect(response.status).toBe(401);
  });

  it('비밀번호 설정이 짧거나 없으면 아무도 못 들어온다', async () => {
    for (const password of [undefined, 'short']) {
      const { deps } = setup({ auth: createAuth(password) });
      const response = await handle(
        post('/admin/login', { name: 'x', password: password ?? '' }, ORIGIN, null),
        deps,
      );
      expect(response.status).toBe(401);
      expect(await response.text()).toContain('ADMIN_PASSWORD');
    }
  });

  it('위조하거나 비밀번호가 바뀐 세션은 받지 않는다', async () => {
    const { deps } = setup();
    const cookie = await loginAs(deps);
    const changed = setup({ auth: createAuth('another long password') }).deps;
    expect((await handle(get('/admin/', cookie), changed)).status).toBe(303);
    expect(
      (await handle(get('/admin/', `${SESSION_COOKIE}=forged.token.value`), deps)).status,
    ).toBe(303);
  });

  it('세션은 12시간 뒤 끝난다', async () => {
    let now = Date.parse('2026-10-30T10:00:00Z');
    const auth = createAuth(PASSWORD, { now: () => now });
    const { deps } = setup({ auth });
    const cookie = await loginAs(deps);
    expect((await handle(get('/admin/', cookie), deps)).status).toBe(200);
    now += 12 * 3600_000 + 1000;
    expect((await handle(get('/admin/', cookie), deps)).status).toBe(303);
  });

  it('로그아웃하면 쿠키를 지운다', async () => {
    const { deps } = setup();
    const cookie = await loginAs(deps);
    const response = await handle(post('/admin/logout', {}, ORIGIN, cookie), deps);
    expect(response.headers.get('location')).toBe('/admin/login');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('다른 사이트에서 보낸 로그인 폼은 막는다', async () => {
    const { deps } = setup();
    const response = await handle(
      post('/admin/login', { name: 'x', password: PASSWORD }, 'https://evil.example', null),
      deps,
    );
    expect(response.status).toBe(403);
  });
});

describe('handle', () => {
  beforeEach(async () => {
    session = await loginAs(setup().deps);
  });

  it('/admin 은 /admin/ 으로, 나머지 주소는 공개 사이트 파일로 보낸다', async () => {
    const { deps, site } = setup();
    const response = await handle(get('/admin'), deps);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin/');
    for (const path of ['/', '/members', '/administrator']) {
      expect(await (await handle(get(path, null), deps)).text()).toBe('site');
    }
    expect(site.serve).toHaveBeenCalledTimes(3);
  });

  it('/health 는 사이트를 처음 만들기 전까지 503', async () => {
    const { deps, site } = setup();
    vi.mocked(site.ready).mockReturnValueOnce(false);
    expect((await handle(get('/health', null), deps)).status).toBe(503);
    expect((await handle(get('/health', null), deps)).status).toBe(200);
  });

  it('화면에 운영진 이메일과 동기화 결과를 그리고, 캐시·색인을 막는다', async () => {
    const { deps } = setup();
    const response = await handle(get('/admin/'), deps);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('김운영');
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
    const { deps, jobs } = setup();
    const evil = await handle(post('/admin/sync', {}, 'https://evil.example'), deps);
    expect(evil.status).toBe(403);
    const none = await handle(post('/admin/sync', {}, null), deps);
    expect(none.status).toBe(403);
    expect(jobs.sync).not.toHaveBeenCalled();
  });

  it('동기화 버튼은 서버의 동기화를 시작한다(--full 체크 반영)', async () => {
    const { deps, jobs } = setup();
    const response = await handle(post('/admin/sync', { full: '1' }), deps);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin/?notice=sync-started');
    expect(jobs.sync).toHaveBeenCalledWith({ full: true, reason: '김운영', trigger: 'admin' });
  });

  it('사이트 다시 만들기 버튼', async () => {
    const { deps, jobs } = setup();
    const response = await handle(post('/admin/build', {}), deps);
    expect(response.headers.get('location')).toBe('/admin/?notice=build-started');
    expect(jobs.build).toHaveBeenCalledWith('김운영');
  });

  it('작업 기록과 실패 출력을 보여 준다', async () => {
    const { deps, jobs } = setup();
    vi.mocked(jobs.status).mockReturnValueOnce({
      running: { kind: 'sync', reason: '15분 자동 실행', startedAt: new Date() },
      queued: ['build'],
      recent: [
        {
          kind: 'build',
          reason: '김운영',
          startedAt: new Date('2026-10-30T10:00:00Z'),
          finishedAt: new Date('2026-10-30T10:01:30Z'),
          ok: false,
          output: 'Error: <connect ECONNREFUSED>',
        },
      ],
      buildPending: true,
    });
    const body = await (await handle(get('/admin/'), deps)).text();
    expect(body).toContain('지금 Notion 동기화 중이에요');
    expect(body).toContain('다음 차례: 사이트 만들기');
    expect(body).toContain('90초');
    expect(body).toContain('Error: &lt;connect ECONNREFUSED&gt;');
    expect(body).toContain('이전 사이트가 보여요');
  });

  it('모집 정보를 저장하고 사이트를 다시 만든다', async () => {
    const { deps, store, jobs } = setup();
    const response = await handle(
      post('/admin/settings/recruit', {
        generation: ' 9기 ',
        status: 'open',
        startDate: '2027-03-02',
        endDate: '2027-03-15',
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
        status: 'open',
        startDate: '2027-03-02',
        endDate: '2027-03-15',
        target: '',
        applyUrl: 'https://forms.gle/abc',
      },
      '김운영',
    );
    expect(jobs.build).toHaveBeenCalledWith('김운영 · 모집 정보 저장');
  });

  it('모집 폼: 기수·상태는 목록, 날짜는 달력 입력', async () => {
    const { deps } = setup();
    const body = await (await handle(get('/admin/'), deps)).text();
    expect(body).toContain('<select name="generation">');
    expect(body).toContain('<option value="9기" >9기 (다음 기수)</option>');
    expect(body).toContain('<option value="closed" >마감</option>');
    expect(body).toContain('<input type="date" name="endDate" value="">');
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
