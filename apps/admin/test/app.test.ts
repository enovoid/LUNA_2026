import { generateKeyPair, SignJWT } from 'jose';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AppDeps, handle } from '../src/app.js';
import { type AuthOptions, createAuth, LOGIN_COOKIE, SESSION_COOKIE } from '../src/auth.js';
import type { ContentTable } from '../src/content.js';
import type { Jobs } from '../src/jobs.js';
import { createRateLimiter } from '../src/rate-limit.js';
import type { Site } from '../src/site.js';
import type { AdminStore, ContentRow, StoredAdmins, StoredSettings } from '../src/store.js';

const ORIGIN = 'https://admin.example';
const CLIENT_ID = 'client-123.apps.googleusercontent.com';
const OWNER = 'owner@luna.kr';

/** 가짜 Google: id_token을 이 키로 서명하고, 앱은 공개 키로 확인한다. */
let google: Awaited<ReturnType<typeof generateKeyPair>>;
/** 다음 토큰 교환에서 Google이 돌려줄 사용자 정보 */
let googleUser: Record<string, unknown> = {};
let tokenStatus = 200;

beforeAll(async () => {
  google = await generateKeyPair('RS256');
});

const fakeFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
  const body = new URLSearchParams(String(init?.body ?? ''));
  const idToken = await new SignJWT({ ...googleUser })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer('https://accounts.google.com')
    .setAudience(CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(google.privateKey);
  if (body.get('code') !== 'good-code') return Response.json({}, { status: 400 });
  return Response.json({ id_token: idToken }, { status: tokenStatus });
});

function authFor(overrides: Partial<AuthOptions> = {}) {
  return createAuth({
    clientId: CLIENT_ID,
    clientSecret: 'secret',
    fetch: fakeFetch as typeof fetch,
    googleKeys: async () => google.publicKey,
    ...overrides,
  });
}

