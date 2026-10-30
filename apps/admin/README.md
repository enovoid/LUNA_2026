# @luna/admin — 사이트 서버 (Railway)

Railway 서비스 하나가 다음을 모두 맡는다. 주소도 하나다(`/`는 공개 사이트, `/admin/`은 관리자 페이지).

| 일                 | 어떻게                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| 공개 사이트        | Astro가 DB를 읽어 미리 만든 HTML·사진 파일을 그대로 내보낸다. 방문자 요청은 Notion에도 DB에도 닿지 않는다(`site.ts`)      |
| 사이트 다시 만들기 | 서버 시작 때, 동기화로 바뀐 게 있을 때, 관리자 페이지에서 저장했을 때, 매일 0시(한국 시간). 실패하면 이전 사이트가 남는다 |
| Notion 동기화      | 15분마다 `@luna/sync`를 자식 프로세스로 실행(`jobs.ts`). 관리자 페이지의 "지금 다시 동기화"도 같은 경로                   |
| 관리자 페이지      | 멤버·수상·프로젝트·FAQ 추가·수정·삭제(사진 포함), Notion 내보내기 zip 가져오기, 모집 정보, 연락처·SNS, 작업 기록          |

```
Notion ─(15분마다, 바뀐 페이지만)→ [이 서버: sync 자식 프로세스] ─→ Railway Postgres
                                         └ 바뀐 게 있으면 → astro build(새 폴더) → 성공하면 그 폴더로 교체
방문자 ─→ [이 서버] ─→ 미리 만든 파일(압축·캐시 헤더·ETag)
운영진 ─→ [이 서버] /admin/ (Google 로그인) ─→ Postgres(site_settings 쓰기) → 사이트 다시 만들기
```

## 모집 정보

| 칸          | 사이트에 보이는 것                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| 모집 기수   | 멤버 DB의 기수에서 고른다(다음 기수 표시). "모집 안 함"이면 모집 섹션을 숨긴다                            |
| 모집 상태   | "마감"으로 바꾸면 날짜와 상관없이 "모집 마감"으로 보이고 지원하기 버튼이 사라진다                         |
| 시작·마감일 | 시작일 전에는 일정만, 기간 안에는 지원하기 버튼, 마감일 다음 날부터는 "모집 마감". 매일 0시에 다시 만든다 |
| 지원서 링크 | 없으면 지원하기 버튼을 보이지 않는다                                                                      |

## 콘텐츠 직접 관리

- 메뉴의 **멤버·수상·프로젝트·FAQ**에서 목록을 보고 추가·수정·삭제한다(`content.ts`가 칸과 검사 규칙, `store.ts`가 DB). 동기화·가져오기와 같은 테이블이다.
- 여기서 만든 행의 `notion_id`는 `admin:<uuid>`다. Notion 동기화와 가져오기는 이 행을 지우지 않는다.
- Notion에서 온 행도 고칠 수 있지만, 나중에 Notion에서 그 페이지를 고치면 Notion 내용으로 바뀐다(화면에 안내가 뜬다).
- **사진**: 파일을 고르면 미리 보기가 바로 뜨고 뒤에서 `/admin/upload/<table>`로 올라간다(진행률 표시). 서버는 앞 바이트로 형식(JPG·PNG·WebP·AVIF·GIF)을 확인하고, 20MB·약 5천만 픽셀까지만 받고, 동기화와 같은 방식으로 WebP 480·960·1600으로 다시 만들어 `image_files`에 넣는다(EXIF·GPS 제거, 원본은 저장하지 않음). 올리는 중에 저장을 누르면 끝나는 대로 저장된다. JS가 없으면 폼에 파일이 같이 간다.
- 저장·삭제하면 바로 목록으로 돌아오고 사이트는 뒤에서 다시 만든다. 머리글의 상태 표시("사이트에 반영 중…" → "사이트에 반영됐어요")가 몇 초마다 바뀐다(`/admin/status.json`).
- 저장하지 않은 사진은 Notion 동기화가 유예(기본 2시간) 뒤 지운다.

## Notion 내보내기 가져오기

