// 인트로 밤하늘에 가끔 별똥별이 하나 지나간다. 하늘 사진이 그대로 보이는 첫 화면(스크롤 맨 위)에서만, 10~22초에 한 번.
// 달을 가로지르지 않도록 달 왼쪽·오른쪽 위 하늘에서 바깥쪽 아래로 떨어진다. 도시 사진 뒤를 지나간다(레이어 순서).
// 별똥별 하나(.meteor)를 다시 쓰며 transform·opacity만 움직인다(Web Animations, 합성 단계에서 처리).
// 움직임 줄이기·정적 화면·탭이 가려진 동안에는 띄우지 않는다.
const root = document.querySelector<HTMLElement>('[data-intro]');
const meteor = root?.querySelector<HTMLElement>('[data-meteor]');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

if (root && meteor && !reduceMotion.matches && typeof meteor.animate === 'function') {
  const rand = (min: number, max: number) => min + Math.random() * (max - min);
  let timer = 0;

  const schedule = (delay: number) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(fall, delay);
  };

  function fall() {
    const top = root?.getBoundingClientRect().top ?? 0;
    // 조금이라도 스크롤해 하늘이 확대되기 시작했거나, 탭이 가려졌거나, 정적 화면이면 이번 차례는 건너뛴다.
    if (
      reduceMotion.matches ||
      document.hidden ||
      root?.classList.contains('is-static') ||
      top < -40 ||
      !meteor
    ) {
      schedule(rand(6000, 10000));
      return;
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    // 길이는 CSS 폭(120px) 고정, 좁은 화면에서는 scaleX로만 줄인다(폭을 바꾸지 않아 레이아웃 계산 없음).
    const len = 120;
    const k = Math.min(1, (w * 0.22) / len);
    const right = Math.random() < 0.5;
    // 시작: 달(가운데) 양옆의 위쪽 하늘. 방향: 바깥쪽 아래로 20~32°.
    const x0 = w * (right ? rand(0.6, 0.85) : rand(0.15, 0.4));
    const y0 = h * rand(0.05, 0.16);
    const angle = (rand(20, 32) * Math.PI) / 180;
    const dist = Math.min(w * 0.3, 320);
    const dx = Math.cos(angle) * dist * (right ? 1 : -1);
    const dy = Math.sin(angle) * dist;
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    // 원점이 머리(오른쪽 끝)라 머리 좌표에서 길이만큼 왼쪽으로 놓고 돌린다. 꼬리는 머리 뒤에서 늘었다 줄어든다.
    const at = (x: number, y: number, s: number) =>
      `translate3d(${(x - len).toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${deg.toFixed(1)}deg) scaleX(${(s * k).toFixed(3)})`;
    meteor.animate(
      [
        { transform: at(x0, y0, 0.2), opacity: 0 },
        { transform: at(x0 + dx * 0.35, y0 + dy * 0.35, 1), opacity: 0.85, offset: 0.35 },
        { transform: at(x0 + dx, y0 + dy, 0.6), opacity: 0 },
      ],
      { duration: 1100, easing: 'cubic-bezier(0.3, 0, 0.6, 1)' },
    );
    schedule(rand(10000, 22000));
  }

  schedule(rand(3000, 5000));
  reduceMotion.addEventListener('change', (e) => {
    if (e.matches) window.clearTimeout(timer);
  });
}
