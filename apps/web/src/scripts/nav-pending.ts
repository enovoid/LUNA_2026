// 페이지 이동이 늦을 때 화면이 멈춘 것처럼 보이지 않게 한다.
// 링크를 누르고 120ms 안에 새 페이지가 오지 않으면(미리 받아 둔 페이지는 거의 즉시 와서 이 단계를 건너뜀)
// 탭 선택을 먼저 옮기고, 도착할 페이지 모양의 스켈레톤을 본문 자리에 덮는다.
// 새 페이지가 오면 브라우저가 문서를 바꾸며 View Transition 크로스페이드로 스켈레톤 → 실제 내용으로 넘어간다.
// 스켈레톤 상자 크기는 실제 페이지의 격자·비율과 같게 잡아 바뀔 때 내용이 튀지 않게 한다.
// 제목은 미리 아는 글자라 그대로 쓰고, 필터·기수 탭 같은 내비게이션은 회색 상자로 그리지 않고 자리만 비워 둔다.

type Shape = 'home' | 'members' | 'projects' | 'awards' | 'faq';

const routes: Record<string, Shape> = {
  '/': 'home',
  '/members': 'members',
  '/projects': 'projects',
  '/awards': 'awards',
  '/faq': 'faq',
};

const DELAY = 120;
// 이 시간 안에 이동하지 않으면(취소·네트워크 오류) 원래 화면으로 돌려놓는다.
const GIVE_UP = 20_000;

const bar = (w: string, h = 16) => `<span class="sk" style="width:${w};height:${h}px"></span>`;
const repeat = (n: number, html: string) => html.repeat(n);

/** 내비게이션이 올 자리. 높이만 차지하고 아무것도 그리지 않는다. */
const space = (h: number, w = '100%') =>
  `<span class="sk-space" style="width:${w};height:${h}px"></span>`;

const head = (title: string, filter: boolean) =>
  `<div class="sk-head container-page"><h1 class="sk-title">${title}</h1>${filter ? space(36, 'min(320px, 100%)') : ''}</div>`;

const card = (ratio: string) =>
  `<div class="sk-card"><span class="sk" style="aspect-ratio:${ratio}"></span><div class="sk-card-text">${bar('60%', 18)}${bar('40%', 14)}</div></div>`;

const templates: Record<Shape, () => string> = {
  home: () => '<div class="sk-hero"><span class="sk sk-moon"></span></div>',
  members: () =>
    `${head('멤버', false)}<div class="container-page sk-body">${space(44)}${bar('6ch', 24)}<div class="sk-grid sk-grid-members">${repeat(8, card('1 / 1'))}</div></div>`,
  projects: () =>
    `${head('프로젝트', true)}<div class="container-page sk-body"><div class="sk-grid sk-grid-projects">${repeat(6, card('16 / 9'))}</div></div>`,
  awards: () =>
    `${head('수상', true)}<div class="container-page sk-body">${bar('5ch', 24)}<div class="sk-list">${repeat(5, '<span class="sk sk-row" style="height:88px"></span>')}</div></div>`,
  faq: () =>
    `${head('자주 묻는 질문', false)}<div class="container-page sk-body"><div class="sk-list">${repeat(6, '<span class="sk sk-row" style="height:64px"></span>')}</div></div>`,
};

let timer = 0;
let giveUp = 0;
let layer: HTMLElement | null = null;
let restore: (() => void) | null = null;

function reset() {
  clearTimeout(timer);
  clearTimeout(giveUp);
  layer?.remove();
  layer = null;
  restore?.();
  restore = null;
}

/** 헤더·탭 바의 현재 탭 표시를 도착할 페이지로 먼저 옮긴다. */
function moveCurrentTab(path: string) {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('.top-tabs a, .tab-bar a')];
  const before = links.map((a) => a.getAttribute('aria-current'));
  for (const a of links) {
    if (a.pathname === path) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  return () => {
    links.forEach((a, i) => {
      const value = before[i];
      if (value) a.setAttribute('aria-current', value);
      else a.removeAttribute('aria-current');
    });
  };
}

function show(path: string, shape: Shape) {
  const restoreTab = moveCurrentTab(path);
  layer = document.createElement('div');
  layer.className = `nav-skeleton nav-skeleton-${shape}`;
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = templates[shape]();
  document.body.append(layer);
  document.documentElement.setAttribute('aria-busy', 'true');
  restore = () => {
    restoreTab();
    document.documentElement.removeAttribute('aria-busy');
  };
  giveUp = window.setTimeout(reset, GIVE_UP);
}

document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const a = (event.target as Element | null)?.closest?.('a');
  if (!a?.href || a.hasAttribute('download')) return;
  if (a.target && a.target !== '_self') return;
  const url = new URL(a.href);
  if (url.origin !== location.origin) return;
  if (url.pathname === location.pathname && url.search === location.search) return;
  const shape = routes[url.pathname.replace(/\/$/, '') || '/'];
  if (!shape) return;
  reset();
  timer = window.setTimeout(() => show(url.pathname, shape), DELAY);
});

// 뒤로 가기 캐시(bfcache)에 들어갔다 돌아오면 스켈레톤이 남아 있지 않게 한다.
window.addEventListener('pagehide', () => clearTimeout(timer));
window.addEventListener('pageshow', (event) => {
  if (event.persisted) reset();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && layer) reset();
});
