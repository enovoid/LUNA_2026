# @luna/admin — 운영진 관리자 페이지

글과 사진은 계속 Notion에서 관리한다. 이 페이지는 Notion이 못 하는 일만 한다.

| 화면          | 하는 일                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------- |
| Notion 동기화 | DB별 마지막 실행·결과·오류(`sync_state`), 지금 실행 중인지, "지금 다시 동기화"(`--full` 선택) |
| 사이트 배포   | 최근 배포 기록, "사이트 다시 배포"                                                            |
| 모집 정보     | 기수·기간·대상·지원서 링크. 저장하면 사이트 배포가 바로 시작된다                              |
| 연락처·SNS    | 푸터의 이메일·Instagram·GitHub. 저장하면 사이트 배포가 바로 시작된다                          |

```
운영진 브라우저 ─→ Cloudflare Access(허용한 이메일만) ─→ luna-admin Worker ─┬→ Railway Postgres (sync_state 읽기, site_settings 쓰기)
                                                                              └→ GitHub Actions (sync.yml, deploy.yml 실행·기록 조회)
```

공개 사이트(`apps/web`)는 이 Worker를 거치지 않는다. 사이트는 여전히 빌드할 때만 DB를 읽는다.

## 권한

- 로그인은 직접 만들지 않고 **Cloudflare Access**에 맡긴다. 허용 목록에 있는 이메일만 들어온다(Zero Trust Free 50명까지 무료).
- Worker도 모든 요청에서 Access JWT(`Cf-Access-Jwt-Assertion`)를 다시 검증한다: 팀 공개 키로 서명, 발급자(팀 도메인), AUD, 만료, 이메일. Access 설정이 빠지거나 workers.dev 주소로 직접 들어와도 403이다. `ACCESS_TEAM_DOMAIN`·`ACCESS_AUD`가 비어 있으면 아무도 못 들어온다.
- 쓰기(POST)는 같은 출처에서 보낸 폼만 받는다(`Origin` 확인, CSRF 방지).
- 화면은 `no-store`, `noindex`, CSP(`default-src 'none'`, 스크립트 없음), `frame-ancestors 'none'`.
- 누가 설정을 바꿨는지 `site_settings.updated_by`에 Access 이메일로 남고 화면에 보인다.

## "지금 다시 동기화"는 어떻게 도나

버튼은 GitHub Actions `sync.yml`(workflow_dispatch)을 실행한다. 평소처럼 15분마다 도는 Railway Cron과 같은 코드(`@luna/sync`)다.
두 실행이 겹치지 않도록 동기화는 시작할 때 `sync_state`의 `_running` 행을 잡는다. 이미 잡혀 있으면 나중에 시작한 쪽이 "다른 동기화가 실행 중"이라고 남기고 건너뛴다. 프로세스가 죽어 풀지 못한 잠금은 30분 뒤 다음 실행이 가져간다.

## 설정 체크리스트 (Cloudflare·GitHub에서 직접 할 클릭)

루트 README의 GitHub Secrets(`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DATABASE_URL`)가 먼저 있어야 한다.

### 1. GitHub

- [ ] **Actions Secrets 추가**(Settings → Secrets and variables → Actions): 수동 동기화가 GitHub에서 돌기 때문에 Railway `sync` 서비스와 같은 값이 필요하다. `NOTION_TOKEN`, `NOTION_DB_MEMBERS`, `NOTION_DB_AWARDS`, `NOTION_DB_PROJECTS`, `NOTION_DB_FAQ`
- [ ] **관리자용 fine-grained token** 만들기(GitHub → Settings → Developer settings → Fine-grained tokens): Repository access는 이 저장소만, Permissions는 **Actions: Read and write** 하나. Railway의 `GITHUB_DISPATCH_TOKEN`과 따로 둔다.

### 2. Worker 배포

- [ ] 이 PR이 main에 병합되면 `Deploy admin` 워크플로가 `luna-admin` Worker를 배포한다(실패하면 Actions 탭에서 다시 실행).

### 3. Cloudflare Zero Trust(Access)

- [ ] Cloudflare 대시보드 → **Zero Trust** 처음 열기 → 팀 이름 정하기 → **Free** 플랜 선택(결제 수단 등록을 요구할 수 있지만 50명까지 무료)
- [ ] 로그인 방법: 기본인 **One-time PIN**(이메일로 받은 코드)이면 따로 할 것 없음. 운영진 Google 계정으로 들어오게 하려면 Zero Trust → Settings → Authentication → Login methods에서 Google 추가
- [ ] Workers & Pages → **luna-admin** → Settings → **Domains & Routes** → `workers.dev` 줄의 **Cloudflare Access 켜기**. Access 애플리케이션이 자동으로 만들어진다
- [ ] Zero Trust → Access → **Applications** → 방금 생긴 luna-admin 애플리케이션 → **Policies**: Action `Allow`, Include `Emails`에 운영진 이메일을 한 줄씩. 사람이 바뀌면 여기만 고친다
- [ ] 같은 애플리케이션 화면(Overview)의 **Application Audience (AUD) Tag**를 복사, Zero Trust → Settings에서 **Team domain**(`<팀>.cloudflareaccess.com`) 확인

