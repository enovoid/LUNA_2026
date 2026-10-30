// 관리자 화면. 서버에서 HTML을 다 그리고, 버튼은 일반 폼 전송이라 브라우저 JS가 필요 없다.
import {
  type SettingsByKey,
  type SettingsKey,
  settingsFields,
  settingsLabel,
} from '@luna/db/settings';
import type { WorkflowRun } from './github.js';
import { type Html, html, raw } from './html.js';
import type { StoredSetting, SyncStateRow } from './store.js';

export type Loaded<T> = { ok: true; value: T } | { ok: false; error: string };

export interface PageModel {
  viewer: { email: string };
  siteUrl?: string;
  notice?: Notice;
  sync: Loaded<SyncStateRow[]>;
  syncRuns: Loaded<WorkflowRun[]>;
  deployRuns: Loaded<WorkflowRun[]>;
  settings: Loaded<{ [K in SettingsKey]?: StoredSetting<K> }>;
  /** 검사에 실패한 폼: 입력한 값을 그대로 다시 보여 준다. */
  rejected?: { key: SettingsKey; input: Record<string, string>; errors: string[] };
  now: Date;
}

export const NOTICES = {
  'sync-started': {
    tone: 'ok',
    text: '동기화를 시작했어요. 1~3분 뒤 이 페이지를 새로고침하면 결과가 보여요.',
  },
  'deploy-started': { tone: 'ok', text: '사이트 배포를 시작했어요. 보통 2~3분 걸려요.' },
  saved: { tone: 'ok', text: '저장했어요. 사이트에 반영하는 배포를 시작했어요(보통 2~3분).' },
  'saved-deploy-failed': {
    tone: 'warn',
    text: '저장은 됐지만 배포를 시작하지 못했어요. 아래 "사이트 다시 배포"를 눌러 주세요.',
  },
  'github-failed': {
    tone: 'error',
    text: 'GitHub Actions를 부르지 못했어요. 잠시 뒤 다시 시도하고, 계속되면 GITHUB_TOKEN 설정을 확인해 주세요.',
  },
  'db-failed': {
    tone: 'error',
    text: '데이터베이스에 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
  },
} as const satisfies Record<string, { tone: 'ok' | 'warn' | 'error'; text: string }>;

export type Notice = keyof typeof NOTICES;

export function isNotice(value: string | null): value is Notice {
  return value !== null && Object.hasOwn(NOTICES, value);
}

const DATABASE_LABELS: Record<string, string> = {
  members: '멤버',
  awards: '수상',
  projects: '프로젝트',
  faqs: 'FAQ',
};

const SETTINGS_TITLES: Record<SettingsKey, { title: string; help: string }> = {
  recruit: {
    title: '모집 정보',
    help: '모집 기수와 지원서 링크가 모두 있어야 사이트에 모집 섹션과 "지원하기" 버튼이 보여요. 모집이 끝나면 칸을 비우고 저장하세요.',
  },
  contact: {
    title: '연락처·SNS',
    help: '사이트 푸터에 보여요. 빈 칸은 표시하지 않아요.',
  },
};

const PLACEHOLDERS: Record<string, string> = {
  generation: '9기',
  period: '3월 2일 ~ 3월 15일',
  target: '재학생 누구나',
  applyUrl: 'https://forms.gle/…',
  email: 'luna@example.com',
  instagram: 'https://instagram.com/…',
  github: 'https://github.com/…',
};

export function renderPage(model: PageModel): string {
  const page = html`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>LUNA 관리자</title>
<style>${raw(STYLE)}</style>
</head>
<body>
<header class="top">
  <div class="wrap top-inner">
    <strong class="brand">LUNA 관리자</strong>
    <nav>
      ${model.siteUrl ? html`<a href="${model.siteUrl}" target="_blank" rel="noopener">사이트 열기</a>` : ''}
      <span class="who">${model.viewer.email}</span>
      <a href="/cdn-cgi/access/logout">로그아웃</a>
    </nav>
  </div>
</header>
<main class="wrap">
  ${model.notice ? noticeBox(model.notice) : ''}
  <p class="lead">글과 사진은 Notion에서 고치면 15분 안에 사이트에 반영돼요. 여기서는 Notion에 없는 것만 다뤄요.</p>
  ${syncSection(model)}
  ${deploySection(model)}
  ${settingsSection(model, 'recruit')}
  ${settingsSection(model, 'contact')}
</main>
</body>
</html>`;
  return page.value;
}

