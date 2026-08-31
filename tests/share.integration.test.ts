import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/llm", () => ({ generateText: vi.fn() }));

import { closeDatabase, getDatabase } from "@/lib/db";
import { generateText } from "@/lib/llm";
import { getShareHistory, runShareMeasurement } from "@/lib/share";
import { updateSettings } from "@/lib/settings";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-share-test-"));
const databasePath = path.join(tempDir, "geo.db");
const previousDb = process.env.GEO_DB_PATH;
const previousKey = process.env.GEO_MASTER_KEY;

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "share-integration-master-key-with-32-characters";
  updateSettings({
    brandName: "브랜드Z", category: "분석 도구", competitors: ["경쟁사A"],
    models: { openai: "gpt-test", anthropic: "claude-test", gemini: "gemini-test", hyperclova: "HCX-DASH-002" },
    repetitions: 1, modelWeights: { openai: 1, anthropic: 0, gemini: 0, hyperclova: 0 },
    apiKeys: { openai: "sk-test" },
  });
});
afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb;
  if (previousKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = previousKey;
});

describe("share measurement atomicity", () => {
  it("does not persist partial result rows when a later LLM request fails", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce("일반적인 도구 비교 응답")
      .mockRejectedValueOnce(new Error("simulated provider failure"));
    await expect(runShareMeasurement({
      questions: ["좋은 분석 도구의 기준은 무엇인가요?", "기업용 분석 도구를 비교해 주세요."],
      providers: ["openai"], repetitions: 1,
    })).rejects.toThrow();
    const run = getDatabase().sqlite.prepare("SELECT id, status FROM measure_runs ORDER BY id DESC LIMIT 1").get() as { id: number; status: string };
    const count = getDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM measure_results WHERE run_id = ?").get(run.id) as { count: number };
    expect(run.status).toBe("failed");
    expect(count.count).toBe(0);
  });

  it("tolerates malformed legacy history JSON", () => {
    const db = getDatabase().sqlite;
    const run = db.prepare("SELECT id FROM measure_runs ORDER BY id DESC LIMIT 1").get() as { id: number };
    db.prepare("UPDATE measure_runs SET models = ?, summary = ? WHERE id = ?").run("not-json", "{", run.id);
    const item = getShareHistory().find((entry) => entry.id === run.id);
    expect(item?.models).toEqual([]);
    expect(item?.summary).toEqual({});
  });
});
