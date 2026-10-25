import { describe, expect, it } from "vitest";
import { auditReportToMarkdown, mdCell, type AuditMarkdownInput } from "@/lib/report-markdown";

const base = (): AuditMarkdownInput => ({
  generatedAt: "2026-10-13T00:00:00.000Z",
  audit: {
    id: 7, url: "https://example.com/p", finalUrl: "https://example.com/p/", score: 21, total: 32, grade: "보통",
    createdAt: "2026-10-12T09:00:00.000Z",
    categories: [{ category: "기반 SEO", passed: 5, total: 7 }, { category: "기술적 GEO", passed: 2, total: 5 }],
    items: [
      { code: "seo-canonical", category: "기반 SEO", label: "Canonical URL", passed: false, manual: false, detail: "canonical 없음", recommendation: "대표 URL을 가리키는 canonical 링크를 추가하세요." },
      { code: "seo-og", category: "기반 SEO", label: "Open Graph 태그", passed: true, manual: false, detail: "핵심 OG 태그 3/3", recommendation: "" },
      { code: "brand-definition", category: "브랜드 노출", label: "일관된 브랜드 정의", passed: false, manual: true, detail: "수동 확인 필요", recommendation: "모든 채널에서 정의를 통일하세요." },
    ],
  },
  snapshot: {
    capturedAt: "2026-10-12T09:00:01.000Z", renderMode: "native", parserVersion: "page-facts/2", rulesVersion: "page-rules/3", skipped: null,
    findings: [
      { code: "schema-required", tier: "technical", severity: "warning", passed: false, label: "구조화 데이터 필수 속성", detail: "Product: review | aggregateRating | offers", evidence: "Product" },
      { code: "viewport", tier: "recommendation", severity: "notice", passed: false, label: "모바일 viewport", detail: "viewport 없음", evidence: null },
      { code: "geo-faq", tier: "hypothesis", severity: "notice", passed: false, label: "FAQ 섹션", detail: "FAQ 신호 0개", evidence: null },
      { code: "title-present", tier: "technical", severity: "notice", passed: true, label: "<title> 존재", detail: "제목이 있습니다.", evidence: "상품" },
    ],
  },
  changes: [{ id: 3, field: "description", status: "verification_pending", proposedValue: "새 설명", updatedAt: "2026-10-12T10:00:00.000Z" }],
});

describe("audit markdown report", () => {
  it("renders a stable document", () => {
    expect(auditReportToMarkdown(base())).toMatchSnapshot();
  });

  it("is deterministic apart from the generation time", () => {
    const first = auditReportToMarkdown(base());
    const later = auditReportToMarkdown({ ...base(), generatedAt: "2026-10-14T00:00:00.000Z" });
    expect(first).toBe(auditReportToMarkdown(base()));
    expect(first.replace("2026-10-13T00:00:00.000Z", "X")).toBe(later.replace("2026-10-14T00:00:00.000Z", "X"));
  });

  it("keeps the fixed section order", () => {
    const text = auditReportToMarkdown(base());
    const order = ["# GEO 진단 보고서", "## 요약", "## 미충족 진단 항목", "## 페이지 규칙 검사", "## 통과 항목", "## 연결된 수정안", "## 측정하지 않은 것", "## AI에게 넘기는 작업 요청", "## 방법과 한계"];
    const positions = order.map((heading) => text.indexOf(heading));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("orders page findings technical, recommendation, hypothesis and lists only failures there", () => {
    const text = auditReportToMarkdown(base());
    const section = text.slice(text.indexOf("## 페이지 규칙 검사"), text.indexOf("## 통과 항목"));
    expect(section.indexOf("schema-required")).toBeLessThan(section.indexOf("viewport"));
    expect(section.indexOf("viewport")).toBeLessThan(section.indexOf("geo-faq"));
    expect(section).not.toContain("title-present");
    expect(section).toContain("page-rules/3");
  });

  it("links failed rules to their official documentation", () => {
    expect(auditReportToMarkdown(base())).toContain("https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls");
  });

  it("escapes untrusted page text in tables and inline text", () => {
    const input = base();
    const hostile = "a|b\nc `code` <script>alert(1)</script> [x](javascript:alert(1))";
    const text = auditReportToMarkdown({ ...input, audit: { ...input.audit, url: "https://example.com/<b>", items: [{ ...input.audit.items[0]!, detail: hostile }] } });
    expect(text).not.toContain("<script>");
    expect(text).not.toContain("<b>");
    expect(text).toContain("a\\|b c");
    expect(text).toContain("\\`code\\`");
    expect(text).toContain("\\[x\\]");
  });

  it("caps long observed values at 500 characters", () => {
    expect(mdCell("가".repeat(800))).toHaveLength(500);
    expect(mdCell("가".repeat(800)).endsWith("…")).toBe(true);
  });

  it("explains what was not measured", () => {
    const input = base();
    const text = auditReportToMarkdown({ ...input, snapshot: null });
    const section = text.slice(text.indexOf("## 측정하지 않은 것"), text.indexOf("## AI에게 넘기는 작업 요청"));
    expect(section).toContain("일관된 브랜드 정의");
    expect(section).toMatch(/페이지 스냅샷이 없어/);
    const skipped = auditReportToMarkdown({ ...input, snapshot: { ...input.snapshot!, skipped: "원본 HTML이 없어 규칙을 적용하지 않았습니다." } });
    expect(skipped).toContain("원본 HTML이 없어 규칙을 적용하지 않았습니다.");
  });

  it("lists engine-judged manual items as failures and only unchecked ones as not measured", () => {
    const input = base();
    const engineJudged = { code: "geo-journey", category: "GEO 콘텐츠 구조", label: "구매 여정별 구성", passed: false, manual: true, detail: "비교 단계 내용이 없습니다.", recommendation: "탐색→비교→구매 순서로 배치하세요." };
    const text = auditReportToMarkdown({ ...input, audit: { ...input.audit, items: [...input.audit.items, engineJudged] } });
    const failed = text.slice(text.indexOf("## 미충족 진단 항목"), text.indexOf("## 페이지 규칙 검사"));
    const notMeasured = text.slice(text.indexOf("## 측정하지 않은 것"), text.indexOf("## AI에게 넘기는 작업 요청"));
    expect(failed).toContain("구매 여정별 구성 (GEO 엔진 판정)");
    expect(notMeasured).not.toContain("구매 여정별 구성");
    expect(notMeasured).toContain("일관된 브랜드 정의");
  });

  it("handles an audit without items or changes", () => {
    const input = base();
    const text = auditReportToMarkdown({ ...input, audit: { ...input.audit, items: [], categories: [] }, changes: [] });
    expect(text).toContain("미충족 항목이 없습니다.");
    expect(text).toContain("이 URL의 수정안이 없습니다.");
  });

  it("asks an AI only for the failed checks and forbids invented facts", () => {
    const text = auditReportToMarkdown(base());
    const section = text.slice(text.indexOf("## AI에게 넘기는 작업 요청"), text.indexOf("## 방법과 한계"));
    expect(section).toContain("- [ ] Canonical URL");
    expect(section).not.toContain("Open Graph");
    expect(section).toMatch(/새로 만들지/);
  });

  it("states that the audit is rule-based and not an AI citation measurement", () => {
    expect(auditReportToMarkdown(base())).toMatch(/AI 인용을 측정한 것이 아닙니다/);
  });
});
