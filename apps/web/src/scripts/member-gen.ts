import { fadeIn } from '../lib/filter-dom';

// 기수 탭: 한 번에 한 기수만 보여 준다(예전 루나 사이트와 같은 방식). 선택은 ?gen=8 로 URL에 남는다.
// 첫 페인트 전 적용은 members.astro의 인라인 스크립트가 하고, 여기서는 누름·키보드·해시 링크를 맡는다.
const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-gen-tab]')];
const panels = [...document.querySelectorAll<HTMLElement>('[data-gen-panel]')];

function showGen(key: string, { focus = false } = {}) {
  for (const t of tabs) {
    const on = t.dataset.genTab === key;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    if (on && focus) t.focus();
  }
  for (const p of panels) p.hidden = p.dataset.genPanel !== key;
}

function selectGen(key: string, opts?: { focus?: boolean }) {
  const current = tabs.find((t) => t.getAttribute('aria-selected') === 'true')?.dataset.genTab;
  if (key === current) return;
  const url = new URL(location.href);
  if (key === tabs[0]?.dataset.genTab) url.searchParams.delete('gen');
  else url.searchParams.set('gen', key);
  url.hash = '';
  history.replaceState(history.state, '', url);
  showGen(key, opts);
  // 명단이 통째로 바뀌므로 새 명단을 흐릿하게 띄운다. View Transition은 쓰지 않는다:
  // 화면 전체 스냅숏을 바꿔 끼우는 동안 Android Chrome·Brave에서 스크롤된 sticky 헤더가 사라졌다 나타났다(lib/filter-dom.ts).
  const panel = panels.find((p) => p.dataset.genPanel === key);
  if (panel) fadeIn(panel);
}

for (const [i, t] of tabs.entries()) {
  t.addEventListener('click', () => selectGen(t.dataset.genTab ?? ''));
  t.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    const edge = { Home: 0, End: tabs.length - 1 }[e.key];
    if (step === undefined && edge === undefined) return;
    e.preventDefault();
    const next = tabs[edge ?? (i + (step ?? 0) + tabs.length) % tabs.length];
    selectGen(next?.dataset.genTab ?? '', { focus: true });
  });
}

// /members#member-… 링크: 그 멤버가 속한 기수를 열고 카드로 스크롤한다.
function fromHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  const card = id ? document.getElementById(id) : null;
  const panel = card?.closest<HTMLElement>('[data-gen-panel]');
  if (!card || !panel?.dataset.genPanel) return;
  showGen(panel.dataset.genPanel);
  card.scrollIntoView({ block: 'center' });
}
fromHash();
addEventListener('hashchange', fromHash);
