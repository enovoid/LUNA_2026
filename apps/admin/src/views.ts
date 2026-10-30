// 관리자 화면. 서버에서 HTML을 다 그리고, 버튼은 일반 폼 전송이라 JS 없이도 동작한다.
// admin.js는 사진 미리 올리기·진행률, 사이트 반영 상태 표시 같은 편의 기능만 더한다.

import { isAdminCreated } from '@luna/db/content';
import {
  RECRUIT_STATUSES,
  type SettingsByKey,
  type SettingsKey,
  settingsFields,
  settingsLabel,
} from '@luna/db/settings';
import { assetUrl } from './assets.js';
import { CONTENT, CONTENT_TABLES, type ContentTable, type FieldDef, formValue } from './content.js';
import { type Html, html } from './html.js';
import { MAX_UPLOAD_BYTES } from './images.js';

/** 가져오기는 zip을 메모리에 풀므로(약 3배) 서버 메모리에 맞춰 둔다. */
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

import type { JobRun, JobsStatus } from './jobs.js';
import type { ContentRow, StoredAdmins, StoredSetting, SyncStateRow } from './store.js';

export type Loaded<T> = { ok: true; value: T } | { ok: false; error: string };

export interface PageModel {
  viewer: { email: string; name: string };
  /** Railway 변수 ADMIN_EMAILS(관리자 화면에서 못 지움) */
  owners: string[];
  /** 관리자 화면에서 추가한 운영진 */
  admins: Loaded<StoredAdmins>;
  notice?: Notice;
  sync: Loaded<SyncStateRow[]>;
  jobs: JobsStatus;
  /** 사이트를 한 번이라도 만들었는지 */
  siteReady: boolean;
  settings: Loaded<{ [K in SettingsKey]?: StoredSetting<K> }>;
  /** 멤버 DB에 있는 루나 기수 번호. 모집 기수 선택지를 만든다. */
  generations: Loaded<number[]>;
  /** 테이블마다 항목 수 */
  counts: Loaded<Record<ContentTable, number>>;
  /** 검사에 실패한 폼: 입력한 값을 그대로 다시 보여 준다. */
  rejected?: { key: SettingsKey; input: Record<string, string>; errors: string[] };
  now: Date;
}

export const NOTICES = {
  'sync-started': {
    tone: 'ok',
    text: '동기화를 시작했어요. 1~3분 뒤 새로고침하면 결과가 보여요. 바뀐 게 있으면 사이트도 이어서 다시 만들어요.',
  },
  'build-started': {
    tone: 'ok',
    text: '사이트를 다시 만들기 시작했어요. 1~2분 걸리고, 그동안은 이전 사이트가 그대로 보여요.',
  },
  saved: { tone: 'ok', text: '저장했어요. 사이트를 다시 만들고 있어요(1~2분 뒤 반영).' },
  'admin-added': {
    tone: 'ok',
    text: '운영진을 추가했어요. 그 Google 계정으로 바로 로그인할 수 있어요.',
  },
  'admin-removed': {
    tone: 'ok',
    text: '운영진에서 뺐어요. 그 계정은 바로 관리자 페이지를 쓸 수 없어요.',
  },
  'admin-invalid': { tone: 'error', text: '이메일 주소 형식이 올바르지 않아요.' },
  'content-saved': { tone: 'ok', text: '저장했어요. 사이트에 반영하는 중이에요(1~2분).' },
  'content-deleted': { tone: 'ok', text: '지웠어요. 사이트에서도 곧 빠져요.' },
  'content-missing': { tone: 'warn', text: '이미 지워졌거나 없는 항목이에요.' },
  'import-started': {
    tone: 'ok',
    text: '올렸어요. 뒤에서 가져오고 있고, 끝나면 사이트도 다시 만들어요. 아래 "최근 작업"에서 결과를 볼 수 있어요.',
  },
  'import-failed': {
    tone: 'error',
    text: '파일을 받지 못했어요. Notion에서 "Markdown & CSV"로 내보낸 200MB 이하 zip인지 확인해 주세요.',
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
    help: '모집 기수를 고르면 사이트에 모집 섹션이 보여요. "지원하기" 버튼은 모집 중이고, 지원 기간 안이고, 지원서 링크가 있을 때만 보여요. 마감일이 지나거나 "마감"으로 바꾸면 "모집 마감"으로 바뀌어요(날짜는 매일 0시에 다시 확인). 섹션을 아예 내리려면 "모집 안 함"을 고르세요.',
  },
  contact: {
    title: '연락처·SNS',
    help: '사이트 푸터에 보여요. 빈 칸은 표시하지 않아요.',
  },
};

