// 요청 처리. /admin 아래는 관리자 페이지, 나머지 주소는 미리 만든 공개 사이트 파일이다.
// 관리자 페이지의 보호 장치(모두 서버에서 확인한다):
// - 로그인: Google 계정 + 운영진 목록. 목록에서 빠지면 세션이 남아 있어도 바로 막는다.
// - 쓰기 요청은 같은 출처에서 온 것만(CSRF), 요청 횟수 제한, 입력값·사진 검사
// - 응답마다 보안 헤더(CSP로 외부 스크립트·인라인 스크립트 금지, 다른 사이트에 끼워 넣기 금지 등)

import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { parseSettings, SETTINGS_KEYS, type SettingsKey } from '@luna/db/settings';
import { serveAsset } from './assets.js';
import { type Auth, AuthError, CALLBACK_PATH, isEmail, type Viewer } from './auth.js';
import { CONTENT, type ContentTable, isContentTable, parseContent } from './content.js';
import {
  COMPLETE_WIDTH,
  isImageFileKey,
  isImageKey,
  MAX_UPLOAD_BYTES,
  sizeOfStored,
  storeUpload,
  UploadError,
  variantKey,
} from './images.js';
import type { Jobs } from './jobs.js';
import { clientIp, type RateLimiter } from './rate-limit.js';
import type { Site } from './site.js';
import type { AdminStore, ContentImage } from './store.js';
import {
  type Frame,
  isNotice,
  jobState,
  type Loaded,
  MAX_IMPORT_BYTES,
  type Notice,
  type PageModel,
  renderContentForm,
  renderContentList,
  renderLoginPage,
  renderPage,
} from './views.js';

export interface AppDeps {
  auth: Auth;
  /** DB가 설정되지 않았으면 던진다. */
  store(): AdminStore;
  site: Site;
  jobs: Jobs;
  /** Railway 변수 ADMIN_EMAILS: 항상 들어올 수 있고 관리자 화면에서 지울 수 없는 운영진 */
  ownerEmails: string[];
  /** 올린 Notion 내보내기 zip을 잠시 둘 폴더 */
  importDir?: string;
  /** 요청 횟수 제한. 없으면 제한하지 않는다(테스트). */
  limiter?: RateLimiter;
  now?: () => Date;
  log?: (message: string) => void;
}

/** 요청 횟수 상한: [횟수, 기간(ms)] */
const LIMITS = {
  /** IP마다 관리자 페이지 전체 */
  ip: [300, 60_000],
  /** IP마다 로그인 시도 */
  login: [20, 10 * 60_000],
  /** 운영진마다 저장·삭제 등 쓰기 */
  write: [60, 60_000],
  /** 운영진마다 사진 올리기 */
  upload: [60, 10 * 60_000],
} as const;

const BASE = '/admin';

