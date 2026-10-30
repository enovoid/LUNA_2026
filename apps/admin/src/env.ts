/** wrangler.jsonc의 vars와 `wrangler secret put`으로 넣는 값. */
export interface Env {
  /** Zero Trust 팀 도메인. 예) https://luna.cloudflareaccess.com (팀 이름만 적어도 된다) */
  ACCESS_TEAM_DOMAIN: string;
  /** Access 애플리케이션의 Application Audience (AUD) Tag. 애플리케이션이 둘이면(workers.dev와 도메인) 쉼표로 구분 */
  ACCESS_AUD: string;
  /** owner/repo. 동기화·배포 워크플로를 부를 저장소 */
  GITHUB_REPOSITORY: string;
  /** 공개 사이트 주소(링크용, 선택) */
  SITE_URL?: string;
  /** 비밀 값. 이 저장소만, Actions: Read and write 권한의 fine-grained token */
  GITHUB_TOKEN?: string;
  /** 비밀 값. Railway Postgres 공개(TCP proxy) 주소. HYPERDRIVE 바인딩이 있으면 그쪽을 쓴다. */
  DATABASE_URL?: string;
  HYPERDRIVE?: Hyperdrive;
  /** 로컬 `wrangler dev` 전용(.dev.vars): Access 없이 이 이메일로 로그인한 것으로 본다. localhost가 아니면 무시한다. */
  DEV_ACCESS_EMAIL?: string;
}
