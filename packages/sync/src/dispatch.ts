export interface DispatchTarget {
  token: string;
  /** owner/repo */
  repository: string;
}

export type Dispatcher = (payload: Record<string, unknown>) => Promise<void>;

/**
 * GitHub Actions 빌드를 시작한다(repository_dispatch, event_type: content-updated).
 * 토큰은 이 저장소의 Contents: write(dispatch) 권한만 가진 fine-grained token.
 */
export function createDispatcher(
  target: DispatchTarget,
  fetchImpl: typeof fetch = fetch,
): Dispatcher {
  return async (payload) => {
    const response = await fetchImpl(
      `https://api.github.com/repos/${target.repository}/dispatches`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${target.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': 'luna-sync',
        },
        body: JSON.stringify({ event_type: 'content-updated', client_payload: payload }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    // 성공하면 204 No Content.
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const hint =
        response.status === 401 || response.status === 403 || response.status === 404
          ? ' (토큰 권한이나 저장소 이름을 확인하세요)'
          : '';
      throw new Error(
        `repository_dispatch 실패: HTTP ${response.status}${hint} ${body.slice(0, 200)}`,
      );
    }
  };
}
