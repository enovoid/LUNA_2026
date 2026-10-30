# 서비스별 공식 권장 방식 정렬 (2026년 10월 기준)

이 저장소가 쓰는 서비스·도구를 각 공식 문서의 2026-10-30 기준 권장 방식과 비교하고 맞춘 기록이다. 근거는 각 서비스의 공식 문서(대부분 문서 사이트의 원본 저장소)와 npm 레지스트리 배포 정보다.

요약: 런타임·패키지 매니저·CI 액션을 현재 권장 버전과 설치 방식으로 올렸고(Node 26 LTS, pnpm 12, `pnpm/setup`), 코드는 SDK가 제공하는 타입·헬퍼를 쓰도록 바꿨다. 이미 권장 방식과 같은 부분(Astro 정적 빌드, Tailwind v4 Vite 플러그인, Notion API 2026-03-11)은 그대로 두었다.

## 한눈에 보기

| 영역           | 이전                                                           | 지금                                                                                                |
| -------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Node.js        | 22 (`.nvmrc`, `engines`가 서로 다른 값)                        | 26 LTS, `package.json`의 `devEngines.runtime` 한 곳                                                 |
| pnpm           | 10.28 (corepack), `onlyBuiltDependencies`, `.npmrc`            | 12.16.1, `allowBuilds`, `.npmrc` 삭제                                                               |
| GitHub Actions | checkout v4, pnpm/action-setup v4 + setup-node v4, 태그로 참조 | checkout v7 + `pnpm/setup` v3, wrangler-action v4, 커밋 SHA 고정, Dependabot                        |
| Cloudflare     | wrangler-action이 받는 wrangler, Workers vs Pages TODO         | Workers Static Assets 확정, wrangler를 devDependency로, `$schema`, 관리자 Worker는 `wrangler types` |
| Railway        | 대시보드에서 손으로 설정                                       | `packages/sync/railway.json`(config as code)                                                        |
| Astro          | `process.env`로 환경 변수 읽기                                 | `astro:env` 스키마                                                                                  |
| TypeScript     | 5.9                                                            | 6.0 (7.0은 `astro check`가 아직 지원하지 않음)                                                      |
| Biome          | 린트 규칙 없음(`preset: none`)                                 | 권장 규칙(`recommended`) + `.astro` 예외                                                            |
| Notion SDK     | 오류 코드를 문자열로 비교, 응답 타입 단언                      | `isNotionClientError`·`APIErrorCode`·`ClientErrorCode`, SDK 타입 그대로                             |
| sharp          | `.rotate()`, EXIF 방향을 직접 계산                             | `.autoOrient()`, `metadata().autoOrient`                                                            |
| Drizzle        | `drizzle(client, { schema })`                                  | `drizzle({ client, schema })`                                                                       |
| Vitest         | 4                                                              | 5                                                                                                   |

## 서비스별 내역

### Node.js — 26 LTS

- 근거: Node.js 릴리스 일정(nodejs/Release `schedule.json`). v26은 2026-10-28에 Active LTS가 됐고, v24는 2026-10-20부터 Maintenance LTS, v22는 2027-04-30 지원 종료. 운영에는 Active 또는 Maintenance LTS를 쓰라는 것이 Node.js의 공식 안내다.
- 바꾼 것: `package.json`에 `devEngines.runtime`(`node` `26`, `onFail: error`)을 두고 `.nvmrc`와 `engines`를 지웠다. 이전에는 `.nvmrc`(22.23.4)와 `engines`(`>=22.23.4`)가 따로 있었고, Railpack은 `engines`를 `.nvmrc`보다 먼저 읽어서 Railway에서는 범위의 최신 버전이 깔릴 수 있었다.
- 이 값 하나를 pnpm(버전이 다르면 설치 중단), `pnpm/setup`(Actions), Railpack(Railway)이 모두 읽는다.
- `@types/node`를 26으로 맞췄다.
- 하지 않은 것: `onFail: "download"`(pnpm이 Node를 lockfile에 고정해 내려받음)는 pnpm 문서의 예시지만, musl 빌드 확인을 위해 `unofficial-builds.nodejs.org`에 의존하게 되어 쓰지 않았다. Node는 `pnpm/setup`·Railpack·각자의 설치 도구가 설치한다.

### pnpm — 12

