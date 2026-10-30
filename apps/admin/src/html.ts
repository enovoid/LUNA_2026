// 아주 작은 HTML 템플릿. 끼워 넣는 값은 모두 이스케이프하고, html``로 만든 조각만 그대로 넣는다.

export class Html {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}

/** 이미 안전한 문자열(코드에 박힌 CSS 등)을 이스케이프 없이 넣는다. 사용자 입력에는 쓰지 않는다. */
export function raw(text: string): Html {
  return new Html(text);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0] ?? '';
  values.forEach((value, i) => {
    out += render(value) + (strings[i + 1] ?? '');
  });
  return new Html(out);
}

function render(value: unknown): string {
  if (value instanceof Html) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (value === null || value === undefined || value === false) return '';
  return escapeHtml(String(value));
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
