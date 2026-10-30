import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { AccessError, normalizeTeamDomain, verifyAccess } from '../src/access.js';

const team = 'https://luna.cloudflareaccess.com';
const aud = 'aud-tag-123';

let keys: ReturnType<typeof createLocalJWKSet>;
let sign: (
  claims: Record<string, unknown>,
  options?: { issuer?: string; audience?: string; exp?: string },
) => Promise<string>;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  keys = createLocalJWKSet({ keys: [jwk] });
  sign = (claims, options = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(options.issuer ?? team)
      .setAudience(options.audience ?? aud)
      .setIssuedAt()
      .setExpirationTime(options.exp ?? '5m')
      .sign(privateKey);
});

const request = (token?: string) =>
  new Request('https://admin.example/admin/', {
    headers: token ? { 'cf-access-jwt-assertion': token } : {},
  });
const config = { teamDomain: team, audience: [aud] };

describe('verifyAccess', () => {
  it('올바른 토큰이면 이메일을 소문자로 돌려준다', async () => {
    const token = await sign({ email: 'Staff@Luna.kr' });
    await expect(verifyAccess(request(token), config, keys)).resolves.toEqual({
      email: 'staff@luna.kr',
    });
  });

  it('AUD를 여러 개 받을 수 있다(workers.dev와 도메인 애플리케이션)', async () => {
    const token = await sign({ email: 'a@b.kr' }, { audience: 'domain-app' });
    await expect(
      verifyAccess(request(token), { teamDomain: team, audience: [aud, 'domain-app'] }, keys),
    ).resolves.toEqual({ email: 'a@b.kr' });
  });

  it('토큰이 없으면 거부한다', async () => {
    await expect(verifyAccess(request(), config, keys)).rejects.toThrow(AccessError);
  });

  it('다른 Access 애플리케이션(aud)의 토큰은 거부한다', async () => {
    const token = await sign({ email: 'a@b.kr' }, { audience: 'other-app' });
    await expect(verifyAccess(request(token), config, keys)).rejects.toThrow(/aud/);
  });

  it('다른 팀(iss)의 토큰은 거부한다', async () => {
    const token = await sign({ email: 'a@b.kr' }, { issuer: 'https://evil.cloudflareaccess.com' });
    await expect(verifyAccess(request(token), config, keys)).rejects.toThrow(AccessError);
  });

  it('만료된 토큰은 거부한다', async () => {
    const token = await sign({ email: 'a@b.kr' }, { exp: '-1m' });
    await expect(verifyAccess(request(token), config, keys)).rejects.toThrow(AccessError);
  });

  it('서명이 다른 키로 된 토큰은 거부한다', async () => {
    const other = await generateKeyPair('RS256');
    const token = await new SignJWT({ email: 'a@b.kr' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(team)
      .setAudience(aud)
      .setExpirationTime('5m')
      .sign(other.privateKey);
    await expect(verifyAccess(request(token), config, keys)).rejects.toThrow(AccessError);
  });

  it('이메일이 없는 서비스 토큰은 거부한다', async () => {
    const token = await sign({ common_name: 'bot.access' });
    await expect(verifyAccess(request(token), config, keys)).rejects.toThrow(/이메일/);
  });

  it('설정이 비어 있으면 아무도 들이지 않는다', async () => {
    const token = await sign({ email: 'a@b.kr' });
    await expect(
      verifyAccess(request(token), { teamDomain: '', audience: [] }, keys),
    ).rejects.toThrow(/ACCESS_TEAM_DOMAIN/);
  });
});

describe('normalizeTeamDomain', () => {
  it.each([
    ['luna', team],
    ['luna.cloudflareaccess.com', team],
    ['https://luna.cloudflareaccess.com/', team],
    ['', ''],
  ])('%s → %s', (input, expected) => {
    expect(normalizeTeamDomain(input)).toBe(expected);
  });
});