function noticeBox(notice: Notice): Html {
  const { tone, text } = NOTICES[notice];
  return html`<p class="notice ${tone}" role="status">${text}</p>`;
}

function syncSection(model: PageModel): Html {
  const rows = model.sync.ok ? model.sync.value : [];
  const byName = new Map(rows.map((row) => [row.database, row]));
  const running = byName.get('_running');
  const dispatch = byName.get('_dispatch');
  const pendingDispatch = isRecord(dispatch?.lastResult) && dispatch.lastResult.pending === true;

  return html`<section aria-labelledby="sync-title">
  <h2 id="sync-title">Notion 동기화</h2>
  ${!model.sync.ok ? html`<p class="notice error">동기화 상태를 읽지 못했어요: ${model.sync.error}</p>` : ''}
  ${
    running
      ? html`<p class="notice ok">지금 동기화 중이에요 (${triggerLabel(running.lastResult)}, ${formatTime(running.lastRunAt)} 시작).</p>`
      : ''
  }
  ${
    pendingDispatch
      ? html`<p class="notice warn">동기화 뒤 사이트 빌드 호출이 실패해 다음 동기화 때 다시 불러요. ${dispatch?.lastError ?? ''}</p>`
      : ''
  }
  ${
    model.sync.ok
      ? html`<div class="table"><table>
    <thead><tr><th scope="col">Notion DB</th><th scope="col">마지막 실행</th><th scope="col">결과</th><th scope="col">오류</th></tr></thead>
    <tbody>${Object.keys(DATABASE_LABELS).map((name) => syncRow(name, byName.get(name), model.now))}</tbody>
  </table></div>`
      : ''
  }
  <form method="post" action="/admin/sync" class="actions">
    <label class="check"><input type="checkbox" name="full" value="1"> 전체 다시 반영(--full, 오래 걸려요)</label>
    <button type="submit">지금 다시 동기화</button>
  </form>
  <p class="help">Notion에서 고친 내용을 15분 기다리지 않고 바로 가져와요. 바뀐 게 있으면 사이트 배포까지 이어져요.</p>
  ${runList('최근 수동 동기화', model.syncRuns)}
</section>`;
}

function syncRow(name: string, row: SyncStateRow | undefined, now: Date): Html {
  const label = DATABASE_LABELS[name] ?? name;
  if (!row)
    return html`<tr><th scope="row">${label}</th><td colspan="3" class="muted">아직 실행 기록이 없어요</td></tr>`;
  const stale = row.lastRunAt && now.getTime() - row.lastRunAt.getTime() > 60 * 60_000;
  return html`<tr>
    <th scope="row">${label}</th>
    <td>${formatTime(row.lastRunAt)}${stale ? html` <span class="badge warn">1시간 넘게 멈춤</span>` : ''}</td>
    <td>${resultSummary(row.lastResult)}</td>
    <td>${row.lastError ? html`<span class="err">${row.lastError}</span>` : html`<span class="muted">없음</span>`}</td>
  </tr>`;
}

function resultSummary(result: unknown): string {
  if (!isRecord(result)) return '—';
  if (result.aborted) return '시작하지 못함';
  const parts: string[] = [];
  const count = (key: string, label: string) => {
    const n = result[key];
    if (typeof n === 'number' && n > 0) parts.push(`${label} ${n}`);
  };
  count('created', '추가');
  count('updated', '수정');
  count('deleted', '삭제');
  count('failed', '실패');
  count('imagesUploaded', '사진');
  return parts.length > 0 ? parts.join(' · ') : '바뀐 것 없음';
}

