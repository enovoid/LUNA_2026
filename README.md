# LUNA 2026

IT 소셜벤처 동아리 루나의 소개 사이트. 운영진은 Notion에서 글과 사진을 관리하고, 바뀐 내용은 자동으로 정적 사이트에 반영된다.

```
Railway 서비스 하나(apps/admin)
  ├ 15분마다 Notion 동기화(변경분만) ─→ Railway Postgres (글, WebP 사진)
  ├ 바뀐 게 있으면 Astro 빌드(Postgres 읽기) ─→ 새 정적 파일로 교체
  ├ /        공개 사이트: 미리 만든 파일만 내보냄(압축·캐시)
  └ /admin/  관리자 페이지(Google 로그인): 동기화 상태, 모집·연락처 설정
```

방문자 요청은 Notion에도 DB에도 닿지 않는다. Notion은 동기화만 읽고, 사이트는 DB에 저장된 내용으로 미리 만든다. 모집 정보·연락처처럼 Notion에 없는 값은 관리자 페이지에서 고치고, 저장하면 사이트가 다시 만들어진다.

## 구성

| 경로            | 역할                                                                       |
| --------------- | -------------------------------------------------------------------------- |
| `apps/web`      | Astro 정적 사이트 (`@luna/web`)                                            |
| `apps/admin`    | Railway 사이트 서버: 공개 사이트·관리자 페이지·동기화·빌드 (`@luna/admin`) |
| `packages/db`   | Drizzle 스키마·마이그레이션 (`@luna/db`)                                   |
| `packages/sync` | Notion → Postgres 동기화, 사진 WebP 변환 (`@luna/sync`)                    |

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

## CI / 배포

| 무엇              | 언제                    | 하는 일                                                                                                 |
| ----------------- | ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `ci.yml`          | PR, main 외 브랜치 푸시 | Biome, typecheck, 임시 Postgres에 마이그레이션 적용 + 스키마 일치 확인, 테스트, 빌드                    |
| Railway 자동 배포 | main 푸시               | 루트 [`railway.json`](railway.json): 빌드 → `pnpm db:migrate` → 서버 시작 → 사이트를 만들면 트래픽 전환 |

CI는 `pnpm/setup`으로 pnpm·Node를 `package.json`에서 읽어 설치한다(`actions/setup-node` 없음). 액션은 커밋 SHA로 고정하고 Dependabot(`.github/dependabot.yml`)이 주 1회 갱신 PR을 연다. 서비스별 공식 권장 방식과 맞춘 내역은 [`docs/official-recommendations-2026-10.md`](docs/official-recommendations-2026-10.md)(Cloudflare 배포 시절 기록).

## 설정 체크리스트 (직접 해야 하는 클릭 작업)

### Notion

- [ ] 읽기 전용 integration 생성 → 토큰을 `NOTION_TOKEN`에
- [ ] "Notion API" 페이지의 Members·Awards·Projects·FAQ 4개 DB에 integration 연결(Share/Connections)
- [ ] 각 DB ID를 `NOTION_DB_MEMBERS` `NOTION_DB_AWARDS` `NOTION_DB_PROJECTS` `NOTION_DB_FAQ`에

### Railway

- [ ] [`apps/admin/README.md`](apps/admin/README.md)의 "Railway 설정 체크리스트": Postgres, 저장소 연결 서비스 하나, 변수(`DATABASE_URL`, `GOOGLE_CLIENT_ID`·`SECRET`, `ADMIN_EMAILS`, `NOTION_*`), 도메인, Google 로그인 만들기
- 사진은 별도 저장소 없이 Postgres `image_files`에 두고, 빌드가 `/img/` 정적 파일로 꺼낸다

## 남은 TODO

- 사이트 도메인, 창립 연도, 인트로 사진 라이선스 확인
- 모집 정보, 연락처·SNS는 관리자 페이지에서 입력
- 다크 모드, Lighthouse 측정