홈의 "Notion 내보내기 가져오기"에 Notion에서 **Markdown & CSV**로 내보낸 zip(200MB까지)을 올리면, 서버가 파일을 임시 폴더에 두고 `pnpm --filter @luna/sync import:start <zip>`을 작업으로 실행한다. 올리기는 진행률과 함께 바로 끝나고 가져오기는 뒤에서 한다. 성공(0)·일부 성공(1)이면 사이트를 다시 만들고, zip은 끝나면 지운다. 결과는 "최근 작업"에 남는다.

## 로그인과 보안

- **Google 계정**으로 들어온다(OpenID Connect: state·nonce 확인, Google 공개 키로 id_token 서명·발급자·대상 검증, 이메일 확인된 계정만). 공용 비밀번호는 없다.
- 들어올 수 있는 사람: Railway 변수 `ADMIN_EMAILS`(쉼표로 구분, 화면에서 못 지움) + 관리자 화면 "운영진"에서 추가한 이메일(`site_settings`의 `admins`). 사람이 바뀌면 화면에서 추가·빼기만 하면 된다.
- 누가 설정을 바꿨는지 `site_settings.updated_by`에 Google 이메일로 남는다.
- 세션은 서명한 쿠키(`__Host-luna_admin`, HttpOnly·Secure·SameSite=Lax, 12시간). `GOOGLE_CLIENT_SECRET`을 바꾸면 모든 세션이 끊긴다. 요청마다 운영진 목록을 다시 확인하므로 운영진에서 빼면 바로 막힌다.
- 모든 확인은 서버에서 한다. 브라우저로 가는 `admin.js`는 업로드 진행률·상태 표시 같은 편의 기능뿐이고 비밀 값이 없다. 그래서 코드를 난독화해도 보안은 나아지지 않는다(공개 사이트는 Astro가 압축해 내보낸다).
- 쓰기(POST)는 같은 출처에서 보낸 요청만 받는다(`Origin` 확인, CSRF 방지).
- 요청 횟수 제한(`rate-limit.ts`, 서버 메모리): IP마다 분당 300회, 로그인 10분에 20회. 운영진마다 쓰기 분당 60회, 업로드 10분에 60회. 넘으면 429.
- 본문 크기: 폼 64KB, 사진 20MB, zip 200MB. 로그인 확인 전에는 본문을 읽지 않고, 넘으면 그 자리에서 끊는다(`server.ts`).
- 입력은 칸마다 길이·숫자·날짜를 검사하고 제어 문자를 지운다. 화면에 넣는 값은 모두 HTML 이스케이프한다.
- 관리자 응답 헤더: `no-store`, `noindex`, CSP(`script-src 'self'`, 인라인 스크립트·스타일 금지, `frame-ancestors 'none'`, `form-action 'self'`), HSTS, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `Permissions-Policy`.

## Railway 설정 체크리스트

설정 파일은 저장소 루트의 [`railway.json`](../../railway.json)이다(빌드·시작 명령, 배포 전 `pnpm db:migrate`, `/health` 확인). 대시보드에서 따로 고칠 명령은 없다.

1. [ ] Railway 프로젝트에 **Postgres**가 있는지 확인(없으면 New → Database → PostgreSQL)
2. [ ] New → **GitHub Repo** → `enovoid/LUNA_2026` 선택. Root Directory는 비워 둔다(저장소 루트)
3. [ ] 새 서비스 **Variables**에 추가

   | 이름                                                                        | 값                                                      |
   | --------------------------------------------------------------------------- | ------------------------------------------------------- |
   | `DATABASE_URL`                                                              | `${{Postgres.DATABASE_URL}}` (내부 주소 참조)           |
   | `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET`                                   | 아래 "Google 로그인 만들기"에서 받은 값                 |
   | `ADMIN_EMAILS`                                                              | 처음 들어올 운영진 Google 이메일(쉼표로 구분)           |
   | `NOTION_TOKEN`                                                              | Notion integration 토큰                                 |
   | `NOTION_DB_MEMBERS` `NOTION_DB_AWARDS` `NOTION_DB_PROJECTS` `NOTION_DB_FAQ` | 각 Notion DB ID                                         |
   | `SITE_URL`                                                                  | (선택) 직접 연결한 도메인. 없으면 Railway 도메인을 쓴다 |
   | `SYNC_INTERVAL_MINUTES`                                                     | (선택) 동기화 간격, 기본 15. 0이면 자동 동기화를 끈다   |

