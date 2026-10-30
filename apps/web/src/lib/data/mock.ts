// 개발용 목업 데이터. DATABASE_URL 없이 화면을 만들 때만 쓴다.
// 이름·대회·숫자는 모두 지어낸 값이며 실제 루나 기록이 아니다. 배포 빌드(LUNA_DATA_SOURCE=db)에서는 쓰이지 않는다.
import type { SiteData } from './types';

const positions = ['Designer', 'Developer', 'Planner'] as const;
const classes = ['디지털콘텐츠과', '소프트웨어과', 'IT경영과'] as const;
const names = [
  '김하늘',
  '이도윤',
  '박서연',
  '최민준',
  '정하린',
  '강지호',
  '조수아',
  '윤지우',
  '장예준',
  '임서윤',
  '한유진',
  '오태오',
];

export const mockData: SiteData = {
  source: 'mock',
  members: names.map((name, i) => ({
    id: `mock-member-${i}`,
    name,
    lunaGeneration: i < 5 ? 'LUNA 8기' : i < 9 ? 'LUNA 7기' : 'LUNA 6기',
    description:
      i === 3
        ? '밤하늘 사진 찍는 걸 좋아하고, 접근성 좋은 서비스를 만드는 개발자가 되고 싶어요.'
        : '한 줄 소개 자리',
    position: positions[i % positions.length] ?? 'Developer',
    schoolGeneration: `${23 - Math.floor(i / 5)}기`,
    className: classes[i % classes.length] ?? '',
    image: null,
  })),
  awards: [
    {
      id: 'mock-award-1',
      name: '예시 청소년 소셜벤처 경진대회',
      year: '2026',
      prize: '대상',
      team: '예시팀 A',
      memberNames: ['김하늘', '이도윤', '명단에없는사람'],
      date: '2026-08-07',
      prizeMoney: 300000,
      image: null,
    },
    {
      id: 'mock-award-2',
      name: '예시 해커톤',
      year: '2026',
      prize: '우수상',
      team: '예시팀 B',
      memberNames: ['박서연'],
      date: '2026-05-21',
      prizeMoney: null,
      image: null,
    },
    {
      id: 'mock-award-3',
      name: '예시 창업 아이디어 대회',
      year: '2025',
      prize: '장려상',
      team: '예시팀 C',
      memberNames: ['윤지우', '장예준'],
      date: '2025-11-02',
      prizeMoney: 100000,
      image: null,
    },
    {
      id: 'mock-award-4',
      name: '예시 앱 공모전',
      year: '2025',
      prize: '1위',
      team: '예시팀 D',
      memberNames: [],
      date: null,
      prizeMoney: 200000,
      image: null,
    },
  ],
  projects: [
    {
      id: 'mock-project-1',
      name: '예시 프로젝트 A',
      year: '2026',
      description: '프로젝트 설명 자리입니다. Notion Projects의 description이 여기에 들어갑니다.',
      awardNames: ['예시 청소년 소셜벤처 경진대회 대상'],
      image: null,
    },
    {
      id: 'mock-project-2',
      name: '예시 프로젝트 B',
      year: '2026',
      description:
        '설명이 길어질 때 카드가 어떻게 보이는지 확인하기 위한 문장입니다. 한글 줄바꿈은 단어 단위로 끊기고, 카드 높이는 같은 줄의 다른 카드와 맞춰집니다.',
      awardNames: [],
      image: null,
    },
    {
      id: 'mock-project-3',
      name: '예시 프로젝트 C',
      year: '2025',
      description: '프로젝트 설명 자리입니다.',
      awardNames: ['예시 앱 공모전 1위'],
      image: null,
    },
    {
      id: 'mock-project-4',
      name: '예시 프로젝트 D',
      year: '2024',
      description: '프로젝트 설명 자리입니다.',
      awardNames: [],
      image: null,
    },
  ],
  faqs: [
    {
      id: 'mock-faq-1',
      question: '루나는 어떤 동아리인가요?',
      answer:
        '루나는 IT 소셜벤처 동아리입니다. (목업 문구 — 실제 사이트에서는 Notion FAQ의 order가 가장 작은 답변이 이 자리에 들어갑니다.)',
      order: 1,
    },
    {
      id: 'mock-faq-2',
      question: '개발 경험이 없어도 지원할 수 있나요?',
      answer: '목업 답변입니다.',
      order: 2,
    },
    {
      id: 'mock-faq-3',
      question: '활동은 언제 하나요?',
      answer: '목업 답변입니다.\n줄바꿈도 그대로 보입니다.',
      order: 3,
    },
  ],
};
