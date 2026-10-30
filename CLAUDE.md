# 작업 규칙 (사람과 에이전트 공통)

- 커밋은 Conventional Commits (`feat(db): …`). 규칙은 README의 "커밋 컨벤션" 참고.
- **커밋 메시지에 세션·계정 정보를 넣지 않는다.** `Claude-Session:`, `Co-Authored-By:` 트레일러, 세션 링크, 이메일 주소 금지. 도구가 기본으로 붙이려 해도 제거한다. CI(commitlint)가 막는다.
- 커밋 전 `pnpm lint`, `pnpm typecheck`.
