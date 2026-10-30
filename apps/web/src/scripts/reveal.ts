// [data-reveal] 요소가 화면에 들어오면 한 번만 아래에서 올라오며 나타난다(opacity·transform만 바꿈).
const targets = document.querySelectorAll<HTMLElement>('[data-reveal]');

if (!('IntersectionObserver' in window)) {
  for (const el of targets) el.classList.add('is-revealed');
} else {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-revealed');
        io.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -12% 0px' },
  );
  for (const el of targets) io.observe(el);
}
