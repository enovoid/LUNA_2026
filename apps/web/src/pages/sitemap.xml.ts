import type { APIRoute } from 'astro';
import { nav } from '../content/site';

// 사이트 서버가 콘텐츠를 고칠 때와 매일 0시에 다시 빌드하므로, 빌드한 날을 lastmod로 둔다.
export const GET: APIRoute = ({ site }) => {
  const lastmod = new Date().toISOString().slice(0, 10);
  const urls = nav
    .map(
      (n) =>
        `  <url><loc>${new URL(n.href, site)}</loc><lastmod>${lastmod}</lastmod><priority>${n.key === 'home' ? '1.0' : '0.8'}</priority></url>`,
    )
    .join('\n');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
};
