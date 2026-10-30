import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// TODO: 사이트 도메인 확정 후 SITE_URL(배포 환경 변수)로 지정. sitemap·canonical·OG 절대 주소에 쓴다.
const site = process.env.SITE_URL ?? 'https://luna.example.com';

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file', inlineStylesheets: 'auto' },
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
});
