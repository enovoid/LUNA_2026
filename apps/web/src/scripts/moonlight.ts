// 마우스 주변을 달빛처럼 은은하게 밝힌다. 빛 한 장(.moonlight)을 transform으로만 옮긴다(레이아웃·페인트 없음).
// 마우스·펜이 있는 기기에서만 켜고, 터치와 움직임 줄이기에서는 CSS가 숨긴다.
// 빛은 포인터를 살짝 늦게 따라간다(프레임마다 남은 거리의 20%, 약 0.2초에 따라잡음). 멈추면 rAF도 멈춘다.
const light = document.querySelector<HTMLElement>('[data-moonlight]');
const enabled = window.matchMedia(
  '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)',
);

if (light) {
  let x = 0;
  let y = 0;
  let tx = 0;
  let ty = 0;
  let frame = 0;
  let visible = false;

  const tick = () => {
    x += (tx - x) * 0.2;
    y += (ty - y) * 0.2;
    light.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    frame = Math.abs(tx - x) + Math.abs(ty - y) > 0.5 ? requestAnimationFrame(tick) : 0;
  };

  const hide = () => {
    visible = false;
    light.classList.remove('is-on');
  };

  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'touch' || !enabled.matches) return;
      tx = e.clientX;
      ty = e.clientY;
      if (!visible) {
        // 처음 들어올 때는 그 자리에서 켜진다(화면 구석에서 날아오지 않게).
        x = tx;
        y = ty;
        visible = true;
        light.classList.add('is-on');
      }
      if (!frame) frame = requestAnimationFrame(tick);
    },
    { passive: true },
  );
  document.documentElement.addEventListener('pointerleave', hide);
  window.addEventListener('blur', hide);
  enabled.addEventListener('change', (e) => {
    if (!e.matches) hide();
  });
}
