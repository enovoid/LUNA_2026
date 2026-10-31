// 홈 스크롤 인트로. 스크롤 진행률 p(0~1) 하나로 모든 레이어를 계산한다.
// - GSAP 타임라인 하나 + ScrollTrigger(scrub). 고정은 pin 대신 CSS sticky. 스크롤 잠금·자동 스냅 없음.
// - 레이어는 transform·opacity만 바꾼다. 한 프레임에 한 번(render)만 스타일을 쓴다.
// - 움직임 줄이기 설정이면 GSAP을 아예 내려받지 않는다(CSS가 정적 화면을 보여 줌).
//
// 타임라인(p). 달→로고 전환은 사용자가 맞춰 둔 PR #7 흐름 그대로이고(흰 화면 없음), 뒤에 구름 구간을 이어 붙였다.
// 앞부분 구간 길이(px)는 예전과 같도록 p를 travel 비율(2.8 → 3.8)만큼 줄였다.
//   0.00–0.04  안내 문구가 사라진다
//   0.04–0.32  하늘이 달 중심으로 확대(지수)되고 달이 화면 가운데로 온다. 배율은 site.ts의 zoom에서 멈춘다
//   0.15–0.28  도시가 하늘보다 빠르게 커지며(시차) 사라진다
//   0.18–0.34  달 둘레에 라벤더 빛이 번지고, 달 바깥이 어두워진다
//   0.32–0.42  달이 같은 자리·같은 크기의 루나 로고로 바뀐다(사진이 먼저 어두워지고 로고가 떠오름)
//   0.42–0.50  로고가 제 크기로 자리 잡는다
//   0.50–0.58  로고 곡선 안쪽에서 "LUNA" 글자가 옆으로 나오고 로고는 왼쪽으로 비켜 선다
//   0.57–0.64  "IT Social Venture · Since …" + "세상을 비추는 달, LUNA"
//   0.64–0.72  로고와 제목이 완전히 보이는 구간
//   0.72–0.90  구름이 닫히며 로고를 덮는다(사용자 요청: "구름 뒤로 로고가 숨었으면")
//   0.80–0.92  구름 틈새를 바탕색 막이 채우고 아래쪽 22%가 바탕색으로 어두워진다 → 다음 섹션과 이음새 없음
//   0.92–1.00  상단 내비 로고가 나타난다 → 소개 문단으로 이어짐

import { springEase } from '../lib/motion';

/** luna.svg 바깥 원의 중심이 상자 중심에서 오른쪽으로 떨어진 정도(로고 폭 대비). (388.64 - 369) / 738 */
const LOGO_CIRCLE_DX = (388.64 - 369) / 738;

interface SceneConfig {
  mx: number;
  my: number;
  moon: number;
  aspect: number;
  zoom: number;
}
interface IntroConfig {
  media: string;
  desktop: SceneConfig;
  mobile: SceneConfig;
}

const section = document.querySelector<HTMLElement>('[data-intro]');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

if (section && !reduceMotion.matches) {
  start(section).catch((error: unknown) => {
    // GSAP을 못 불러오면(네트워크 오류 등) 애니메이션 없이 정적 화면으로 바꾼다.
    console.error('[intro] 애니메이션을 시작하지 못해 정적 화면으로 바꿉니다.', error);
    section.classList.add('is-static');
    showNavLogo();
  });
}

function showNavLogo() {
  const navLogo = document.querySelector<HTMLElement>('[data-nav-logo]');
  if (navLogo) navLogo.style.opacity = '1';
}