### 4. Worker 변수

luna-admin → Settings → **Variables and Secrets** → Add. `wrangler.jsonc`의 `keep_vars` 덕분에 다시 배포해도 지워지지 않는다.

| 이름                 | 종류   | 값                                                                                       |
| -------------------- | ------ | ---------------------------------------------------------------------------------------- |
| `ACCESS_TEAM_DOMAIN` | Text   | `https://<팀>.cloudflareaccess.com`                                                      |
| `ACCESS_AUD`         | Text   | 위 AUD Tag. Access 애플리케이션이 둘이면(workers.dev와 사이트 도메인) 쉼표로 이어 적는다 |
| `SITE_URL`           | Text   | (선택) 공개 사이트 주소. 화면 위쪽 "사이트 열기" 링크                                    |
| `DATABASE_URL`       | Secret | Railway Postgres **공개(TCP proxy)** 주소. GitHub Secret `DATABASE_URL`과 같은 값        |
| `GITHUB_TOKEN`       | Secret | 1단계에서 만든 관리자용 fine-grained token                                               |

- [ ] 저장 뒤 `https://luna-admin.<계정>.workers.dev/admin/` 에 운영진 이메일로 들어가 보기. 허용하지 않은 이메일은 Access 화면에서 막혀야 한다

### 5. (도메인을 정한 뒤) 사이트 주소 아래 `/admin`으로 옮기기

- [ ] `wrangler.jsonc`의 `routes` 주석을 풀어 `<도메인>/admin*`로 바꾸고 병합(Worker 경로 라우트는 같은 호스트의 Custom Domain보다 먼저 잡힌다)
- [ ] Zero Trust → Access → Applications → **Add an application** → Self-hosted, 도메인 `<도메인>`, 경로 `admin`(하위 경로 포함), 3단계와 같은 정책
- [ ] 새 애플리케이션의 AUD를 `ACCESS_AUD`에 쉼표로 덧붙이기
- [ ] 다 되면 luna-admin → Domains & Routes에서 `workers.dev`를 끈다

Worker가 JWT를 직접 검증하므로 중간에 하나를 빠뜨려도 열리지 않고 403으로 막힌다(잘못 설정하면 "안 열림" 쪽으로 실패한다).

### (선택) Hyperdrive

DB 연결이 느리게 느껴지면 Hyperdrive를 만들어 `wrangler.jsonc`에 `"hyperdrive": [{ "binding": "HYPERDRIVE", "id": "…" }]`를 추가한다. 바인딩이 있으면 `DATABASE_URL`보다 먼저 쓴다. 운영진 몇 명이 가끔 여는 화면이라 처음엔 필요 없다.

## 로컬 실행

```bash
cp apps/admin/.dev.vars.example apps/admin/.dev.vars   # 값 채우기(커밋하지 않음)
pnpm --filter @luna/admin dev                          # http://localhost:8787/admin/
pnpm --filter @luna/admin test
```

`DEV_ACCESS_EMAIL`은 주소가 `localhost`·`127.0.0.1`일 때만 쓰인다. 배포된 Worker에 넣어도 무시된다.

## 예외 처리

| 상황                                  | 동작                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------- |
| Access 토큰 없음·만료·다른 앱·다른 팀 | 403. 로그에 이유                                                          |
| DB 연결 실패                          | 해당 구역에만 오류를 보이고 GitHub 구역은 그대로. 설정 저장 버튼은 꺼진다 |
| GitHub 호출 실패(토큰·권한)           | 해당 구역에 오류, 버튼을 누르면 "GitHub Actions를 부르지 못했어요" 안내   |
| 설정 값이 잘못됨(http 링크, 긴 값 등) | 저장하지 않고 입력을 유지한 채 무엇을 고칠지 보여 준다                    |
| 저장은 됐는데 배포 호출 실패          | 그 사실을 알리고 "사이트 다시 배포"를 누르게 한다                         |
| 동기화가 1시간 넘게 안 돎             | 해당 DB 줄에 "1시간 넘게 멈춤" 표시(Railway Cron 확인)                    |
| 수동 동기화와 Cron이 겹침             | 나중에 시작한 쪽이 건너뜀(`_running` 잠금)                                |
