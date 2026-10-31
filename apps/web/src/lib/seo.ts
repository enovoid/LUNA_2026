// 검색 엔진용 구조화 데이터(JSON-LD, schema.org). Base.astro가 <head>에 넣는다.
// Google·Naver가 사이트 이름, 로고, 공식 계정(sameAs), 페이지 위치(빵부스러기)를 읽는다.

import type { ContactSettings } from '@luna/db/settings';
import { site } from '../content/site';
import type { Faq } from './data/types';

type Json = Record<string, unknown>;

const orgId = (base: URL) => new URL('/#organization', base).href;

/** 홈에만 넣는다: 사이트 이름(검색 결과 위 이름)과 동아리 정보. */
export function homeLd(base: URL, contact: ContactSettings): Json[] {
  const sameAs = [contact.instagram, contact.github].filter(Boolean);
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': new URL('/#website', base).href,
      url: new URL('/', base).href,
      name: '루나 LUNA',
      alternateName: site.alternateNames,
      inLanguage: 'ko-KR',
      publisher: { '@id': orgId(base) },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': orgId(base),
      name: '루나 LUNA',
      alternateName: site.alternateNames,
      url: new URL('/', base).href,
      logo: new URL('/icon-512.png', base).href,
      description: site.description,
      ...(site.foundedYear && { foundingDate: String(site.foundedYear) }),
      parentOrganization: { '@type': 'HighSchool', name: site.school },
      ...(contact.email && { email: contact.email }),
      ...(sameAs.length > 0 && { sameAs }),
    },
  ];
}

/** 하위 페이지: 홈 > 페이지 */
export function breadcrumbLd(base: URL, name: string, path: string): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '홈', item: new URL('/', base).href },
      { '@type': 'ListItem', position: 2, name, item: new URL(path, base).href },
    ],
  };
}

export function faqLd(faqs: Faq[]): Json | null {
  if (faqs.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  };
}

/** <script type="application/ld+json"> 안에 넣을 문자열. `</script>`로 태그가 끊기지 않게 `<`를 이스케이프한다. */
export function serializeLd(data: Json | Json[]): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