function setup(overrides: Partial<AppDeps> = {}) {
  const saved: StoredSettings = {};
  let admins: StoredAdmins = { emails: ['staff@gmail.com'], updatedAt: null, updatedBy: null };
  const content: Record<ContentTable, ContentRow[]> = {
    members: [],
    awards: [],
    projects: [],
    faqs: [],
  };
  const files = new Map<string, Buffer>();
  let nextId = 1;
  const store: AdminStore = {
    listContent: vi.fn(async (table: ContentTable) => content[table]),
    getContent: vi.fn(async (table: ContentTable, id: number) =>
      content[table].find((row) => row.id === id),
    ),
    saveContent: vi.fn(
      async (...[table, id, values, image]: Parameters<AdminStore['saveContent']>) => {
        const imageValues =
          image === undefined
            ? {}
            : {
                imageKey: image?.imageKey ?? null,
                imageWidth: image?.width ?? null,
                imageHeight: image?.height ?? null,
              };
        if (id === undefined) {
          const row: ContentRow = {
            id: nextId++,
            notionId: `admin:${nextId}`,
            values,
            imageKey: null,
            imageWidth: null,
            imageHeight: null,
            editedAt: new Date(),
            ...imageValues,
          };
          content[table].push(row);
          return row.id;
        }
        const row = content[table].find((r) => r.id === id);
        if (!row) return undefined;
        Object.assign(row, { values, editedAt: new Date(), ...imageValues });
        return id;
      },
    ),
    deleteContent: vi.fn(async (table: ContentTable, id: number) => {
      const before = content[table].length;
      content[table] = content[table].filter((r) => r.id !== id);
      return content[table].length < before;
    }),
    distinctValues: vi.fn(async () => ['7기', '8기']),
    putImageFile: vi.fn(async (key: string, body: Buffer) => {
      files.set(key, body);
    }),
    imageFileExists: vi.fn(async (key: string) => files.has(key)),
    imageFile: vi.fn(async (key: string) => files.get(key)),
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
    adminEmails: vi.fn(async () => admins),
    saveAdminEmails: vi.fn(async (emails, editor) => {
      admins = { emails, updatedAt: new Date(), updatedBy: editor };
    }),
  };
  const jobs: Jobs = {
    sync: vi.fn(),
    build: vi.fn(),
    importZip: vi.fn(),
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
    auth: authFor(),
    store: () => store,
    site,
    jobs,
    ownerEmails: [OWNER],
    now: () => new Date('2026-10-30T10:10:00Z'),
    ...overrides,
  };
  return { deps, store, jobs, site, content, files };
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

const cookieValue = (response: Response, name: string) =>
  response.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${name}=`))
    ?.split(';')[0];

/** Google 로그인을 처음부터 끝까지 흉내 낸다. 성공하면 세션 쿠키를, 실패하면 응답을 돌려준다. */
async function googleLogin(
  deps: AppDeps,
  user: Record<string, unknown>,
  tweak: { state?: string; code?: string; dropCookie?: boolean } = {},
) {
  const start = await handle(get('/admin/login/google', null), deps);
  const location = new URL(start.headers.get('location') ?? '');
  const loginCookie = cookieValue(start, LOGIN_COOKIE) ?? '';
  googleUser = { nonce: location.searchParams.get('nonce'), ...user };
  const params = new URLSearchParams({
    code: tweak.code ?? 'good-code',
    state: tweak.state ?? location.searchParams.get('state') ?? '',
  });
  const response = await handle(
    get(`/admin/auth/callback?${params}`, tweak.dropCookie ? null : loginCookie),
    deps,
  );
  return { start, location, response, session: cookieValue(response, SESSION_COOKIE) ?? '' };
}

const STAFF = { email: 'Staff@gmail.com', email_verified: true, name: '김운영' };

async function loginAs(deps: AppDeps) {
  return (await googleLogin(deps, STAFF)).session;
}

describe('Google 로그인', () => {
  beforeEach(() => {
    tokenStatus = 200;
  });

  it('로그인하지 않으면 화면은 로그인으로 보내고, 쓰기는 403', async () => {
    const { deps, store, jobs } = setup();
    const page = await handle(get('/admin/', null), deps);
    expect(page.status).toBe(303);
    expect(page.headers.get('location')).toBe('/admin/login');
    const write = await handle(post('/admin/sync', {}, ORIGIN, null), deps);
    expect(write.status).toBe(403);
    expect(store.syncStates).not.toHaveBeenCalled();
    expect(jobs.sync).not.toHaveBeenCalled();
    const login = await (await handle(get('/admin/login', null), deps)).text();
    expect(login).toContain('href="/admin/login/google"');
  });

  it('Google로 보낼 때 state·nonce를 붙이고 돌아올 주소를 알린다', async () => {
    const { deps } = setup();
    const { start, location } = await googleLogin(deps, STAFF);
    expect(start.status).toBe(303);
    expect(location.origin + location.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(location.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/admin/auth/callback`);
    expect(location.searchParams.get('scope')).toBe('openid email profile');
    expect(location.searchParams.get('state')).toMatch(/^[\w-]{20,}$/);
    expect(start.headers.get('set-cookie')).toContain('HttpOnly; Secure; SameSite=Lax');
  });

  it('허용 목록의 계정이면 세션 쿠키를 주고 관리자 화면으로 보낸다', async () => {
    const { deps } = setup();
    const { response, session: cookie } = await googleLogin(deps, STAFF);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin/');
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=.+`));
    expect(cookieValue(response, LOGIN_COOKIE)).toBe(`${LOGIN_COOKIE}=`);
    const body = await (await handle(get('/admin/', cookie), deps)).text();
    expect(body).toContain('김운영');
  });

  it('Railway 변수(ADMIN_EMAILS)의 운영진은 DB 없이도 들어온다', async () => {
    const { deps } = setup({
      store: () => {
        throw new Error('DATABASE_URL이 설정되지 않았습니다.');
      },
    });
    const { session: cookie } = await googleLogin(deps, { email: OWNER, email_verified: true });
    expect(cookie).not.toBe('');
  });

  it('목록에 없거나 이메일 확인이 안 된 계정은 막는다', async () => {
    const { deps } = setup();
    const stranger = await googleLogin(deps, { email: 'x@gmail.com', email_verified: true });
    expect(stranger.response.status).toBe(403);
    expect(await stranger.response.text()).toContain('운영진 목록에 없어요');
    expect(stranger.session).toBe('');
    const unverified = await googleLogin(deps, { ...STAFF, email_verified: false });
    expect(unverified.response.status).toBe(403);
  });

  it('state가 다르거나 로그인 쿠키가 없거나 nonce가 다르면 막는다', async () => {
    const { deps } = setup();
    expect((await googleLogin(deps, STAFF, { state: 'forged' })).response.status).toBe(403);
    expect((await googleLogin(deps, STAFF, { dropCookie: true })).response.status).toBe(403);
    expect((await googleLogin(deps, { ...STAFF, nonce: 'other' })).response.status).toBe(403);
    expect((await googleLogin(deps, STAFF, { code: 'bad' })).response.status).toBe(403);
  });

  it('다른 키로 서명한 id_token은 받지 않는다', async () => {
    const other = await generateKeyPair('RS256');
    const { deps } = setup({ auth: authFor({ googleKeys: async () => other.publicKey }) });
    expect((await googleLogin(deps, STAFF)).response.status).toBe(403);
  });

  it('Google 설정이 없으면 로그인 버튼 대신 안내를 보여 준다', async () => {
    const { deps } = setup({ auth: authFor({ clientSecret: undefined }) });
    const body = await (await handle(get('/admin/login', null), deps)).text();
    expect(body).toContain('GOOGLE_CLIENT_ID');
    expect((await handle(get('/admin/login/google', null), deps)).status).toBe(503);
  });

  it('위조하거나 비밀이 바뀐 세션은 받지 않는다', async () => {
    const { deps } = setup();
    const cookie = await loginAs(deps);
    const changed = setup({ auth: authFor({ clientSecret: 'rotated' }) }).deps;
    expect((await handle(get('/admin/', cookie), changed)).status).toBe(303);
    const forged = `${SESSION_COOKIE}=${cookie.split('=')[1]?.slice(0, -2)}xx`;
    expect((await handle(get('/admin/', forged), deps)).status).toBe(303);
  });

  it('세션은 12시간 뒤 끝난다', async () => {
    let clock = Date.parse('2026-10-30T00:00:00Z');
    const { deps } = setup({ auth: authFor({ now: () => clock }) });
    const cookie = await loginAs(deps);
    expect((await handle(get('/admin/', cookie), deps)).status).toBe(200);
    clock += 12 * 3600_000 + 1000;
    expect((await handle(get('/admin/', cookie), deps)).status).toBe(303);
  });

  it('로그아웃하면 쿠키를 지운다', async () => {
    const { deps } = setup();
    const cookie = await loginAs(deps);
    const response = await handle(post('/admin/logout', {}, ORIGIN, cookie), deps);
    expect(response.headers.get('location')).toBe('/admin/login');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});

describe('운영진 목록', () => {
  beforeEach(async () => {
    session = await loginAs(setup().deps);
  });

  it('추가·삭제하고, 누가 바꿨는지 이메일로 남긴다', async () => {
    const { deps, store } = setup();
    const added = await handle(post('/admin/admins/add', { email: ' New@Gmail.com ' }), deps);
    expect(added.headers.get('location')).toBe('/admin/?notice=admin-added');
    expect(store.saveAdminEmails).toHaveBeenLastCalledWith(
      ['new@gmail.com', 'staff@gmail.com'],
      'staff@gmail.com',
    );
    const { session: newcomer } = await googleLogin(deps, {
      email: 'new@gmail.com',
      email_verified: true,
    });
    expect(newcomer).not.toBe('');

    await handle(post('/admin/admins/remove', { email: 'new@gmail.com' }), deps);
    expect(store.saveAdminEmails).toHaveBeenLastCalledWith(['staff@gmail.com'], 'staff@gmail.com');
  });

  it('잘못된 이메일은 추가하지 않는다', async () => {
    const { deps, store } = setup();
    const response = await handle(post('/admin/admins/add', { email: 'nope' }), deps);
    expect(response.headers.get('location')).toBe('/admin/?notice=admin-invalid');
    expect(store.saveAdminEmails).not.toHaveBeenCalled();
  });

  it('Railway 변수의 운영진은 목록에 보이지만 빼기 버튼이 없다', async () => {
    const { deps } = setup();
    const body = await (await handle(get('/admin/'), deps)).text();
    expect(body).toContain(OWNER);
    expect(body).toContain('Railway 변수 ADMIN_EMAILS');
    expect(body).toContain('value="staff@gmail.com"');
    expect(body).not.toContain(`value="${OWNER}"`);
  });

  it('다른 사이트에서 보낸 추가 요청은 막는다', async () => {
    const { deps, store } = setup();
    const response = await handle(
      post('/admin/admins/add', { email: 'evil@x.com' }, 'https://evil.example'),
      deps,
    );
    expect(response.status).toBe(403);
    expect(store.saveAdminEmails).not.toHaveBeenCalled();
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
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-inline');
    expect(response.headers.get('strict-transport-security')).toContain('max-age=');
  });

  it('DB가 실패해도 화면은 그리고 오류를 보여 준다', async () => {
    const { deps } = setup({
      store: () => {
        throw new Error('DATABASE_URL이 설정되지 않았습니다.');
      },
    });
    // DB가 없으면 Railway 변수의 운영진만 들어올 수 있다.
    const owner = (await googleLogin(deps, { email: OWNER, email_verified: true })).session;
    const body = await (await handle(get('/admin/', owner), deps)).text();
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
      'staff@gmail.com',
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

/** 브라우저처럼 multipart 폼을 보낸다(사진 파일 포함 가능). */
const postForm = (path: string, fields: Record<string, string | Blob>, cookie = session) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, cookie },
    body: form,
  });
};

const uploadBytes = (path: string, body: Uint8Array, cookie = session) =>
  new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, cookie, 'content-type': 'image/png' },
    body,
  });

async function png(width = 40, height = 30) {
  const sharp = (await import('sharp')).default;
  return sharp({
    create: { width, height, channels: 3, background: { r: 120, g: 80, b: 200 } },
  })
    .png()
    .toBuffer();
}

describe('콘텐츠 관리', () => {
  beforeEach(async () => {
    session = await loginAs(setup().deps);
  });

  it('멤버를 추가하면 목록에 보이고 사이트를 다시 만든다', async () => {
    const { deps, store, jobs, content } = setup();
    const empty = await (await handle(get('/admin/content/members'), deps)).text();
    expect(empty).toContain('아직 멤버 항목이 없어요');

    const form = await (await handle(get('/admin/content/members/new'), deps)).text();
    expect(form).toContain('enctype="multipart/form-data"');
    expect(form).toContain('data-upload="/admin/upload/members"');
    expect(form).toContain('<option value="8기">');

    const response = await handle(
      postForm('/admin/content/members/new', {
        name: '  윤채원 ',
        lunaGeneration: '9기',
        position: '프론트엔드',
        description: '안녕하세요\r\n반가워요',
        sort: '',
        unknown: 'ignored',
      }),
      deps,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/admin/content/members?notice=content-saved');
    expect(store.saveContent).toHaveBeenCalledWith(
      'members',
      undefined,
      {
        name: '윤채원',
        lunaGeneration: '9기',
        position: '프론트엔드',
        schoolGeneration: null,
        className: null,
        description: '안녕하세요\n반가워요',
        sort: 0,
      },
      undefined,
    );
    expect(jobs.build).toHaveBeenCalledWith('김운영 · 멤버 윤채원 저장');
    expect(content.members[0]?.notionId).toMatch(/^admin:/);

    const list = await (
      await handle(get('/admin/content/members?notice=content-saved'), deps)
    ).text();
    expect(list).toContain('윤채원');
    expect(list).toContain('9기 · 프론트엔드');
    expect(list).toContain('저장했어요');
    expect(list).not.toContain('class="badge">Notion');
  });

  it('잘못된 입력은 저장하지 않고 입력을 이스케이프해 다시 보여 준다', async () => {
    const { deps, store } = setup();
    const response = await handle(
      postForm('/admin/content/awards/new', {
        name: '<script>alert(1)</script>',
        prizeMoney: '많이',
        date: '2026-02-30',
      }),
      deps,
    );
    const body = await response.text();
    expect(response.status).toBe(422);
    expect(store.saveContent).not.toHaveBeenCalled();
    expect(body).toContain('상금(원)은(는) 정수로 적어 주세요.');
    expect(body).toContain('수상일은(는) 날짜(YYYY-MM-DD)로 골라 주세요.');
    expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(body).not.toContain('<script>alert(1)</script>');

    const missing = await handle(postForm('/admin/content/faqs/new', { answer: '답' }), deps);
    expect(await missing.text()).toContain('질문을(를) 적어 주세요.');
  });

  it('고치고 지운다. Notion에서 온 항목에는 덮어쓰기 안내를 보여 준다', async () => {
    const { deps, store, jobs, content } = setup();
    content.faqs.push({
      id: 7,
      notionId: '1f2e3d4c-0000-4000-8000-000000000000',
      values: { question: '언제 모집해요?', answer: '3월', sortOrder: 1 },
      imageKey: null,
      imageWidth: null,
      imageHeight: null,
      editedAt: new Date('2026-10-01T00:00:00Z'),
    });
    const form = await (await handle(get('/admin/content/faqs/7'), deps)).text();
    expect(form).toContain('value="언제 모집해요?"');
    expect(form).toContain('Notion에서 가져온 항목이에요');
    expect(form).toContain('data-confirm=');

    await handle(
      postForm('/admin/content/faqs/7', {
        question: '언제 모집해요?',
        answer: '3월 초',
        sortOrder: '2',
      }),
      deps,
    );
    expect(store.saveContent).toHaveBeenLastCalledWith(
      'faqs',
      7,
      { question: '언제 모집해요?', answer: '3월 초', sortOrder: 2 },
      undefined,
    );

    const deleted = await handle(post('/admin/content/faqs/7/delete', {}), deps);
    expect(deleted.headers.get('location')).toBe('/admin/content/faqs?notice=content-deleted');
    expect(content.faqs).toHaveLength(0);
    expect(jobs.build).toHaveBeenLastCalledWith('김운영 · FAQ 삭제');

    const gone = await handle(get('/admin/content/faqs/7'), deps);
    expect(gone.headers.get('location')).toBe('/admin/content/faqs?notice=content-missing');
    expect((await handle(get('/admin/content/secrets'), deps)).status).toBe(404);
    expect((await handle(get('/admin/content/faqs/abc'), deps)).status).toBe(404);
  });

  it('사진을 먼저 올리면 WebP 세 장으로 저장하고, 저장할 때 그 키를 쓴다', async () => {
    const { deps, store, files } = setup();
    const response = await handle(
      uploadBytes('/admin/upload/projects', await png(2000, 1000)),
      deps,
    );
    expect(response.status).toBe(200);
    const image = (await response.json()) as { imageKey: string; width: number; height: number };
    expect(image.imageKey).toMatch(/^projects\/[0-9a-f]{64}$/);
    expect(image).toMatchObject({ width: 1600, height: 800 });
    expect([...files.keys()].sort()).toEqual([
      `${image.imageKey}-1600.webp`,
      `${image.imageKey}-480.webp`,
      `${image.imageKey}-960.webp`,
    ]);
    // 같은 사진은 다시 만들지 않는다.
    await handle(uploadBytes('/admin/upload/projects', await png(2000, 1000)), deps);
    expect(store.putImageFile).toHaveBeenCalledTimes(3);

    await handle(
      postForm('/admin/content/projects/new', { name: 'LUNA', imageKey: image.imageKey }),
      deps,
    );
    expect(vi.mocked(store.saveContent).mock.lastCall?.[3]).toEqual({
      imageKey: image.imageKey,
      width: 1600,
      height: 800,
    });

    // 관리자 화면 미리 보기
    const preview = await handle(get(`/admin/img/${image.imageKey}-480.webp`), deps);
    expect(preview.status).toBe(200);
    expect(preview.headers.get('content-type')).toBe('image/webp');
    expect((await handle(get(`/admin/img/${image.imageKey}-480.webp`, null), deps)).status).toBe(
      303,
    );
    expect((await handle(get('/admin/img/../secret'), deps)).status).toBe(404);
  });

  it('사진이 아니거나 남의 키를 넣으면 받지 않는다', async () => {
    const { deps, store } = setup();
    const fake = await handle(
      uploadBytes('/admin/upload/members', new TextEncoder().encode('<svg onload=alert(1)>')),
      deps,
    );
    expect(fake.status).toBe(422);
    expect(((await fake.json()) as { error: string }).error).toContain('사진만');
    expect(store.putImageFile).not.toHaveBeenCalled();
    expect((await handle(uploadBytes('/admin/upload/faqs', await png()), deps)).status).toBe(404);

    const forged = await handle(
      postForm('/admin/content/members/new', { name: 'A', imageKey: `awards/${'a'.repeat(64)}` }),
      deps,
    );
    expect(forged.status).toBe(422);
    expect(await forged.text()).toContain('사진 정보가 올바르지 않아요');
    const missing = await handle(
      postForm('/admin/content/members/new', { name: 'A', imageKey: `members/${'a'.repeat(64)}` }),
      deps,
    );
    expect(await missing.text()).toContain('올린 사진을 찾지 못했어요');
    expect(store.saveContent).not.toHaveBeenCalled();
  });

  it('JS 없이 폼에 사진을 같이 보내도 저장한다', async () => {
    const { deps, store } = setup();
    const file = new File([await png(300, 600)], 'me.png', { type: 'image/png' });
    const response = await handle(
      postForm('/admin/content/members/new', { name: 'B', image: file }),
      deps,
    );
    expect(response.status).toBe(303);
    expect(vi.mocked(store.saveContent).mock.lastCall?.[3]).toMatchObject({
      width: 300,
      height: 600,
    });
  });

  it('로그인하지 않으면 올리기·저장·지우기를 막는다', async () => {
    const { deps, store } = setup();
    expect((await handle(uploadBytes('/admin/upload/members', await png(), ''), deps)).status).toBe(
      403,
    );
    expect(
      (await handle(postForm('/admin/content/members/new', { name: 'X' }, ''), deps)).status,
    ).toBe(403);
    expect(
      (await handle(post('/admin/content/faqs/1/delete', {}, ORIGIN, null), deps)).status,
    ).toBe(403);
    expect(
      (await handle(post('/admin/content/faqs/1/delete', {}, 'https://evil.example'), deps)).status,
    ).toBe(403);
    expect(store.putImageFile).not.toHaveBeenCalled();
    expect(store.deleteContent).not.toHaveBeenCalled();
  });

  it('사이트 반영 상태를 JSON으로 알려 준다', async () => {
    const { deps, jobs } = setup();
    vi.mocked(jobs.status).mockReturnValueOnce({
      running: { kind: 'build', reason: '김운영', startedAt: new Date() },
      queued: [],
      recent: [],
      buildPending: false,
    });
    const busy = await (await handle(get('/admin/status.json'), deps)).json();
    expect(busy).toMatchObject({ busy: true, tone: 'busy', label: '사이트에 반영 중…' });
    const idle = await (await handle(get('/admin/status.json'), deps)).json();
    expect(idle).toMatchObject({ busy: false, label: '사이트 최신' });
  });
});

describe('Notion 내보내기 가져오기', () => {
  beforeEach(async () => {
    session = await loginAs(setup().deps);
  });

  const zipBytes = () => {
    const bytes = new Uint8Array(64);
    bytes.set([0x50, 0x4b, 0x03, 0x04]);
    return bytes;
  };
  const sendZip = (body: Uint8Array, cookie = session) =>
    new Request(`${ORIGIN}/admin/import`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        cookie,
        accept: 'application/json',
        'content-type': 'application/zip',
      },
      body,
    });

  it('zip을 디스크에 두고 가져오기 작업을 건다', async () => {
    const { mkdtemp, readFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const importDir = await mkdtemp(join(tmpdir(), 'luna-import-test-'));
    const { deps, jobs } = setup({ importDir });
    const response = await handle(sendZip(zipBytes()), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const [file, reason] = vi.mocked(jobs.importZip).mock.lastCall ?? [];
    expect(reason).toBe('김운영');
    expect(file?.startsWith(importDir)).toBe(true);
    expect((await readFile(file ?? '')).length).toBe(64);
  });

  it('zip이 아니거나 로그인하지 않았으면 받지 않는다', async () => {
    const { deps, jobs } = setup();
    const notZip = await handle(sendZip(new TextEncoder().encode('hello')), deps);
    expect(notZip.status).toBe(422);
    expect(((await notZip.json()) as { error: string }).error).toContain('zip');
    expect((await handle(sendZip(zipBytes(), ''), deps)).status).toBe(403);
    expect(jobs.importZip).not.toHaveBeenCalled();
    const home = await (await handle(get('/admin/'), deps)).text();
    expect(home).toContain('data-import="/admin/import"');
  });
});

describe('보안', () => {
  it('운영진 목록에서 빠지면 남은 세션도 바로 막는다', async () => {
    const { deps, store } = setup();
    const cookie = await loginAs(deps);
    expect((await handle(get('/admin/', cookie), deps)).status).toBe(200);
    await store.saveAdminEmails([], OWNER);
    const response = await handle(get('/admin/', cookie), deps);
    expect(response.status).toBe(303);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('요청이 너무 많으면 429', async () => {
    let clock = 0;
    const { deps } = setup({ limiter: createRateLimiter(() => clock) });
    const headers = { 'x-real-ip': '203.0.113.9' };
    for (let i = 0; i < 20; i++) {
      const r = await handle(new Request(`${ORIGIN}/admin/login/google`, { headers }), deps);
      expect(r.status).toBe(303);
    }
    const blocked = await handle(new Request(`${ORIGIN}/admin/login/google`, { headers }), deps);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('60');
    clock += 10 * 60_000;
    expect(
      (await handle(new Request(`${ORIGIN}/admin/login/google`, { headers }), deps)).status,
    ).toBe(303);
  });

  it('화면 CSS·JS는 로그인 없이 받고, 없는 파일은 404', async () => {
    const { deps } = setup();
    const js = await handle(get('/admin/assets/admin.js', null), deps);
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toContain('javascript');
    expect(js.headers.get('cache-control')).toContain('immutable');
    expect((await handle(get('/admin/assets/secret.ts', null), deps)).status).toBe(404);
    const login = await (await handle(get('/admin/login', null), deps)).text();
    expect(login).toMatch(/<script src="\/admin\/assets\/admin\.js\?v=[0-9a-f]+" defer>/);
    expect(login).not.toMatch(/<script>|<style>/);
  });
});
