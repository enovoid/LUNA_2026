import { createHash } from 'node:crypto';
import sharp from 'sharp';

/** 사이트 srcset과 맞춘 폭. 세 파일은 원본이 작아도 항상 만든다(확대하지 않고 원본 폭으로 저장). */
export const IMAGE_WIDTHS = [480, 960, 1600] as const;
const LARGEST = IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]!;

/** 너무 큰 파일로 메모리를 다 쓰지 않게 막는다. */
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

export interface ImageVariant {
  width: number;
  key: string;
  body: Buffer;
}

export interface ProcessedImage {
  /** DB에 저장하는 키 접두어. 예: members/<sha256> */
  imageKey: string;
  /** 1600 이하로 줄인 최대본의 크기. 화면의 width/height 속성(CLS 방지)에 쓴다. */
  width: number;
  height: number;
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function imageKeyFor(prefix: string, bytes: Uint8Array): string {
  return `${prefix}/${sha256(bytes)}`;
}

export function variantKey(imageKey: string, width: number): string {
  return `${imageKey}-${width}.webp`;
}

/** EXIF 회전을 반영한 뒤, 최대 폭으로 줄였을 때의 크기. */
export async function displaySize(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  // metadata().autoOrient는 EXIF 방향을 반영한 크기다(sharp 0.34+).
  const { width, height } = (await sharp(bytes).metadata()).autoOrient;
  if (!width || !height) throw new Error('이미지 크기를 읽을 수 없습니다');
  if (width <= LARGEST) return { width, height };
  return { width: LARGEST, height: Math.round((height * LARGEST) / width) };
}

/** WebP 세 가지 폭으로 변환한다. sharp는 기본으로 메타데이터(EXIF·GPS)를 지운다. */
export async function toWebpVariants(bytes: Uint8Array, imageKey: string): Promise<ImageVariant[]> {
  // 움직이는 GIF 등은 첫 프레임만 쓴다.
  const source = sharp(bytes, { animated: false }).autoOrient();
  return Promise.all(
    IMAGE_WIDTHS.map(async (width) => ({
      width,
      key: variantKey(imageKey, width),
      body: await source
        .clone()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 80, effort: 5 })
        .toBuffer(),
    })),
  );
}

export class DownloadError extends Error {
  override name = 'DownloadError';
  constructor(
    message: string,
    /** 다시 시도해 볼 만한 오류인지(네트워크 끊김, 5xx, 429). */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface DownloadOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 이미지 하나를 내려받는다. Node 내장 fetch(undici)를 쓴다.
 * - 요청마다 타임아웃, 일시 오류(네트워크·5xx·429)는 짧게 지수 대기 후 재시도
 * - 크기 상한을 넘으면 받는 도중에 끊는다(Content-Length가 없거나 틀려도)
 * - 만료된 Notion 링크(403)는 재시도해도 소용없으니 바로 실패한다
 */
export async function download(url: string, options: DownloadOptions = {}): Promise<Buffer> {
  const { fetchImpl = fetch, timeoutMs = 30_000, maxAttempts = 3, sleep = defaultSleep } = options;
  for (let attempt = 1; ; attempt++) {
    try {
      return await downloadOnce(url, fetchImpl, timeoutMs);
    } catch (error) {
      const retryable = error instanceof DownloadError ? error.retryable : true;
      if (!retryable || attempt >= maxAttempts) throw error;
      await sleep(500 * 2 ** (attempt - 1));
    }
  }
}

async function downloadOnce(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new DownloadError(
      `이미지 요청 실패: ${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    const retryable = response.status === 429 || response.status >= 500;
    const hint = response.status === 403 ? ' (Notion 파일 링크가 만료됐을 수 있음)' : '';
    throw new DownloadError(
      `이미지를 내려받지 못했습니다: HTTP ${response.status}${hint}`,
      retryable,
    );
  }
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_DOWNLOAD_BYTES) {
    await response.body?.cancel();
    throw new DownloadError(`이미지가 너무 큽니다 (${declared} bytes)`, false);
  }
  if (!response.body) throw new DownloadError('이미지 응답 본문이 비어 있습니다', true);

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for await (const chunk of response.body) {
      total += chunk.byteLength;
      if (total > MAX_DOWNLOAD_BYTES) {
        // 반복문을 빠져나가면 스트림이 취소되어 나머지는 받지 않는다.
        throw new DownloadError(`이미지가 너무 큽니다 (${MAX_DOWNLOAD_BYTES} bytes 초과)`, false);
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof DownloadError) throw error;
    throw new DownloadError(
      `이미지를 받는 도중 끊겼습니다: ${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }
  if (total === 0) throw new DownloadError('이미지 파일이 비어 있습니다', false);
  return Buffer.concat(chunks, total);
}
