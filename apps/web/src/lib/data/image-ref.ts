import type { ImageRef } from './types';

/** DB의 image_key·width·height 세 값이 모두 있어야 이미지로 본다. 하나라도 비면 자리표시로 그린다. */
export function toImageRef(
  key: string | null | undefined,
  width: number | null | undefined,
  height: number | null | undefined,
): ImageRef | null {
  if (!key || !width || !height || width <= 0 || height <= 0) return null;
  return { key, width, height };
}
