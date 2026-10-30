# LUNA 2026

IT 소셜벤처 동아리 루나의 소개 사이트. 운영진은 Notion에서 글과 사진을 관리하고, 바뀐 내용은 자동으로 정적 사이트에 반영된다.

```
Notion ─(15분마다 변경분만)→ Railway Cron(sync) ─→ Railway Postgres
                                   └─→ 이미지 WebP 변환 → Postgres(image_files)
                                   └─→ 변경 있으면 repository_dispatch
GitHub Actions: Astro 빌드(Postgres에서 글·사진 읽기) → Cloudflare 정적 배포(사진은 /img/)

운영진 ─ Cloudflare Access ─→ 관리자 Worker(/admin) ─→ Postgres(동기화 상태, 모집·연락처 설정)
                                                     └→ GitHub Actions(수동 동기화, 다시 배포)
```

방문자 요청은 Notion에도 DB에도 닿지 않는다. 모집 정보·연락처처럼 Notion에 없는 값은 관리자 페이지에서 고치고, 저장하면 사이트가 다시 빌드된다.

## 구성

| 경로            | 역할                                                    |
| --------------- | ------------------------------------------------------- |
| `apps/web`      | Astro 정적 사이트 (`@luna/web`)                         |
| `apps/admin`    | 운영진 관리자 Worker (`@luna/admin`)                    |
| `packages/db`   | Drizzle 스키마·마이그레이션 (`@luna/db`)                |
| `packages/sync` | Notion → Postgres 동기화, 사진 WebP 변환 (`@luna/sync`) |

## 로컬 실행

필요: Node 26 LTS, pnpm 12, 로컬 Postgres. 두 버전은 루트 `package.json`의 `devEngines.runtime`(Node)과 `packageManager`(pnpm) 한 곳에서 정하고, GitHub Actions(`pnpm/setup`)와 Railway(Railpack)도 같은 값을 읽는다.

- pnpm 설치: `npx get-pnpm` 또는 `npm install -g pnpm@latest` (pnpm 12는 Node 없이 도는 단일 실행 파일이다. Node 25부터 corepack이 Node에 들어 있지 않아 `corepack enable`은 쓰지 않는다)
- Node 설치: `pnpm runtime set node 26` 또는 nvm·fnm 등. 다른 버전이면 `pnpm install`이 멈추고 알려 준다
- 새로 나온 지 하루가 안 된 패키지 버전은 설치하지 않는다(pnpm 기본값 `minimumReleaseAge`, 공급망 사고 대비)

```bash
pnpm install
cp .env.example .env        # 값을 채운다. .env는 커밋하지 않는다
export DATABASE_URL=postgres://...   # 또는 .env를 로드
pnpm db:migrate             # 마이그레이션 적용
pnpm dev                    # 사이트 개발 서버
```

| 명령                          | 설명                                                               |
| ----------------------------- | ------------------------------------------------------------------ |
| `pnpm lint` / `pnpm lint:fix` | Biome 검사 / 자동 수정 (lint + format + import 정렬)               |
| `pnpm format`                 | Biome 포맷                                                         |
| `pnpm typecheck`              | 모든 패키지 타입 검사 (`tsc`, 웹은 `astro check`)                  |
| `pnpm build`                  | 사이트 빌드                                                        |
| `pnpm db:generate`            | `packages/db/src/schema.ts` 변경 뒤 새 마이그레이션 생성           |
| `pnpm db:migrate`             | `DATABASE_URL`에 마이그레이션 적용                                 |
| `pnpm test`                   | 모든 패키지 테스트 (Vitest)                                        |
| `pnpm sync`                   | Notion → Postgres 동기화 (`--full`, `--dry-run`, `--check-schema`) |

### 스키마를 바꿀 때

`schema.ts`를 고친 뒤 `pnpm db:generate`로 SQL을 만들고 `packages/db/drizzle/`까지 함께 커밋한다. CI가 스키마와 마이그레이션이 어긋나면 실패시킨다.

## Biome 사용 메모

lint·format은 ESLint/Prettier 대신 Biome 하나로 쓴다. 한 가지 한계: **Biome는 `.astro` 파일의 frontmatter(`---` 안쪽 TypeScript)만 부분적으로 지원**하고 템플릿 부분은 검사하지 않는다. 그래서 `.astro` 템플릿과 타입은 `astro check`(`pnpm typecheck`)가 맡는다. 그래서 `biome.json`은 Biome 권장 규칙(`recommended`)을 켜고, `.astro` 파일만 `overrides`로 템플릿에서 쓰는 변수를 못 보는 규칙(`noUnusedVariables`, `noUnusedImports`, `useConst`, `useImportType`)을 끈다. `noNonNullAssertion`은 끈다(`noUncheckedIndexedAccess`를 켜 둬서 `!`는 일부러 쓰는 표시다).

## 커밋 컨벤션

