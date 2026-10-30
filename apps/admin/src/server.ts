// LUNA 사이트 서버(Railway 서비스 하나). 공개 사이트 파일, 관리자 페이지(/admin), Notion 동기화, 사이트 빌드를 모두 맡는다.
// Node 기본 http 서버에서 app.ts의 handle(Request → Response)을 부른다.
import { rmSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from './app.js';
import { createAuth, parseEmails } from './auth.js';
import { createJobs, pnpmRunner } from './jobs.js';
import { createSite } from './site.js';
import { type AdminStore, createStore } from './store.js';

const env = process.env;
const log = (message: string) => console.log(`[server] ${message}`);
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const workDir = env.SITE_WORK_DIR || join(tmpdir(), 'luna-site');
// 지난 실행이 남긴 빌드 폴더는 지운다(같은 컨테이너에서 다시 시작한 경우).
rmSync(workDir, { recursive: true, force: true });

const site = createSite();
const jobs = createJobs({
  site,
  workDir,
  env: {
    ...env,
    // 사이트 주소(canonical·OG·sitemap). 직접 정한 도메인이 없으면 Railway가 만든 도메인을 쓴다.
    SITE_URL:
      env.SITE_URL ||
      (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : undefined),
  },
  run: pnpmRunner(repoRoot),
  log,
});
let db: { store: AdminStore; close: () => Promise<void> } | undefined;

const deps = {
  auth: createAuth({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }),
  ownerEmails: parseEmails(env.ADMIN_EMAILS),
  store: () => {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL이 설정되지 않았습니다.');
    db ??= createStore(env.DATABASE_URL);
    return db.store;
  },
  site,
  jobs,
  log,
};

const server = createServer(async (req, res) => {
  try {
    const response = await handle(await toRequest(req), deps);
    const headers: [string, string][] = [];
    response.headers.forEach((value, key) => {
      if (key !== 'set-cookie') headers.push([key, value]);
    });
    for (const cookie of response.headers.getSetCookie()) headers.push(['set-cookie', cookie]);
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('[server] 요청 처리 실패', error);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('서버 오류가 났어요. 잠시 뒤 다시 시도해 주세요.');
  }
});

const port = Number(env.PORT) || 8787;
server.listen(port, () => log(`http://localhost:${port}/ (관리자 /admin/)`));

// 시작하면 DB 내용으로 사이트를 만들고(끝나야 /health가 200), 이어서 Notion 변경을 한 번 확인한다.
jobs.build('서버 시작');
const syncMinutes = Number(env.SYNC_INTERVAL_MINUTES ?? '15');
const timers: NodeJS.Timeout[] = [];
if (syncMinutes > 0) {
  jobs.sync({ full: false, reason: '서버 시작 뒤 확인', trigger: 'cron' });
  timers.push(
    setInterval(
      () => jobs.sync({ full: false, reason: `${syncMinutes}분 자동 실행`, trigger: 'cron' }),
      syncMinutes * 60_000,
    ),
  );
} else {
  log('SYNC_INTERVAL_MINUTES=0: 자동 동기화를 끕니다');
}
// 모집 시작·마감이 날짜로 정해지므로 한국 시간 0시가 지나면 사이트를 다시 만든다.
const scheduleMidnight = () => {
  timers.push(
    setTimeout(() => {
      jobs.build('날짜 바뀜(모집 기간 확인)');
      scheduleMidnight();
    }, msUntilSeoulMidnight(new Date()) + 60_000),
  );
};
scheduleMidnight();

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    for (const timer of timers) clearTimeout(timer);
    jobs.stop();
    server.close();
    void (db?.close() ?? Promise.resolve()).finally(() => process.exit(0));
  });
}

function msUntilSeoulMidnight(now: Date): number {
  const KST = 9 * 3600_000;
  const day = 24 * 3600_000;
  return day - ((now.getTime() + KST) % day);
}

/** Railway 앞단이 HTTPS를 처리하고 X-Forwarded-Proto를 붙인다. 폼 본문은 작아서 통째로 읽는다(64KB 상한). */
async function toRequest(req: IncomingMessage): Promise<Request> {
  const proto = String(req.headers['x-forwarded-proto'] ?? 'http')
    .split(',')[0]
    ?.trim();
  const url = new URL(req.url ?? '/', `${proto}://${req.headers.host ?? 'localhost'}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else if (value !== undefined) headers.set(key, value);
  }
  let body: Buffer | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > 64 * 1024) throw new Error('요청 본문이 너무 큽니다.');
      chunks.push(chunk as Buffer);
    }
    body = Buffer.concat(chunks);
  }
  return new Request(url, { method: req.method, headers, body });
}
