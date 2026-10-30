// 화면에 맞게 데이터를 정렬·묶음·계산한다. 모두 빌드 시점에 실행된다.
import type { Award, Faq, Member, Project } from './data';

const ko = new Intl.Collator('ko');

export function formatWon(value: number) {
  return `₩${value.toLocaleString('ko-KR')}`;
}

export function formatDate(iso: string | null) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${y}년 ${m}월 ${d}일`;
}

/** "LUNA 8기" → 8. 숫자가 없으면 -1(맨 뒤). */
export function generationNumber(label: string) {
  const match = label.match(/(\d+)/);
  return match ? Number(match[1]) : -1;
}

export function groupMembersByGeneration(members: Member[]) {
  const groups = new Map<string, Member[]>();
  for (const m of members) {
    const key = m.lunaGeneration || '기수 미정';
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => generationNumber(b) - generationNumber(a) || ko.compare(a, b))
    .map(([generation, list]) => ({
      generation,
      members: list.sort((a, b) => ko.compare(a.name, b.name)),
    }));
}

/** 직군별 묶음. 직군 이름 가나다순, 안에서는 최근 기수부터, 같은 기수는 이름순. */
export function groupMembersByPosition(members: Member[]) {
  const groups = new Map<string, Member[]>();
  for (const m of members) {
    const key = m.position || '직군 미정';
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => ko.compare(a, b))
    .map(([position, list]) => ({
      position,
      members: list.sort(
        (a, b) =>
          generationNumber(b.lunaGeneration) - generationNumber(a.lunaGeneration) ||
          ko.compare(a.name, b.name),
      ),
    }));
}

export function uniqueSorted(values: string[], order: 'asc' | 'desc' = 'asc') {
  const list = [...new Set(values.filter(Boolean))].sort(ko.compare);
  return order === 'desc' ? list.reverse() : list;
}

export function sortProjects(projects: Project[]) {
  return [...projects].sort((a, b) => ko.compare(b.year, a.year) || ko.compare(a.name, b.name));
}

export function sortAwards(awards: Award[]) {
  return [...awards].sort(
    (a, b) =>
      (b.date ?? '').localeCompare(a.date ?? '') ||
      ko.compare(b.year, a.year) ||
      ko.compare(a.name, b.name),
  );
}

export function groupAwardsByYear(awards: Award[]) {
  const groups = new Map<string, Award[]>();
  for (const a of sortAwards(awards)) {
    const key = a.year || a.date?.slice(0, 4) || '연도 미정';
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => ko.compare(b, a))
    .map(([year, list]) => ({ year, awards: list }));
}

export function sortFaqs(faqs: Faq[]) {
  return [...faqs].sort(
    (a, b) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY),
  );
}

/** 1위·대상처럼 최상위 순위는 진한 보라 배지로 강조한다. */
export function isTopPrize(prize: string) {
  return /(^|\s)(1위|1등|대상|최우수상?|금상|우승)(\s|$)/.test(prize.trim());
}

export function computeStats(members: Member[], awards: Award[]) {
  return {
    awardCount: awards.length,
    prizeTotal: awards.reduce((sum, a) => sum + (a.prizeMoney ?? 0), 0),
    memberCount: members.length,
  };
}

export function memberAnchor(member: Pick<Member, 'id'>) {
  return `member-${member.id}`;
}

/** 수상의 members(이름 문자열)를 멤버 카드와 연결한다. 이름이 정확히 같은 멤버가 한 명일 때만 연결한다. */
export function memberLinker(members: Member[]) {
  const byName = new Map<string, Member | null>();
  for (const m of members) byName.set(m.name, byName.has(m.name) ? null : m);
  return (name: string) => byName.get(name) ?? undefined;
}

/** 프로젝트의 awards 문자열과 수상을 연결한다. "대회명" 또는 "대회명 순위"가 정확히 같아야 한다. */
export function projectsForAward(award: Award, projects: Project[]) {
  const labels = new Set([award.name, `${award.name} ${award.prize}`.trim()]);
  return projects.filter((p) => p.awardNames.some((n) => labels.has(n.trim())));
}

export function textToParagraphs(text: string) {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}
