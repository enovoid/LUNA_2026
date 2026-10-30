import { describe, expect, it, vi } from 'vitest';
import { parseRetryAfter, RateLimitedQueue, retryHintFrom } from '../src/notion/rate-limit.js';

function httpError(status: number, retryAfter?: string) {
  const headers = new Headers(retryAfter ? { 'retry-after': retryAfter } : {});
  return Object.assign(new Error(`HTTP ${status}`), { status, headers });
}

describe('parseRetryAfter', () => {
  it('초 단위와 HTTP 날짜를 모두 읽는다', () => {
    expect(parseRetryAfter('2')).toBe(2000);
    expect(parseRetryAfter('0.5')).toBe(500);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
  });
});

describe('retryHintFrom', () => {
  it('429·529·5xx만 재시도 대상으로 본다', () => {
    expect(retryHintFrom(httpError(429, '3'))).toEqual({ status: 429, retryAfterMs: 3000 });
    expect(retryHintFrom(httpError(529))).toEqual({ status: 529, retryAfterMs: undefined });
    expect(retryHintFrom(httpError(502))?.status).toBe(502);
    expect(retryHintFrom(httpError(400))).toBeUndefined();
    expect(retryHintFrom(httpError(404))).toBeUndefined();
    expect(retryHintFrom(new Error('network'))).toBeUndefined();
    expect(retryHintFrom(new TypeError('fetch failed'))?.status).toBe(0);
    expect(
      retryHintFrom(Object.assign(new Error('t'), { code: 'notionhq_client_request_timeout' }))
        ?.status,
    ).toBe(0);
  });
});

describe('RateLimitedQueue', () => {
  it('429면 Retry-After만큼 기다렸다가 같은 요청을 다시 보낸다', async () => {
    const sleeps: number[] = [];
    const queue = new RateLimitedQueue({
      requestsPerSecond: 3,
      maxAttempts: 5,
      fallbackDelayMs: 1000,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    const task = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(httpError(429, '2'))
      .mockRejectedValueOnce(httpError(529, '1'))
      .mockResolvedValueOnce('ok');

    await expect(queue.run(task)).resolves.toBe('ok');
    expect(task).toHaveBeenCalledTimes(3);
    // 요청 하나의 대기 + 대기열 전체 멈춤이 같은 시간으로 잡힌다.
    expect(sleeps.filter((ms) => ms === 2000).length).toBeGreaterThanOrEqual(1);
    expect(sleeps.filter((ms) => ms === 1000).length).toBeGreaterThanOrEqual(1);
  });

  it('Retry-After가 없으면 지수 대기, 시도 횟수를 넘기면 오류를 그대로 던진다', async () => {
    const sleeps: number[] = [];
    const queue = new RateLimitedQueue({
      requestsPerSecond: 3,
      maxAttempts: 3,
      fallbackDelayMs: 100,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    const error = httpError(503);
    const task = vi.fn<() => Promise<string>>().mockRejectedValue(error);
    await expect(queue.run(task)).rejects.toBe(error);
    expect(task).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([100, 200]);
  });

  it('재시도할 수 없는 오류는 바로 던진다', async () => {
    const queue = new RateLimitedQueue({
      requestsPerSecond: 3,
      maxAttempts: 5,
      fallbackDelayMs: 1,
    });
    const task = vi.fn<() => Promise<string>>().mockRejectedValue(httpError(401));
    await expect(queue.run(task)).rejects.toThrow('HTTP 401');
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('1초에 3개보다 많이 출발시키지 않는다', async () => {
    const queue = new RateLimitedQueue({
      requestsPerSecond: 3,
      maxAttempts: 1,
      fallbackDelayMs: 1,
    });
    const starts: number[] = [];
    const begin = Date.now();
    await Promise.all(
      Array.from({ length: 7 }, () =>
        queue.run(async () => {
          starts.push(Date.now() - begin);
        }),
      ),
    );
    starts.sort((a, b) => a - b);
    // 4번째는 두 번째 창, 7번째는 세 번째 창에서 출발한다.
    expect(starts[3]).toBeGreaterThanOrEqual(950);
    expect(starts[6]).toBeGreaterThanOrEqual(1950);
  });

  it('429를 받으면 다른 요청도 멈춘다', async () => {
    const queue = new RateLimitedQueue({
      requestsPerSecond: 3,
      maxAttempts: 3,
      fallbackDelayMs: 1,
    });
    const begin = Date.now();
    let first = true;
    const otherStarted: number[] = [];
    const limited = queue.run(async () => {
      if (first) {
        first = false;
        throw httpError(429, '0.3');
      }
      return 'retried';
    });
    // 429 응답이 처리된 뒤에 들어온 요청은 멈춤이 풀릴 때까지 출발하지 않는다.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const other = queue.run(async () => {
      otherStarted.push(Date.now() - begin);
    });
    await Promise.all([limited, other]);
    expect(otherStarted[0]).toBeGreaterThanOrEqual(280);
  });
});
