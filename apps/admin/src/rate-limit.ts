// 요청 횟수 제한(서버 메모리). 로그인 시도나 업로드를 마구 보내는 것을 막는다.
// 서버가 하나라 메모리로 충분하고, 다시 시작하면 초기화된다.

export interface RateLimiter {
  /** 이번 요청을 받아도 되면 true. key마다 windowMs 동안 limit번까지. */
  take(key: string, limit: number, windowMs: number): boolean;
}

export function createRateLimiter(now: () => number = Date.now): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    take(key, limit, windowMs) {
      const t = now();
      if (windows.size > 10_000) {
        for (const [k, w] of windows) if (w.resetAt <= t) windows.delete(k);
      }
      const current = windows.get(key);
      if (!current || current.resetAt <= t) {
        windows.set(key, { count: 1, resetAt: t + windowMs });
        return true;
      }
      current.count++;
      return current.count <= limit;
    },
  };
}

/**
 * 요청한 사람의 IP. Railway 앞단이 X-Real-IP를 붙이고, 없으면 X-Forwarded-For의 마지막(앞단이 붙인) 값을 쓴다.
 * 제한용이라 조금 틀려도 괜찮다.
 */
export function clientIp(request: Request): string {
  const real = request.headers.get('x-real-ip')?.trim();
  if (real) return real;
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',').at(-1)?.trim() || 'unknown';
}
