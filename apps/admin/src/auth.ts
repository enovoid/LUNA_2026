// 운영진 로그인: Google 계정(OpenID Connect)으로 들어오고, 허용 목록에 있는 이메일만 받는다.
// 로그인하면 서명한 세션 쿠키(12시간)를 준다. 서명 키는 GOOGLE_CLIENT_SECRET에서 만들므로 비밀을 바꾸면 모든 세션이 끊긴다.
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify, SignJWT } from 'jose';

export const SESSION_COOKIE = '__Host-luna_admin';
/** 로그인 중(Google에 다녀오는 동안) state·nonce를 담는 쿠키 */
export const LOGIN_COOKIE = '__Host-luna_login';
const SESSION_HOURS = 12;
const LOGIN_MINUTES = 10;
const ISSUER = 'luna-admin';
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
export const CALLBACK_PATH = '/admin/auth/callback';

export class AuthError extends Error {
  override name = 'AuthError';
}

export interface Viewer {
  /** Google 계정 이메일(소문자). site_settings.updated_by에 남는다. */
  email: string;
  /** Google 프로필 이름. 없으면 이메일 */
  name: string;
}

export interface Auth {
  /** GOOGLE_CLIENT_ID·SECRET이 있는지 */
  configured(): boolean;
  /** Google 로그인 화면으로 보낼 주소와, 돌아왔을 때 확인할 쿠키 */
  start(origin: string): Promise<{ location: string; cookie: string }>;
  /** Google에서 돌아온 요청을 확인하고 세션 쿠키를 준다. 허용 목록에 없거나 확인에 실패하면 AuthError. */
  finish(
    request: Request,
    origin: string,
    isAllowed: (email: string) => Promise<boolean>,
  ): Promise<{ viewer: Viewer; cookie: string }>;
  /** 세션 쿠키가 유효하면 운영진을, 아니면 undefined. */
  viewer(request: Request): Promise<Viewer | undefined>;
  logoutCookie(): string;
  clearLoginCookie(): string;
}

export interface AuthOptions {
  clientId: string | undefined;
  clientSecret: string | undefined;
  now?: () => number;
  fetch?: typeof fetch;
  /** Google 공개 키. 테스트에서 바꿔 끼운다. */
  googleKeys?: JWTVerifyGetKey;
}

export function createAuth(options: AuthOptions): Auth {
  const { clientId, clientSecret } = options;
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetch ?? fetch;
  const configured = Boolean(clientId && clientSecret);
  const key = sha256(`luna-admin session:${clientSecret ?? ''}`);
  let googleKeys = options.googleKeys;

  const sign = (claims: Record<string, unknown>, seconds: number, audience: string) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setAudience(audience)
      .setIssuedAt(Math.floor(now() / 1000))
      .setExpirationTime(Math.floor(now() / 1000) + seconds)
      .sign(key);

  const verify = async (token: string, audience: string) =>
    (
      await jwtVerify(token, key, {
        issuer: ISSUER,
        audience,
        algorithms: ['HS256'],
        currentDate: new Date(now()),
      })
    ).payload;

  return {
    configured: () => configured,

    async start(origin) {
      if (!configured) throw new AuthError(NOT_CONFIGURED);
      const state = randomBytes(16).toString('base64url');
      const nonce = randomBytes(16).toString('base64url');
      const params = new URLSearchParams({
        client_id: clientId ?? '',
        redirect_uri: origin + CALLBACK_PATH,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        nonce,
        prompt: 'select_account',
      });
      const token = await sign({ state, nonce }, LOGIN_MINUTES * 60, 'login');
      return {
        location: `${GOOGLE_AUTH}?${params}`,
        cookie: cookie(LOGIN_COOKIE, token, LOGIN_MINUTES * 60),
      };
    },

    async finish(request, origin, isAllowed) {
      if (!configured) throw new AuthError(NOT_CONFIGURED);
      const url = new URL(request.url);
      if (url.searchParams.get('error')) throw new AuthError('Google 로그인을 취소했어요.');
      const code = url.searchParams.get('code');
      const login = readCookie(request, LOGIN_COOKIE);
      if (!code || !login) throw new AuthError('로그인 시간이 지났어요. 다시 시도해 주세요.');
      let expected: Record<string, unknown>;
      try {
        expected = await verify(login, 'login');
      } catch {
        throw new AuthError('로그인 시간이 지났어요. 다시 시도해 주세요.');
      }
      if (expected.state !== url.searchParams.get('state')) {
        throw new AuthError('로그인 요청이 맞지 않아요. 다시 시도해 주세요.');
      }

      const response = await fetchImpl(GOOGLE_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId ?? '',
          client_secret: clientSecret ?? '',
          redirect_uri: origin + CALLBACK_PATH,
          grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const tokens = (await response.json().catch(() => ({}))) as { id_token?: string };
      if (!response.ok || !tokens.id_token) {
        throw new AuthError(`Google 로그인을 확인하지 못했어요(HTTP ${response.status}).`);
      }

      googleKeys ??= createRemoteJWKSet(new URL(GOOGLE_JWKS));
      let claims: Record<string, unknown>;
      try {
        claims = (
          await jwtVerify(tokens.id_token, googleKeys, {
            issuer: GOOGLE_ISSUERS,
            audience: clientId,
            currentDate: new Date(now()),
          })
        ).payload;
      } catch {
        throw new AuthError('Google 로그인을 확인하지 못했어요.');
      }
      if (claims.nonce !== expected.nonce) throw new AuthError('로그인 요청이 맞지 않아요.');
      const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
      if (!email || claims.email_verified !== true) {
        throw new AuthError('이메일이 확인된 Google 계정이 필요해요.');
      }
      if (!(await isAllowed(email))) {
        throw new AuthError(
          `${email}은(는) 운영진 목록에 없어요. 운영진에게 추가해 달라고 해 주세요.`,
        );
      }
      const name = typeof claims.name === 'string' && claims.name ? claims.name : email;
      const viewer = { email, name: name.slice(0, 60) };
      const session = await sign(viewer, SESSION_HOURS * 3600, 'session');
      return { viewer, cookie: cookie(SESSION_COOKIE, session, SESSION_HOURS * 3600) };
    },

    async viewer(request) {
      if (!configured) return undefined;
      const token = readCookie(request, SESSION_COOKIE);
      if (!token) return undefined;
      try {
        const payload = await verify(token, 'session');
        if (typeof payload.email !== 'string' || !payload.email) return undefined;
        return {
          email: payload.email,
          name: typeof payload.name === 'string' ? payload.name : payload.email,
        };
      } catch {
        return undefined; // 만료·위조·비밀 변경
      }
    },

    logoutCookie: () => cookie(SESSION_COOKIE, '', 0),
    clearLoginCookie: () => cookie(LOGIN_COOKIE, '', 0),
  };
}

const NOT_CONFIGURED =
  'Google 로그인이 설정되지 않았어요. Railway 변수 GOOGLE_CLIENT_ID와 GOOGLE_CLIENT_SECRET을 확인해 주세요.';

function sha256(text: string): Buffer {
  return createHash('sha256').update(text).digest();
}

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

/** "a@x.com, B@y.com" → ['a@x.com', 'b@y.com'] */
export function parseEmails(text: string | undefined): string[] {
  return [
    ...new Set(
      (text ?? '')
        .split(/[\s,;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function isEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}
