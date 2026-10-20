import { describe, expect, it } from "vitest";
import { analyzeObservation, extractPageFacts, PAGE_PARSER_VERSION, PAGE_RULES_VERSION, type PageObservation } from "@/lib/page-snapshots";
import { displayWidth } from "@/lib/page-seo-rules";

const head = (inner: string) => `<!doctype html><html lang="ko"><head>${inner}</head><body><h1>제목</h1><p>본문</p></body></html>`;
const observe = (body: string, overrides: Partial<PageObservation> = {}): PageObservation => ({
  url: "https://example.com/p", finalUrl: "https://example.com/p", statusCode: 200, contentType: "text/html",
  renderMode: "native", body, bodyKind: "html", ...overrides,
});
const findingOf = (body: string, code: string, overrides: Partial<PageObservation> = {}) =>
  analyzeObservation(observe(body, overrides), "example.com").findings.find((item) => item.code === code);

describe("versions", () => {
  it("bumps parser and rule versions for the new facts and rules", () => {
    expect(PAGE_PARSER_VERSION).toBe("page-facts/2");
    expect(PAGE_RULES_VERSION).toMatch(/^page-rules\/[2-9]$/);
  });
});

describe("display width", () => {
  it("counts Hangul, CJK and full-width characters as two columns", () => {
    expect(displayWidth("abc")).toBe(3);
    expect(displayWidth("가나다")).toBe(6);
    expect(displayWidth("漢字")).toBe(4);
    expect(displayWidth("ＡＢ")).toBe(4);
    expect(displayWidth("가 a")).toBe(4);
  });
});

describe("new facts", () => {
  it("extracts viewport and absolute hreflang links, remembering relative ones", () => {
    const facts = extractPageFacts(head(`<meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="alternate" hreflang="ko" href="https://example.com/p"><link rel="alternate" hreflang="en" href="/en/p">`), "https://example.com/p");
    expect(facts.viewport).toBe("width=device-width, initial-scale=1");
    expect(facts.hreflang).toEqual([
      { lang: "ko", href: "https://example.com/p", absolute: true },
      { lang: "en", href: "https://example.com/en/p", absolute: false },
    ]);
  });
  it("caps hreflang links and skips unparsable hrefs", () => {
    const many = Array.from({ length: 80 }, (_, index) => `<link rel="alternate" hreflang="x${index}" href="https://example.com/${index}">`).join("");
    expect(extractPageFacts(head(many), "https://example.com/p").hreflang).toHaveLength(50);
    expect(extractPageFacts(head('<link rel="alternate" hreflang="ko" href="http://[bad">'), "https://example.com/p").hreflang).toEqual([]);
  });
});

describe("title and description length", () => {
  it("passes a short Korean title and flags one that is likely truncated", () => {
    expect(findingOf(head("<title>큐샵 상품 A 가격</title>"), "title-length")?.passed).toBe(true);
    const long = findingOf(head(`<title>${"가".repeat(31)}</title>`), "title-length");
    expect(long).toMatchObject({ passed: false, tier: "recommendation", severity: "notice" });
    expect(long?.detail).toMatch(/잘릴 수 있/);
  });
  it("leaves a missing title to the title-present rule", () => {
    expect(findingOf(head(""), "title-length")?.passed).toBe(true);
  });
  it("flags descriptions that are too short or too long", () => {
    expect(findingOf(head(`<meta name="description" content="${"가".repeat(40)}">`), "description-length")?.passed).toBe(true);
    expect(findingOf(head('<meta name="description" content="짧음">'), "description-length")?.passed).toBe(false);
    expect(findingOf(head(`<meta name="description" content="${"가".repeat(81)}">`), "description-length")?.passed).toBe(false);
    expect(findingOf(head(""), "description-length")?.passed).toBe(true);
  });
});

describe("viewport", () => {
  it("requires width=device-width", () => {
    expect(findingOf(head('<meta name="viewport" content="width=device-width,initial-scale=1">'), "viewport")?.passed).toBe(true);
    expect(findingOf(head('<meta name="viewport" content="width=1024">'), "viewport")).toMatchObject({ passed: false, tier: "recommendation", severity: "notice" });
    expect(findingOf(head(""), "viewport")?.passed).toBe(false);
  });
});

describe("https", () => {
  it("is a technical warning when the final URL is plain http", () => {
    expect(findingOf(head(""), "https-final")?.passed).toBe(true);
    expect(findingOf(head(""), "https-final", { url: "http://example.com/p", finalUrl: "http://example.com/p" }))
      .toMatchObject({ passed: false, tier: "technical", severity: "warning" });
  });
});

describe("hreflang finding", () => {
  it("passes pages without annotations and reports broken sets", () => {
    expect(findingOf(head(""), "hreflang-valid")?.passed).toBe(true);
    const broken = findingOf(head('<link rel="alternate" hreflang="en" href="https://example.com/en">'), "hreflang-valid");
    expect(broken).toMatchObject({ passed: false, tier: "technical", severity: "warning" });
    expect(broken?.detail).toMatch(/자기 자신/);
  });
});

describe("does not penalize what Google does not", () => {
  it("has no rule that flags an H1 equal to the title", () => {
    const codes = analyzeObservation(observe(head("<title>제목</title>")), "example.com").findings.map((item) => item.code);
    expect(codes.some((code) => /h1.*title|title.*h1/i.test(code))).toBe(false);
  });
});
