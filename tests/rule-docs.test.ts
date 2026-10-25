import { describe, expect, it } from "vitest";
import { AUDIT_RULES, auditGrade } from "@/lib/audit";
import { auditGradeScale, auditGradeTone } from "@/lib/audit-grade";
import { analyzeObservation } from "@/lib/page-snapshots";
import { RULE_DOC_HOSTS, RULE_DOCS, ruleDocFor } from "@/lib/rule-docs";

const html = `<!doctype html><html lang="ko"><head><title>상품 A</title>
  <meta name="description" content="설명"><link rel="canonical" href="https://example.com/p">
  <script type="application/ld+json">{"@type":"Product","name":"A"}</script></head>
  <body><h1>상품 A</h1><p>본문</p></body></html>`;

describe("rule documentation links", () => {
  it("covers every automatic audit rule", () => {
    const missing = AUDIT_RULES.filter((rule) => !rule.manual && !ruleDocFor(rule.code)).map((rule) => rule.code);
    expect(missing).toEqual([]);
  });

  it("covers every page snapshot finding code", () => {
    const analysis = analyzeObservation({
      url: "https://example.com/p", finalUrl: "https://example.com/p", statusCode: 200, contentType: "text/html",
      renderMode: "native", body: html, bodyKind: "html",
    }, "example.com");
    const missing = analysis.findings.map((item) => item.code).filter((code) => !ruleDocFor(code));
    expect(missing).toEqual([]);
  });

  it("only links to https pages on allow-listed documentation hosts", () => {
    for (const [code, doc] of Object.entries(RULE_DOCS)) {
      const url = new URL(doc.url);
      expect(url.protocol, code).toBe("https:");
      expect(RULE_DOC_HOSTS, code).toContain(url.hostname);
      expect(doc.source.trim(), code).not.toBe("");
    }
  });

  it("warns that Google Search no longer shows FAQ rich results", () => {
    expect(ruleDocFor("tech-faq-schema")?.note).toMatch(/FAQ 리치 결과/);
  });

  it("returns null for unknown or manual-only codes", () => {
    expect(ruleDocFor("brand-definition")).toBeNull();
    expect(ruleDocFor("__proto__")).toBeNull();
    expect(ruleDocFor("constructor")).toBeNull();
  });
});

describe("audit grade scale", () => {
  it("keeps the server grade and the client tone on the same thresholds", () => {
    for (let score = 0; score <= AUDIT_RULES.length; score += 1) {
      const grade = auditGrade(score);
      const tone = auditGradeTone(score);
      expect({ score, tone }).toEqual({ score, tone: grade === "우수" ? "good" : grade === "개선 필요" ? "bad" : "warn" });
    }
  });

  it("describes the scale in words for the screen", () => {
    const scale = auditGradeScale(AUDIT_RULES.length);
    expect(scale).toContain(`${AUDIT_RULES.length}개 중 통과 수`);
    expect(scale).toMatch(/25개 이상 우수/);
    expect(scale).toMatch(/20~24개 보통/);
    expect(scale).toMatch(/20개 미만 개선 필요/);
  });
});
