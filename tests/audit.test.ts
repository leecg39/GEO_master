import { describe, expect, it } from "vitest";
import { AUDIT_RULES, auditGrade, blockedAiBots, parseAuditHtml, scoreAudit } from "@/lib/audit";

const richHtml = `<!doctype html><html><head>
<title>GEO 질문 가이드</title><meta name="description" content="GEO를 실행하는 방법과 검증 기준을 단계별로 설명합니다.">
<link rel="canonical" href="https://example.com/guide"><meta property="og:title" content="GEO"><meta property="og:description" content="설명"><meta property="og:image" content="/cover.png">
<meta name="author" content="GEO 연구팀"><meta property="article:published_time" content="2026-01-01"><meta property="article:modified_time" content="2026-08-01">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"예시","url":"https://example.com","logo":"https://example.com/logo.png","sameAs":["https://social.example/test"]},{"@type":"FAQPage"}]}</script>
</head><body><main><h1>GEO 실행 가이드</h1><p>이 가이드는 실무자가 GEO 진단을 바로 실행하고 우선순위를 결정하도록 핵심 답변과 검증 방법을 먼저 제공합니다.</p>
<h2>GEO란 무엇인가요?</h2><h3>어떻게 측정할 수 있나요?</h3><ul><li>질문 수집</li><li>반복 측정</li></ul><table><tr><th>모델</th><th>비율</th></tr><tr><td>GPT</td><td>40%</td></tr></table>
<section class="faq"><details><summary>질문 1?</summary><p>답변</p></details><details><summary>질문 2?</summary><p>답변</p></details><details><summary>질문 3?</summary><p>답변</p></details></section>
<p>고객 100개사에서 30% 개선했습니다.</p><a href="/one">내부 1</a><a href="/two">내부 2</a><a href="https://source.example/report">출처</a><a href="/about">회사 소개</a><a href="mailto:test@example.com">연락</a><img src="chart.png" alt="100개사 중 30개사가 개선된 차트"></main></body></html>`;

describe("GEO audit engine", () => {
  it("keeps exactly 32 rules in the documented 7+7+6+6+6 split", () => {
    expect(AUDIT_RULES).toHaveLength(32);
    const counts = Object.groupBy(AUDIT_RULES, (rule) => rule.category);
    expect(Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, value?.length]))).toEqual({
      "기반 SEO": 7,
      "GEO 콘텐츠 구조": 7,
      "신뢰도·E-E-A-T": 6,
      "기술적 GEO": 6,
      "브랜드 노출": 6,
    });
    expect(new Set(AUDIT_RULES.map((rule) => rule.code)).size).toBe(32);
  });

  it("scores a fully structured page and applies manual confirmations", () => {
    const snapshot = parseAuditHtml(richHtml, "https://example.com/guide");
    const manual = Object.fromEntries(AUDIT_RULES.filter((rule) => rule.manual).map((rule) => [rule.code, true]));
    const scored = scoreAudit(snapshot, { robots: "User-agent: *\nAllow: /", llms: "# Example", sitemap: "<urlset><url></url></urlset>" }, manual);
    expect(scored.total).toBe(32);
    expect(scored.items.filter((item) => !item.passed).map((item) => item.code)).toEqual([]);
    expect(scored.score).toBe(32);
    expect(scored.grade).toBe("우수");
  });

  it("detects explicit AI crawler blocks", () => {
    expect(blockedAiBots("User-agent: GPTBot\nDisallow: /\nUser-agent: ClaudeBot\nDisallow: /private")).toEqual(["GPTBot"]);
    expect(blockedAiBots("User-agent: *\nDisallow: /")).toEqual(["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended"]);
  });

  it("uses exact score boundaries", () => {
    expect(auditGrade(19)).toBe("개선 필요");
    expect(auditGrade(20)).toBe("보통");
    expect(auditGrade(24)).toBe("보통");
    expect(auditGrade(25)).toBe("우수");
  });
});