4. [ ] Settings → Networking → **Generate Domain**(또는 Custom Domain 연결)
5. [ ] 배포가 끝나면(첫 배포는 사이트를 만드느라 2~4분) `https://<도메인>/`과 `https://<도메인>/admin/` 열어 보기
6. [ ] 예전 `sync` Cron 서비스가 있으면 **삭제**한다. 이제 이 서버가 동기화하고, 따로 돌면 바뀐 내용이 사이트에 반영되지 않는다
7. [ ] 예전 `ADMIN_PASSWORD` 변수가 있으면 지운다(더 이상 쓰지 않음)
8. [ ] (선택) Cloudflare의 `luna-2026`·`luna-admin` Worker 삭제, GitHub Secrets의 `CLOUDFLARE_*` 삭제

### Google 로그인 만들기 (Google Cloud, 무료·카드 없음)

1. [ ] [console.cloud.google.com](https://console.cloud.google.com) → 프로젝트 만들기(예: `luna-admin`)
2. [ ] **Google Auth Platform**(또는 APIs & Services → OAuth consent screen) → 시작하기: 앱 이름 `LUNA 관리자`, 지원 이메일, 대상 **External**
3. [ ] **대상(Audience) → 테스트 사용자**에 운영진 Gmail을 넣는다. 게시(Publish)하려면 브랜딩에 내 도메인·개인정보처리방침이 필요한데 `*.up.railway.app`은 등록할 수 없어서, 내 도메인이 생기기 전에는 "테스트 중"으로 두고 운영진을 테스트 사용자로 넣는다(최대 100명). 운영진을 새로 추가하면 여기에도 넣는다
4. [ ] **Clients → Create client** → 유형 **Web application** → Authorized redirect URIs에 `https://<도메인>/admin/auth/callback` 추가(Railway 도메인과 내 도메인을 둘 다 쓰면 둘 다)
5. [ ] 만들어진 Client ID와 Client secret을 Railway 변수 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`에 넣는다

배포 순서: Railway가 새 버전을 빌드 → `pnpm db:migrate` → 서버 시작 → 사이트를 다 만들면 `/health`가 200 → 그때 트래픽이 새 버전으로 넘어간다. 사이트를 만들지 못하면 새 버전은 실패로 끝나고 이전 버전이 계속 응답한다.

## 로컬 실행

```bash
# .env(apps/admin/.env)에 DATABASE_URL, GOOGLE_CLIENT_ID·SECRET, ADMIN_EMAILS, NOTION_* 를 넣는다(커밋하지 않음)
# Google 클라이언트의 redirect URI에 http://localhost:8787/admin/auth/callback 도 추가해 둔다
pnpm --filter @luna/admin dev     # http://localhost:8787/ , http://localhost:8787/admin/
pnpm --filter @luna/admin test
```

DB 없이 화면만 보려면 `LUNA_DATA_SOURCE=mock SYNC_INTERVAL_MINUTES=0`을 함께 준다. 로컬은 HTTPS가 아니라서 `__Host-` 쿠키를 받으려면 `localhost`로 연다(브라우저가 localhost는 Secure 예외로 본다).

## 예외 처리

| 상황                                      | 동작                                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 사이트 만들기 실패                        | 이전 사이트를 그대로 내보내고, 관리자 화면에 실패와 마지막 출력. 다음 동기화 때 다시 시도                        |
| 첫 사이트를 아직 못 만듦                  | 공개 주소는 503 "만드는 중", `/health`도 503(Railway가 이전 버전을 유지)                                         |
| DB 연결 실패                              | 해당 구역에만 오류를 보인다. 설정 저장 버튼은 꺼진다                                                             |
| 설정 값이 잘못됨(http 링크, 날짜 순서 등) | 저장하지 않고 입력을 유지한 채 무엇을 고칠지 보여 준다                                                           |
| 동기화가 1시간 넘게 안 돎                 | 해당 DB 줄에 "1시간 넘게 멈춤" 표시                                                                              |
| 동기화·빌드 요청이 겹침                   | 한 번에 하나씩, 대기 중인 같은 요청은 하나로 합친다. 다른 곳에서 돈 동기화와는 `_running` 잠금으로 겹치지 않는다 |
| 운영진 목록에 없는 Google 계정            | 403, "운영진 목록에 없어요" 안내. DB가 끊겨도 `ADMIN_EMAILS`의 운영진은 들어온다                                 |
