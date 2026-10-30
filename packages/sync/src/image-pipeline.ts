import type { ObjectStore } from './image-store.js';
import {
  type DownloadOptions,
  displaySize,
  download,
  IMAGE_WIDTHS,
  imageKeyFor,
  type ProcessedImage,
  toWebpVariants,
  variantKey,
} from './images.js';
import type { ImageDatabase } from './mappers.js';
import type { FileRef } from './notion/properties.js';

/** 마지막으로 올리는 파일. 이게 있으면 세 파일이 모두 올라간 것이다. */
const COMPLETION_WIDTH = IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]!;

export type ImageCache = Map<string, ProcessedImage>;

export interface ImageOutcome {
  image: ProcessedImage;
  /** Notion에서 원본을 내려받았는지(캐시 적중이면 false). */
  downloaded: boolean;
  /** image_files에 새로 저장했는지. */
  uploaded: boolean;
}

/**
 * Notion 파일 → WebP 세 장 → Postgres image_files.
 * 원본 바이트의 SHA-256이 키라서 같은 사진은 한 번만 올라가고,
 * Notion 파일 주소(서명 쿼리 제외)로 캐시해서 글만 고친 페이지는 사진을 다시 내려받지 않는다.
 */
export class ImagePipeline {
  constructor(
    /** undefined면 --dry-run: 변환까지만 하고 올리지 않는다. */
    private readonly objects: ObjectStore | undefined,
    readonly cache: ImageCache,
    private readonly downloadOptions: DownloadOptions = {},
  ) {}

  static cacheKey(database: ImageDatabase, file: FileRef): string | undefined {
    return file.stableId ? `${database}:${file.stableId}` : undefined;
  }

  async process(database: ImageDatabase, file: FileRef): Promise<ImageOutcome> {
    const cacheKey = ImagePipeline.cacheKey(database, file);
    const cached = cacheKey ? this.cache.get(cacheKey) : undefined;
    if (cached && (await this.#isComplete(cached.imageKey))) {
      return { image: cached, downloaded: false, uploaded: false };
    }

    const bytes = await download(file.url, this.downloadOptions);
    const outcome = await this.processBytes(database, bytes, file.name);
    if (cacheKey) this.cache.set(cacheKey, outcome.image);
    return { ...outcome, downloaded: true };
  }

  /** 이미 가진 원본 바이트(Notion 내보내기 파일 등)를 WebP로 바꿔 올린다. 캐시는 쓰지 않는다. */
  async processBytes(
    database: ImageDatabase,
    bytes: Uint8Array,
    name: string,
  ): Promise<Omit<ImageOutcome, 'downloaded'>> {
    const imageKey = imageKeyFor(database, bytes);
    let uploaded = false;
    try {
      if (!(await this.#isComplete(imageKey))) {
        const variants = await toWebpVariants(bytes, imageKey);
        if (this.objects) {
          // 완료 표시 파일(1600)은 맨 마지막에 올린다. 중간에 실패하면 다음 실행에서 다시 올린다.
          variants.sort((a, b) => a.width - b.width);
          for (const variant of variants)
            await this.objects.put(variant.key, variant.body, 'image/webp');
          uploaded = true;
        }
      }
      const size = await displaySize(bytes);
      const image: ProcessedImage = { imageKey, ...size };
      return { image, uploaded };
    } catch (error) {
      if (
        error instanceof Error &&
        /unsupported image format|Input buffer contains unsupported/i.test(error.message)
      ) {
        throw new Error(
          `이미지 형식을 읽을 수 없습니다(${name}). JPG·PNG·WebP·AVIF·GIF로 올려 주세요.`,
        );
      }
      throw error;
    }
  }

  async #isComplete(imageKey: string): Promise<boolean> {
    if (!this.objects) return false;
    return this.objects.exists(variantKey(imageKey, COMPLETION_WIDTH));
  }
}

export function serializeCache(
  cache: ImageCache,
  referenced: ReadonlySet<string>,
): Record<string, ProcessedImage> {
  const out: Record<string, ProcessedImage> = {};
  for (const [key, image] of cache) if (referenced.has(image.imageKey)) out[key] = image;
  return out;
}

export function deserializeCache(value: unknown): ImageCache {
  const cache: ImageCache = new Map();
  if (!value || typeof value !== 'object') return cache;
  for (const [key, image] of Object.entries(value as Record<string, unknown>)) {
    if (!image || typeof image !== 'object') continue;
    const { imageKey, width, height } = image as Record<string, unknown>;
    if (typeof imageKey === 'string' && typeof width === 'number' && typeof height === 'number') {
      cache.set(key, { imageKey, width, height });
    }
  }
  return cache;
}