const PLACEHOLDERS: Record<string, string> = {
  target: '재학생 누구나',
  applyUrl: 'https://forms.gle/…',
  email: 'luna@example.com',
  instagram: 'https://www.instagram.com/dimigo_luna/',
  github: 'https://github.com/…',
};

function documentHead(title = 'LUNA 관리자'): Html {
  return html`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="same-origin">
<title>${title}</title>
<link rel="stylesheet" href="${assetUrl('admin.css')}">
<script src="${assetUrl('admin.js')}" defer></script>
</head>`;
}

export type Section = 'home' | ContentTable;

export interface Frame {
  viewer: { email: string; name: string };
  status: JobState;
}

/** 모든 관리자 화면의 머리글(메뉴, 사이트 반영 상태, 로그인한 사람). */
export function layout(frame: Frame, active: Section, title: string, body: Html): string {
  const tabs: [Section, string, string][] = [
    ['home', '홈', '/admin/'],
    ...CONTENT_TABLES.map((t): [Section, string, string] => [
      t,
      CONTENT[t].label,
      `/admin/content/${t}`,
    ]),
  ];
  return html`${documentHead(`${title} · LUNA 관리자`)}
<body>
<header class="top">
  <div class="wrap top-inner">
    <a class="brand" href="/admin/">LUNA</a>
    <nav class="tabs" aria-label="관리 메뉴">${tabs.map(
      ([key, label, href]) =>
        html`<a href="${href}" ${key === active ? html`aria-current="page"` : ''}>${label}</a>`,
    )}</nav>
    <div class="me">
      ${statusPill(frame.status)}
      <a href="/" target="_blank" rel="noopener">사이트</a>
      <span class="who" title="${frame.viewer.email}">${frame.viewer.name}</span>
      <form method="post" action="/admin/logout" class="inline"><button type="submit" class="link">로그아웃</button></form>
    </div>
  </div>
</header>
<main class="wrap">
${body}
</main>
</body>
</html>`.value;
}

/** 머리글의 사이트 반영 상태. admin.js가 /admin/status.json으로 새로 고친다. */
export interface JobState {
  busy: boolean;
  tone: 'idle' | 'busy' | 'ok' | 'error';
  label: string;
  detail: string;
}

export function jobState(jobs: JobsStatus, siteReady: boolean): JobState {
  const { running, queued, recent, buildPending } = jobs;
  if (running || queued.length > 0) {
    const kind = running?.kind ?? queued[0] ?? 'build';
    return {
      busy: true,
      tone: 'busy',
      label:
        kind === 'import'
          ? '가져오는 중…'
          : kind === 'build' || queued.includes('build')
            ? '사이트에 반영 중…'
            : 'Notion 확인 중…',
      detail: running ? `${JOB_LABELS[running.kind]} · ${running.reason}` : '곧 시작해요',
    };
  }
  if (!siteReady || buildPending) {
    return {
      busy: false,
      tone: 'error',
      label: '반영 실패',
      detail: '홈의 "사이트" 기록에서 이유를 볼 수 있어요.',
    };
  }
  const last = recent.find((run) => run.kind === 'build');
  return {
    busy: false,
    tone: 'idle',
    label: '사이트 최신',
    detail: last ? `마지막 반영 ${formatTime(last.finishedAt ?? last.startedAt)}` : '',
  };
}

function statusPill(state: JobState): Html {
  return html`<a class="status" href="/admin/#site-title" data-status="/admin/status.json" data-tone="${state.tone}" title="${state.detail}" aria-live="polite">${state.label}</a>`;
}

