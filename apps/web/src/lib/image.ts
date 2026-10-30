import type { ImageRef } from './data';

export const IMAGE_WIDTHS = [480, 960, 1600] as const;

/** 사진 파일 경로. 빌드가 DB(image_files)에서 꺼내 같은 경로의 정적 파일로 내보낸다(`pages/img/[...file].ts`). */
export const imageFile = (key: string, width: number) => `${key}-${width}.webp`;

/** 사이트에 쓰이는 사진들의 파일 이름 전부. */
export function imageFilesFor(images: Iterable<ImageRef | null>): string[] {
  const files = new Set<string>();
  for (const image of images)
    if (image) for (const w of IMAGE_WIDTHS) files.add(imageFile(image.key, w));
  return [...files];
}

/** 같은 출처의 /img/ 아래 정적 파일로 src·srcset을 만든다. 사진이 없으면 null을 돌려 자리표시로 그린다. */
export function imageSources(image: ImageRef | null) {
  if (!image) return null;
  const url = (w: number) => `/img/${imageFile(image.key, w)}`;
  // 원본이 작으면 큰 파일도 원본 폭으로 저장된다. 실제 폭이 같은 후보는 하나만 남긴다.
  const seen = new Set<number>();
  const srcset = IMAGE_WIDTHS.flatMap((w) => {
    const actual = Math.min(w, image.width);
    if (seen.has(actual)) return [];
    seen.add(actual);
    return [`${url(w)} ${actual}w`];
  }).join(', ');
  return { src: url(960), srcset, width: image.width, height: image.height };
}
