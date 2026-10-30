// 정적으로 그려 둔 카드에 필터를 적용한다. 세그먼트 스크립트(scripts/segmented.ts)와 첫 페인트 전 인라인 스크립트가 같은 규칙을 쓴다.
// 규칙(인라인 스크립트도 이와 같아야 함 → components/FilterBoot.astro):
//   [data-filter-scope=<param>] 안의 [data-filter-item]은 data-<param> 값이 같을 때만 보인다(ALL이면 전부).
//   항목이 하나도 안 보이는 [data-filter-group]은 숨기고, 전부 숨으면 [data-filter-empty]를 보인다.
export const ALL = '전체';

export function applyFilter(param: string, value: string) {
  const scope = document.querySelector<HTMLElement>(`[data-filter-scope="${param}"]`);
  if (!scope) return 0;
  let shown = 0;
  for (const item of scope.querySelectorAll<HTMLElement>('[data-filter-item]')) {
    const match = value === ALL || item.dataset[param] === value;
    item.hidden = !match;
    if (match) shown++;
  }
  for (const group of scope.querySelectorAll<HTMLElement>('[data-filter-group]')) {
    group.hidden = !group.querySelector('[data-filter-item]:not([hidden])');
  }
  const empty = scope.querySelector<HTMLElement>('[data-filter-empty]');
  if (empty) empty.hidden = shown > 0;
  return shown;
}

/**
 * applyFilter와 같지만, 지원하는 브라우저에서는 View Transition으로 카드가 새 자리로 미끄러지고
 * 사라지는 카드는 흐려지며 빠진다(HIG: 바뀐 내용의 출처를 보여 주는 공간 연속성).
 * 동작 줄이기면 카드 이름을 붙이지 않아 화면 전체가 크로스페이드만 한다.
 */
export function applyFilterWithTransition(param: string, value: string) {
  const scope = document.querySelector<HTMLElement>(`[data-filter-scope="${param}"]`);
  if (!scope || !document.startViewTransition) return applyFilter(param, value);
  const items = [...scope.querySelectorAll<HTMLElement>('[data-filter-item]')];
  const shown = items.filter((item) => value === ALL || item.dataset[param] === value).length;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // 화면 밖 카드까지 이름을 붙이면 캡처가 무거워지므로 보이는 범위 근처만 움직인다.
  const near = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return r.bottom > -window.innerHeight && r.top < window.innerHeight * 2;
  };
  const named = reduce ? [] : items.filter((el) => !el.hidden && near(el));
  named.forEach((el, i) => {
    el.style.viewTransitionName = `filter-item-${i}`;
  });
  // 이름 붙은 카드는 루트 스냅숏 위에 그려진다. 헤더 유리 막대는 루트에 속해 있어 그대로 두면 전환 동안
  // 카드가 막대를 덮어 헤더가 사라졌다 나타나 보인다. 전환 동안만 헤더도 이름을 붙여 카드 위에 둔다.
  // 이름이 붙으면 막대의 흐림이 뒤를 못 보므로(backdrop root) 그동안은 막대를 불투명하게 칠한다(Header.astro).
  const header = document.querySelector<HTMLElement>('[data-site-header]');
  if (header && named.length > 0) {
    header.style.viewTransitionName = 'site-header';
    header.dataset.solid = '';
  }
  const transition = document.startViewTransition(() => {
    applyFilter(param, value);
  });
  transition.finished.finally(() => {
    for (const el of named) el.style.viewTransitionName = '';
    if (header) {
      header.style.viewTransitionName = '';
      delete header.dataset.solid;
    }
  });
  return shown;
}

export function readParam(param: string, options: readonly string[]) {
  const value = new URLSearchParams(window.location.search).get(param);
  return value && options.includes(value) ? value : ALL;
}

export function writeParam(param: string, value: string) {
  const url = new URL(window.location.href);
  if (value === ALL) url.searchParams.delete(param);
  else url.searchParams.set(param, value);
  window.history.replaceState(window.history.state, '', url);
}
