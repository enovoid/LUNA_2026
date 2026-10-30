// Apple HIG 모션: SwiftUI의 spring(response, bounce)과 같은 식을 0→1 이징 함수로 쓴다.
// CSS 쪽은 global.css의 --spring-* (같은 식을 linear()로 샘플링한 값)를 쓴다.

/** response: 한 번 진동하는 데 걸리는 시간(초), bounce: 0이면 넘침 없음, 0.3이면 약 5% 넘쳤다 돌아옴 */
export function springEase(response: number, bounce: number) {
  const w = (2 * Math.PI) / response;
  const z = 1 - bounce;
  const x =
    z >= 1
      ? (t: number) => 1 - Math.exp(-w * t) * (1 + w * t)
      : (() => {
          const wd = w * Math.sqrt(1 - z * z);
          return (t: number) =>
            1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
        })();
  // 스프링이 멈추는 시간(오차 0.2% 안)을 전체 구간으로 잡아 t=1에서 정확히 1이 되게 한다.
  let settle = response;
  while (settle < 5 && Math.abs(1 - x(settle)) > 0.002) settle += 0.01;
  return (t: number) => (t >= 1 ? 1 : x(t * settle));
}