export async function handle(request: Request, deps: AppDeps): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  // Railway는 새 배포가 /health에 200을 줄 때 트래픽을 넘긴다: 첫 빌드가 끝나기 전에는 이전 배포가 계속 응답한다.
  if (path === '/health') {
    return deps.site.ready() ? text(200, 'ok') : text(503, '사이트를 만드는 중');
  }
  if (path !== BASE && !path.startsWith(`${BASE}/`)) return deps.site.serve(request);
  if (path === BASE && url.pathname !== `${BASE}/`) return redirect(`${BASE}/`);

  // 화면용 CSS·JS(비밀 없음). 로그인 화면에서도 쓰므로 로그인 없이 준다.
  if (request.method === 'GET' && path.startsWith(`${BASE}/assets/`)) {
    return serveAsset(path.slice(`${BASE}/assets/`.length)) ?? text(404, '없는 주소입니다.');
  }

  const ip = clientIp(request);
  if (!limit(deps, `ip:${ip}`, LIMITS.ip)) return tooMany();

  if (request.method === 'POST' && !isSameOrigin(request, url)) {
    return text(403, '다른 사이트에서 보낸 요청은 받지 않습니다.');
  }

  const session = await deps.auth.viewer(request);

  if (request.method === 'GET' && path === `${BASE}/login`) {
    if (session) return redirect(`${BASE}/`);
    return html(renderLoginPage({ configured: deps.auth.configured() }));
  }
  if (request.method === 'GET' && (path === `${BASE}/login/google` || path === CALLBACK_PATH)) {
    if (!limit(deps, `login:${ip}`, LIMITS.login)) return tooMany();
    if (path === CALLBACK_PATH) return finishLogin(request, deps, url);
    return startLogin(deps, url);
  }
  if (path === `${BASE}/logout` && request.method === 'POST') {
    return redirect(`${BASE}/login`, deps.auth.logoutCookie());
  }

  // 세션이 유효해도 운영진 목록에서 빠졌으면 바로 막는다.
  const viewer = session && (await isAllowed(deps, session.email)) ? session : undefined;
  if (!viewer) {
    const cookies = session ? [deps.auth.logoutCookie()] : [];
    if (request.method === 'GET') return redirect(`${BASE}/login`, ...cookies);
    return text(403, '로그인이 필요합니다.');
  }

  if (request.method === 'GET') {
    if (path === BASE) {
      const notice = url.searchParams.get('notice');
      return page(await loadPage(deps, viewer, isNotice(notice) ? notice : undefined));
    }
    if (path === `${BASE}/status.json`) return statusJson(deps);
    if (path.startsWith(`${BASE}/img/`)) return adminImage(deps, path.slice(`${BASE}/img/`.length));
    const content = matchContent(path);
    if (content) return contentPage(deps, viewer, content, url);
  }

  if (request.method === 'POST') {
    const isUpload = path.startsWith(`${BASE}/upload/`) || path === IMPORT_PATH;
    const [count, windowMs] = isUpload ? LIMITS.upload : LIMITS.write;
    if (!limit(deps, `${isUpload ? 'upload' : 'write'}:${viewer.email}`, [count, windowMs])) {
      return tooMany();
    }
    if (path === IMPORT_PATH) return importZip(request, deps, viewer);
    if (isUpload) return upload(request, deps, viewer, path.slice(`${BASE}/upload/`.length));
    const content = matchContent(path);
    if (content && content.id !== undefined && content.action === 'delete') {
      return deleteContent(deps, viewer, content.table, content.id);
    }
    if (content && content.action === 'edit') {
      return saveContent(request, deps, viewer, content.table, content.id);
    }
    if (path === `${BASE}/sync`) return runSync(request, deps, viewer);
    if (path === `${BASE}/build`) return build(deps, viewer);
    if (path === `${BASE}/admins/add`) return changeAdmins(request, deps, viewer, 'add');
    if (path === `${BASE}/admins/remove`) return changeAdmins(request, deps, viewer, 'remove');
    const key = SETTINGS_KEYS.find((k) => path === `${BASE}/settings/${k}`);
    if (key) return saveSettings(request, deps, viewer, key);
  }

  return text(404, '없는 주소입니다.');
}

function limit(deps: AppDeps, key: string, [count, windowMs]: readonly [number, number]): boolean {
  return deps.limiter?.take(key, count, windowMs) ?? true;
}

function tooMany(): Response {
  const response = text(429, '요청이 너무 많아요. 잠시 뒤 다시 시도해 주세요.');
  response.headers.set('Retry-After', '60');
  return response;
}

async function startLogin(deps: AppDeps, url: URL) {
  try {
    const { location, cookie } = await deps.auth.start(url.origin);
    return redirect(location, cookie);
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    return html(renderLoginPage({ configured: false, error: error.message }), 503);
  }
}

async function finishLogin(request: Request, deps: AppDeps, url: URL) {
  try {
    const { viewer, cookie } = await deps.auth.finish(request, url.origin, (email) =>
      isAllowed(deps, email),
    );
    deps.log?.(`로그인: ${viewer.email}`);
    return redirect(`${BASE}/`, cookie, deps.auth.clearLoginCookie());
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    deps.log?.(`로그인 실패: ${error.message}`);
    const response = html(renderLoginPage({ configured: true, error: error.message }), 403);
    response.headers.append('Set-Cookie', deps.auth.clearLoginCookie());
    return response;
  }
}

/** Railway 변수의 운영진 + 관리자 화면에서 추가한 운영진. DB를 못 읽어도 변수에 있는 사람은 들어온다. */
async function isAllowed(deps: AppDeps, email: string): Promise<boolean> {
  if (deps.ownerEmails.includes(email)) return true;
  try {
    return (await deps.store().adminEmails()).emails.includes(email);
  } catch (error) {
    deps.log?.(`운영진 목록을 읽지 못함: ${message(error)}`);
    return false;
  }
}