export function renderLoginPage(model: { configured: boolean; error?: string }): string {
  return html`${documentHead()}
<body>
<main class="wrap login">
  <section aria-labelledby="login-title">
    <h1 id="login-title">LUNA 관리자</h1>
    <p class="help">운영진 목록에 있는 Google 계정만 들어올 수 있어요. 누가 무엇을 바꿨는지 이메일로 기록에 남아요.</p>
    ${model.error ? html`<p class="notice error" role="alert">${model.error}</p>` : ''}
    ${
      model.configured
        ? html`<div class="actions"><a class="button" href="/admin/login/google">Google 계정으로 로그인</a></div>`
        : html`<p class="notice warn">Google 로그인이 아직 설정되지 않았어요. Railway 변수 GOOGLE_CLIENT_ID와 GOOGLE_CLIENT_SECRET을 넣어 주세요.</p>`
    }
  </section>
</main>
</body>
</html>`.value;
}

export function renderPage(model: PageModel): string {
  const status = jobState(model.jobs, model.siteReady);
  return layout(
    { viewer: model.viewer, status },
    'home',
    '홈',
    html`<div class="page-head"><div><h1>홈</h1><p class="muted">사이트 내용은 위 메뉴에서 바로 고칠 수 있어요. 저장하면 1~2분 안에 사이트에 반영돼요.</p></div></div>
  ${model.notice ? noticeBox(model.notice) : ''}
  ${contentTiles(model)}
  ${siteSection(model)}
  ${importSection()}
  ${settingsSection(model, 'recruit')}
  ${settingsSection(model, 'contact')}
  ${syncSection(model)}
  ${adminsSection(model)}`,
  );
}

function importSection(): Html {
  return html`<section aria-labelledby="import-title">
  <h2 id="import-title">Notion 내보내기 가져오기</h2>
  <p class="help">Notion에서 ··· → 내보내기 → "Markdown & CSV"로 받은 zip을 올리면 멤버·수상·프로젝트·FAQ를 한 번에 가져와요. 여기서 직접 만들거나 고친 항목은 덮어쓰지 않아요.</p>
  <form method="post" action="/admin/import" enctype="multipart/form-data" class="photo" data-import="/admin/import" data-max-bytes="${MAX_IMPORT_BYTES}">
    <div class="photo-controls">
      <input type="file" name="file" accept=".zip,application/zip" required>
      <progress hidden></progress>
      <span data-upload-status>zip, 200MB까지. 올리면 뒤에서 가져와요.</span>
      <div class="actions"><button type="submit" class="secondary">올리고 가져오기</button></div>
    </div>
  </form>
</section>`;
}