- 근거: pnpm 문서 Installation(pnpm 12가 현재 릴리스 라인, Node 없이 도는 단일 실행 파일), Settings(`.npmrc`에서는 인증·레지스트리·TLS·프록시 설정만 읽음), Settings › Build(`onlyBuiltDependencies`는 v11에서 제거되고 `allowBuilds`로 대체, `strictDepBuilds` 기본 true), Settings › Dependency resolution(`minimumReleaseAge` 기본 1440분).
- 바꾼 것
  - `packageManager: pnpm@12.16.1`. lockfile이 pnpm 버전도 기록한다(`packageManagerDependencies`).
  - `pnpm-workspace.yaml`: `onlyBuiltDependencies` → `allowBuilds`(`esbuild`, `sharp`, `workerd`).
  - `.npmrc` 삭제. 유일한 설정 `auto-install-peers=true`는 pnpm 12에서 `.npmrc`로 읽지 않고, 기본값도 true다.
  - lockfile을 새로 만들었다. 기본 `minimumReleaseAge`(하루) 때문에 하루가 안 된 버전은 그 이전 버전으로 해석된다.
  - README의 `corepack enable` 안내를 지웠다. Node 25부터 corepack이 Node에 들어 있지 않고, pnpm 문서도 `npx get-pnpm`·설치 스크립트·`npm i -g pnpm`을 안내한다.

### GitHub Actions

- 근거: pnpm 문서 Continuous Integration(GitHub Actions는 `pnpm/setup`이 pnpm·Node 설치와 `pnpm install`·캐시를 한 단계로 처리, `actions/setup-node` 불필요), `pnpm/setup` README, `actions/checkout` README(v7), `cloudflare/wrangler-action` README(v4, 기본 Wrangler v4, 이미 설치된 wrangler가 있으면 그것을 씀), GitHub의 Actions 보안 강화 가이드(서드파티 액션은 전체 커밋 SHA로 고정, 쓰지 않는 자격 증명은 남기지 않음).
- 바꾼 것(4개 워크플로 모두)
  - `actions/checkout@v7.0.1`, `persist-credentials: false`(워크플로에서 git push를 하지 않음).
  - `pnpm/action-setup` + `actions/setup-node` + `pnpm install` → `pnpm/setup@v3.1.2`(`cache: true`, `require-lockfile: true`로 `--frozen-lockfile` 설치).
  - `cloudflare/wrangler-action@v4.1.3`. `wranglerVersion`을 비워 두어 각 앱의 devDependency wrangler를 쓴다.
  - 액션은 모두 커밋 SHA로 고정하고 옆에 버전 주석을 단다. `.github/dependabot.yml`이 주 1회 액션 갱신 PR을 열고, 막 나온 버전은 7일 기다린다(`cooldown`).
  - CI Postgres 서비스 이미지는 `postgres:16` 그대로. Railway Postgres 템플릿(`postgres-ssl:latest`)이 아직 16을 가리킨다.

### Cloudflare (Workers Static Assets, Workers, R2, Access)

- 근거: Astro 문서 Deploy › Cloudflare와 Cloudflare 문서 Framework guides › Astro(새 프로젝트는 Pages 대신 Workers, 정적 사이트는 어댑터 없이 `assets.directory`만, wrangler는 프로젝트에 devDependency로 설치), Workers › TypeScript(`@cloudflare/workers-types` 대신 `wrangler types`로 생성한 타입을 권장, 생성 파일은 커밋하고 CI에서 확인), R2 › aws-sdk-js-v3 예시와 R2 S3 API 호환 표.
- 바꾼 것
  - `apps/web`: Workers Static Assets로 확정(README의 TODO 제거), `wrangler`를 devDependency로, `deploy` 스크립트, `wrangler.jsonc`에 `$schema`.
  - `apps/admin`: `@cloudflare/workers-types` 제거, `wrangler types --include-env=false`로 `worker-configuration.d.ts` 생성·커밋(호환성 날짜·`nodejs_compat`에 맞는 런타임 타입). `typecheck`가 `wrangler types --check`로 생성 파일이 최신인지 먼저 본다. `Env`는 대시보드에서 넣는 Secret이 있어 기존 `src/env.ts`를 그대로 쓴다. `wrangler.jsonc`에 `$schema`.
  - R2: 404 판별을 `S3ServiceException` 타입으로 바꿨다. `requestChecksumCalculation: 'WHEN_REQUIRED'`는 유지했다. R2 호환 표에서 CRC32는 COMPOSITE만 지원하고, SDK 기본값은 단일 PUT에 전체 객체 CRC32를 보내기 때문이다.
  - (이후 변경) R2는 결제 수단 등록이 필요해 쓰지 않기로 했다. 사진은 Postgres `image_files`에 WebP로 두고, Astro 정적 엔드포인트(`src/pages/img/[...file].ts`, `getStaticPaths`)가 빌드 때 `dist/img/`로 내보내 Workers Static Assets로 함께 배포한다. 정적 출력에서 HTML이 아닌 파일을 만드는 Astro 공식 방식이고, `/img/*`는 `_headers`로 1년 immutable 캐시. `@aws-sdk/client-s3`와 `R2_*` 환경 변수는 지웠다.
