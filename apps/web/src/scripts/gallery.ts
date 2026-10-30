// 가로 갤러리의 이전·다음 버튼. 보이는 카드 묶음만큼 넘기고, 끝에 닿으면 버튼을 끈다.
// 넘칠 만큼 카드가 없으면 버튼은 자리만 차지한 채 보이지 않는다. 손가락·트랙패드로 넘기는 건 브라우저 스크롤 스냅이 맡는다.
for (const gallery of document.querySelectorAll<HTMLElement>('[data-gallery]')) {
  const track = gallery.querySelector<HTMLElement>('[data-gallery-track]');
  const nav = gallery.querySelector<HTMLElement>('[data-gallery-nav]');
  const prev = gallery.querySelector<HTMLButtonElement>('[data-gallery-prev]');
  const next = gallery.querySelector<HTMLButtonElement>('[data-gallery-next]');
  if (!track || !nav || !prev || !next) continue;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  // 한 번에 화면에 다 보이는 카드 수만큼 넘긴다(넓은 화면 3장, 중간 2장, 휴대폰 1장).
  const step = () => {
    const first = track.firstElementChild as HTMLElement | null;
    if (!first) return track.clientWidth;
    const cs = getComputedStyle(track);
    const gap = Number.parseFloat(cs.columnGap) || 0;
    const visible =
      track.clientWidth - Number.parseFloat(cs.paddingLeft) - Number.parseFloat(cs.paddingRight);
    const card = first.offsetWidth + gap;
    return Math.max(1, Math.floor((visible + gap) / card)) * card;
  };
  const update = () => {
    const max = track.scrollWidth - track.clientWidth;
    nav.classList.toggle('is-active', max > 1);
    prev.disabled = track.scrollLeft <= 1;
    next.disabled = track.scrollLeft >= max - 1;
  };
  const go = (dir: 1 | -1) =>
    track.scrollBy({ left: dir * step(), behavior: reduce.matches ? 'auto' : 'smooth' });

  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  track.addEventListener('scroll', update, { passive: true });
  new ResizeObserver(update).observe(track);
  update();
}
