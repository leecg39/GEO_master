import { describe, expect, it } from "vitest";
import { auditStudioOutput, factPromptBlock } from "@/lib/draft-evidence";
import type { DraftFact } from "@/lib/geo-core";

const facts: DraftFact[] = [
  { id: "1", attribute: "가격", value: "12,000", unit: "원", usable: true },
  { id: "2", attribute: "설립연도", value: "2015", unit: "년", usable: false },
];

describe("factPromptBlock", () => {
  it("lists only usable facts and tells the model to mark missing evidence", () => {
    const block = factPromptBlock(facts);
    expect(block).toContain("- 가격: 12,000 원");
    expect(block).not.toContain("2015");
    expect(block).toContain("[자료 요청]");
  });

  it("forbids numbers entirely when there are no usable facts", () => {
    expect(factPromptBlock([])).toContain("확인된 사실 메모가 없습니다");
  });
});

describe("auditStudioOutput", () => {
  it("audits rewrite and intro text", () => {
    expect(auditStudioOutput("rewrite", { after: "요금은 12,000원입니다. 만족도 98%." }, facts)?.needsEvidence).toBe(1);
    expect(auditStudioOutput("intro", { intro: "요금은 12,000원입니다." }, facts)?.needsEvidence).toBe(0);
  });

  it("audits every FAQ answer", () => {
    const audit = auditStudioOutput("faq", { faqs: [{ question: "가격은?", answer: "12,000원입니다." }, { question: "회원 수는?", answer: "5만 명입니다." }] }, facts);
    expect(audit?.needsEvidence).toBe(1);
    expect(audit?.sentences.map((sentence) => sentence.check)).toEqual(["ok", "needs_evidence"]);
  });

  it("returns null for deterministic entity output", () => {
    expect(auditStudioOutput("entity", { definition: "정의" }, facts)).toBeNull();
  });
});
