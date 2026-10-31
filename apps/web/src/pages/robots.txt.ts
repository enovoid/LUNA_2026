import type { APIRoute } from 'astro';

// 관리자 페이지(/admin, 사이트 서버 apps/admin)는 검색에 나오지 않게 한다. 응답에도 X-Robots-Tag: noindex가 붙는다.
export const GET: APIRoute = ({ site }) =>
  new Response(
    `User-agent: *\nAllow: /\nDisallow: /admin\n\nSitemap: ${new URL('/sitemap.xml', site)}\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
