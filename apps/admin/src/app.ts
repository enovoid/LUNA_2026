// 요청 처리. 모든 주소는 Cloudflare Access를 통과해야 하고(authenticate), 쓰기 요청은 같은 출처에서 온 폼만 받는다.
import { parseSettings, SETTINGS_KEYS, type SettingsKey } from '@luna/db/settings';
import type { GitHub } from './github.js';
import type { AdminStore } from './store.js';
import { isNotice, type Loaded, type Notice, type PageModel, renderPage } from './views.js';

export interface AppDeps {
  /** Access JWT를 검증해 운영진 이메일을 돌려준다. 실패하면 던진다. */
  authenticate(request: Request): Promise<{ email: string }>;
  /** DB가 설정되지 않았으면 던진다. */
  store(): AdminStore;
  /** GITHUB_TOKEN이 설정되지 않았으면 던진다. */
  github(): GitHub;
  siteUrl?: string;
  now?: () => Date;
  log?: (message: string) => void;
}

const BASE = '/admin';

export async function handle(request: Request, deps: AppDeps): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  let viewer: { email: string };
  try {
    viewer = await deps.authenticate(request);
  } catch (error) {
    deps.log?.(`접근 거부: ${message(error)}`);
    return text(
      403,
      '접근 권한이 없습니다. 운영진 계정으로 Cloudflare Access 로그인이 필요합니다.',
    );
  }

  if (path === '/' || (path === BASE && url.pathname !== `${BASE}/`)) {
    return redirect(`${BASE}/`);
  }

  if (request.method === 'GET' && path === BASE) {
    const notice = url.searchParams.get('notice');
    return page(await loadPage(deps, viewer, isNotice(notice) ? notice : undefined));
  }

  if (request.method === 'POST') {
    if (!isSameOrigin(request, url)) return text(403, '다른 사이트에서 보낸 요청은 받지 않습니다.');
    if (path === `${BASE}/sync`) return runSync(request, deps, viewer);
    if (path === `${BASE}/deploy`) return deploy(deps, viewer);
    const key = SETTINGS_KEYS.find((k) => path === `${BASE}/settings/${k}`);
    if (key) return saveSettings(request, deps, viewer, key);
  }

  if (path.startsWith(BASE)) return text(404, '없는 주소입니다.');
  return text(404, 'Not found');
}

async function runSync(request: Request, deps: AppDeps, viewer: { email: string }) {
  const form = await request.formData();
  const full = form.get('full') === '1';
  try {
    await deps.github().runSync({ full });
    deps.log?.(`동기화 요청: ${viewer.email}${full ? ' (--full)' : ''}`);
    return redirect(`${BASE}/?notice=sync-started`);
  } catch (error) {
    deps.log?.(`동기화 요청 실패: ${message(error)}`);
    return redirect(`${BASE}/?notice=github-failed`);
  }
}

async function deploy(deps: AppDeps, viewer: { email: string }) {
  try {
    await deps.github().deploySite();
    deps.log?.(`배포 요청: ${viewer.email}`);
    return redirect(`${BASE}/?notice=deploy-started`);
  } catch (error) {
    deps.log?.(`배포 요청 실패: ${message(error)}`);
    return redirect(`${BASE}/?notice=github-failed`);
  }
}

async function saveSettings(
  request: Request,
  deps: AppDeps,
  viewer: { email: string },
  key: SettingsKey,
) {
  const form = await request.formData();
  const input: Record<string, string> = {};
  for (const [name, value] of form) if (typeof value === 'string') input[name] = value;

  const parsed = parseSettings(key, input);
  if (!parsed.ok) {
    const model = await loadPage(deps, viewer, undefined);
    return page({ ...model, rejected: { key, input, errors: parsed.errors } }, 422);
  }

  try {
    await deps.store().saveSetting(key, parsed.value, viewer.email);
    deps.log?.(`설정 저장(${key}): ${viewer.email}`);
  } catch (error) {
    deps.log?.(`설정 저장 실패(${key}): ${message(error)}`);
    return redirect(`${BASE}/?notice=db-failed`);
  }

  // 사이트는 빌드할 때 설정을 읽으므로 저장한 뒤 바로 다시 배포한다.
  try {
    await deps.github().deploySite();
    return redirect(`${BASE}/?notice=saved`);
  } catch (error) {
    deps.log?.(`설정 저장 뒤 배포 요청 실패: ${message(error)}`);
    return redirect(`${BASE}/?notice=saved-deploy-failed`);
  }
}

async function loadPage(
  deps: AppDeps,
  viewer: { email: string },
  notice: Notice | undefined,
): Promise<PageModel> {
  const [sync, settings, syncRuns, deployRuns] = await Promise.all([
    load(() => deps.store().syncStates()),
    load(() => deps.store().settings()),
    load(() => deps.github().recentRuns('sync.yml', 3)),
    load(() => deps.github().recentRuns('deploy.yml', 5)),
  ]);
  return {
    viewer,
    siteUrl: deps.siteUrl,
    notice,
    sync,
    settings,
    syncRuns,
    deployRuns,
    now: deps.now?.() ?? new Date(),
  };
}

/** 한 구역이 실패해도(DB 끊김, GitHub 장애) 나머지 화면은 그린다. */
async function load<T>(fn: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

/**
 * Access 쿠키는 다른 사이트에서 보낸 폼에도 실릴 수 있으므로(CSRF) 출처를 확인한다.
 * 브라우저는 POST에 Origin을 붙이고, 없으면 Sec-Fetch-Site로 판단한다.
 */
export function isSameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get('origin');
  if (origin) return origin === url.origin;
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
  return new Response(renderPage(model), {
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
function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location, ...SECURITY_HEADERS } });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