async function changeAdmins(
  request: Request,
  deps: AppDeps,
  viewer: Viewer,
  action: 'add' | 'remove',
) {
  const form = await request.formData();
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  if (action === 'add' && !isEmail(email)) return redirect(`${BASE}/?notice=admin-invalid`);
  try {
    const current = (await deps.store().adminEmails()).emails;
    const next =
      action === 'add'
        ? [...new Set([...current, email])].sort()
        : current.filter((e) => e !== email);
    await deps.store().saveAdminEmails(next, viewer.email);
    deps.log?.(`운영진 ${action === 'add' ? '추가' : '삭제'}: ${email} (${viewer.email})`);
  } catch (error) {
    deps.log?.(`운영진 목록 저장 실패: ${message(error)}`);
    return redirect(`${BASE}/?notice=db-failed`);
  }
  return redirect(`${BASE}/?notice=${action === 'add' ? 'admin-added' : 'admin-removed'}`);
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
    await deps.store().saveSetting(key, parsed.value, viewer.email);
    deps.log?.(`설정 저장(${key}): ${viewer.email}`);
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
  const [sync, settings, generations, admins, counts] = await Promise.all([
    load(() => deps.store().syncStates()),
    load(() => deps.store().settings()),
    load(() => deps.store().generations()),
    load(() => deps.store().adminEmails()),
    load(async () => {
      const entries = await Promise.all(
        (Object.keys(CONTENT) as ContentTable[]).map(
          async (table) => [table, (await deps.store().listContent(table)).length] as const,
        ),
      );
      return Object.fromEntries(entries) as Record<ContentTable, number>;
    }),
  ]);
  return {
    viewer,
    owners: deps.ownerEmails,
    admins,
    notice,
    sync,
    settings,
    generations,
    counts,
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
  // 우리 서버의 파일만 불러오고(인라인 스크립트 금지), 폼은 우리 서버로만, 다른 사이트에 끼워 넣지 못하게.
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'Strict-Transport-Security': 'max-age=31536000',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

// ── 콘텐츠(멤버·수상·프로젝트·FAQ) ──

interface ContentRoute {
  table: ContentTable;
  /** 없으면 새로 만들기 또는 목록 */
  id?: number;
  action: 'list' | 'edit' | 'delete';
}

/** /admin/content/<table>, /<table>/new, /<table>/<id>, /<table>/<id>/delete */
function matchContent(path: string): ContentRoute | undefined {
  const match = path.match(/^\/admin\/content\/([a-z]+)(?:\/(new|\d{1,9})(\/delete)?)?$/);
  const table = match?.[1];
  if (!match || !table || !isContentTable(table)) return undefined;
  if (!match[2]) return { table, action: 'list' };
  if (match[2] === 'new') return match[3] ? undefined : { table, action: 'edit' };
  return { table, id: Number(match[2]), action: match[3] ? 'delete' : 'edit' };
}

function frame(deps: AppDeps, viewer: Viewer): Frame {
  return { viewer, status: jobState(deps.jobs.status(), deps.site.ready()) };
}

async function contentPage(deps: AppDeps, viewer: Viewer, route: ContentRoute, url: URL) {
  const { table } = route;
  if (route.action === 'list') {
    const notice = url.searchParams.get('notice');
    const rows = await load(() => deps.store().listContent(table));
    return html(
      renderContentList({
        ...frame(deps, viewer),
        table,
        rows,
        notice: isNotice(notice) ? notice : undefined,
      }),
    );
  }
  let row: Awaited<ReturnType<AdminStore['getContent']>>;
  if (route.id !== undefined) {
    try {
      row = await deps.store().getContent(table, route.id);
    } catch (error) {
      deps.log?.(`콘텐츠 읽기 실패: ${message(error)}`);
      return redirect(`${BASE}/content/${table}?notice=db-failed`);
    }
    if (!row) return redirect(`${BASE}/content/${table}?notice=content-missing`);
  }
  return contentForm(deps, viewer, table, row);
}

async function contentForm(
  deps: AppDeps,
  viewer: Viewer,
  table: ContentTable,
  row: Awaited<ReturnType<AdminStore['getContent']>>,
  rejected?: { input: Record<string, string>; errors: string[] },
) {
  const suggestions: Record<string, string[]> = {};
  await Promise.all(
    CONTENT[table].fields
      .filter((f) => f.suggest)
      .map(async (f) => {
        suggestions[f.name] = await deps
          .store()
          .distinctValues(table, f.name)
          .catch(() => []);
      }),
  );
  return html(
    renderContentForm({
      ...frame(deps, viewer),
      table,
      row,
      suggestions,
      input: rejected?.input,
      errors: rejected?.errors,
    }),
    rejected ? 422 : 200,
  );
}

async function saveContent(
  request: Request,
  deps: AppDeps,
  viewer: Viewer,
  table: ContentTable,
  id: number | undefined,
) {
  const form = await readForm(request);
  if (!form)
    return text(413, `요청이 너무 커요. 사진은 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB까지예요.`);
  const input: Record<string, string> = {};
  let file: File | undefined;
  for (const [name, value] of form) {
    if (typeof value === 'string') input[name] = value;
    else if (name === 'image' && value.size > 0) file = value;
  }
  const def = CONTENT[table];
  const parsed = parseContent(def, input);
  const errors = parsed.ok ? [] : [...parsed.errors];

  // 사진: JS가 미리 올렸으면 imageKey, 아니면 폼에 같이 온 파일(JS 없이 저장한 경우).
  let image: ContentImage | null | undefined;
  if (def.images) {
    try {
      image = await resolveImage(deps, table, input, file);
    } catch (error) {
      if (!(error instanceof UploadError)) throw error;
      errors.push(error.message);
      input.imageKey = '';
    }
  }

  let current: Awaited<ReturnType<AdminStore['getContent']>>;
  if (id !== undefined) {
    current = await deps
      .store()
      .getContent(table, id)
      .catch(() => undefined);
    if (!current) return redirect(`${BASE}/content/${table}?notice=content-missing`);
  }
  if (!parsed.ok || errors.length > 0) {
    return contentForm(deps, viewer, table, current, { input, errors });
  }

  try {
    const saved = await deps.store().saveContent(table, id, parsed.values, image);
    if (saved === undefined) return redirect(`${BASE}/content/${table}?notice=content-missing`);
    deps.log?.(`${def.label} ${id === undefined ? '추가' : '수정'}(${saved}): ${viewer.email}`);
  } catch (error) {
    deps.log?.(`${def.label} 저장 실패: ${message(error)}`);
    return redirect(`${BASE}/content/${table}?notice=db-failed`);
  }
  deps.jobs.build(`${viewer.name} · ${def.label} ${titleOf(def.title(parsed.values))} 저장`);
  return redirect(`${BASE}/content/${table}?notice=content-saved`);
}

function titleOf(title: string): string {
  return title.length > 20 ? `${title.slice(0, 20)}…` : title;
}

/** 저장할 사진. undefined면 그대로 두고, null이면 뺀다. */
async function resolveImage(
  deps: AppDeps,
  table: ContentTable,
  input: Record<string, string>,
  file: File | undefined,
): Promise<ContentImage | null | undefined> {
  if (file) {
    return storeUpload(deps.store(), table, Buffer.from(await file.arrayBuffer()));
  }
  const key = input.imageKey?.trim();
  if (key) {
    if (!isImageKey(table, key))
      throw new UploadError('사진 정보가 올바르지 않아요. 다시 골라 주세요.');
    const body = await deps.store().imageFile(variantKey(key, COMPLETE_WIDTH));
    if (!body) throw new UploadError('올린 사진을 찾지 못했어요. 다시 골라 주세요.');
    return { imageKey: key, ...(await sizeOfStored(body)) };
  }
  if (input.removeImage === '1') return null;
  return undefined;
}

async function deleteContent(deps: AppDeps, viewer: Viewer, table: ContentTable, id: number) {
  const def = CONTENT[table];
  try {
    const deleted = await deps.store().deleteContent(table, id);
    if (!deleted) return redirect(`${BASE}/content/${table}?notice=content-missing`);
    deps.log?.(`${def.label} 삭제(${id}): ${viewer.email}`);
  } catch (error) {
    deps.log?.(`${def.label} 삭제 실패: ${message(error)}`);
    return redirect(`${BASE}/content/${table}?notice=db-failed`);
  }
  deps.jobs.build(`${viewer.name} · ${def.label} 삭제`);
  return redirect(`${BASE}/content/${table}?notice=content-deleted`);
}

/** 사진만 먼저 올린다(admin.js). 본문은 사진 바이트 그대로. 저장 전이라 사이트는 다시 만들지 않는다. */
async function upload(request: Request, deps: AppDeps, viewer: Viewer, name: string) {
  if (!isContentTable(name) || !CONTENT[name].images) return text(404, '없는 주소입니다.');
  let bytes: Buffer;
  try {
    bytes = Buffer.from(await request.arrayBuffer());
  } catch {
    return json({ error: `사진은 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB까지 올릴 수 있어요.` }, 413);
  }
  try {
    const image = await storeUpload(deps.store(), name, bytes);
    deps.log?.(`사진 올림(${image.imageKey}): ${viewer.email}`);
    return json(image);
  } catch (error) {
    if (error instanceof UploadError) return json({ error: error.message }, 422);
    deps.log?.(`사진 저장 실패: ${message(error)}`);
    return json({ error: '사진을 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.' }, 500);
  }
}

export const IMPORT_PATH = `${BASE}/import`;
/** 가져오기는 zip을 메모리에 풀므로(약 3배) 서버 메모리에 맞춰 둔다. */

/**
 * Notion 내보내기 zip(Markdown & CSV)을 받아 디스크에 두고 가져오기 작업을 건다. 바로 돌려주고 가져오기는 뒤에서 한다.
 * admin.js는 파일 바이트를 그대로 보내고, JS가 없으면 multipart 폼으로 온다.
 */
async function importZip(request: Request, deps: AppDeps, viewer: Viewer) {
  const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
  const fail = (status: number, error: string) =>
    wantsJson ? json({ error }, status) : redirect(`${BASE}/?notice=import-failed`);
  const dir = deps.importDir ?? join(tmpdir(), 'luna-import');
  const file = join(dir, `notion-${Date.now()}-${randomBytes(4).toString('hex')}.zip`);
  try {
    await mkdir(dir, { recursive: true });
    let body: ReadableStream<Uint8Array> | null = request.body;
    if ((request.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
      const upload = (await readForm(request))?.get('file');
      body = upload instanceof File && upload.size > 0 ? upload.stream() : null;
    }
    if (!body) return fail(422, 'zip 파일을 골라 주세요.');
    let size = 0;
    let head: Uint8Array | undefined;
    const counted = body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          head ??= chunk.subarray(0, 4);
          size += chunk.length;
          if (size > MAX_IMPORT_BYTES) throw new UploadError('zip은 200MB까지 올릴 수 있어요.');
          controller.enqueue(chunk);
        },
      }),
    );
    await pipeline(
      Readable.fromWeb(counted as NodeReadableStream<Uint8Array>),
      createWriteStream(file),
    );
    // zip 파일은 PK\x03\x04로 시작한다.
    if (!head || head[0] !== 0x50 || head[1] !== 0x4b || head[2] !== 0x03 || head[3] !== 0x04) {
      await rm(file, { force: true });
      return fail(422, 'Notion에서 내보낸 zip 파일만 올릴 수 있어요.');
    }
  } catch (error) {
    await rm(file, { force: true });
    if (error instanceof UploadError) return fail(413, error.message);
    deps.log?.(`내보내기 저장 실패: ${message(error)}`);
    return fail(413, '파일을 받지 못했어요. 200MB 이하인지 확인하고 다시 올려 주세요.');
  }
  deps.jobs.importZip(file, viewer.name);
  deps.log?.(`Notion 내보내기 올림: ${viewer.email}`);
  return wantsJson ? json({ ok: true }) : redirect(`${BASE}/?notice=import-started`);
}

/** 관리자 화면 미리 보기용 사진. 키에 내용 해시가 있어 바뀌지 않으므로 브라우저에 오래 둔다. */
async function adminImage(deps: AppDeps, key: string) {
  if (!isImageFileKey(key)) return text(404, '없는 사진입니다.');
  const body = await deps
    .store()
    .imageFile(key)
    .catch(() => undefined);
  if (!body) return text(404, '없는 사진입니다.');
  return new Response(new Uint8Array(body), {
    headers: {
      ...SECURITY_HEADERS,
      'Content-Type': 'image/webp',
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}

function statusJson(deps: AppDeps) {
  return json(jobState(deps.jobs.status(), deps.site.ready()));
}

/** 본문이 상한을 넘으면(server.ts가 끊음) undefined */
async function readForm(request: Request): Promise<FormData | undefined> {
  try {
    return await request.formData();
  } catch {
    return undefined;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

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
function redirect(location: string, ...cookies: string[]): Response {
  const headers = new Headers({ Location: location, ...SECURITY_HEADERS });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
