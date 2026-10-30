import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalPath, createSite, parseHeaders } from '../src/site.js';

let root: string;
let dist: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'luna-site-test-'));
  dist = join(root, 'build-1');
  await mkdir(join(dist, '_astro'), { recursive: true });
  await writeFile(join(dist, 'index.html'), `<h1>홈</h1>${'x'.repeat(2000)}`);
  await writeFile(join(dist, 'members.html'), '<h1>멤버</h1>');
  await writeFile(join(dist, '404.html'), '<h1>없음</h1>');
  await writeFile(join(dist, '_astro', 'app.abc123.js'), 'console.log(1)');
  await writeFile(join(root, 'secret.txt'), 'secret');
  await writeFile(
    join(dist, '_headers'),
    '# 주석\n/_astro/*\n  Cache-Control: public, max-age=31536000, immutable\n/sw.js\n  Cache-Control: no-cache\n',
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const req = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
  new Request(`https://luna.example${path}`, { headers, method });

describe('공개 사이트 파일', () => {
  it('처음 만들기 전에는 503', async () => {
    const site = createSite();
    expect(site.ready()).toBe(false);
    expect((await site.serve(req('/'))).status).toBe(503);
  });

  it('주소를 .html 파일로 잇고, _headers의 캐시 규칙을 붙인다', async () => {
    const site = createSite();
    await site.use(dist);
    const home = await site.serve(req('/'));
    expect(home.status).toBe(200);
    expect(home.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(home.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(await (await site.serve(req('/members'))).text()).toBe('<h1>멤버</h1>');
    const asset = await site.serve(req('/_astro/app.abc123.js'));
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(asset.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
  });

  it('끝의 / 와 .html 은 정식 주소로 보낸다', async () => {
    const site = createSite();
    await site.use(dist);
    const slash = await site.serve(req('/members/?a=1'));
    expect(slash.status).toBe(301);
    expect(slash.headers.get('location')).toBe('/members?a=1');
    expect((await site.serve(req('/members.html'))).headers.get('location')).toBe('/members');
    expect((await site.serve(req('/index.html'))).headers.get('location')).toBe('/');
  });

  it('없는 주소·설정 파일·폴더 밖은 404 페이지', async () => {
    const site = createSite();
    await site.use(dist);
    for (const path of ['/nope', '/_headers', '/../secret.txt', '/%2e%2e/secret.txt']) {
      const response = await site.serve(req(path));
      expect(response.status, path).toBe(404);
      expect(await response.text()).toBe('<h1>없음</h1>');
    }
  });

  it('ETag가 같으면 304, 큰 텍스트는 압축한다', async () => {
    const site = createSite();
    await site.use(dist);
    const first = await site.serve(req('/', { 'accept-encoding': 'gzip, br' }));
    expect(first.headers.get('content-encoding')).toBe('br');
    expect(first.headers.get('vary')).toBe('Accept-Encoding');
    const etag = first.headers.get('etag') ?? '';
    expect((await site.serve(req('/', { 'if-none-match': etag }))).status).toBe(304);
    const gzip = await site.serve(req('/', { 'accept-encoding': 'gzip' }));
    expect(gzip.headers.get('content-encoding')).toBe('gzip');
    const plain = await site.serve(req('/'));
    expect(plain.headers.get('content-encoding')).toBeNull();
    expect(await plain.text()).toContain('<h1>홈</h1>');
  });

  it('GET·HEAD 말고는 405', async () => {
    const site = createSite();
    await site.use(dist);
    expect((await site.serve(req('/', {}, 'POST'))).status).toBe(405);
    const head = await site.serve(req('/members', {}, 'HEAD'));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('새 폴더로 바꾸면 이전 폴더를 돌려준다', async () => {
    const site = createSite();
    expect(await site.use(dist)).toBeUndefined();
    expect(await site.use(dist)).toBe(dist);
  });
});

describe('도우미', () => {
  it('canonicalPath', () => {
    expect(canonicalPath('/')).toBe('/');
    expect(canonicalPath('/faq/')).toBe('/faq');
    expect(canonicalPath('/faq.html')).toBe('/faq');
    expect(canonicalPath('/img/a.webp')).toBe('/img/a.webp');
  });

  it('parseHeaders: *는 아무 문자열', () => {
    const [rule] = parseHeaders('/img/*\n  Cache-Control: immutable');
    expect(rule?.pattern.test('/img/members/a.webp')).toBe(true);
    expect(rule?.pattern.test('/imgx')).toBe(false);
    expect(rule?.headers).toEqual([['Cache-Control', 'immutable']]);
  });
});