function triggerLabel(result: unknown): string {
  const trigger = isRecord(result) ? result.trigger : undefined;
  if (trigger === 'admin') return '관리자 페이지에서 시작';
  if (trigger === 'cron') return '15분 자동 실행';
  return typeof trigger === 'string' ? trigger : '시작한 곳 모름';
}

function deploySection(model: PageModel): Html {
  return html`<section aria-labelledby="deploy-title">
  <h2 id="deploy-title">사이트 배포</h2>
  ${runList('최근 배포', model.deployRuns)}
  <form method="post" action="/admin/deploy" class="actions">
    <button type="submit" class="secondary">사이트 다시 배포</button>
  </form>
  <p class="help">DB에 있는 내용으로 사이트를 다시 만들어요. 배포가 실패하면 이전 사이트가 그대로 남아요.</p>
</section>`;
}

function runList(title: string, runs: Loaded<WorkflowRun[]>): Html {
  if (!runs.ok) return html`<p class="notice error">${title}: 불러오지 못했어요. ${runs.error}</p>`;
  if (runs.value.length === 0) return html`<p class="muted">${title}: 아직 없어요</p>`;
  return html`<h3>${title}</h3><ul class="runs">${runs.value.map(
    (run) => html`<li>
      ${runBadge(run)}
      <span>${formatTime(new Date(run.createdAt))}</span>
      <span class="muted">${EVENT_LABELS[run.event] ?? run.event}</span>
      ${run.url ? html`<a href="${run.url}" target="_blank" rel="noopener">기록 보기</a>` : ''}
    </li>`,
  )}</ul>`;
}

const EVENT_LABELS: Record<string, string> = {
  push: '코드 변경',
  repository_dispatch: '콘텐츠·설정 변경',
  schedule: '주간 예약',
  workflow_dispatch: '수동 실행',
};

function runBadge(run: WorkflowRun): Html {
  if (run.status !== 'completed') return html`<span class="badge ok">진행 중</span>`;
  switch (run.conclusion) {
    case 'success':
      return html`<span class="badge ok">성공</span>`;
    case 'failure':
    case 'timed_out':
      return html`<span class="badge error">실패</span>`;
    case 'cancelled':
      return html`<span class="badge muted">취소됨</span>`;
    default:
      return html`<span class="badge muted">${run.conclusion ?? run.status}</span>`;
  }
}

function settingsSection<K extends SettingsKey>(model: PageModel, key: K): Html {
  const { title, help } = SETTINGS_TITLES[key];
  const stored = model.settings.ok ? model.settings.value[key] : undefined;
  const rejected = model.rejected?.key === key ? model.rejected : undefined;
  const values: Record<string, string> =
    rejected?.input ?? (stored?.value as SettingsByKey[K] & Record<string, string>) ?? {};

  return html`<section aria-labelledby="${key}-title">
  <h2 id="${key}-title">${title}</h2>
  <p class="help">${help}</p>
  ${!model.settings.ok ? html`<p class="notice error">저장된 값을 읽지 못했어요: ${model.settings.error}</p>` : ''}
  ${
    rejected
      ? html`<div class="notice error" role="alert"><p>저장하지 않았어요. 아래를 고쳐 주세요.</p><ul>${rejected.errors.map((e) => html`<li>${e}</li>`)}</ul></div>`
      : ''
  }
  <form method="post" action="/admin/settings/${key}" class="fields">
    ${settingsFields(key).map(
      (field) => html`<label>
      <span>${settingsLabel(key, field)}</span>
      <input name="${field}" value="${values[field] ?? ''}" placeholder="${PLACEHOLDERS[field] ?? ''}" inputmode="${INPUT_MODES[field] ?? 'text'}" autocomplete="off">
    </label>`,
    )}
    <div class="actions">
      <button type="submit" ${model.settings.ok ? '' : html`disabled`}>저장하고 사이트에 반영</button>
      ${
        stored
          ? html`<span class="muted">마지막 수정 ${formatTime(stored.updatedAt)}${stored.updatedBy ? ` · ${stored.updatedBy}` : ''}</span>`
          : html`<span class="muted">아직 저장한 적 없음</span>`
      }
    </div>
  </form>
</section>`;
}

