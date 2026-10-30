/** R2에 올라간 이미지. 실제 파일은 `${R2_PUBLIC_URL}/${key}-{480|960|1600}.webp` */
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
  source: 'db' | 'mock';
}
