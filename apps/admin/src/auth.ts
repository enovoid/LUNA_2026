// 운영진 로그인. Railway 변수 ADMIN_PASSWORD 하나로 들어오고, 누가 바꿨는지 남기려고 이름을 함께 받는다.
// 로그인하면 서명한 세션 쿠키(12시간)를 준다. 비밀번호를 바꾸면 서명 키도 바뀌어 모든 세션이 끊긴다.
import { createHash, timingSafeEqual } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';

export const SESSION_COOKIE = '__Host-luna_admin';
const SESSION_HOURS = 12;
const ISSUER = 'luna-admin';
/** 이보다 짧은 비밀번호는 설정 오류로 보고 로그인을 막는다. */
export const MIN_PASSWORD_LENGTH = 12;

export class AuthError extends Error {
  override name = 'AuthError';
}

export interface Viewer {
  /** 로그인할 때 적은 이름. site_settings.updated_by에 남는다. */
  name: string;
}

export interface Auth {
  /** 비밀번호가 맞으면 세션 쿠키(Set-Cookie 값)를 돌려준다. 틀리거나 너무 자주 틀리면 AuthError. */
  login(input: { name: string; password: string; client: string }): Promise<string>;
  /** 세션 쿠키가 유효하면 운영진을, 아니면 undefined. */
  viewer(request: Request): Promise<Viewer | undefined>;
  logoutCookie(): string;
}

export function createAuth(
  password: string | undefined,
  options: { now?: () => number } = {},
): Auth {
  const now = options.now ?? Date.now;
  const configured = (password ?? '').length >= MIN_PASSWORD_LENGTH;
  const expected = sha256(password ?? '');
  // 비밀번호에서 서명 키를 만든다: 비밀번호를 바꾸면 기존 세션이 모두 무효가 된다.
  const key = sha256(`luna-admin session:${password ?? ''}`);
  const limiter = new FailureLimiter(now);

  return {
    async login({ name, password: given, client }) {
      if (!configured) {
        throw new AuthError(
          `관리자 비밀번호(ADMIN_PASSWORD)가 설정되지 않았거나 ${MIN_PASSWORD_LENGTH}자보다 짧아요. Railway 변수를 확인해 주세요.`,
        );
      }
      if (limiter.blocked(client)) {
        throw new AuthError('비밀번호를 여러 번 틀려서 잠시 막았어요. 10분 뒤 다시 시도해 주세요.');
      }
      const trimmed = name.trim().slice(0, 40);
      if (!trimmed) throw new AuthError('이름을 적어 주세요. 누가 바꿨는지 기록에 남아요.');
      if (!timingSafeEqual(sha256(given), expected)) {
        limiter.fail(client);
        throw new AuthError('비밀번호가 맞지 않아요.');
      }
      const token = await new SignJWT({ name: trimmed })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer(ISSUER)
        .setIssuedAt(Math.floor(now() / 1000))
        .setExpirationTime(Math.floor(now() / 1000) + SESSION_HOURS * 3600)
        .sign(key);
      return cookie(token, SESSION_HOURS * 3600);
    },

    async viewer(request) {
      if (!configured) return undefined;
      const token = readCookie(request, SESSION_COOKIE);
      if (!token) return undefined;
      try {
        const { payload } = await jwtVerify(token, key, {
          issuer: ISSUER,
          algorithms: ['HS256'],
          currentDate: new Date(now()),
        });
        return typeof payload.name === 'string' && payload.name
          ? { name: payload.name }
          : undefined;
      } catch {
        return undefined; // 만료·위조·비밀번호 변경
      }
    },

    logoutCookie: () => cookie('', 0),
  };
}

/**
 * 비밀번호 대입을 늦춘다. 같은 접속 주소에서 10분에 5번, 전체로는 10분에 30번 틀리면 막는다.
 * 서버 한 대(Railway 서비스 하나)의 메모리에만 두며, 재시작하면 초기화된다.
 */
class FailureLimiter {
  static readonly WINDOW_MS = 10 * 60_000;
  static readonly PER_CLIENT = 5;
  static readonly TOTAL = 30;
  readonly #failures: { client: string; at: number }[] = [];

  constructor(private readonly now: () => number) {}

  #recent() {
    const since = this.now() - FailureLimiter.WINDOW_MS;
    while (this.#failures.length > 0 && (this.#failures[0]?.at ?? 0) < since)
      this.#failures.shift();
    return this.#failures;
  }

  blocked(client: string): boolean {
    const recent = this.#recent();
    return (
      recent.length >= FailureLimiter.TOTAL ||
      recent.filter((f) => f.client === client).length >= FailureLimiter.PER_CLIENT
    );
  }

  fail(client: string) {
    this.#recent().push({ client, at: this.now() });
  }
}

function sha256(text: string): Buffer {
  return createHash('sha256').update(text).digest();
}

function cookie(value: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}
