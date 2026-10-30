// 사진을 사이트와 같은 출처의 정적 파일로 내보낸다(dist/img/<table>/<sha256>-<폭>.webp).
// 동기화가 WebP로 바꿔 DB(image_files)에 넣어 둔 파일을 빌드 때 꺼낸다. 별도 이미지 저장소가 필요 없다.
import type { APIRoute, GetStaticPaths } from 'astro';
import { loadImageFiles, loadSiteData } from '../../lib/data';
import { imageFilesFor } from '../../lib/image';

export const getStaticPaths = (async () => {
  const data = await loadSiteData();
  const wanted = imageFilesFor(
    [...data.members, ...data.awards, ...data.projects].map((row) => row.image),
  );
  const files = await loadImageFiles(wanted);
  const missing = wanted.filter((file) => !files.has(file));
  if (missing.length > 0)
    console.warn(
      `[image] DB에 없는 사진 파일 ${missing.length}개는 자리표시로 보입니다: ${missing.slice(0, 3).join(', ')}`,
    );
  return [...files].map(([file, body]) => ({ params: { file }, props: { body } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ body: Uint8Array<ArrayBuffer> }> = ({ props }) =>
  new Response(props.body, { headers: { 'Content-Type': 'image/webp' } });
