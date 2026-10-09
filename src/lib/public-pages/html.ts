/** 이미 안전하게 만들어진 HTML 조각. html 템플릿 안에서는 이스케이프하지 않고 그대로 넣는다. */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString() { return this.value; }
}

export type HtmlValue = SafeHtml | string | number | boolean | null | undefined | readonly HtmlValue[];

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** 코드에 고정된 마크업(CSS 등)만 감싼다. 사용자 입력에는 쓰지 않는다. */
export function raw(value: string): SafeHtml {
  return new SafeHtml(value);
}

function render(value: HtmlValue): string {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join("");
  if (value === null || value === undefined || value === false) return "";
  return escapeHtml(String(value));
}

/** 끼워 넣는 값은 모두 이스케이프하는 태그드 템플릿. 배열은 이어 붙이고 false/null은 생략한다. */
export function html(strings: TemplateStringsArray, ...values: HtmlValue[]): SafeHtml {
  return new SafeHtml(strings.reduce((output, chunk, index) => output + chunk + (index < values.length ? render(values[index]) : ""), ""));
}
