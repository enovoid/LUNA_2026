import type { ContactSettings, RecruitSettings } from '@luna/db/settings';

/** 동기화가 만든 이미지. 실제 파일은 `/img/${key}-{480|960|1600}.webp`(빌드가 DB image_files에서 꺼냄) */
export interface ImageRef {
  key: string;
  width: number;
  height: number;
}

export interface Member {
  id: string;
  name: string;
  lunaGeneration: string;
  description: string;
  position: string;
  schoolGeneration: string;
  className: string;
  image: ImageRef | null;
}

export interface Award {
  id: string;
  name: string;
  year: string;
  prize: string;
  team: string;
  memberNames: string[];
  /** YYYY-MM-DD */
  date: string | null;
  prizeMoney: number | null;
  image: ImageRef | null;
}

export interface Project {
  id: string;
  name: string;
  year: string;
  description: string;
  awardNames: string[];
  image: ImageRef | null;
}

export interface Faq {
  id: string;
  question: string;
  answer: string;
  order: number | null;
}

export interface SiteData {
  members: Member[];
  awards: Award[];
  projects: Project[];
  faqs: Faq[];
  /** 관리자 페이지에서 고치는 값(site_settings). 저장된 적 없으면 빈 값이라 해당 구역을 숨긴다. */
  settings: SiteSettings;
  source: 'db' | 'mock';
}

export interface SiteSettings {
  recruit: RecruitSettings;
  contact: ContactSettings;
}
