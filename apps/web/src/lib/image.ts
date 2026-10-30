import type { ImageRef } from './data';

export const IMAGE_WIDTHS = [480, 960, 1600] as const;

const base = (process.env.R2_PUBLIC_URL ?? '').replace(/\/+$/, '');
let warned = false;

/** R2 공개 URL로 src·srcset을 만든다. R2_PUBLIC_URL이 없으면 null을 돌려 자리표시로 그린다. */
export function imageSources(image: ImageRef | null) {
  if (!image) return null;
  if (!base) {
    if (!warned) console.warn('[image] R2_PUBLIC_URL이 없어 사진 대신 자리표시를 그립니다.');
    warned = true;
    return null;
  }
  const url = (w: number) => `${base}/${image.key}-${w}.webp`;
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
