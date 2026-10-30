import { writeFile } from 'node:fs/promises';

export type Dispatcher = (payload: Record<string, unknown>) => Promise<void>;

/**
 * 사이트를 다시 만들라고 알린다. 사이트 서버(apps/admin)가 이 동기화를 자식 프로세스로 실행하면서
 * SYNC_NOTIFY_FILE에 파일 경로를 넘기고, 끝난 뒤 파일이 있으면 사이트를 다시 빌드한다.
 */
export function createFileNotifier(path: string): Dispatcher {
  return async (payload) => {
    await writeFile(path, JSON.stringify(payload));
  };
}
