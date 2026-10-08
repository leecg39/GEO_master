import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/llm", () => ({ generateText: vi.fn() }));

import { closeDatabase } from "@/lib/db";
import { createFact } from "@/lib/facts";
import { generateText } from "@/lib/llm";
import { ensureActiveProject } from "@/lib/projects";
import { getPublicSettings, updateSettings } from "@/lib/settings";
import { runStudioTool } from "@/lib/studio";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-studio-evidence-"));
const databasePath = path.join(tempDir, "geo.db");
const previousDb = process.env.GEO_DB_PATH;
const previousKey = process.env.GEO_MASTER_KEY;

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "studio-evidence-master-key-with-32-characters";
  ensureActiveProject();
  updateSettings({
    models: { openai: "gpt-test", anthropic: "claude-test", gemini: "gemini-test", grok: "grok-4.6" },
    repetitions: 1, modelWeights: { openai: 1, anthropic: 0, gemini: 0, grok: 0 },
    apiKeys: { openai: "sk-test" }, expectedUpdatedAt: getPublicSettings().updatedAt,
  });
  createFact({ attribute: "가격", value: "12,000", unit: "원", verified: true });
});

afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb;
  if (previousKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = previousKey;
});

describe("studio evidence grounding", () => {
  it("passes verified facts to the model and flags unsupported numbers in the draft", async () => {
    vi.mocked(generateText).mockResolvedValueOnce("요금은 월 12,000원입니다. 고객 만족도는 98%입니다.");
    const result = await runStudioTool({ action: "rewrite", text: "요금이 저렴합니다.", patterns: ["형용사→수치"], provider: "openai" });
    expect(vi.mocked(generateText).mock.calls[0]![0].prompt).toContain("- 가격: 12,000 원");
    expect(result.output.evidence).toMatchObject({
      needsEvidence: 1,
      sentences: [{ check: "ok", factIds: [expect.any(String)] }, { check: "needs_evidence" }],
    });
  });
});
