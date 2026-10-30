// LUNA 관리자 Worker. Cloudflare Access 뒤에서 동기화 상태·수동 동기화·사이트 설정을 다룬다.
import { normalizeTeamDomain, verifyAccess } from './access.js';
import { handle } from './app.js';
import type { Env } from './env.js';
import { createGitHub, type GitHub } from './github.js';
import { type AdminStore, createStore } from './store.js';

export default {
  async fetch(request, env, ctx) {
    let db: { store: AdminStore; close: () => Promise<void> } | undefined;
    let github: GitHub | undefined;
    const access = {
      teamDomain: normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN ?? ''),
      audience: (env.ACCESS_AUD ?? '')
        .split(',')
        .map((aud) => aud.trim())
        .filter(Boolean),
    };

    try {
      return await handle(request, {
        authenticate: async (req) => {
          const devEmail = env.DEV_ACCESS_EMAIL?.trim();
          if (devEmail && isLocalhost(req)) return { email: devEmail };
          return verifyAccess(req, access);
        },
        store: () => {
          if (!db) {
            const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
            if (!url) throw new Error('DATABASE_URL(또는 HYPERDRIVE)이 설정되지 않았습니다.');
            db = createStore(url);
          }
          return db.store;
        },
        github: () => {
          if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN이 설정되지 않았습니다.');
          github ??= createGitHub(env.GITHUB_TOKEN, env.GITHUB_REPOSITORY || 'enovoid/LUNA_2026');
          return github;
        },
        siteUrl: env.SITE_URL || undefined,
        log: (message) => console.log(`[admin] ${message}`),
      });
    } finally {
      const opened = db;
      if (opened) ctx.waitUntil(opened.close().catch(() => {}));
    }
  },
} satisfies ExportedHandler<Env>;

function isLocalhost(request: Request): boolean {
  const { hostname } = new URL(request.url);
  return hostname === 'localhost' || hostname === '127.0.0.1';
}
