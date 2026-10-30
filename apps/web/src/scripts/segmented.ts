// 세그먼트 컨트롤(디자인 시스템 SegmentedControl, radiogroup 패턴). 선택값을 URL 쿼리(?position=, ?year=)에 남긴다.
// 마크업은 Filter.astro가 정적으로 그리고, 첫 페인트 전 선택 표시는 FilterBoot의 인라인 스크립트가 맞춘다.
// 이 스크립트는 클릭·키보드·뒤로 가기와 선택 표시(thumb)의 snappy 스프링 이동만 맡는다(React 섬을 대신함, 약 1KB).
import {
  ALL,
  applyFilter,
  applyFilterWithTransition,
  readParam,
  writeParam,
} from '../lib/filter-dom';

function setup(root: HTMLElement) {
  const param = root.dataset.param ?? '';
  const unit = root.dataset.unit ?? '';
  const group = root.querySelector<HTMLElement>('[role="radiogroup"]');
  const thumb = root.querySelector<HTMLElement>('.segment-thumb');
  const status = root.querySelector<HTMLElement>('[aria-live]');
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  if (!group || !thumb || buttons.length === 0) return;
  const options = buttons.map((b) => b.value).filter((v) => v !== ALL);

  const current = () =>
    buttons.find((b) => b.getAttribute('aria-checked') === 'true') ?? buttons[0];

  const place = () => {
    const target = current();
    if (!target) return;
    thumb.style.width = `${target.offsetWidth}px`;
    thumb.style.transform = `translate3d(${target.offsetLeft}px, 0, 0)`;
  };

  const mark = (value: string) => {
    for (const b of buttons) {
      const on = b.value === value;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    place();
  };

  const select = (value: string) => {
    mark(value);
    const shown = applyFilterWithTransition(param, value);
    writeParam(param, value);
    if (status) status.textContent = `${value === ALL ? '전체' : value} ${shown}${unit}`;
  };

  // 첫 배치는 애니메이션 없이, 다음 프레임부터 스프링으로 움직인다.
  const initial = readParam(param, options);
  mark(initial);
  if (initial !== ALL) applyFilter(param, initial);
  requestAnimationFrame(() => group.classList.add('has-thumb'));
  new ResizeObserver(place).observe(group);

  group.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[role="radio"]');
    if (button && button.getAttribute('aria-checked') !== 'true') select(button.value);
  });

  group.addEventListener('keydown', (event) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    const edge = { Home: 0, End: buttons.length - 1 }[event.key];
    if (step === undefined && edge === undefined) return;
    event.preventDefault();
    const index = buttons.indexOf(current() as HTMLButtonElement);
    const next = buttons[edge ?? (index + (step ?? 0) + buttons.length) % buttons.length];
    if (!next) return;
    select(next.value);
    next.focus();
  });

  // 뒤로·앞으로 가기는 URL 상태로 맞추기만 한다(전환 효과·안내 없이).
  window.addEventListener('popstate', () => {
    const value = readParam(param, options);
    mark(value);
    applyFilter(param, value);
  });
}

for (const root of document.querySelectorAll<HTMLElement>('[data-segmented]')) setup(root);
