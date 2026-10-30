// 사이트 전역 설정. Notion에서 관리하지 않는 값만 여기에 둔다.
// 모집 정보와 연락처는 운영진이 관리자 페이지(apps/admin)에서 고치고 DB(site_settings)에서 읽는다 → loadSiteData().settings

export interface IntroSceneVariant {
  /** 이미지 원본 가로세로비(가로/세로) */
  aspect: number;
  /** 달 중심(이미지 폭·높이에 대한 %) */
  moonX: number;
  moonY: number;
  /** 달 지름(이미지 폭에 대한 %) */
  moonDiameter: number;
  /** 하늘 레이어 최대 확대 배율. 이 배율에서 멈춘 뒤 달이 로고로 바뀐다. */
  zoom: number;
  sky: string;
  city: string;
  /** 달 부분만 잘라 Real-ESRGAN으로 키운 고해상도 사진. 하늘 레이어의 달 위에 겹친다. */
  moonDetail: string;
  /** moonDetail 한 변의 길이(이미지 폭에 대한 %) */
  moonDetailSize: number;
  width: number;
  height: number;
}

export const site = {
  name: 'LUNA',
  title: '루나 LUNA — IT 소셜벤처 동아리',
  description:
    '세상을 비추는 달, LUNA. 기술로 사회 문제를 푸는 IT 소셜벤처 동아리 루나의 멤버, 프로젝트, 수상 기록을 소개합니다.',
  /** TODO: 창립 연도 확인(요청서 기준 2018). 비우면(null) "Since …" 문구를 숨긴다. */
  foundedYear: 2018 as number | null,

  /** 인트로 사진 출처 표기. 라이선스상 필요하면 채운다(푸터에 표시). */
  photoCredit: 'Unsplash',

  introScene: {
    /**
     * 실제 밤 도시 사진을 쓸지(public/intro/*.webp, Unsplash 라이선스).
     * false면 같은 좌표에 CSS로 그린 임시 하늘·달을 쓴다.
     */
    usePhotos: true,
    desktop: {
      aspect: 2400 / 1350,
      moonX: 49.38,
      moonY: 33.33,
      moonDiameter: 14.5,
      zoom: 2.4,
      sky: '/intro/intro-desk-sky.webp',
      city: '/intro/intro-desk-city.webp',
      moonDetail: '/intro/intro-desk-moon.webp',
      moonDetailSize: (400 / 2400) * 100,
      width: 2400,
      height: 1350,
    },
    mobile: {
      aspect: 900 / 1947,
      moonX: 50.05,
      moonY: 35.95,
      moonDiameter: 39.2,
      zoom: 1.7,
      sky: '/intro/intro-mob-sky.webp',
      city: '/intro/intro-mob-city.webp',
      moonDetail: '/intro/intro-mob-moon.webp',
      moonDetailSize: (400 / 900) * 100,
      width: 900,
      height: 1947,
    },
    /** 모바일 에셋으로 바꾸는 기준 */
    mobileMedia: '(max-aspect-ratio: 3/4)',
    /** 데스크톱·모바일 공용 구름(투명 배경). 로고와 제목이 다 나온 뒤 위·아래에서 닫히며 로고를 덮는다. */
    clouds: {
      top: { src: '/intro/intro-cloud-top.webp', width: 1717, height: 860 },
      bottom: { src: '/intro/intro-cloud-bottom.webp', width: 1717, height: 956 },
    },
  } satisfies {
    usePhotos: boolean;
    desktop: IntroSceneVariant;
    mobile: IntroSceneVariant;
    mobileMedia: string;
    clouds: Record<'top' | 'bottom', { src: string; width: number; height: number }>;
  },
} as const;

export const nav = [
  { key: 'home', label: '홈', href: '/' },
  { key: 'members', label: '멤버', href: '/members' },
  { key: 'projects', label: '프로젝트', href: '/projects' },
  { key: 'awards', label: '수상', href: '/awards' },
  { key: 'faq', label: 'FAQ', href: '/faq' },
] as const;

export type NavKey = (typeof nav)[number]['key'];