[Conventional Commits](https://www.conventionalcommits.org/ko/v1.0.0/)를 따른다: `<type>(<scope>): <설명>`

- type: `feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore` `revert`
- scope(선택): `web` `db` `sync` `ci` 등. 예: `feat(db): members 테이블에 sort 열 추가`
- 설명은 한글이어도 되고, 제목은 마침표 없이 짧게. 본문에 이유를 적는다.
- 하위 호환이 깨지면 `feat!:` 또는 본문에 `BREAKING CHANGE:`.
- 커밋 메시지에 **세션·계정 정보**(`Claude-Session:`·`Co-Authored-By:` 트레일러, 세션 링크, 이메일 주소)를 넣지 않는다.
- PR 단위로 CI(`commitlint`)가 PR의 모든 커밋 메시지를 검사한다.

## CI / 배포 (GitHub Actions)

| 워크플로           | 언제                                                                                 | 하는 일                                                                      |
| ------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `ci.yml`           | PR, main 외 브랜치 푸시                                                              | Biome, typecheck, 임시 Postgres에 마이그레이션 적용 + 스키마 일치 확인, 빌드 |
| `deploy.yml`       | main 푸시, `repository_dispatch`(`content-updated`), 주 1회 예약(일 18:00 UTC), 수동 | 검사 → DB 마이그레이션 → 빌드(Postgres 읽기) → Cloudflare 배포               |
| `sync.yml`         | 관리자 페이지의 "지금 다시 동기화", 수동                                             | Notion → Postgres 동기화(Railway Cron과 같은 코드, 겹치면 건너뜀)            |
| `deploy-admin.yml` | main 푸시 중 `apps/admin`·`packages/db` 변경, 수동                                   | 관리자 Worker 배포                                                           |

모든 워크플로는 `pnpm/setup`으로 pnpm·Node를 `package.json`에서 읽어 설치한다(`actions/setup-node` 없음). 액션은 커밋 SHA로 고정하고 Dependabot(`.github/dependabot.yml`)이 주 1회 갱신 PR을 연다. 서비스별 공식 권장 방식과 맞춘 내역은 [`docs/official-recommendations-2026-10.md`](docs/official-recommendations-2026-10.md).

GitHub 저장소 **Settings → Secrets and variables → Actions**에 등록: `DATABASE_URL`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. 수동 동기화(`sync.yml`)를 쓰려면 Notion 값도 필요하다([`apps/admin/README.md`](apps/admin/README.md)).
배포 때 `pnpm db:migrate`가 먼저 돌아 새 마이그레이션이 자동으로 적용된다.
`DATABASE_URL`은 Railway Postgres의 **공개(TCP proxy) 주소**여야 GitHub 러너에서 접속된다.

## 설정 체크리스트 (직접 해야 하는 클릭 작업)

### Notion

- [ ] 읽기 전용 integration 생성 → 토큰을 `NOTION_TOKEN`에
- [ ] "Notion API" 페이지의 Members·Awards·Projects·FAQ 4개 DB에 integration 연결(Share/Connections)
- [ ] 각 DB ID를 `NOTION_DB_MEMBERS` `NOTION_DB_AWARDS` `NOTION_DB_PROJECTS` `NOTION_DB_FAQ`에

### Railway

- [ ] 프로젝트 생성 → **Postgres** 추가
- [ ] Postgres의 **TCP Proxy(공개 네트워크)** 켜기 → 외부용 URL을 GitHub Secret `DATABASE_URL`에 (Railway 내부 서비스끼리는 내부 URL 사용)
- [ ] 처음 한 번 `DATABASE_URL`을 외부 URL로 두고 로컬에서 `pnpm db:migrate`
- [ ] 저장소 연결로 서비스 추가(`sync`): Root Directory는 저장소 루트(비워 둠), Settings → **Config-as-code → Railway Config File**에 `/packages/sync/railway.json` 입력. 빌드·시작 명령, Cron Schedule(`*/15 * * * *`, UTC), 재시작 정책(NEVER), 배포를 일으키는 경로가 이 파일에 있고 대시보드 값보다 우선한다 (자세한 동작은 [`packages/sync/README.md`](packages/sync/README.md))
- [ ] `sync` 서비스 Variables: `NOTION_TOKEN`, `NOTION_DB_*`, `DATABASE_URL`(내부 참조 `${{Postgres.DATABASE_URL}}`), `GITHUB_DISPATCH_TOKEN`
- [ ] Cron 서비스는 실행이 끝나면 프로세스가 종료된다. sync는 성공 0, 일부 실패 1, 시작 불가(설정·스키마 문제) 2로 끝나니 Railway에서 실패한 실행을 볼 수 있다

### Cloudflare

- [ ] 배포용 API 토큰(Workers 편집 권한) → GitHub Secret `CLOUDFLARE_API_TOKEN`, 계정 ID `CLOUDFLARE_ACCOUNT_ID`
- [ ] 사이트 도메인 연결(Workers → Settings → Domains) 후 `apps/web/astro.config.mjs`의 `site` 지정
- 사이트는 Pages가 아니라 **Workers Static Assets**로 배포한다. Cloudflare·Astro 문서 모두 새 프로젝트에 Workers를 권장한다(`apps/web/wrangler.jsonc`). wrangler는 `apps/web` devDependency라 로컬(`pnpm --filter @luna/web deploy`)과 Actions가 같은 버전을 쓴다
- 사진은 R2 같은 별도 저장소 없이 Postgres `image_files`에 두고, 빌드가 `dist/img/`로 꺼내 사이트와 함께 배포한다(결제 수단 없이 쓸 수 있는 구성). 무료 플랜의 정적 파일 한도(버전당 2만 개, 파일당 25MiB)에 비해 사진 한 장이 파일 3개라 여유가 크다

### GitHub

- [ ] fine-grained token(이 저장소만, **Contents: Read and write** 권한 — `repository_dispatch`에 필요) → Railway `GITHUB_DISPATCH_TOKEN`
- [ ] Actions Secrets 등록(위 목록)

### 관리자 페이지

- [ ] [`apps/admin/README.md`](apps/admin/README.md)의 "설정 체크리스트": GitHub Secrets 추가, 관리자용 토큰, Zero Trust(Access) 켜기, 운영진 이메일 허용, Worker 변수

## 남은 TODO

- 사이트 도메인, 창립 연도, 인트로 사진 라이선스 확인
- 모집 정보, 연락처·SNS는 관리자 페이지에서 입력
- 다크 모드, Lighthouse 측정