- 건드리지 않은 것: Cloudflare Access 검증 로직과 관리자 Worker 동작(관리자 스레드 담당). 관리자 Worker가 Postgres에 직접 연결하는데, Cloudflare는 Workers에서 Postgres를 쓸 때 Hyperdrive를 권장한다. 코드는 이미 `HYPERDRIVE` 바인딩이 있으면 쓰도록 되어 있으니 바인딩만 만들면 된다(선택).

### Railway (Postgres, Cron)

- 근거: Railway 문서 Config as Code(`railway.json`, 코드 설정이 대시보드보다 우선), Cron Jobs(작업 후 연결을 닫고 종료해야 다음 실행이 돈다, 최소 5분 간격, UTC), Monorepo(공유 모노레포는 Config File 경로를 절대 경로로 지정), Railpack Node(Node 버전은 `devEngines.runtime` → `engines` → `.nvmrc` 순, pnpm 버전은 `packageManager`).
- 바꾼 것: `packages/sync/railway.json` 추가. Railpack 빌더, 빌드 단계는 `@luna/sync` typecheck(루트 `build` 스크립트인 사이트 빌드가 sync 서비스에서 돌지 않게), 시작 `pnpm --filter @luna/sync start`, Cron `*/15 * * * *`, 재시작 정책 `NEVER`(실패해도 15분 뒤 다음 실행이 다시 시도), 배포를 일으키는 경로(`packages/sync`, `packages/db`, lockfile 등).
- 직접 할 일: Railway `sync` 서비스 Settings → Config-as-code → Railway Config File에 `/packages/sync/railway.json` 입력.
- 하지 않은 것: `preDeployCommand`로 마이그레이션. 이미 `deploy.yml`이 빌드 전에 `pnpm db:migrate`를 하므로 두 곳에서 동시에 돌지 않게 했다.

### Astro 7 (+ React, Tailwind v4, GSAP)

- 근거: Astro 문서 Environment variables(`astro:env` 스키마로 타입 안전하게), Upgrade to v7, Styling(Tailwind v4는 `@tailwindcss/vite` 플러그인), `@astrojs/react` 7.
- 바꾼 것: `astro.config.mjs`에 `env.schema`(`DATABASE_URL` secret, `LUNA_DATA_SOURCE` enum `db|mock`, `CI` boolean; `R2_PUBLIC_URL`은 R2를 쓰지 않게 되며 뺐다). `lib/data`·`lib/image`가 `astro:env/server`에서 읽는다. 값이 형식에 맞지 않으면(예: `LUNA_DATA_SOURCE=nope`) 빌드가 시작 전에 멈춘다. `SITE_URL`은 설정 파일 안에서 쓰여 `astro:env`로 읽을 수 없어 그대로 `process.env`.
- 확인만 한 것: v7 업그레이드 가이드의 항목(실험 플래그, Rust 컴파일러, `compressHTML: 'jsx'` 기본값)에 걸리는 곳은 없고 빌드가 통과한다. Tailwind v4(`@tailwindcss/vite` + `@import "tailwindcss"` + `@theme`), React 19.3 섬, GSAP 동적 import + `registerPlugin`은 이미 권장 방식이다.
- 하지 않은 것: 프론트엔드 성능 작업(React Compiler, 하이드레이션 지시어, 캐시 헤더 등)과 달빛 커서는 다른 스레드 담당이라 건드리지 않았다.

### Drizzle ORM + postgres.js

- 근거: Drizzle 문서(드라이버 초기화는 `drizzle({ client })` 객체 형태), npm 배포 정보(Drizzle 안정판은 0.45.4, 1.0은 아직 RC), postgres.js CHANGELOG(4.0.0).
- 바꾼 것: `drizzle({ client, schema })`(`packages/db`), `drizzle({ client })`(`apps/admin`). `postgres`를 `^3.4.9`로.
- 하지 않은 것
  - Drizzle 1.0 RC: 안정판이 아니다.
  - postgres.js 4.0: 2026-10-29에 나와 pnpm의 하루 대기에 걸리고, 파라미터 타입 추론(`infer: false` 기본), `sql.array()` 제거 같은 동작 변경을 Drizzle이 아직 공식적으로 맞추지 않았다. 3.4.9에는 4.0의 보안 수정(NUL 문자, `__proto__` 열)이 함께 들어 있다. Drizzle이 4.x 지원을 밝히면 올린다.
  - `serial` → identity 열: Postgres·Drizzle 문서가 identity 열을 권장하지만, 이미 만든 테이블의 기본 키를 바꾸는 마이그레이션이 필요하다. 운영 DB에 적용되는 일이라 따로 결정한다.

