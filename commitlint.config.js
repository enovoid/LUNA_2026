// 커밋 메시지에 세션·계정 정보(트레일러, 세션 링크, 이메일)를 넣지 못하게 막는다.
const forbid = (pattern, label) => (parsed) => {
  const text = parsed.raw ?? '';
  return [!pattern.test(text), `커밋 메시지에 ${label}을(를) 넣지 마세요.`];
};

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'no-session-info': forbid(
          /claude-session:|claude\.ai\/code\/session|session_[0-9A-Za-z]{10,}/i,
          '세션 정보',
        ),
        'no-coauthor-trailer': forbid(/^co-authored-by:/im, 'Co-Authored-By 트레일러'),
        'no-email': forbid(/[\w.+-]+@[\w-]+\.[\w.-]+/, '이메일 주소'),
      },
    },
  ],
  rules: {
    'no-session-info': [2, 'always'],
    'no-coauthor-trailer': [2, 'always'],
    'no-email': [2, 'always'],
  },
};
