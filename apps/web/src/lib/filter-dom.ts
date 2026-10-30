// 정적으로 그려 둔 카드에 필터를 적용한다. React 섬과 첫 페인트 전 인라인 스크립트가 같은 규칙을 쓴다.
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
