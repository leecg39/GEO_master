import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/llm", () => ({ generateText: vi.fn() }));

import { getRunDiagnostics, runClaimCheck } from "@/lib/claims";
import { closeDatabase, getDatabase } from "@/lib/db";
import { measureResults, measureRuns } from "@/lib/db/schema";
import { createFact } from "@/lib/facts";
import { generateText } from "@/lib/llm";
import { ensureActiveProject, updateProject } from "@/lib/projects";
import { getPublicSettings, updateSettings } from "@/lib/settings";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-claims-test-"));
const databasePath = path.join(tempDir, "geo.db");
const previousDb = process.env.GEO_DB_PATH;
const previousKey = process.env.GEO_MASTER_KEY;
let runId = 0;

function result(response: string, overrides: Partial<typeof measureResults.$inferInsert> = {}) {
  return {
    runId, questionText: "분석 도구 가격은?", provider: "openai", model: "gpt-test", repetition: 1, response,
    brandMentioned: true, sentiment: "positive", mentionRank: 1, competitorMentions: "[]",
    slotStatus: "succeeded" as const, metricVersion: "m1.0", createdAt: "2026-10-01T00:00:00.000Z", ...overrides,
  };
}

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "claims-integration-master-key-with-32-characters";
  const project = ensureActiveProject();
  updateProject(project.id, { name: "브랜드Z", brandName: "브랜드Z", category: "분석 도구", competitors: ["경쟁사A"], expectedUpdatedAt: project.updatedAt });
  updateSettings({
    models: { openai: "gpt-test", anthropic: "claude-test", gemini: "gemini-test", grok: "grok-4.6" },
    repetitions: 1, modelWeights: { openai: 1, anthropic: 0, gemini: 0, grok: 0 },
    apiKeys: { openai: "sk-test" }, expectedUpdatedAt: getPublicSettings().updatedAt,
  });
  for (let index = 0; index < 3; index += 1) {
    createFact({ attribute: ["가격", "무료체험", "설립연도"][index]!, value: ["12,000", "14", "2015"][index]!, unit: ["원", "일", "년"][index]!, verified: true });
  }
  const { orm } = getDatabase();
  runId = orm.insert(measureRuns).values({
    projectId: project.id, status: "completed", models: "[]", repetitions: 1, totalQueries: 5, answerShare: 75, genrank: 70,
    funnelStage: "추천", summary: JSON.stringify({ competitorComparison: [{ name: "경쟁사A", mentions: 1, share: 25 }] }),
    createdAt: "2026-10-01T00:00:00.000Z", completedAt: "2026-10-01T00:01:00.000Z",
  }).returning().get().id;
  orm.insert(measureResults).values([
    result("브랜드Z는 월 15,000원입니다."),
    result("브랜드Z는 월 12,000원이고 무료 체험은 14일입니다."),
    result("브랜드Z는 2015년에 설립됐습니다."),
    result("관련 정보가 없습니다.", { brandMentioned: false, sentiment: "neutral", mentionRank: null }),
    result("", { slotStatus: "failed", brandMentioned: false }),
  ]).run();
});

afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb;
  if (previousKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = previousKey;
});

describe("claim checks", () => {
  it("extracts claims from brand-mentioning answers only and compares them with fact memos", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce('{"claims":[{"attribute":"가격","value":"15,000","unit":"원","claim_text":"브랜드Z는 월 15,000원"}]}')
      .mockResolvedValueOnce('```json\n{"claims":[{"attribute":"가격","value":"12000","unit":"원","claim_text":"월 12,000원"},{"attribute":"무료체험","value":"14","unit":"일","claim_text":"무료 체험 14일"}]}\n```')
      .mockResolvedValueOnce("not json");
    const summary = await runClaimCheck(runId, { provider: "openai" });
    expect(vi.mocked(generateText)).toHaveBeenCalledTimes(3);
    expect(summary).toEqual({
      checkedResults: 3, extractionFailed: 1,
      claims: { match: 2, conflict: 1, insufficient: 0, timeUnknown: 0, needsReview: 0 },
    });
  });

  it("builds diagnostic cards and lists claims with their linked facts", () => {
    const diagnostics = getRunDiagnostics(runId);
    expect(diagnostics.cards.map((card) => [card.card, card.verdict])).toEqual([
      ["존재", "pass"], ["맥락", "issue"], ["시의성", "issue"], ["추천", "pass"],
    ]);
    expect(diagnostics.claims.find((claim) => claim.verdict === "conflict")).toMatchObject({ value: "15,000", fact: { attribute: "가격", value: "12,000" } });
  });

  it("replaces earlier claims when re-run", async () => {
    vi.mocked(generateText).mockResolvedValue('{"claims":[]}');
    await runClaimCheck(runId, { provider: "openai" });
    expect(getRunDiagnostics(runId).claims).toEqual([]);
  });
});
