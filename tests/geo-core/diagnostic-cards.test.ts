import { describe, expect, it } from "vitest";
import { auditDraftText, suggestDiagnosticCards, type CardInput, type DraftFact } from "@/lib/geo-core";

const base: CardInput = {
  valid: 10, brandMentioned: 6, ambiguousMentions: 0, positiveMentions: 5, topCompetitorMentions: 3, hasFacts: true,
  claims: { match: 3, conflict: 0, insufficient: 1, timeUnknown: 0, needsReview: 0 },
};
const verdicts = (input: CardInput) => Object.fromEntries(suggestDiagnosticCards(input).map((card) => [card.card, card.verdict]));

describe("suggestDiagnosticCards", () => {
  it("passes all four funnel cards for a healthy run", () => {
    expect(verdicts(base)).toEqual({ 존재: "pass", 맥락: "pass", 시의성: "pass", 추천: "pass" });
  });

  it("flags presence when the brand is rarely mentioned or only through ambiguous aliases", () => {
    expect(verdicts({ ...base, brandMentioned: 2 }).존재).toBe("issue");
    expect(verdicts({ ...base, ambiguousMentions: 1 }).존재).toBe("issue");
  });

  it("flags context on conflicts and freshness on conflicts or time-unknown claims", () => {
    expect(verdicts({ ...base, claims: { ...base.claims, conflict: 1 } })).toMatchObject({ 맥락: "issue", 시의성: "issue" });
    expect(verdicts({ ...base, claims: { ...base.claims, timeUnknown: 1 } })).toMatchObject({ 맥락: "pass", 시의성: "issue" });
  });

  it("marks fact-based cards insufficient without facts or with fewer than three judgeable claims", () => {
    expect(verdicts({ ...base, hasFacts: false })).toMatchObject({ 맥락: "insufficient", 시의성: "insufficient" });
    expect(verdicts({ ...base, claims: { ...base.claims, match: 2 } })).toMatchObject({ 맥락: "insufficient" });
  });

  it("flags recommendation when a competitor is mentioned more often than the positive brand rate", () => {
    expect(verdicts({ ...base, positiveMentions: 3, topCompetitorMentions: 8 }).추천).toBe("issue");
    expect(verdicts({ ...base, valid: 0 })).toMatchObject({ 존재: "insufficient", 추천: "insufficient" });
  });
});

describe("auditDraftText", () => {
  const facts: DraftFact[] = [
    { id: "f1", attribute: "가격", value: "12,000", unit: "원", usable: true },
    { id: "f2", attribute: "설립연도", value: "2015", unit: "년", usable: false },
  ];

  it("links numeric sentences to usable facts and flags unsupported numbers as evidence requests", () => {
    const result = auditDraftText("기본 요금은 12,000원입니다. 고객 만족도는 98%입니다.\n2015년에 설립했습니다. 친절한 상담을 제공합니다.", facts);
    expect(result.sentences).toEqual([
      { text: "기본 요금은 12,000원입니다.", check: "ok", factIds: ["f1"], reason: null },
      { text: "고객 만족도는 98%입니다.", check: "needs_evidence", factIds: [], reason: "근거 사실이 없습니다" },
      { text: "2015년에 설립했습니다.", check: "needs_evidence", factIds: [], reason: "근거 사실이 없습니다" },
      { text: "친절한 상담을 제공합니다.", check: "ok", factIds: [], reason: null },
    ]);
    expect(result.needsEvidence).toBe(2);
  });

  it("treats explicit evidence-request markers as unresolved", () => {
    expect(auditDraftText("[자료 요청] 인증 현황을 확인해 주세요.", facts).needsEvidence).toBe(1);
  });
});
