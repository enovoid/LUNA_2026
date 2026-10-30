// 관리자 화면의 CSS·JS. 서버가 시작할 때 읽어 두고, 내용 해시를 주소에 붙여 오래 캐시한다.
// CSP가 인라인 스크립트·스타일을 막으므로(script-src 'self') 화면은 이 파일들만 불러온다.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

interface Asset {
  body: Buffer;
  type: string;
  hash: string;
}

const load = (name: string, type: string): Asset => {
  const body = readFileSync(new URL(`./assets/${name}`, import.meta.url));
  return { body, type, hash: createHash('sha256').update(body).digest('hex').slice(0, 12) };
};

const ASSETS: Record<string, Asset> = {
  'admin.css': load('admin.css', 'text/css; charset=utf-8'),
  'admin.js': load('admin.js', 'text/javascript; charset=utf-8'),
};

/** 화면에 넣을 주소. 내용이 바뀌면 주소도 바뀐다. */
export function assetUrl(name: keyof typeof ASSETS & string): string {
  return `/admin/assets/${name}?v=${ASSETS[name]?.hash ?? ''}`;
}

export function serveAsset(name: string): Response | undefined {
  const asset = Object.hasOwn(ASSETS, name) ? ASSETS[name] : undefined;
  if (!asset) return undefined;
  return new Response(new Uint8Array(asset.body), {
    headers: {
      'Content-Type': asset.type,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  });
}