function contentTiles(model: PageModel): Html {
  return html`<div class="tiles">${CONTENT_TABLES.map((table) => {
    const count = model.counts.ok ? model.counts.value[table] : undefined;
    return html`<a class="tile" href="/admin/content/${table}"><strong>${count ?? '—'}</strong><span>${CONTENT[table].label}</span></a>`;
  })}</div>`;
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
  <p class="help">Notion을 쓰지 않으면 이 구역은 신경 쓰지 않아도 돼요. 여기서 만든 항목은 동기화가 지우지 않아요.</p>
  ${!model.sync.ok ? html`<p class="notice error">동기화 상태를 읽지 못했어요: ${model.sync.error}</p>` : ''}
  ${
    running
      ? html`<p class="notice ok">지금 동기화 중이에요 (${triggerLabel(running.lastResult)}, ${formatTime(running.lastRunAt)} 시작).</p>`
      : ''
  }
  ${
    pendingDispatch
      ? html`<p class="notice warn">동기화 뒤 사이트 다시 만들기 요청이 실패해 다음 동기화 때 다시 요청해요. ${dispatch?.lastError ?? ''}</p>`
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
  <p class="help">Notion에서 고친 내용을 15분 기다리지 않고 바로 가져와요. 바뀐 게 있으면 사이트도 이어서 다시 만들어요.</p>
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

function siteSection(model: PageModel): Html {
  const { running, queued, recent, buildPending } = model.jobs;
  return html`<section aria-labelledby="site-title">
  <h2 id="site-title">사이트</h2>
  ${!model.siteReady ? html`<p class="notice warn">아직 사이트를 만들지 못했어요. 아래 기록에서 실패 이유를 확인해 주세요.</p>` : ''}
  ${buildPending && model.siteReady ? html`<p class="notice warn">마지막 사이트 만들기가 실패해 지금은 이전 사이트가 보여요. 다음 자동 동기화 때 다시 시도해요.</p>` : ''}
  ${running ? html`<p class="notice ok">지금 ${JOB_LABELS[running.kind]} 중이에요 (${running.reason}, ${formatTime(running.startedAt)} 시작).${queued.length > 0 ? ` 다음 차례: ${queued.map((k) => JOB_LABELS[k]).join(', ')}` : ''}</p>` : ''}
  ${
    recent.length > 0
      ? html`<h3>최근 작업</h3><ul class="runs">${recent.map(jobItem)}</ul>`
      : html`<p class="muted">서버가 시작된 뒤 작업 기록이 아직 없어요.</p>`
  }
  <form method="post" action="/admin/build" class="actions">
    <button type="submit" class="secondary">사이트 다시 만들기</button>
  </form>
  <p class="help">DB에 있는 내용으로 사이트를 다시 만들어요. 실패하면 이전 사이트가 그대로 남아요. 기록은 서버가 다시 시작되면 지워져요.</p>
</section>`;
}

const JOB_LABELS = {
  sync: 'Notion 동기화',
  import: 'Notion 내보내기 가져오기',
  build: '사이트 만들기',
} as const;

function jobItem(run: JobRun): Html {
  const badge =
    run.ok === undefined
      ? html`<span class="badge ok">진행 중</span>`
      : run.ok
        ? html`<span class="badge ok">성공</span>`
        : html`<span class="badge error">실패</span>`;
  const seconds = run.finishedAt
    ? Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000)
    : undefined;
  return html`<li>
    ${badge}
    <span>${JOB_LABELS[run.kind]}${run.full ? ' (전체)' : ''}</span>
    <span>${formatTime(run.startedAt)}</span>
    <span class="muted">${run.reason}${seconds !== undefined ? ` · ${seconds}초` : ''}</span>
    ${run.output ? html`<details><summary>출력 보기</summary><pre>${run.output}</pre></details>` : ''}
  </li>`;
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
      ${
        key === 'recruit' && field === 'generation'
          ? generationSelect(values[field] ?? '', model.generations)
          : key === 'recruit' && field === 'status'
            ? statusSelect(values[field] ?? '')
            : DATE_FIELDS.has(field)
              ? html`<input type="date" name="${field}" value="${values[field] ?? ''}">`
              : html`<input name="${field}" value="${values[field] ?? ''}" placeholder="${PLACEHOLDERS[field] ?? ''}" inputmode="${INPUT_MODES[field] ?? 'text'}" autocomplete="off">`
      }
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

/**
 * 모집 기수 선택지. 멤버 DB의 가장 높은 기수 다음 기수를 맨 위에 두고, 그 위로 두 기수, 아래로는 1기까지.
 * 멤버 기수를 못 읽으면 1~15기. 지금 저장된 값이 목록 밖이면 그것도 넣는다.
 */
export function generationOptions(current: string, known: Loaded<number[]>): string[] {
  const latest = known.ok && known.value.length > 0 ? Math.max(...known.value) : 13;
  const options: string[] = [];
  for (let n = latest + 2; n >= 1; n--) options.push(`${n}기`);
  if (current && !options.includes(current)) options.unshift(current);
  return options;
}

function generationSelect(current: string, known: Loaded<number[]>): Html {
  const latest = known.ok && known.value.length > 0 ? Math.max(...known.value) : undefined;
  return html`<select name="generation">
    <option value="" ${current ? '' : html`selected`}>모집 안 함</option>
    ${generationOptions(current, known).map(
      (option) =>
        html`<option value="${option}" ${option === current ? html`selected` : ''}>${option}${latest && option === `${latest + 1}기` ? ' (다음 기수)' : ''}</option>`,
    )}
  </select>`;
}

function adminsSection(model: PageModel): Html {
  const added = model.admins.ok
    ? model.admins.value.emails.filter((e) => !model.owners.includes(e))
    : [];
  return html`<section aria-labelledby="admins-title">
  <h2 id="admins-title">운영진</h2>
  <p class="help">여기 있는 Google 계정만 관리자 페이지에 들어올 수 있어요. Google Cloud의 OAuth 앱이 "테스트 중"이면 Google 인증 플랫폼 → 대상 → 테스트 사용자에도 같은 주소를 넣어 주세요.</p>
  ${!model.admins.ok ? html`<p class="notice error">운영진 목록을 읽지 못했어요: ${model.admins.error}</p>` : ''}
  <ul class="runs">
    ${model.owners.map(
      (email) =>
        html`<li><span>${email}</span><span class="muted">Railway 변수 ADMIN_EMAILS(여기서 못 지움)</span></li>`,
    )}
    ${added.map(
      (email) => html`<li><span>${email}</span>
      <form method="post" action="/admin/admins/remove" class="inline"><input type="hidden" name="email" value="${email}"><button type="submit" class="link">빼기</button></form></li>`,
    )}
  </ul>
  <form method="post" action="/admin/admins/add" class="actions">
    <input type="email" name="email" placeholder="new@gmail.com" autocomplete="off" required>
    <button type="submit" ${model.admins.ok ? '' : html`disabled`}>추가</button>
  </form>
  ${
    model.admins.ok && model.admins.value.updatedBy
      ? html`<p class="muted">마지막 수정 ${formatTime(model.admins.value.updatedAt)} · ${model.admins.value.updatedBy}</p>`
      : ''
  }
</section>`;
}

const DATE_FIELDS = new Set(['startDate', 'endDate']);

function statusSelect(current: string): Html {
  const value = current || 'open';
  return html`<select name="status">${Object.entries(RECRUIT_STATUSES).map(
    ([option, label]) =>
      html`<option value="${option}" ${option === value ? html`selected` : ''}>${label}</option>`,
  )}</select>`;
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

export interface ContentListModel extends Frame {
  table: ContentTable;
  rows: Loaded<ContentRow[]>;
  notice?: Notice;
}

export function renderContentList(model: ContentListModel): string {
  const def = CONTENT[model.table];
  const rows = model.rows.ok ? model.rows.value : [];
  return layout(
    model,
    model.table,
    def.label,
    html`<div class="page-head">
    <div><h1>${def.label}</h1><p class="muted">${model.rows.ok ? `${rows.length}개` : ''}</p></div>
    <a class="button" href="/admin/content/${model.table}/new">+ ${def.noun} 추가</a>
  </div>
  ${model.notice ? noticeBox(model.notice) : ''}
  ${!model.rows.ok ? html`<p class="notice error">목록을 읽지 못했어요: ${model.rows.error}</p>` : ''}
  ${
    model.rows.ok && rows.length === 0
      ? html`<div class="card empty-state">아직 ${def.label} 항목이 없어요. 오른쪽 위 버튼으로 추가해 보세요.</div>`
      : ''
  }
  ${
    rows.length > 0
      ? html`<div class="toolbar"><input type="search" placeholder="검색" aria-label="${def.label} 검색" data-filter hidden></div>
  <ul class="items" data-filter-list>${rows.map((row) => contentItem(model.table, row))}</ul>`
      : ''
  }`,
  );
}

function contentItem(table: ContentTable, row: ContentRow): Html {
  const def = CONTENT[table];
  const title = def.title(row.values) || '(제목 없음)';
  return html`<li><a href="/admin/content/${table}/${row.id}">
    ${def.images ? thumb(row.imageKey, 'thumb') : ''}
    <span class="item-text"><strong>${title}</strong><span>${def.subtitle(row.values) || ' '}</span></span>
    ${isAdminCreated(row.notionId) ? '' : html`<span class="badge">Notion</span>`}
  </a></li>`;
}

function thumb(imageKey: string | null, className: string): Html {
  return imageKey
    ? html`<img class="${className}" src="/admin/img/${imageKey}-480.webp" alt="" loading="lazy" decoding="async" data-preview>`
    : html`<span class="${className} empty" aria-hidden="true" data-preview>＋</span>`;
}

export interface ContentFormModel extends Frame {
  table: ContentTable;
  /** 고치는 행. 없으면 새로 만들기 */
  row?: ContentRow;
  /** 검사에 실패해 다시 보여 줄 입력 */
  input?: Record<string, string>;
  errors?: string[];
  /** 입력 후보: 열 이름 → 이미 쓰는 값 */
  suggestions: Record<string, string[]>;
}

export function renderContentForm(model: ContentFormModel): string {
  const def = CONTENT[model.table];
  const { row, input } = model;
  const editing = row !== undefined;
  const action = editing
    ? `/admin/content/${model.table}/${row.id}`
    : `/admin/content/${model.table}/new`;
  const pendingKey = input?.imageKey ?? '';
  const shownKey = pendingKey || (input?.removeImage === '1' ? null : (row?.imageKey ?? null));
  const fromNotion = row !== undefined && !isAdminCreated(row.notionId);
  const title = editing ? `${def.noun} 고치기` : `${def.noun} 추가`;

  const field = (f: FieldDef) => {
    const value = input ? (input[f.name] ?? '') : formValue(row?.values[f.name]);
    const list =
      f.suggest && (model.suggestions[f.name]?.length ?? 0) > 0 ? `${f.name}-options` : '';
    const control =
      f.kind === 'textarea'
        ? html`<textarea name="${f.name}" maxlength="${f.max ?? ''}" ${f.required ? html`required` : ''}>${value}</textarea>`
        : html`<input type="${f.kind === 'date' ? 'date' : 'text'}" name="${f.name}" value="${value}"
            ${f.max ? html`maxlength="${f.max * (f.kind === 'list' ? 20 : 1)}"` : ''}
            ${f.kind === 'int' ? html`inputmode="numeric" pattern="-?[0-9,]*"` : ''}
            ${f.placeholder ? html`placeholder="${f.placeholder}"` : ''}
            ${list ? html`list="${list}"` : ''} ${f.required ? html`required` : ''} autocomplete="off">`;
    return html`<label>
      <span>${f.label}${f.required ? ' *' : ''}</span>
      ${control}
      ${list ? html`<datalist id="${list}">${model.suggestions[f.name]?.map((v) => html`<option value="${v}">`)}</datalist>` : ''}
      ${f.help ? html`<p class="help">${f.help}</p>` : ''}
    </label>`;
  };

  return layout(
    model,
    model.table,
    title,
    html`<div class="page-head">
    <div><h1>${title}</h1>${row ? html`<p class="muted">마지막 수정 ${formatTime(row.editedAt)}</p>` : ''}</div>
    <a href="/admin/content/${model.table}">목록으로</a>
  </div>
  ${
    fromNotion
      ? html`<p class="notice warn">Notion에서 가져온 항목이에요. 여기서 고쳐도 되지만, 나중에 Notion에서 이 페이지를 고치면 그 내용으로 바뀌어요.</p>`
      : ''
  }
  ${
    model.errors && model.errors.length > 0
      ? html`<div class="notice error" role="alert"><p>저장하지 않았어요. 아래를 고쳐 주세요.</p><ul>${model.errors.map((e) => html`<li>${e}</li>`)}</ul></div>`
      : ''
  }
  <form method="post" action="${action}" enctype="multipart/form-data" class="card fields">
    ${
      def.images
        ? html`<div class="field"><span>사진</span>
      <div class="photo" data-upload="/admin/upload/${model.table}" data-max-bytes="${MAX_UPLOAD_BYTES}">
        ${thumb(shownKey, 'photo-preview')}
        <div class="photo-controls">
          <input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/avif,image/gif">
          <input type="hidden" name="imageKey" value="${pendingKey}">
          <progress hidden></progress>
          <span data-upload-status>${pendingKey ? '사진 준비 완료. 저장하면 반영돼요.' : 'JPG·PNG·WebP, 20MB까지. 고르면 바로 올라가요.'}</span>
          ${
            row?.imageKey
              ? html`<label class="check"><input type="checkbox" name="removeImage" value="1" ${input?.removeImage === '1' ? html`checked` : ''}> 사진 빼기</label>`
              : ''
          }
        </div>
      </div></div>`
        : ''
    }
    ${def.fields.map(field)}
    <div class="actions">
      <button type="submit">${editing ? '저장' : '추가'}</button>
      <a href="/admin/content/${model.table}">취소</a>
    </div>
  </form>
  ${
    editing
      ? html`<form method="post" action="/admin/content/${model.table}/${row.id}/delete" class="card danger-zone" data-confirm="정말 지울까요? 되돌릴 수 없어요.">
    <h2>지우기</h2>
    <p class="help">사이트에서 바로 빠져요.${fromNotion ? ' Notion 페이지는 그대로라서 Notion에서 이 페이지를 고치면 다시 생겨요. 완전히 없애려면 Notion에서도 지워 주세요.' : ''}</p>
    <button type="submit" class="danger">${def.noun} 지우기</button>
  </form>`
      : ''
  }`,
  );
}
