// GitHub Actions 호출. 토큰은 이 저장소만, Actions: Read and write 권한의 fine-grained token.

export type WorkflowFile = 'sync.yml' | 'deploy.yml';

export interface WorkflowRun {
  id: number;
  /** queued, in_progress, completed … */
  status: string;
  /** success, failure, cancelled, skipped … (끝나기 전엔 null) */
  conclusion: string | null;
  /** push, repository_dispatch, schedule, workflow_dispatch … */
  event: string;
  createdAt: string;
  url: string;
}

export interface GitHub {
  /** sync.yml을 실행한다(관리자 페이지의 "지금 다시 동기화"). */
  runSync(options: { full: boolean }): Promise<void>;
  /** deploy.yml을 실행한다(DB 내용으로 사이트를 다시 빌드·배포). */
  deploySite(): Promise<void>;
  recentRuns(workflow: WorkflowFile, count: number): Promise<WorkflowRun[]>;
}

export class GitHubError extends Error {
  override name = 'GitHubError';
}

export function createGitHub(
  token: string,
  repository: string,
  fetchImpl: typeof fetch = fetch,
): GitHub {
  const call = async (path: string, init: RequestInit = {}) => {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'luna-admin',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const hint =
        response.status === 401 || response.status === 403 || response.status === 404
          ? ' (GITHUB_TOKEN 권한이나 저장소 이름을 확인하세요)'
          : '';
      const body = await response.text().catch(() => '');
      throw new GitHubError(`GitHub API ${response.status}${hint} ${body.slice(0, 200)}`.trim());
    }
    return response;
  };

  return {
    async runSync({ full }) {
      await call('/actions/workflows/sync.yml/dispatches', {
        method: 'POST',
        body: JSON.stringify({ ref: 'main', inputs: { full: String(full) } }),
      });
    },
    async deploySite() {
      await call('/actions/workflows/deploy.yml/dispatches', {
        method: 'POST',
        body: JSON.stringify({ ref: 'main' }),
      });
    },
    async recentRuns(workflow, count) {
      const response = await call(`/actions/workflows/${workflow}/runs?per_page=${count}`);
      const data = (await response.json()) as { workflow_runs?: GitHubRun[] };
      return (data.workflow_runs ?? []).map((run) => ({
        id: run.id,
        status: run.status ?? 'unknown',
        conclusion: run.conclusion ?? null,
        event: run.event ?? '',
        createdAt: run.created_at ?? '',
        url: run.html_url ?? '',
      }));
    },
  };
}

interface GitHubRun {
  id: number;
  status?: string | null;
  conclusion?: string | null;
  event?: string;
  created_at?: string;
  html_url?: string;
}
