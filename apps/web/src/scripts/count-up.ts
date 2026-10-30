// [data-count] 숫자가 화면에 들어오면 0부터 최종값까지 세어 올라간다(약 1.2초, 끝으로 갈수록 느려짐).
// 서버 HTML에는 최종값이 그대로 있어 JS가 없거나 움직임 줄이기면 아무것도 바꾸지 않는다.
import { formatWon } from '../lib/content';

const targets = document.querySelectorAll<HTMLElement>('[data-count]');
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const format = (el: HTMLElement, n: number) =>
  el.dataset.countFormat === 'won'
    ? formatWon(n)
    : `${n.toLocaleString('ko-KR')}${el.dataset.countUnit ?? ''}`;

if (!reduce && 'IntersectionObserver' in window && targets.length > 0) {
  const run = (el: HTMLElement) => {
    const to = Number(el.dataset.count);
    if (!Number.isFinite(to) || to <= 0) return;
    const start = performance.now();
    const duration = 1200;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 4;
      el.textContent = format(el, Math.round(to * eased));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.unobserve(entry.target);
        run(entry.target as HTMLElement);
      }
    },
    { rootMargin: '0px 0px -15% 0px' },
  );
  for (const el of targets) {
    // 아직 화면 밖에 있는 숫자만 0으로 돌려 둔다(이미 보이는 숫자가 깜빡이지 않게).
    if (el.getBoundingClientRect().top > window.innerHeight) {
      el.textContent = format(el, 0);
      io.observe(el);
    }
  }
}