async function start(root: HTMLElement) {
  const config = JSON.parse(root.dataset.config ?? '{}') as IntroConfig;
  const mobileQuery = window.matchMedia(config.media);
  const q = (name: string) => root.querySelector<HTMLElement>(`[data-layer="${name}"]`);
  const stage = root.querySelector<HTMLElement>('.intro-stage');
  const sky = q('sky');
  const city = q('city');
  const ring = q('ring');
  const dark = q('dark');
  const cloudTop = q('cloudTop');
  const cloudBottom = q('cloudBottom');
  const fade = q('fade');
  const logo = q('logo');
  const logoBox = root.querySelector<HTMLElement>('[data-measure="logo"]');
  const wordmark = q('wordmark');
  const title = q('title');
  const hint = q('hint');
  const glow = root.querySelector<HTMLElement>('.intro-glow');
  const navLogo = document.querySelector<HTMLElement>('[data-nav-logo]');
  if (
    !stage ||
    !sky ||
    !city ||
    !ring ||
    !dark ||
    !cloudTop ||
    !cloudBottom ||
    !fade ||
    !logo ||
    !logoBox ||
    !wordmark ||
    !title ||
    !hint
  ) {
    return;
  }

  // 구름은 첫 화면 로딩(하늘·도시 사진)이 끝난 뒤에 받는다. 닫히는 구간까지는 스크롤이 한참 남아 있다.
  const showClouds = () => root.classList.add('has-clouds');
  if (document.readyState === 'complete') showClouds();
  else window.addEventListener('load', showClouds, { once: true });

  const [{ gsap }, { ScrollTrigger }] = await Promise.all([
    import('gsap'),
    import('gsap/ScrollTrigger'),
  ]);
  gsap.registerPlugin(ScrollTrigger);

  // 각 값은 0→1 진행도. render()가 이것으로 실제 transform·opacity를 계산한다.
  const s = {
    hint: 0,
    z: 0,
    zc: 0,
    k: 0,
    cityOut: 0,
    glow: 0,
    ring: 0,
    dim: 0,
    morph: 0,
    settle: 0,
    lock: 0,
    title: 0,
    cloud: 0,
    fade: 0,
    nav: 0,
  };

  // 레이아웃 값(크기가 바뀔 때만 다시 잰다). transform이 없는 상자를 재므로 애니메이션 상태와 무관하다.
  const m = { moonPx: 0, logoPx: 1, dx: 0, dy: 0, lift: 0 };
  const measure = () => {
    const c = mobileQuery.matches ? config.mobile : config.desktop;
    const st = stage.getBoundingClientRect();
    const layerW = Math.max(st.width, st.height * c.aspect);
    m.moonPx = (layerW * c.moon * c.zoom) / 100;
    // 세로 사진이 화면보다 길면(좁은 화면) 위·아래가 반씩 잘려 건물이 하단 탭 바 뒤로 숨는다.
    // 첫 화면에서는 사진 아래 끝을 화면 아래 끝에 맞춰 건물을 탭 바 위로 올리고, 달이 가운데로 오는 동안(k) 원래대로 돌린다.
    m.lift = mobileQuery.matches ? Math.max(0, (layerW / c.aspect - st.height) / 2) : 0;
    const box = logoBox.getBoundingClientRect();
    m.logoPx = box.width || 1;
    // 로고 상자 중심 → 화면 중심까지의 거리. 달이 있던 자리에서 로고가 시작한다.
    // 로고의 바깥 원은 상자 중심보다 살짝 오른쪽에 있어(luna.svg: 중심 388.6/738) 그만큼 왼쪽으로 당긴다.
    m.dx = st.left + st.width / 2 - (box.left + box.width / 2) - LOGO_CIRCLE_DX * m.moonPx;
    m.dy = st.top + st.height / 2 - (box.top + box.height / 2);
    stage.style.setProperty('--hole', `${(m.moonPx / 2).toFixed(1)}px`);
  };

  // 구름이 닫히는 정도(1이면 완전히 닫힘). 0.64 = 로고 아랫부분과 오른쪽 일부만 가린 위치(사용자 지정).
  const CLOUD_CLOSE = 0.64;

  const render = () => {
    const c = mobileQuery.matches ? config.mobile : config.desktop;
    const logZoom = Math.log(c.zoom);
    // 확대는 지수(로그 선형)로: 배율이 같은 비율로 늘어 속도가 일정하게 느껴진다.
    const skyScale = Math.exp(logZoom * s.z);
    const cityScale = Math.exp(logZoom * 1.6 * s.zc);
    const tx = `calc(-50% + ${((50 - c.mx) * s.k).toFixed(3)}%)`;
    const ty = `calc(-50% + ${((50 - c.my) * s.k).toFixed(3)}% - ${(m.lift * (1 - s.k)).toFixed(1)}px)`;

    // 어두운 막이 다 덮은 뒤에는 사진 레이어를 그리지 않는다(합성 비용 절약).
    const photoVisible = s.dim < 1 ? '' : 'hidden';
    sky.style.visibility = photoVisible;
    city.style.visibility = s.cityOut < 1 ? photoVisible : 'hidden';
    sky.style.transform = `translate3d(${tx}, ${ty}, 0) scale(${skyScale.toFixed(4)})`;
    city.style.transform = `translate3d(${tx}, ${ty}, 0) scale(${cityScale.toFixed(4)})`;
    city.style.opacity = (1 - s.cityOut).toFixed(3);
    if (glow) glow.style.opacity = (s.glow * (1 - s.dim)).toFixed(3);
    ring.style.opacity = s.ring.toFixed(3);
    dark.style.opacity = s.dim.toFixed(3);

    // 로고: 달 크기·화면 중심에서 시작 → 제 크기 → 옆으로 비켜 섬
    const startScale = m.moonPx / m.logoPx;
    const scale = startScale + (1 - startScale) * s.settle;
    const toCenter = 1 - s.lock;
    const lx = m.dx * toCenter;
    const ly = m.dy * (1 - s.settle);
    logo.style.opacity = s.morph.toFixed(3);
    logo.style.transform = `translate3d(${lx.toFixed(1)}px, ${ly.toFixed(1)}px, 0) scale(${scale.toFixed(4)})`;
    // 글자는 로고 곡선 안쪽에서 미끄러져 나온다(창 밖은 잘림).
    // 창 왼쪽 여백(로고 뒤에 숨는 부분)까지 완전히 비켜 있어야 글자 끝이 미리 비치지 않는다.
    const hide = 1 - s.lock;
    wordmark.style.transform = `translate3d(calc(${(-100 * hide).toFixed(2)}% - var(--logo) * ${(0.5 * hide).toFixed(3)}), 0, 0)`;
    title.style.opacity = s.title.toFixed(3);
    title.style.transform = `translate3d(0, ${(24 * (1 - s.title)).toFixed(1)}px, 0)`;

    // 구름: 자기 크기 기준 %로 화면 밖(102%)에서 제자리로. 가로로는 서로 반대로 흐른다. 로고 위를 덮는다.
    // 구름은 끝까지 닫히지 않고 로고 아랫부분·오른쪽 일부만 가린 채(정적 화면과 같은 위치) 멈춘다.
    const open = 1 - s.cloud * CLOUD_CLOSE;
    cloudTop.style.transform = `translate3d(${(8 * open).toFixed(2)}%, ${(-102 * open).toFixed(2)}%, 0)`;
    cloudBottom.style.transform = `translate3d(${(-50 - 6 * open).toFixed(2)}%, ${(102 * open).toFixed(2)}%, 0)`;
    fade.style.opacity = s.fade.toFixed(3);

    hint.style.opacity = (1 - s.hint).toFixed(3);
    if (navLogo) navLogo.style.opacity = s.nav.toFixed(3);
  };

  // 스크롤에 직접 묶인 움직임은 손가락(휠)을 그대로 따라가야 하므로 대칭 감속만 쓴다(HIG: 제스처를 따르는 움직임).
  const smooth = (t: number) => t * t * (3 - 2 * t);
  // "딱" 하고 자리 잡는 순간만 HIG bouncy 스프링(살짝 넘쳤다 돌아옴, 약 4%).
  const snap = springEase(0.5, 0.25);

  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    onUpdate: render,
    scrollTrigger: {
      trigger: root,
      start: 'top top',
      end: 'bottom bottom',
      // 휠은 한 칸(약 100px)씩 끊겨 들어오므로 0.5초 동안 따라잡게 해 부드럽게 잇고,
      // 터치·트랙패드는 이미 관성이 부드러우므로 지연을 줄여 손가락을 바로 따라오게 한다.
      scrub: window.matchMedia('(pointer: coarse)').matches ? 0.2 : 0.5,
      invalidateOnRefresh: true,
      onRefresh: () => {
        measure();
        render();
      },
    },
  });

  // 위치(두 번째 인자)와 길이가 곧 스크롤 진행률 p 구간이다. 타임라인 전체 길이 = 1.
  const span = (
    key: keyof typeof s,
    from: number,
    to: number,
    ease: (t: number) => number = (t) => t,
  ) =>
    tl.fromTo(
      s,
      { [key]: 0 },
      { [key]: 1, duration: to - from, ease, immediateRender: false },
      from,
    );

  // 구름이 로고를 덮는 순간(p=1)에 고정이 풀리고 무대가 그대로 위로 올라간다(사용자 요청: 가려지면 바로 스크롤).
  span('hint', 0, 0.045);
  span('z', 0.045, 0.364);
  span('zc', 0.045, 0.318);
  span('k', 0.045, 0.33, smooth);
  span('cityOut', 0.17, 0.318, smooth);
  span('glow', 0.205, 0.364, smooth);
  span('ring', 0.205, 0.386, smooth);
  span('dim', 0.364, 0.455, smooth); // 사진이 먼저 어두워지고
  span('morph', 0.386, 0.477, smooth); // 그 자리에서 로고가 떠오른다
  span('settle', 0.477, 0.568, smooth);
  span('lock', 0.568, 0.659, snap);
  span('title', 0.648, 0.727, smooth);
  span('cloud', 0.818, 1, smooth);
  span('fade', 0.864, 1, smooth);
  span('nav', 0.909, 1);

  measure();
  render();

  // 웹폰트(Pretendard)가 늦게 오면 "LUNA" 글자 폭과 제목 높이가 바뀌어 로고 상자 위치도 바뀐다.
  // 처음 잰 값으로 두면 달과 로고가 어긋나므로, 묶음 크기가 바뀔 때마다 다시 잰다.
  const remeasure = new ResizeObserver(() => {
    measure();
    render();
  });
  for (const el of root.querySelectorAll('.lockup, .intro-title')) remeasure.observe(el);
  document.fonts?.ready.then(() => {
    measure();
    render();
  });

  // 데스크톱↔모바일 에셋이 바뀌면 좌표도 바뀐다.
  mobileQuery.addEventListener('change', () => {
    measure();
    render();
  });
  // 사용자가 도중에 움직임 줄이기를 켜면 정적 화면으로 전환한다.
  reduceMotion.addEventListener('change', (e) => {
    if (!e.matches) return;
    tl.scrollTrigger?.kill();
    tl.kill();
    for (const el of [
      sky,
      city,
      ring,
      dark,
      cloudTop,
      cloudBottom,
      fade,
      logo,
      wordmark,
      title,
      hint,
      glow,
    ]) {
      el?.removeAttribute('style');
    }
    root.classList.add('is-static');
    showNavLogo();
  });
}
