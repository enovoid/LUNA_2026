// 헤더 바로 아래에 어두운 구역(data-tone="dark")이 있으면 헤더를 밝은 글자로 바꾼다.
const header = document.querySelector<HTMLElement>('[data-site-header]');
const darkZones = document.querySelectorAll<HTMLElement>(
  '[data-tone="dark"]:not([data-site-header])',
);

if (header && darkZones.length > 0) {
  const visible = new Set<Element>();
  let io: IntersectionObserver | undefined;

  const observe = () => {
    io?.disconnect();
    visible.clear();
    const band = header.offsetHeight;
    // 화면 맨 위 헤더 높이만큼의 띠만 관찰한다.
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target);
          else visible.delete(e.target);
        }
        header.dataset.tone = visible.size > 0 ? 'dark' : 'light';
      },
      { rootMargin: `0px 0px ${band - window.innerHeight}px 0px` },
    );
    for (const zone of darkZones) io.observe(zone);
  };

  observe();
  let timer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = window.setTimeout(observe, 150);
  });
}
