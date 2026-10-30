// Cloudflare Access가 붙여 주는 JWT(Cf-Access-Jwt-Assertion)를 Worker에서 다시 검증한다.
// Access 설정이 실수로 빠지거나 workers.dev 주소로 직접 들어와도 운영진이 아니면 아무것도 볼 수 없게 하기 위해서다.
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose';

export interface AccessConfig {
  /** https://<팀>.cloudflareaccess.com */
  teamDomain: string;
  /** Application Audience (AUD) Tag. 여러 Access 애플리케이션(workers.dev, 사이트 도메인)을 받을 수 있다. */
  audience: string[];
}

export interface Viewer {
  email: string;
}

export class AccessError extends Error {
  override name = 'AccessError';
}

/** "luna", "luna.cloudflareaccess.com", "https://luna.cloudflareaccess.com/" 모두 같은 주소로 맞춘다. */
export function normalizeTeamDomain(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const withHost = trimmed.includes('.') ? trimmed : `${trimmed}.cloudflareaccess.com`;
  try {
    return new URL(withHost.startsWith('https://') ? withHost : `https://${withHost}`).origin;
  } catch {
    return ''; // 잘못된 값이면 설정이 없는 것으로 보고 모두 거부한다.
  }
}

const keysByTeam = new Map<string, JWTVerifyGetKey>();

/** 팀의 공개 키 목록. jose가 캐시하고, 키가 바뀌면(kid 불일치) 다시 받는다. */
export function accessKeys(teamDomain: string): JWTVerifyGetKey {
  let keys = keysByTeam.get(teamDomain);
  if (!keys) {
    keys = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', teamDomain));
    keysByTeam.set(teamDomain, keys);
  }
  return keys;
}

export async function verifyAccess(
  request: Request,
  config: AccessConfig,
  keys: JWTVerifyGetKey = accessKeys(config.teamDomain),
): Promise<Viewer> {
  if (!config.teamDomain || config.audience.length === 0) {
    throw new AccessError('ACCESS_TEAM_DOMAIN과 ACCESS_AUD가 설정되지 않았습니다.');
  }
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) throw new AccessError('Cloudflare Access 토큰이 없습니다.');

  let email: unknown;
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: config.teamDomain,
      audience: config.audience,
      algorithms: ['RS256'],
    });
    email = payload.email;
  } catch (error) {
    throw new AccessError(
      `Cloudflare Access 토큰을 확인하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  // 서비스 토큰(common_name만 있음)은 사람이 아니므로 받지 않는다.
  if (typeof email !== 'string' || !email) throw new AccessError('토큰에 이메일이 없습니다.');
  return { email: email.toLowerCase() };
}
