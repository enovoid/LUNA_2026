# 검색 엔진 등록 (Google·네이버)

사이트가 검색에 잘 나오도록 코드에서 해 둔 것과, 운영진이 한 번 직접 해야 하는 일.

## 코드에 들어 있는 것

| 항목                                                                                                                 | 위치                                                                |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 페이지마다 제목·설명, canonical, Open Graph·Twitter 카드                                                             | `apps/web/src/layouts/Base.astro`, 각 페이지의 `<Base description>` |
| 공유·검색 미리보기 이미지(1200×630), 아이콘(favicon.ico, apple-touch-icon, 512 로고)                                 | `apps/web/public/`                                                  |
| 구조화 데이터(JSON-LD): 홈 `WebSite`·`Organization`(이름, 로고, 인스타그램 등 `sameAs`), 하위 페이지 빵부스러기, FAQ | `apps/web/src/lib/seo.ts`                                           |
| `/sitemap.xml`(5개 페이지, 빌드한 날을 `lastmod`)                                                                    | `apps/web/src/pages/sitemap.xml.ts`                                 |
| `/robots.txt`(`/admin` 막음, sitemap 주소 안내)                                                                      | `apps/web/src/pages/robots.txt.ts`                                  |
| 소유 확인 메타 태그(환경 변수가 있을 때만)                                                                           | `GOOGLE_SITE_VERIFICATION`, `NAVER_SITE_VERIFICATION`               |

모든 페이지는 빌드할 때 HTML로 만들어지므로 검색 로봇이 JavaScript 없이 내용을 읽는다.
절대 주소는 `SITE_URL`(없으면 Railway 도메인)로 만든다. 직접 도메인을 연결하면 `SITE_URL`부터 바꾸고, 아래 등록도 새 도메인으로 다시 한다.

## 운영진이 할 일

### Google Search Console

1. [search.google.com/search-console](https://search.google.com/search-console) → 속성 추가 → **URL 접두어**에 사이트 주소(예: `https://dimigo-luna.up.railway.app`)
   - 직접 도메인을 연결했다면 **도메인** 속성(DNS TXT 확인)이 더 낫다. 이때는 아래 2–3을 건너뛴다.
2. 확인 방법에서 **HTML 태그**를 고르고 `content="…"` 안의 값만 복사
3. Railway 서비스 Variables에 `GOOGLE_SITE_VERIFICATION=<값>` 추가 → 다시 배포되어 사이트가 새로 만들어지면(2–4분) Search Console에서 **확인**
4. 왼쪽 **Sitemaps** → `sitemap.xml` 제출
5. **URL 검사**에 홈 주소를 넣고 **색인 생성 요청**(첫 색인을 앞당긴다)

### 네이버 서치어드바이저

1. [searchadvisor.naver.com](https://searchadvisor.naver.com) → 웹마스터 도구 → 사이트 등록에 사이트 주소
2. 소유 확인에서 **HTML 태그**를 고르고 `content` 값을 복사 → Railway Variables에 `NAVER_SITE_VERIFICATION=<값>` → 배포 후 **소유 확인**
3. 요청 → **사이트맵 제출**에 `https://<도메인>/sitemap.xml`
4. 요청 → **웹 페이지 수집**에 홈 주소 제출
5. 설정 → **연관 채널**에 인스타그램 주소를 넣으면 검색 결과에 공식 채널로 묶인다

### 나머지

- 인스타그램 프로필 링크와 학교·동아리 소개 글에 사이트 주소를 걸어 두면 처음 수집이 빨라진다.
- 색인에는 보통 며칠에서 몇 주가 걸린다. Search Console **페이지** 보고서에서 진행 상황을 본다.
- [리치 결과 테스트](https://search.google.com/test/rich-results)에 주소를 넣으면 구조화 데이터를 확인할 수 있다.
