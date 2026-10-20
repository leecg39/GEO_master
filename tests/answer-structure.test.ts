import { describe, expect, it } from "vitest";
import { analyzeAnswerStructure, answerStructureFinding, countSentences, ANSWER_STRUCTURE } from "@/lib/answer-structure";
import { analyzeObservation } from "@/lib/page-snapshots";
import { ruleDocFor } from "@/lib/rule-docs";

const text = (chars: number) => "가".repeat(chars);
const section = (heading: string, chars: number) => `<h2>${heading}</h2><p>${text(chars)}</p>`;
const doc = (body: string) => `<html><head><title>t</title></head><body>${body}</body></html>`;

describe("sentence counting", () => {
  it("counts Korean and Latin sentence endings", () => {
    expect(countSentences("첫 문장입니다. 두 번째입니다! 세 번째일까요? 끝")).toBe(4);
    expect(countSentences("소수 3.5배와 v1.2는 문장 끝이 아닙니다.")).toBe(1);
    expect(countSentences("")).toBe(0);
  });
});

describe("answer structure metrics", () => {
  it("measures the first paragraph with enough text and the H2 sections in document order", () => {
    const result = analyzeAnswerStructure(doc(`<main><p>짧음</p><p>${text(120)}. 두 번째 문장입니다.</p>${section("가격", 600)}${section("배송", 100)}<ul><li>${text(50)}</li></ul></main>`));
    expect(result.firstParagraph).toEqual({ chars: 133, sentences: 2 });
    expect(result.sections).toEqual([{ heading: "가격", chars: 600 }, { heading: "배송", chars: 150 }]);
    expect(result.idealRatio).toBe(0.5);
  });

  it("ignores scripts and navigation text", () => {
    const result = analyzeAnswerStructure(doc(`<nav><p>${text(500)}</p></nav><script>var a = "${text(10)}";</script><p>${text(40)}</p>`));
    expect(result.firstParagraph?.chars).toBe(40);
  });

  it("returns no first paragraph when every paragraph is too short", () => {
    expect(analyzeAnswerStructure(doc("<p>짧음</p>")).firstParagraph).toBeNull();
  });
});

describe("answer structure finding (hypothesis, not scored)", () => {
  it("passes a concise opening with well-sized sections", () => {
    const finding = answerStructureFinding(doc(`<p>${text(150)}. 결론입니다.</p>${section("a", 500)}${section("b", 900)}`));
    expect(finding).toMatchObject({ code: "answer-structure", tier: "hypothesis", severity: "notice", passed: true });
  });

  it("flags a long opening and oversized sections but stays a notice", () => {
    const sentences = Array.from({ length: 6 }, () => `${text(60)}입니다.`).join(" ");
    const finding = answerStructureFinding(doc(`<p>${sentences}</p>${section("a", 3000)}${section("b", 3000)}`));
    expect(finding).toMatchObject({ passed: false, tier: "hypothesis", severity: "notice" });
    expect(finding.detail).toMatch(/첫 문단/);
    expect(finding.detail).toMatch(/H2 구간/);
    expect(finding.detail).toMatch(/가설/);
  });

  it("does not judge section length with fewer than two H2 sections", () => {
    expect(answerStructureFinding(doc(`<p>${text(100)}.</p>${section("a", 5000)}`)).passed).toBe(true);
  });

  it("keeps thresholds in one exported place", () => {
    expect(ANSWER_STRUCTURE).toMatchObject({ firstParagraphMaxChars: 300, firstParagraphMaxSentences: 4, sectionMinChars: 250, sectionMaxChars: 1600 });
  });

  it("is part of the page rules and has a documentation link", () => {
    const findings = analyzeObservation({ url: "https://e.com", finalUrl: "https://e.com", statusCode: 200, contentType: "text/html", renderMode: "native", bodyKind: "html", body: doc(`<p>${text(100)}.</p>`) }, "e.com").findings;
    expect(findings.find((item) => item.code === "answer-structure")?.tier).toBe("hypothesis");
    expect(ruleDocFor("answer-structure")?.note).toMatch(/가설/);
  });
});
