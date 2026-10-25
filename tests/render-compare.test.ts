import { describe, expect, it } from "vitest";
import { compareRenderedToNative, visibleWordCount } from "@/lib/render-compare";
import { ruleDocFor } from "@/lib/rule-docs";

const words = (count: number) => Array.from({ length: count }, (_, index) => `단어${index}`).join(" ");
const page = (head: string, body: string) => `<html><head>${head}</head><body>${body}</body></html>`;
const full = page('<title>상품</title><script type="application/ld+json">{"@type":"Product"}</script>', `<h1>상품</h1><p>${words(300)}</p>`);
const URL_P = "https://example.com/p";
const native = (body: string, statusCode = 200, finalUrl = `${URL_P}/`) => ({ statusCode, finalUrl, body, bodyKind: "html" as const });

describe("visible word count", () => {
  it("ignores scripts, styles, noscript and templates", () => {
    expect(visibleWordCount(page("<style>a b c</style>", "<p>하나 둘</p><script>var x = 1 2 3</script><noscript>켜 주세요 자바스크립트</noscript><template>숨김 내용</template>"))).toBe(2);
  });
});

describe("rendered vs native comparison (A4)", () => {
  it("passes when the HTML before JavaScript already has the content", () => {
    expect(compareRenderedToNative(full, native(full), URL_P)).toMatchObject({ code: "js-dependent-content", passed: true, tier: "technical", severity: "notice" });
  });

  it("warns when title, H1 or JSON-LD only appear after JavaScript runs", () => {
    const shell = page("", '<div id="root"></div>');
    const finding = compareRenderedToNative(full, native(shell), URL_P);
    expect(finding).toMatchObject({ passed: false, tier: "technical", severity: "warning" });
    expect(finding.detail).toContain("title");
    expect(finding.detail).toContain("H1");
    expect(finding.detail).toContain("JSON-LD");
    expect(finding.evidence).toMatch(/JS 실행 전 0 \/ 실행 후 30\d단어/);
  });

  it("warns when most body text needs JavaScript even if the head is complete", () => {
    const thin = page('<title>상품</title><script type="application/ld+json">{}</script>', `<h1>상품</h1><p>${words(20)}</p>`);
    const finding = compareRenderedToNative(full, native(thin), URL_P);
    expect(finding.passed).toBe(false);
    expect(finding.detail).toMatch(/본문/);
  });

  it("does not judge short pages by the word ratio", () => {
    const short = page("<title>a</title>", `<h1>a</h1><p>${words(40)}</p>`);
    expect(compareRenderedToNative(short, native(page("<title>a</title>", "<h1>a</h1>")), URL_P).passed).toBe(true);
  });

  it("does not judge when the native HTML is missing or failed", () => {
    for (const baseline of [null, native(full, 403), { statusCode: 200, finalUrl: URL_P, body: "plain", bodyKind: "text" as const }, native(full, 200, "https://example.com/login")]) {
      const finding = compareRenderedToNative(full, baseline, URL_P);
      expect(finding).toMatchObject({ passed: true, severity: "notice" });
      expect(finding.detail).toMatch(/비교하지 않았습니다/);
    }
  });

  it("links to Google's JavaScript SEO basics", () => {
    expect(ruleDocFor("js-dependent-content")?.url).toBe("https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics");
  });
});
