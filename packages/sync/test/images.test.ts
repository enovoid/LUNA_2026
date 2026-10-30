import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { ImagePipeline } from '../src/image-pipeline.js';
import type { ObjectStore } from '../src/image-store.js';
import {
  DownloadError,
  displaySize,
  download,
  imageKeyFor,
  sha256,
  toWebpVariants,
} from '../src/images.js';

async function jpeg(width: number, height: number, withExif = false) {
  let image = sharp({
    create: { width, height, channels: 3, background: { r: 144, g: 127, b: 223 } },
  }).jpeg();
  if (withExif) image = image.withExif({ IFD0: { Copyright: 'secret', Artist: 'me' } });
  return image.toBuffer();
}

class MemoryObjects implements ObjectStore {
  readonly files = new Map<string, Buffer>();
  puts: string[] = [];
  async exists(key: string) {
    return this.files.has(key);
  }
  async put(key: string, body: Buffer) {
    this.puts.push(key);
    this.files.set(key, body);
  }
  async listKeys(prefix: string) {
    return [...this.files.keys()].filter((key) => key.startsWith(prefix));
  }
  async deleteKeys(keys: readonly string[]) {
    for (const key of keys) this.files.delete(key);
  }
}

function okResponse(body: Buffer) {
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: { 'content-length': String(body.byteLength) },
  });
}

describe('WebP 변환', () => {
  it('세 가지 폭을 만들고 원본보다 크게 늘리지 않으며 메타데이터를 지운다', async () => {
    const original = await jpeg(1200, 800, true);
    const key = imageKeyFor('members', original);
    expect(key).toBe(`members/${sha256(original)}`);

    const variants = await toWebpVariants(original, key);
    expect(variants.map((v) => v.key)).toEqual([
      `${key}-480.webp`,
      `${key}-960.webp`,
      `${key}-1600.webp`,
    ]);
    const metas = await Promise.all(variants.map((v) => sharp(v.body).metadata()));
    expect(metas.map((m) => [m.format, m.width, m.height])).toEqual([
      ['webp', 480, 320],
      ['webp', 960, 640],
      ['webp', 1200, 800],
    ]);
    expect(metas.every((m) => m.exif === undefined)).toBe(true);
    expect(await displaySize(original)).toEqual({ width: 1200, height: 800 });
  });

  it('1600보다 큰 사진은 1600으로 줄인 크기를 저장한다', async () => {
    expect(await displaySize(await jpeg(3200, 2000))).toEqual({ width: 1600, height: 1000 });
  });

  it('EXIF 회전을 반영한다', async () => {
    const rotated = await sharp({
      create: { width: 400, height: 200, channels: 3, background: '#000' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect(await displaySize(rotated)).toEqual({ width: 200, height: 400 });
    const [small] = await toWebpVariants(rotated, 'members/x');
    const meta = await sharp(small!.body).metadata();
    expect([meta.width, meta.height]).toEqual([200, 400]);
  });
});

describe('download', () => {
  const noSleep = async () => {};

  it('일시 오류는 다시 시도한다', async () => {
    const body = await jpeg(10, 10);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(okResponse(body));
    await expect(download('https://x/a.jpg', { fetchImpl, sleep: noSleep })).resolves.toEqual(body);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('만료된 링크(403)는 다시 시도하지 않는다', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('<Error/>', { status: 403 }));
    const result = download('https://x/a.jpg', { fetchImpl, sleep: noSleep });
    await expect(result).rejects.toBeInstanceOf(DownloadError);
    await expect(result).rejects.toThrow('만료');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('너무 큰 파일은 Content-Length만 보고 끊는다', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('x', { status: 200, headers: { 'content-length': String(80 * 1024 * 1024) } }),
      );
    await expect(download('https://x/a.jpg', { fetchImpl, sleep: noSleep })).rejects.toThrow(
      '너무 큽니다',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('ImagePipeline', () => {
  const url = 'https://prod-files-secure.s3.amazonaws.com/ws/file-1/a.jpg?X-Amz-Signature=1';
  const file = {
    url,
    name: 'a.jpg',
    stableId: 'https://prod-files-secure.s3.amazonaws.com/ws/file-1/a.jpg',
  };

  it('처음엔 세 파일을 1600을 마지막으로 올리고, 같은 사진은 다시 올리지 않는다', async () => {
    const body = await jpeg(800, 600);
    const objects = new MemoryObjects();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => okResponse(body));
    const pipeline = new ImagePipeline(objects, new Map(), { fetchImpl });

    const first = await pipeline.process('members', file);
    const key = `members/${sha256(body)}`;
    expect(first).toEqual({
      image: { imageKey: key, width: 800, height: 600 },
      downloaded: true,
      uploaded: true,
    });
    expect(objects.puts).toEqual([`${key}-480.webp`, `${key}-960.webp`, `${key}-1600.webp`]);

    // 같은 Notion 파일: 캐시 적중, 내려받지도 않는다.
    const second = await pipeline.process('members', { ...file, url: `${url}&new-signature` });
    expect(second).toMatchObject({ downloaded: false, uploaded: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // 다른 파일 주소지만 내용이 같은 사진: 내려받지만 올리지는 않는다.
    const third = await pipeline.process('members', {
      url: 'https://prod-files-secure.s3.amazonaws.com/ws/file-2/b.jpg?sig',
      name: 'b.jpg',
      stableId: 'https://prod-files-secure.s3.amazonaws.com/ws/file-2/b.jpg',
    });
    expect(third).toMatchObject({ downloaded: true, uploaded: false, image: { imageKey: key } });
    expect(objects.puts).toHaveLength(3);
  });

  it('캐시가 있어도 저장된 파일이 없으면 다시 만든다', async () => {
    const body = await jpeg(100, 100);
    const objects = new MemoryObjects();
    const key = `members/${sha256(body)}`;
    const cache = new Map([
      [`members:${file.stableId}`, { imageKey: key, width: 100, height: 100 }],
    ]);
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => okResponse(body));
    const outcome = await new ImagePipeline(objects, cache, { fetchImpl }).process('members', file);
    expect(outcome.uploaded).toBe(true);
    expect(objects.files.has(`${key}-1600.webp`)).toBe(true);
  });

  it('읽을 수 없는 형식이면 알아듣기 쉬운 오류', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => okResponse(Buffer.from('not an image')));
    await expect(
      new ImagePipeline(new MemoryObjects(), new Map(), { fetchImpl }).process('members', file),
    ).rejects.toThrow('이미지 형식을 읽을 수 없습니다');
  });
});
