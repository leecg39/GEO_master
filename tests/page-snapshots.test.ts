import { describe, expect, it } from "vitest";
import { analyzeObservation, extractPageFacts, PAGE_PARSER_VERSION, PAGE_RULES_VERSION, type PageObservation } from "@/lib/page-snapshots";

const page = (overrides: Partial<PageObservation> = {}): PageObservation => ({
  url: "https://example.com/p", finalUrl: "https://example.com/p", statusCode: 200, contentType: "text/html; charset=utf-8",
  renderMode: "native", body: "<html><head><title>상품 A</title></head><body><h1>상품 A</h1></body></html>", bodyKind: "html", ...overrides,
});

const html = `<!doctype html><html lang="ko"><head>
  <title>  큐샵 상품 A — 가격과 사양 </title>
  <meta name="description" content="상품 A의 가격과 사양을 정리했습니다.">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="/p?ref=1">
  <meta property="og:title" content="상품 A"><meta property="og:description" content="설명"><meta property="og:image" content="https://cdn.example.com/a.png">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"상품 A"}</script>
  <script type="application/ld+json">{ broken json </script>
</head><body><h1>상품 A</h1><p>상품 A는 두 가지 크기로 판매합니다.</p></body></html>`;

describe("page facts", () => {
  it("extracts metadata from the original HTML and resolves the canonical URL", () => {
    expect(extractPageFacts(html, "https://example.com/p")).toMatchObject({
      title: "큐샵 상품 A — 가격과 사양",
      description: "상품 A의 가격과 사양을 정리했습니다.",
      canonical: "https://example.com/p?ref=1",
      robotsMeta: "index, follow",
      lang: "ko",
      h1: ["상품 A"],
      og: { title: "상품 A", description: "설명", image: "https://cdn.example.com/a.png" },
      jsonLdTypes: ["Product"],
      jsonLdBlocks: 2,
      jsonLdInvalid: 1,
    });
  });
});

describe("page rules", () => {
  const find = (findings: { code: string }[], code: string) => findings.find((finding) => finding.code === code);

  it("records the parser and rule versions with every analysis", () => {
    const analysis = analyzeObservation(page({ body: html }), "example.com");
    expect(analysis).toMatchObject({ parserVersion: PAGE_PARSER_VERSION, rulesVersion: PAGE_RULES_VERSION, skipped: null });
    expect(analysis.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("flags invalid JSON-LD as a technical error with the observed evidence", () => {
    const finding = find(analyzeObservation(page({ body: html }), "example.com").findings, "jsonld-parse");
    expect(finding).toMatchObject({ tier: "technical", severity: "error", passed: false, evidence: expect.stringContaining("2개 중 1개") });
  });

  it("only reports HTTP status for an error page and skips HTML rules", () => {
    const analysis = analyzeObservation(page({ statusCode: 404 }), "example.com");
    expect(analysis.findings.map((finding) => finding.code)).toEqual(["http-status"]);
    expect(analysis.findings[0]).toMatchObject({ passed: false, severity: "error", evidence: "HTTP 404" });
    expect(analysis.facts).toBeNull();
    expect(analysis.skipped).toContain("HTTP 404");
  });

  it("does not judge metadata from Markdown when the original HTML is missing", () => {
    const analysis = analyzeObservation(page({ renderMode: "rendered", body: "# 상품 A\n본문", bodyKind: "markdown" }), "example.com");
    expect(find(analysis.findings, "title-present")).toBeUndefined();
    expect(analysis.facts).toBeNull();
    expect(analysis.skipped).toContain("원본 HTML");
  });

  it("skips HTML rules for non-HTML documents", () => {
    const analysis = analyzeObservation(page({ contentType: "application/pdf", body: "%PDF-1.7", bodyKind: "text" }), "example.com");
    expect(analysis.findings.map((finding) => finding.code)).toEqual(["http-status"]);
    expect(analysis.skipped).toContain("HTML");
  });

  it("flags a canonical that points to another site", () => {
    const body = html.replace('href="/p?ref=1"', 'href="https://mirror.example.net/p"');
    expect(find(analyzeObservation(page({ body }), "example.com").findings, "canonical-host")).toMatchObject({ tier: "technical", passed: false, evidence: "https://mirror.example.net/p" });
  });

  it("reports noindex as a policy warning with the meta value as evidence", () => {
    const body = html.replace("index, follow", "noindex, nofollow");
    expect(find(analyzeObservation(page({ body }), "example.com").findings, "robots-noindex")).toMatchObject({ passed: false, severity: "warning", evidence: "noindex, nofollow" });
  });

  it("never treats a missing FAQ, table or question headings as a required failure", () => {
    const findings = analyzeObservation(page({ body: html }), "example.com").findings;
    for (const code of ["geo-faq", "geo-tables", "geo-question-headings", "tech-faq-schema"]) {
      expect(find(findings, code)).toMatchObject({ tier: "hypothesis", severity: "notice", passed: false });
    }
    expect(findings.filter((finding) => !finding.passed && finding.severity !== "notice").every((finding) => finding.tier === "technical")).toBe(true);
  });

  it("does not evaluate site-level files per page", () => {
    const codes = analyzeObservation(page({ body: html }), "example.com").findings.map((finding) => finding.code);
    expect(codes).not.toEqual(expect.arrayContaining(["tech-ai-robots"]));
    expect(codes).not.toContain("tech-llms");
    expect(codes).not.toContain("tech-sitemap");
  });
});
