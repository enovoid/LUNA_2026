import tailwindcss from '@tailwindcss/vite';
import { defineConfig, envField } from 'astro/config';

// TODO: 사이트 도메인 확정 후 SITE_URL(배포 환경 변수)로 지정. sitemap·canonical·OG 절대 주소에 쓴다.
const site = process.env.SITE_URL ?? 'https://luna.example.com';

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file', inlineStylesheets: 'auto' },
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
      R2_PUBLIC_URL: envField.string({
        context: 'server',
        access: 'public',
        url: true,
        optional: true,
      }),
      CI: envField.boolean({ context: 'server', access: 'public', default: false }),
    },
  },
});
