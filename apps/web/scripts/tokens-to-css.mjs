// tokens.json(디자인 시스템 "Luna — 루나 홈페이지 디자인 시스템") → src/styles/tokens.css
// 사용: pnpm --filter @luna/web tokens
import { readFile, writeFile } from 'node:fs/promises';

const src = new URL('../src/styles/tokens.json', import.meta.url);
const out = new URL('../src/styles/tokens.css', import.meta.url);
const tokens = JSON.parse(await readFile(src, 'utf8'));

const light = [];
const dark = [];
const base = [];

for (const t of tokens.color.tokens) {
  if (typeof t.value === 'string') {
    base.push(`  --${t.name}: ${t.value};`);
  } else {
    light.push(`  --${t.name}: ${t.value.light};`);
    if (t.value.dark) dark.push(`  --${t.name}: ${t.value.dark};`);
  }
}

for (const group of ['spacing', 'radius', 'size', 'leading', 'blur', 'opacity']) {
  for (const t of tokens[group]?.tokens ?? []) base.push(`  --${t.name}: ${t.value};`);
}
for (const t of tokens.shadow.tokens) {
  if (typeof t.value === 'string') base.push(`  --${t.name}: ${t.value};`);
  else {
    light.push(`  --${t.name}: ${t.value.light};`);
    if (t.value.dark) dark.push(`  --${t.name}: ${t.value.dark};`);
  }
}
for (const g of tokens.type.groups) {
  for (const s of g.styles) {
    if (s.name.includes('italic')) continue;
    base.push(
      `  --type-${s.name}: ${s.fontWeight} ${s.fontSize}/${s.lineHeight} var(--font-sans);`,
      `  --type-${s.name}--tracking: ${s.letterSpacing ?? '0px'};`,
    );
  }
}

const css = `/* 자동 생성 파일 — 직접 고치지 말고 tokens.json을 바꾼 뒤 \`pnpm tokens\`를 실행하세요. */
:root {
  --font-sans: ${tokens.type.families.sans};
${base.join('\n')}
}

/* 라이트 테마(기본) */
:root {
${light.join('\n')}
}

/* 사이트는 다크 하나만 쓴다(<html data-theme="dark" class="theme-dark">). data-theme 속성은 사이트를 감싸는 쪽
   (미리보기 등)이 바꿀 수 있어 클래스로도 고정한다. TODO: prefers-color-scheme 라이트 지원 */
:root.theme-dark,
[data-theme="dark"] {
${dark.join('\n')}
}
`;

await writeFile(out, css);
console.log(`tokens.css: ${light.length} light, ${dark.length} dark, ${base.length} base`);