### Notion API (2026-03-11, `@notionhq/client` 5.30)

- 근거: notion-sdk-js README(2026-03-11 버전, `isNotionClientError`·`APIErrorCode`·`ClientErrorCode`로 오류 구분, 자동 재시도 옵션, `iterateAllDataSourceRows`).
- 이미 맞던 것: `notionVersion: '2026-03-11'`, `dataSources.query`, `in_trash`.
- 바꾼 것: 문자열 오류 코드(`'object_not_found'` 등)를 SDK 열거형으로, `databases.retrieve` 실패 판별을 `isNotionClientError`로, 쿼리 응답의 `request_status`를 타입 단언 없이 SDK 타입 그대로.
- 그대로 둔 것: SDK 자체 재시도는 끄고 공유 대기열이 재시도한다. SDK 재시도는 대기열을 거치지 않아 속도 제한을 넘길 수 있다(`packages/sync/README.md` "속도 제한"). 1만 행 상한을 넘는 조회용 `iterateAllDataSourceRows`는 지금 규모에 필요 없고, 상한에 걸리면 삭제하지 않고 멈추는 기존 안전장치를 유지한다.

### sharp 0.35

- 근거: sharp 타입 정의의 API 문서(`autoOrient()`는 인자 없는 `rotate()`의 별칭으로 목적을 분명히 하려고 추가, `metadata().autoOrient`는 EXIF 방향을 반영한 크기).
- 바꾼 것: `.rotate()` → `.autoOrient()`, 표시 크기 계산을 `metadata().autoOrient`로(방향 값으로 가로·세로를 직접 바꾸던 코드 제거).

### Biome 2.6

- 근거: Biome 설정 스키마(`linter.rules.preset`: `recommended`가 기본, `none`은 규칙 없음), `.vue`·`.svelte`·`.astro`의 기존 처리 방식은 스크립트 부분만 보므로 템플릿에서 쓰는 변수를 못 본다.
- 바꾼 것: `preset: none` → `recommended`. `.astro`에서만 `noUnusedVariables`·`noUnusedImports`·`useConst`·`useImportType`을 끔. SVG 에셋은 린트 제외. `noNonNullAssertion`은 끔(`noUncheckedIndexedAccess` 때문에 `!`는 의도한 표시). 권장 규칙이 찾은 두 곳을 고쳤다: `ScrollIntro.astro`의 식 안 대입, `FilterControl.tsx`의 `role="radio"`(WAI-ARIA 라디오 그룹 패턴이라 이유를 적고 예외 처리). 생성 파일 `worker-configuration.d.ts`는 검사에서 뺀다.
- 하지 않은 것: `html.experimentalFullSupportEnabled`(`.astro` 템플릿까지 검사)는 아직 실험 기능이다.

### TypeScript 6.0

- 근거: npm 배포 정보(최신은 7.0.2), `@astrojs/check` 0.9.12의 peer 범위 `typescript ^5 || ^6`.
- 바꾼 것: 모든 패키지를 `~6.0.3`으로. TS 6부터 `types` 기본값이 빈 배열이라 `tsconfig.base.json`에 `"types": ["node"]`를 넣었다.
- 하지 않은 것: TS 7. `astro check`가 지원하면 올린다.

### Vitest 5

- 근거: Vitest 5 마이그레이션 가이드. 이 저장소가 쓰는 기능(기본 설정, `describe.skipIf`, mock)은 바뀐 항목에 걸리지 않는다.
- 바꾼 것: `packages/sync`, `apps/admin`을 `^5.0.5`로.

## 확인한 것

로컬(Node 26.13.0, pnpm 12.16.1, Postgres 16)에서 CI와 같은 순서로 확인했다: `pnpm lint`, `pnpm typecheck`(TS 6, `astro check`, `wrangler types --check`), 마이그레이션 적용과 스키마 일치, `pnpm test`(DB 테스트 포함), `pnpm build`(DB·목업 두 경로, `R2_PUBLIC_URL`로 이미지 주소 생성 확인, 잘못된 `LUNA_DATA_SOURCE`는 빌드 전에 멈춤), 관리자 Worker와 사이트의 `wrangler deploy --dry-run`.

## 사람이 할 일

- 로컬: pnpm 12(`npx get-pnpm`)와 Node 26 설치. 다른 버전이면 `pnpm install`이 알려 준다.
- Railway `sync` 서비스: Railway Config File에 `/packages/sync/railway.json`.
- 나중에 결정: `serial` → identity 열 마이그레이션, postgres.js 4.x(Drizzle 지원 확인 뒤), TypeScript 7(`astro check` 지원 뒤).
