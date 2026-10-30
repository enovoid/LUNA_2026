// 공개 사이트 정적 파일 내보내기. Astro가 만든 폴더(dist)를 그대로 보여 줄 뿐 요청마다 DB를 읽지 않는다.
// 주소 규칙은 build.format: 'file', trailingSlash: 'never'에 맞춘다: /members → members.html, /members/ → /members로 이동.
// 캐시 헤더는 빌드 결과의 _headers(apps/web/public/_headers)를 읽어 붙인다.
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};
const COMPRESSIBLE = new Set([
  '.html',
  '.css',
  '.js',
  '.mjs',
  '.json',
  '.webmanifest',
  '.xml',
  '.txt',
  '.svg',
]);
/** _headers에 규칙이 없을 때 HTML은 매번 ETag로 확인한다: 다시 빌드하면 바로 새 내용이 보인다. */
const DEFAULT_CACHE = 'public, max-age=0, must-revalidate';
/** 내보내지 않는 설정 파일 */
const HIDDEN = new Set(['/_headers', '/_redirects']);

interface Entry {
  body: Buffer;
  type: string;
  etag: string;
  compressible: boolean;
  br?: Buffer;
  gzip?: Buffer;
}

export interface Site {
  /** 사이트를 한 번이라도 만들었는지. 만들기 전에는 503을 돌려준다. */
  ready(): boolean;
  /** 새로 만든 폴더로 바꾼다. 이전 폴더 경로를 돌려준다(지우는 건 부른 쪽). */
  use(dir: string): Promise<string | undefined>;
  serve(request: Request): Promise<Response>;
}

export function createSite(): Site {
  let dir: string | undefined;
  let rules: HeaderRule[] = [];
  let cache = new Map<string, Entry | null>();

  const load = async (file: string): Promise<Entry | null> => {
    const known = cache.get(file);
    if (known !== undefined) return known;
    let entry: Entry | null = null;
    try {
      if ((await stat(file)).isFile()) {
        const body = await readFile(file);
        const ext = extname(file).toLowerCase();
        entry = {
          body,
          type: TYPES[ext] ?? 'application/octet-stream',
          // 1KB보다 작으면 압축해도 이득이 거의 없다.
          compressible: COMPRESSIBLE.has(ext) && body.length > 1024,
          etag: `"${createHash('sha1').update(body).digest('base64url').slice(0, 20)}"`,
        };
      }
    } catch {
      entry = null;
    }
    // 빌드 결과는 바뀌지 않으므로(새 빌드는 새 폴더) 한 번 읽은 파일은 메모리에 둔다.
    cache.set(file, entry);
    return entry;
  };

  return {
    ready: () => dir !== undefined,

    async use(next) {
      const previous = dir;
      rules = parseHeaders(await readFile(join(next, '_headers'), 'utf8').catch(() => ''));
      cache = new Map();
      dir = next;
      return previous;
    },

    async serve(request) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      }
      if (!dir) {
        return new Response('사이트를 만드는 중이에요. 1~2분 뒤 다시 열어 주세요.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '30' },
        });
      }
      const url = new URL(request.url);
      let path: string;
      try {
        path = decodeURIComponent(url.pathname);
      } catch {
        return notFound(dir);
      }
      if (path.includes('\0')) return notFound(dir);

      // /members/ → /members, /members.html → /members (Cloudflare drop-trailing-slash와 같은 동작)
      const canonical = canonicalPath(url.pathname);
      if (canonical !== url.pathname) {
        return new Response(null, { status: 301, headers: { Location: canonical + url.search } });
      }

      const found = HIDDEN.has(path) ? undefined : await resolve(dir, path, load);
      if (!found) return notFound(dir);
      return respond(request, found.entry, headersFor(rules, path, found.entry));
    },
  };

  async function notFound(root: string): Promise<Response> {
    const page = await load(join(root, '404.html'));
    if (!page) return new Response('Not found', { status: 404 });
    return new Response(page.body, {
      status: 404,
      headers: { 'Content-Type': page.type, 'Cache-Control': DEFAULT_CACHE },
    });
  }
}

/** 주소에 맞는 파일: 그대로 → .html → /index.html 순서. 폴더 밖은 보지 않는다. */
async function resolve(
  root: string,
  path: string,
  load: (file: string) => Promise<Entry | null>,
): Promise<{ entry: Entry } | undefined> {
  const candidates = path === '/' ? ['/index.html'] : [path, `${path}.html`, `${path}/index.html`];
  for (const candidate of candidates) {
    const file = normalize(join(root, candidate));
    if (file !== root && !file.startsWith(root + sep)) return undefined;
    const entry = await load(file);
    if (entry) return { entry };
  }
  return undefined;
}

export function canonicalPath(pathname: string): string {
  let path = pathname;
  if (path.length > 1 && path.endsWith('/')) path = path.replace(/\/+$/, '') || '/';
  if (path.endsWith('/index.html')) path = path.slice(0, -'/index.html'.length) || '/';
  else if (path.endsWith('.html')) path = path.slice(0, -'.html'.length);
  return path;
}

async function respond(request: Request, entry: Entry, headers: Headers): Promise<Response> {
  headers.set('ETag', entry.etag);
  if (request.headers.get('if-none-match') === entry.etag) {
    return new Response(null, { status: 304, headers });
  }
  let body = entry.body;
  if (entry.compressible) {
    headers.set('Vary', 'Accept-Encoding');
    const accept = request.headers.get('accept-encoding') ?? '';
    if (/\bbr\b/.test(accept)) {
      entry.br ??= await brotli(entry.body, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
      });
      body = entry.br;
      headers.set('Content-Encoding', 'br');
    } else if (/\bgzip\b/.test(accept)) {
      entry.gzip ??= await gzipAsync(entry.body, { level: 9 });
      body = entry.gzip;
      headers.set('Content-Encoding', 'gzip');
    }
  }
  headers.set('Content-Length', String(body.length));
  return new Response(request.method === 'HEAD' ? null : new Uint8Array(body), {
    status: 200,
    headers,
  });
}

function headersFor(rules: HeaderRule[], path: string, entry: Entry): Headers {
  const headers = new Headers({
    'Content-Type': entry.type,
    'X-Content-Type-Options': 'nosniff',
  });
  for (const rule of rules) {
    if (!rule.pattern.test(path)) continue;
    for (const [name, value] of rule.headers) headers.set(name, value);
  }
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', DEFAULT_CACHE);
  return headers;
}

interface HeaderRule {
  pattern: RegExp;
  headers: [string, string][];
}

/**
 * Cloudflare _headers 형식: 들여쓰지 않은 줄이 경로(끝의 *는 아무 문자열), 들여쓴 `이름: 값` 줄이 그 경로의 헤더.
 * #으로 시작하는 줄은 주석.
 */
export function parseHeaders(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^\s/.test(line)) {
      const rule = rules.at(-1);
      const colon = line.indexOf(':');
      if (!rule || colon < 0) continue;
      rule.headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
    } else {
      const source = line
        .trim()
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
      rules.push({ pattern: new RegExp(`^${source}$`), headers: [] });
    }
  }
  return rules;
}
