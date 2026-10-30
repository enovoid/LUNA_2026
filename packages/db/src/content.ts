/**
 * 관리자 페이지에서 직접 만든 행의 notion_id 접두어. 예: `admin:3f2a…`
 * Notion 동기화는 이 행을 Notion에 없는 페이지로 보고 지우면 안 된다(`packages/sync`의 삭제 감지 참고).
 */
export const ADMIN_ID_PREFIX = 'admin:';

export function isAdminCreated(notionId: string): boolean {
  return notionId.startsWith(ADMIN_ID_PREFIX);
}
