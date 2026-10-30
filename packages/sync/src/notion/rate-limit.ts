import PQueue from 'p-queue';

export interface RateLimitedQueueOptions {
  /** 초당 요청 수. Notion은 연결당 평균 3회. */
  requestsPerSecond: number;
  /** 한 요청을 몇 번까지 다시 보낼지. */
  maxAttempts: number;
  /** Retry-After가 없을 때 쓰는 첫 대기 시간(ms). 시도마다 두 배. */
  fallbackDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: { attempt: number; status: number; delayMs: number }) => void;
}

/** 다시 보내도 되는 응답인지와, 얼마나 기다릴지를 오류에서 읽는다. */
export interface RetryHint {
  status: number;
  retryAfterMs: number | undefined;
}

const RETRYABLE_STATUS = new Set([429, 529]);
/** 서버 오류(0은 네트워크 오류)는 Retry-After가 없으니 지수 대기로 몇 번만 다시 시도한다(조회만 하므로 안전). */
const TRANSIENT_STATUS = new Set([0, 500, 502, 503, 504]);
const MAX_BACKOFF_MS = 30_000;

export function parseRetryAfter(
  value: string | null | undefined,
  now = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return undefined;
}

/** 응답을 받기 전에 끊긴 요청(네트워크 오류, SDK 타임아웃). 조회만 하므로 다시 보내도 안전하다. */
function isNetworkError(error: object): boolean {
  if ((error as { code?: unknown }).code === 'notionhq_client_request_timeout') return true;
  return error instanceof TypeError && error.message === 'fetch failed';
}

export function retryHintFrom(error: unknown): RetryHint | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  if (isNetworkError(error)) return { status: 0, retryAfterMs: undefined };
  const status = (error as { status?: unknown }).status;
  if (typeof status !== 'number') return undefined;
  if (!RETRYABLE_STATUS.has(status) && !TRANSIENT_STATUS.has(status)) return undefined;
  const headers = (error as { headers?: unknown }).headers;
  let retryAfter: string | null | undefined;
  if (headers && typeof (headers as Headers).get === 'function') {
    retryAfter = (headers as Headers).get('retry-after');
  } else if (headers && typeof headers === 'object') {
    const record = headers as Record<string, unknown>;
    const raw = record['retry-after'] ?? record['Retry-After'];
    retryAfter = typeof raw === 'string' ? raw : undefined;
  }
  return { status, retryAfterMs: parseRetryAfter(retryAfter) };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 모든 Notion 요청이 지나가는 하나의 대기열.
 * - 1초 창마다 최대 requestsPerSecond개만 출발한다.
 * - 429·529면 Retry-After만큼 대기열 전체를 멈췄다가 같은 요청을 다시 넣는다.
 *   (한 요청만 쉬면 나머지 요청이 계속 제한에 걸리기 때문)
 */
export class RateLimitedQueue {
  readonly #queue: PQueue;
  readonly #options: Required<Omit<RateLimitedQueueOptions, 'onRetry'>> &
    Pick<RateLimitedQueueOptions, 'onRetry'>;
  /** 가장 최근의 멈춤. 더 늦게 끝나는 멈춤이 오면 앞선 멈춤은 대기열을 다시 열지 않는다. */
  #pause: { until: number; id: number } | undefined;
  #pauseCount = 0;

  constructor(options: RateLimitedQueueOptions) {
    this.#options = { sleep: defaultSleep, ...options };
    this.#queue = new PQueue({
      concurrency: options.requestsPerSecond,
      intervalCap: options.requestsPerSecond,
      interval: 1000,
    });
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.#queue.add(task);
      } catch (error) {
        const hint = retryHintFrom(error);
        if (!hint || attempt >= this.#options.maxAttempts) throw error;
        const backoff = Math.min(
          this.#options.fallbackDelayMs * 2 ** (attempt - 1),
          MAX_BACKOFF_MS,
        );
        const delayMs = RETRYABLE_STATUS.has(hint.status)
          ? (hint.retryAfterMs ?? backoff)
          : backoff;
        this.#options.onRetry?.({ attempt, status: hint.status, delayMs });
        if (RETRYABLE_STATUS.has(hint.status)) this.#pauseFor(delayMs);
        await this.#options.sleep(delayMs);
      }
    }
  }

  #pauseFor(delayMs: number): void {
    const until = Date.now() + delayMs;
    if (this.#pause && this.#pause.until >= until) return;
    const id = ++this.#pauseCount;
    this.#pause = { until, id };
    this.#queue.pause();
    void this.#options.sleep(delayMs).then(() => {
      if (this.#pause?.id !== id) return;
      this.#pause = undefined;
      this.#queue.start();
    });
  }

  async onIdle(): Promise<void> {
    await this.#queue.onIdle();
  }
}
