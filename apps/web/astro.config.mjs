import tailwindcss from '@tailwindcss/vite';
import { defineConfig, envField } from 'astro/config';

// TODO: 사이트 도메인 확정 후 SITE_URL(배포 환경 변수)로 지정. sitemap·canonical·OG 절대 주소에 쓴다.
const site = process.env.SITE_URL ?? 'https://luna.example.com';

export default defineConfig({
  site,
  output: 'static',
  // 사이트 서버(apps/admin)는 빌드마다 새 폴더를 만들고, 성공하면 그 폴더로 바꾼다.
  outDir: process.env.LUNA_OUT_DIR || './dist',
  trailingSlash: 'never',
  // CSS를 HTML에 넣어 첫 화면을 막는 요청 왕복을 하나 없앤다(압축 후 약 19KB, 모바일 FCP 개선).
  build: { format: 'file', inlineStylesheets: 'always' },
  vite: { plugins: [tailwindcss()] },
  // 빌드 때 읽는 환경 변수. 타입이 생기고 값이 형식에 안 맞으면 빌드가 시작 전에 멈춘다(astro:env).
  // SITE_URL은 설정 파일 안에서 쓰여 astro:env로 읽을 수 없으므로 위에서 process.env로 읽는다.
  env: {
    schema: {
      DATABASE_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
      LUNA_DATA_SOURCE: envField.enum({
        context: 'server',
        access: 'public',
        values: ['db', 'mock'],
        optional: true,
      }),
      // Google Search Console·Naver 서치어드바이저 소유 확인 값(HTML 태그 방식의 content). 비우면 태그를 넣지 않는다.
      GOOGLE_SITE_VERIFICATION: envField.string({
        context: 'server',
        access: 'public',
        optional: true,
      }),
      NAVER_SITE_VERIFICATION: envField.string({
        context: 'server',
        access: 'public',
        optional: true,
      }),
      CI: envField.boolean({ context: 'server', access: 'public', default: false }),
    },
  },
});
