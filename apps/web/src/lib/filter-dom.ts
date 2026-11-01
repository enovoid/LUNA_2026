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
 * applyFilter와 같지만, 남는 카드는 새 자리로 미끄러지고(FLIP) 새로 나타난 카드는 흐릿하게 떠오른다
 * (HIG: 바뀐 내용의 출처를 보여 주는 공간 연속성). 동작 줄이기면 새 카드가 흐려지며 나타나기만 한다.
 *
 * View Transition(document.startViewTransition)은 쓰지 않는다. 화면 전체를 스냅숏으로 바꿔 끼우는 동안
 * Android Chrome·Brave(태블릿)에서 스크롤된 상태의 sticky 헤더가 스냅숏에서 빠져 내비게이션이 사라졌다 나타났다.
 * 카드 요소만 직접 움직이면 헤더는 실제 DOM 그대로 남아 있어 깜빡일 일이 없다.
 */
export function applyFilterWithTransition(param: string, value: string) {
  const scope = document.querySelector<HTMLElement>(`[data-filter-scope="${param}"]`);
  if (!scope || typeof scope.animate !== 'function') return applyFilter(param, value);
  const items = [...scope.querySelectorAll<HTMLElement>('[data-filter-item]')];
  const before = new Map<HTMLElement, DOMRect>();
  for (const el of items) if (!el.hidden) before.set(el, el.getBoundingClientRect());
  const shown = applyFilter(param, value);

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const { duration, easing } = smoothSpring();
  for (const el of items) {
    if (el.hidden) continue;
    const r = el.getBoundingClientRect();
    // 화면 밖 카드는 움직여도 보이지 않으므로 건너뛴다.
    if (r.bottom < -window.innerHeight || r.top > window.innerHeight * 2) continue;
    const prev = before.get(el);
    if (!prev) {
      const from = reduce ? { opacity: 0 } : { opacity: 0, transform: 'scale(0.96)' };
      animate(el, [from, { opacity: 1, transform: 'none' }], { duration, easing });
      continue;
    }
    const dx = prev.left - r.left;
    const dy = prev.top - r.top;
    if (reduce || (Math.abs(dx) < 1 && Math.abs(dy) < 1)) continue;
    animate(el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
      duration,
      easing,
    });
  }
  return shown;
}

/** 새로 보이는 영역을 흐릿하게 띄운다(기수 탭처럼 내용을 통째로 바꿀 때). */
export function fadeIn(el: HTMLElement) {
  if (typeof el.animate !== 'function') return;
  animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: 'ease' });
}

// global.css의 --spring-smooth(linear() 이징)와 길이를 그대로 쓴다.
function smoothSpring() {
  const css = getComputedStyle(document.documentElement);
  const dur = Number.parseFloat(css.getPropertyValue('--spring-smooth-dur'));
  return {
    duration: Number.isFinite(dur) && dur > 0 ? dur * 1000 : 500,
    easing: css.getPropertyValue('--spring-smooth').trim() || 'ease',
  };
}

function animate(el: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
  // 진행 중이던 애니메이션은 끊고 새 자리에서 다시 시작한다.
  for (const a of el.getAnimations()) a.cancel();
  try {
    el.animate(frames, options);
  } catch {
    // linear() 이징을 모르는 브라우저
    el.animate(frames, { ...options, easing: 'ease' });
  }
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
