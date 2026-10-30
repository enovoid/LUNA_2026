// 관리자가 올린 사진: 형식·크기를 확인하고 Notion 동기화와 같은 방식(WebP 480·960·1600, 키는 원본 해시)으로 바꿔 둔다.
// 원본은 저장하지 않는다. 다시 인코딩하면서 EXIF·GPS 같은 메타데이터도 빠진다.
import {
  displaySize,
  IMAGE_WIDTHS,
  imageKeyFor,
  type ProcessedImage,
  toWebpVariants,
  variantKey,
} from '@luna/sync/images';
import sharp from 'sharp';
import type { ContentTable } from './content.js';

export type { ProcessedImage };

/** 올릴 수 있는 원본 크기. 휴대폰 사진은 보통 3~8MB. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
/** 압축 폭탄(작은 파일이 거대한 그림으로 풀리는 것)을 막는 픽셀 상한: 약 8000×6000 */
const MAX_PIXELS = 50_000_000;
/** 마지막으로 저장하는 파일. 이게 있으면 세 파일이 모두 있는 것이다. */
export const COMPLETE_WIDTH = IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1] ?? 1600;

export class UploadError extends Error {
  override name = 'UploadError';
}

export interface ImageSink {
  putImageFile(key: string, body: Buffer): Promise<void>;
  imageFileExists(key: string): Promise<boolean>;
}

/** 파일 앞부분으로 형식을 확인한다(이름·Content-Type은 믿지 않는다). */
export function sniffImage(
  bytes: Uint8Array,
): 'jpeg' | 'png' | 'gif' | 'webp' | 'avif' | undefined {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (ascii(0, 8) === '\x89PNG\r\n\x1a\n') return 'png';
  if (ascii(0, 4) === 'GIF8') return 'gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))) return 'avif';
  return undefined;
}

/** 사진 한 장을 검사하고 WebP 세 장으로 바꿔 저장한다. 같은 사진이면 다시 만들지 않는다. */
export async function storeUpload(
  sink: ImageSink,
  table: ContentTable,
  bytes: Buffer,
): Promise<ProcessedImage> {
  if (bytes.length === 0) throw new UploadError('빈 파일이에요.');
  if (bytes.length > MAX_UPLOAD_BYTES) throw new UploadError('사진은 20MB까지 올릴 수 있어요.');
  if (!sniffImage(bytes)) {
    throw new UploadError('JPG·PNG·WebP·AVIF·GIF 사진만 올릴 수 있어요.');
  }
  let size: { width: number; height: number };
  try {
    const meta = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).metadata();
    if (!meta.width || !meta.height) throw new Error('크기 없음');
    if (meta.width * meta.height > MAX_PIXELS) throw new UploadError('사진 해상도가 너무 커요.');
    size = await displaySize(bytes);
  } catch (error) {
    if (error instanceof UploadError) throw error;
    throw new UploadError('사진을 읽지 못했어요. 파일이 손상됐을 수 있어요.');
  }

  const imageKey = imageKeyFor(table, bytes);
  if (!(await sink.imageFileExists(variantKey(imageKey, COMPLETE_WIDTH)))) {
    const variants = await toWebpVariants(bytes, imageKey);
    // 완료 표시 파일(1600)을 맨 마지막에 저장한다.
    variants.sort((a, b) => a.width - b.width);
    for (const variant of variants) await sink.putImageFile(variant.key, variant.body);
  }
  return { imageKey, ...size };
}

/** 미리 올린 사진의 키: `<table>/<sha256>` 모양이어야 한다. */
export function isImageKey(table: ContentTable, key: string): boolean {
  return new RegExp(`^${table}/[0-9a-f]{64}$`).test(key);
}

/** 관리자 화면에서 보여 줄 파일 키: `<table>/<sha256>-<폭>.webp` */
export function isImageFileKey(key: string): boolean {
  return /^(members|awards|projects)\/[0-9a-f]{64}-(480|960|1600)\.webp$/.test(key);
}

/** 저장해 둔 최대본(1600)에서 화면용 크기를 읽는다. */
export async function sizeOfStored(body: Buffer): Promise<{ width: number; height: number }> {
  const { width, height } = await sharp(body).metadata();
  if (!width || !height) throw new UploadError('저장된 사진을 읽지 못했어요.');
  return { width, height };
}

export { variantKey };
