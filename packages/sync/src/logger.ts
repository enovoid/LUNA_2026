export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/** Railway 로그에서 읽기 쉽게 한 줄씩 남긴다. data는 JSON으로 덧붙인다. */
export function createConsoleLogger(): Logger {
  const line = (level: string, message: string, data?: Record<string, unknown>) =>
    `${new Date().toISOString()} ${level} ${message}${data ? ` ${JSON.stringify(data)}` : ''}`;
  return {
    info: (message, data) => console.log(line('INFO ', message, data)),
    warn: (message, data) => console.warn(line('WARN ', message, data)),
    error: (message, data) => console.error(line('ERROR', message, data)),
  };
}

/** 오류 메시지. `fetch failed`처럼 원인이 cause에만 있으면(ENOTFOUND 등) 덧붙인다. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause as { code?: unknown; message?: unknown } | undefined;
  const detail = typeof cause?.code === 'string' ? cause.code : undefined;
  return detail && !error.message.includes(detail) ? `${error.message} (${detail})` : error.message;
}
