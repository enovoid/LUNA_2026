// 헤더 바로 아래가 배경이 꽉 찬 구역(data-header-clear: 인트로·소개)이면 유리 막대를 걷어 투명하게 둔다.
const header = document.querySelector<HTMLElement>('[data-site-header]');
const clearZones = document.querySelectorAll<HTMLElement>('[data-header-clear]');

if (header && clearZones.length > 0) {
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
        header.dataset.bar = visible.size > 0 ? 'off' : 'on';
      },
      { rootMargin: `0px 0px ${band - window.innerHeight}px 0px` },
    );
    for (const zone of clearZones) io.observe(zone);
  };

  observe();
  let timer = 0;
  let lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    // 모바일 주소창이 접히고 펴질 때는 높이만 바뀐다. 그때마다 다시 관찰하면 막대가 깜빡이므로 폭이 바뀔 때(회전·접기/펴기·창 크기)만 다시 잰다.
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(timer);
    timer = window.setTimeout(observe, 150);
  });
  window.addEventListener('orientationchange', () => {
    clearTimeout(timer);
    timer = window.setTimeout(observe, 300);
  });
}
