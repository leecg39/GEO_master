import { describe, expect, it } from "vitest";
import { checkPageHreflang, findReturnLinkGaps, isValidHreflangValue, sameDocumentUrl } from "@/lib/hreflang";

const link = (lang: string, href: string, absolute = true) => ({ lang, href, absolute });

describe("hreflang values", () => {
  it.each(["ko", "en", "en-US", "zh-Hant", "zh-Hant-TW", "es-419", "x-default", "KO-kr"])("accepts %s", (value) => {
    expect(isValidHreflangValue(value)).toBe(true);
  });
  it.each(["", "korean", "en_US", "en-USA", "x-def", "uk-UK-UK", "1a"])("rejects %s", (value) => {
    expect(isValidHreflangValue(value)).toBe(false);
  });
});

describe("same document url", () => {
  it("ignores fragments and a trailing slash on the path", () => {
    expect(sameDocumentUrl("https://a.com/ko/#top", "https://a.com/ko")).toBe(true);
    expect(sameDocumentUrl("https://a.com/ko?x=1", "https://a.com/ko")).toBe(false);
    expect(sameDocumentUrl("https://www.a.com/ko", "https://a.com/ko")).toBe(false);
    expect(sameDocumentUrl("not a url", "https://a.com")).toBe(false);
  });
});

describe("single page hreflang", () => {
  const page = "https://a.com/ko";
  it("passes when there are no annotations", () => {
    expect(checkPageHreflang([], page, null)).toEqual([]);
  });
  it("passes a complete self-referencing set", () => {
    expect(checkPageHreflang([link("ko", page), link("en", "https://a.com/en"), link("x-default", "https://a.com/")], page, null)).toEqual([]);
  });
  it("accepts the canonical URL as the self reference", () => {
    expect(checkPageHreflang([link("ko", "https://a.com/ko-kr"), link("en", "https://a.com/en")], page, "https://a.com/ko-kr")).toEqual([]);
  });
  it("reports a missing self reference", () => {
    expect(checkPageHreflang([link("en", "https://a.com/en")], page, null).join(" ")).toMatch(/자기 자신/);
  });
  it("reports invalid codes, relative URLs and conflicting duplicates", () => {
    const problems = checkPageHreflang([
      link("ko", page), link("korean", "https://a.com/k"), link("en", "https://a.com/en", false), link("en", "https://a.com/en2"),
    ], page, null).join(" ");
    expect(problems).toMatch(/korean/);
    expect(problems).toMatch(/상대 주소/);
    expect(problems).toMatch(/en.*서로 다른 주소/);
  });
});

describe("return links across crawled pages", () => {
  it("finds a page that links out without being linked back", () => {
    const gaps = findReturnLinkGaps([
      { url: "https://a.com/ko", hreflang: [link("ko", "https://a.com/ko"), link("en", "https://a.com/en")] },
      { url: "https://a.com/en", hreflang: [link("en", "https://a.com/en")] },
    ]);
    expect(gaps).toEqual([{ from: "https://a.com/ko", to: "https://a.com/en" }]);
  });
  it("does not judge targets that were not crawled", () => {
    expect(findReturnLinkGaps([
      { url: "https://a.com/ko", hreflang: [link("ko", "https://a.com/ko"), link("en", "https://a.com/en")] },
    ])).toEqual([]);
  });
  it("accepts reciprocal pairs and ignores self links", () => {
    expect(findReturnLinkGaps([
      { url: "https://a.com/ko", hreflang: [link("ko", "https://a.com/ko"), link("en", "https://a.com/en/")] },
      { url: "https://a.com/en", hreflang: [link("en", "https://a.com/en"), link("ko", "https://a.com/ko#x")] },
    ])).toEqual([]);
  });
});
