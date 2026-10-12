import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/url-security", async () => {
  const actual = await vi.importActual<typeof import("@/lib/url-security")>("@/lib/url-security");
  return { ...actual, fetchPublicText: vi.fn() };
});

import { NextRequest } from "next/server";
import { POST as llmsAction } from "@/app/api/llms/route";
import { formatResourceLines, parseResourceLines } from "@/lib/llms-resources";
import { MAX_SUGGESTED_LINKS, suggestLlmsSections } from "@/lib/llms-suggest";
import { fetchPublicText } from "@/lib/url-security";

const urlset = (locs: string[]) => `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((loc) => `<url><loc>${loc}</loc></url>`).join("")}</urlset>`;
const index = (locs: string[]) => `<?xml version="1.0"?><sitemapindex>${locs.map((loc) => `<sitemap><loc>${loc}</loc></sitemap>`).join("")}</sitemapindex>`;
type Pages = Record<string, { status?: number; text: string }>;
function serve(pages: Pages) {
  vi.mocked(fetchPublicText).mockImplementation(async (url: string) => {
    const page = pages[url];
    if (!page) return { url, status: 404, text: "", contentType: "text/plain", retryAfter: null };
    return { url, status: page.status ?? 200, text: page.text, contentType: "application/xml", retryAfter: null };
  });
}

beforeEach(() => { vi.mocked(fetchPublicText).mockReset(); });

describe("llms.txt suggestions from the sitemap (A6)", () => {
  it("follows robots.txt sitemaps and one level of sitemap index, staying on the site", async () => {
    serve({
      "https://shop.example/robots.txt": { text: "User-agent: *\nSitemap: https://shop.example/sitemap-index.xml\nSitemap: https://evil.example/s.xml" },
      "https://shop.example/sitemap-index.xml": { text: index(["https://shop.example/s1.xml", "https://cdn.other/s2.xml"]) },
      "https://shop.example/s1.xml": { text: urlset([
        "https://shop.example/", "https://shop.example/blog/how-to-choose", "https://shop.example/blog/size_guide", "https://shop.example/products/a",
        "https://shop.example/files/manual.pdf", "https://other.example/x", "https://shop.example/blog/how-to-choose",
        "https://www.shop.example/about",
      ]) },
    });
    const result = await suggestLlmsSections("https://shop.example");
    expect(vi.mocked(fetchPublicText).mock.calls.map(([url]) => url)).not.toContain("https://evil.example/s.xml");
    expect(vi.mocked(fetchPublicText).mock.calls.map(([url]) => url)).not.toContain("https://cdn.other/s2.xml");
    expect(result.sections).toEqual([
      { heading: "blog", links: [{ title: "how to choose", url: "https://shop.example/blog/how-to-choose", description: "" }, { title: "size guide", url: "https://shop.example/blog/size_guide", description: "" }] },
      { heading: "about", links: [{ title: "about", url: "https://www.shop.example/about", description: "" }] },
      { heading: "products", links: [{ title: "a", url: "https://shop.example/products/a", description: "" }] },
      { heading: "홈", links: [{ title: "홈", url: "https://shop.example/", description: "" }] },
    ]);
    expect(result.source).toMatchObject({ sitemaps: ["https://shop.example/sitemap-index.xml", "https://shop.example/s1.xml"], urlCount: 5, truncated: false });
  });

  it("falls back to /sitemap.xml and caps the list", async () => {
    const many = Array.from({ length: 90 }, (_, i) => `https://a.example/p/${i}`);
    serve({ "https://a.example/sitemap.xml": { text: urlset(many) } });
    const result = await suggestLlmsSections("https://a.example/some/page");
    expect(result.sections.flatMap((section) => section.links)).toHaveLength(MAX_SUGGESTED_LINKS);
    expect(result.source.truncated).toBe(true);
  });

  it("decodes Korean paths for titles and headings", async () => {
    serve({ "https://a.example/sitemap.xml": { text: urlset([`https://a.example/${encodeURIComponent("가이드")}/${encodeURIComponent("사이즈-표")}`]) } });
    const result = await suggestLlmsSections("https://a.example");
    expect(result.sections).toEqual([{ heading: "가이드", links: [{ title: "사이즈 표", url: expect.any(String), description: "" }] }]);
  });

  it("explains when no sitemap URLs were found", async () => {
    serve({});
    await expect(suggestLlmsSections("https://none.example")).rejects.toMatchObject({ code: "LLMS_SUGGEST_EMPTY", status: 422 });
  });

  it("rejects non-http websites", async () => {
    await expect(suggestLlmsSections("ftp://a.example")).rejects.toThrow();
    expect(fetchPublicText).not.toHaveBeenCalled();
  });
});

describe("resource lines", () => {
  it("parses '## heading' lines into sections and keeps the old flat format", () => {
    expect(parseResourceLines("홈 | https://a.example/ | 소개\n서비스 | https://a.example/s")).toEqual([
      { heading: "핵심 문서", links: [{ title: "홈", url: "https://a.example/", description: "소개" }, { title: "서비스", url: "https://a.example/s", description: "" }] },
    ]);
    expect(parseResourceLines("## 블로그\n글 | https://a.example/b\n\n## 상품\n상품 | https://a.example/p | 설명")).toEqual([
      { heading: "블로그", links: [{ title: "글", url: "https://a.example/b", description: "" }] },
      { heading: "상품", links: [{ title: "상품", url: "https://a.example/p", description: "설명" }] },
    ]);
  });

  it("drops empty sections and round-trips formatted lines", () => {
    const sections = [{ heading: "블로그", links: [{ title: "글", url: "https://a.example/b", description: "" }] }];
    expect(parseResourceLines("## 빈 섹션\n## 블로그\n글 | https://a.example/b")).toEqual(sections);
    expect(parseResourceLines(formatResourceLines(sections))).toEqual(sections);
  });
});

describe("POST /api/llms action=suggest", () => {
  const call = (body: unknown) => llmsAction(new NextRequest("http://localhost/api/llms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

  it("returns sections for the website", async () => {
    serve({ "https://a.example/sitemap.xml": { text: urlset(["https://a.example/docs/start"]) } });
    const response = await call({ action: "suggest", website: "https://a.example" });
    expect(response.status).toBe(200);
    expect((await response.json() as { result: { sections: unknown[] } }).result.sections).toEqual([{ heading: "docs", links: [{ title: "start", url: "https://a.example/docs/start", description: "" }] }]);
  });

  it("reports an empty sitemap as 422", async () => {
    serve({});
    expect((await call({ action: "suggest", website: "https://a.example" })).status).toBe(422);
  });
});