const INPUT_MODES: Record<string, string> = {
  applyUrl: 'url',
  email: 'email',
  instagram: 'url',
  github: 'url',
};

const timeFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatTime(date: Date | null | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return '—';
  return timeFormat.format(date);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const STYLE = `
:root { color-scheme: light dark; --bg:#f6f6f8; --card:#fff; --fg:#1c1c1e; --muted:#5f5f66; --line:#e2e2e7;
  --accent:#5b4bdb; --onaccent:#fff; --ok:#1f7a3d; --okbg:#e7f5ec; --warn:#8a5a00; --warnbg:#fff4dc; --err:#b42318; --errbg:#fdecea; }
@media (prefers-color-scheme: dark) { :root { --bg:#0f0f14; --card:#1a1a22; --fg:#f2f2f5; --muted:#a3a3ad; --line:#2c2c36;
  --accent:#9d92ff; --onaccent:#14112b; --ok:#6fd394; --okbg:#13301f; --warn:#ffcc66; --warnbg:#33260a; --err:#ff8a80; --errbg:#3a1512; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.6 system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; }
.wrap { max-width: 880px; margin: 0 auto; padding: 0 16px; }
.top { background: var(--card); border-bottom: 1px solid var(--line); }
.top-inner { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:56px; flex-wrap:wrap; }
.top nav { display:flex; gap:14px; align-items:center; flex-wrap:wrap; font-size:14px; }
.who { color: var(--muted); }
a { color: var(--accent); }
.lead { color: var(--muted); margin: 20px 0; }
section { background: var(--card); border:1px solid var(--line); border-radius: 14px; padding: 20px; margin: 0 0 16px; }
h2 { font-size: 18px; margin: 0 0 12px; }
h3 { font-size: 14px; margin: 16px 0 6px; color: var(--muted); }
.help, .muted { color: var(--muted); font-size: 14px; }
.table { overflow-x: auto; }
table { width:100%; min-width: 560px; border-collapse: collapse; font-size: 14px; }
tbody th, td:nth-child(2), td:nth-child(3) { white-space: nowrap; }
th, td { text-align:left; padding: 8px 10px 8px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
thead th { color: var(--muted); font-weight: 500; }
.err { color: var(--err); white-space: pre-wrap; word-break: break-word; }
.notice { padding: 10px 14px; border-radius: 10px; margin: 12px 0; }
.notice p, .notice ul { margin: 0; }
.notice.ok { background: var(--okbg); color: var(--ok); }
.notice.warn { background: var(--warnbg); color: var(--warn); }
.notice.error { background: var(--errbg); color: var(--err); }
.badge { display:inline-block; font-size:12px; padding: 1px 8px; border-radius: 99px; background: var(--line); }
.badge.ok { background: var(--okbg); color: var(--ok); }
.badge.warn { background: var(--warnbg); color: var(--warn); }
.badge.error { background: var(--errbg); color: var(--err); }
.runs { list-style:none; padding:0; margin:0; font-size:14px; }
.runs li { display:flex; gap:10px; align-items:center; flex-wrap:wrap; padding: 4px 0; }
.actions { display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-top: 14px; }
.check { display:flex; gap:6px; align-items:center; font-size:14px; }
.fields label { display:block; margin: 0 0 12px; }
.fields label span { display:block; font-size: 14px; margin-bottom: 4px; }
input:not([type]), input[type=text] { width:100%; font: inherit; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); }
button { font: inherit; font-weight: 600; padding: 10px 16px; border-radius: 10px; border: 0; background: var(--accent); color: var(--onaccent); cursor: pointer; }
button.secondary { background: transparent; color: var(--accent); border: 1px solid var(--accent); }
button:disabled { opacity: .5; cursor: not-allowed; }
:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
`;
