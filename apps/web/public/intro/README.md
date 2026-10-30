# 인트로 사진

`intro-desk-sky.webp`, `intro-desk-city.webp`(2400×1350), `intro-mob-sky.webp`, `intro-mob-city.webp`(900×1947), 달 고해상도 `intro-desk-moon.webp`, `intro-mob-moon.webp`(1200×1200).

- 출처: Unsplash(Unsplash License: 상업적 이용·수정 허용, 출처 표기 선택). 푸터에 "인트로 사진: Unsplash"로 표기한다(`site.ts`의 `photoCredit`).
- 달 고해상도본은 하늘 사진의 달 부분(400×400)을 Real-ESRGAN x4plus(BSD-3)로 4배 키운 뒤 1200px로 줄인 것. 파일이 없으면 하늘 사진의 달을 그대로 쓴다.
- 사진을 바꾸면 `site.ts`의 `introScene` 좌표(moonX·moonY·moonDiameter)도 다시 잰다.
