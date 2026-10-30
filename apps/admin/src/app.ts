// 요청 처리. /admin 아래는 관리자 페이지(/admin/login 말고는 로그인 필요, 쓰기 요청은 같은 출처의 폼만),
// 나머지 주소는 미리 만든 공개 사이트 파일이다.
import { parseSettings, SETTINGS_KEYS, type SettingsKey } from '@luna/db/settings';
import { type Auth, AuthError, type Viewer } from './auth.js';
import type { Jobs } from './jobs.js';
import type { Site } from './site.js';
import type { AdminStore } from './store.js';
import {
  isNotice,
  type Loaded,
  type Notice,
  type PageModel,
  renderLoginPage,
  renderPage,
} from './views.js';

export interface AppDeps {
  auth: Auth;
  /** DB가 설정되지 않았으면 던진다. */
  store(): AdminStore;
  site: Site;
  jobs: Jobs;
  now?: () => Date;
  log?: (message: string) => void;
}

const BASE = '/admin';

/** client: 로그인 실패 횟수를 셀 접속 주소. */
export async function handle(request: Request, deps: AppDeps, client = ''): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  // Railway는 새 배포가 /health에 200을 줄 때 트래픽을 넘긴다: 첫 빌드가 끝나기 전에는 이전 배포가 계속 응답한다.
  if (path === '/health') {
    return deps.site.ready() ? text(200, 'ok') : text(503, '사이트를 만드는 중');
  }
  if (path !== BASE && !path.startsWith(`${BASE}/`)) return deps.site.serve(request);
  if (path === BASE && url.pathname !== `${BASE}/`) return redirect(`${BASE}/`);

  if (request.method === 'POST' && !isSameOrigin(request, url)) {
    return text(403, '다른 사이트에서 보낸 요청은 받지 않습니다.');
  }

  const viewer = await deps.auth.viewer(request);

  if (path === `${BASE}/login`) {
    if (request.method === 'POST') return login(request, deps, client);
    if (viewer) return redirect(`${BASE}/`);
    return html(renderLoginPage({}));
  }
  if (path === `${BASE}/logout` && request.method === 'POST') {
    return redirect(`${BASE}/login`, deps.auth.logoutCookie());
  }

  if (!viewer) {
    if (request.method === 'GET') return redirect(`${BASE}/login`);
    return text(403, '로그인이 필요합니다.');
  }

  if (request.method === 'GET' && path === BASE) {
    const notice = url.searchParams.get('notice');
    return page(await loadPage(deps, viewer, isNotice(notice) ? notice : undefined));
  }

  if (request.method === 'POST') {
    if (path === `${BASE}/sync`) return runSync(request, deps, viewer);
    if (path === `${BASE}/build`) return build(deps, viewer);
    const key = SETTINGS_KEYS.find((k) => path === `${BASE}/settings/${k}`);
    if (key) return saveSettings(request, deps, viewer, key);
  }

  return text(404, '없는 주소입니다.');
}

async function login(request: Request, deps: AppDeps, client: string) {
  const form = await request.formData();
  const name = String(form.get('name') ?? '');
  try {
    const cookie = await deps.auth.login({
      name,
      password: String(form.get('password') ?? ''),
      client,
    });
    deps.log?.(`로그인: ${name.trim()}`);
    return redirect(`${BASE}/`, cookie);
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    deps.log?.(`로그인 실패(${client}): ${error.message}`);
    return html(renderLoginPage({ error: error.message, name }), 401);
  }
}

async function runSync(request: Request, deps: AppDeps, viewer: Viewer) {
  const form = await request.formData();
  const full = form.get('full') === '1';
  deps.jobs.sync({ full, reason: viewer.name, trigger: 'admin' });
  return redirect(`${BASE}/?notice=sync-started`);
}

function build(deps: AppDeps, viewer: Viewer) {
  deps.jobs.build(viewer.name);
  return redirect(`${BASE}/?notice=build-started`);
}

async function saveSettings(request: Request, deps: AppDeps, viewer: Viewer, key: SettingsKey) {
  const form = await request.formData();
  const input: Record<string, string> = {};
  for (const [name, value] of form) if (typeof value === 'string') input[name] = value;

  const parsed = parseSettings(key, input);
  if (!parsed.ok) {
    const model = await loadPage(deps, viewer, undefined);
    return page({ ...model, rejected: { key, input, errors: parsed.errors } }, 422);
  }

  try {
    await deps.store().saveSetting(key, parsed.value, viewer.name);
    deps.log?.(`설정 저장(${key}): ${viewer.name}`);
  } catch (error) {
    deps.log?.(`설정 저장 실패(${key}): ${message(error)}`);
    return redirect(`${BASE}/?notice=db-failed`);
  }

  // 사이트는 빌드할 때 설정을 읽으므로 저장한 뒤 바로 다시 만든다.
  deps.jobs.build(`${viewer.name} · ${SETTINGS_LABELS[key]} 저장`);
  return redirect(`${BASE}/?notice=saved`);
}

const SETTINGS_LABELS: Record<SettingsKey, string> = { recruit: '모집 정보', contact: '연락처' };

async function loadPage(
  deps: AppDeps,
  viewer: Viewer,
  notice: Notice | undefined,
): Promise<PageModel> {
  const [sync, settings, generations] = await Promise.all([
    load(() => deps.store().syncStates()),
    load(() => deps.store().settings()),
    load(() => deps.store().generations()),
  ]);
  return {
    viewer,
    notice,
    sync,
    settings,
    generations,
    jobs: deps.jobs.status(),
    siteReady: deps.site.ready(),
    now: deps.now?.() ?? new Date(),
  };
}

/** 한 구역이 실패해도(DB 끊김 등) 나머지 화면은 그린다. */
async function load<T>(fn: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

/**
 * 세션 쿠키는 다른 사이트에서 보낸 폼에도 실릴 수 있으므로(CSRF) 출처를 확인한다.
 * 브라우저는 POST에 Origin을 붙이고, 없으면 Sec-Fetch-Site로 판단한다.
 * 프록시 뒤라 프로토콜은 믿기 어려워 호스트만 비교한다.
 */
export function isSameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      return new URL(origin).host === url.host;
    } catch {
      return false;
    }
  }
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

function page(model: PageModel, status = 200): Response {
  return html(renderPage(model), status);
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
  });
}

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS },
  });
}

/** POST 뒤에는 303으로 GET 화면에 보낸다(새로고침해도 다시 보내지 않게). */
function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ Location: location, ...SECURITY_HEADERS });
  if (cookie) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
