# 인트로 사진

`intro-desk-sky.webp`, `intro-desk-city.webp`(2400×1350), `intro-mob-sky.webp`, `intro-mob-city.webp`(900×1947), 달 고해상도 `intro-desk-moon.webp`, `intro-mob-moon.webp`(1200×1200).

- 출처: Unsplash(Unsplash License: 상업적 이용·수정 허용, 출처 표기 선택). 푸터에 "인트로 사진: Unsplash"로 표기한다(`site.ts`의 `photoCredit`).
- 달 고해상도본은 하늘 사진의 달 부분(400×400)을 Real-ESRGAN x4plus(BSD-3)로 4배 키운 뒤 1200px로 줄인 것. 파일이 없으면 하늘 사진의 달을 그대로 쓴다.
- 하늘 사진은 원본에서 달과 달무리만 3분할선으로 옮긴 것(데스크톱 22.6% → 33.3%, 모바일 31.9% → 36%). 도시 실루엣·지평선은 원본 그대로.
- 사진을 바꾸면 `site.ts`의 `introScene` 좌표(moonX·moonY·moonDiameter)도 다시 잰다.

## 구름

`intro-cloud-top.webp`(1717×860), `intro-cloud-bottom.webp`(1717×956), 투명 배경. 데스크톱·모바일 공용. 운영진이 2026-10-30에 첨부한 파일.

- TODO: 라이선스 확인(출처·허용 범위). 확인 전에는 공개 배포하지 않는다. 출처 표기가 필요하면 `site.ts`의 `photoCredit`에 더한다.
