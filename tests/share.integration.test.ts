import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/llm", () => ({ generateText: vi.fn(), generateGroundedText: vi.fn(), supportsWebSearch: (provider: string) => provider !== "grok" }));

import { closeDatabase, getDatabase } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { generateGroundedText, generateText } from "@/lib/llm";
import { getShareHistory, runShareMeasurement } from "@/lib/share";
import { ensureActiveProject, updateProject } from "@/lib/projects";
import { getPublicSettings, updateSettings } from "@/lib/settings";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-share-test-"));
const databasePath = path.join(tempDir, "geo.db");
const previousDb = process.env.GEO_DB_PATH;
const previousKey = process.env.GEO_MASTER_KEY;

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "share-integration-master-key-with-32-characters";
  const activeProject = ensureActiveProject();
  updateProject(activeProject.id, {
    name: "브랜드Z", brandName: "브랜드Z", category: "분석 도구", competitors: ["경쟁사A"],
    expectedUpdatedAt: activeProject.updatedAt,
  });
  updateSettings({
    models: { openai: "gpt-test", anthropic: "claude-test", gemini: "gemini-test", grok: "grok-4.6" },
    repetitions: 1, modelWeights: { openai: 1, anthropic: 0, gemini: 0, grok: 0 },
    apiKeys: { openai: "sk-test" }, expectedUpdatedAt: getPublicSettings().updatedAt,
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

  it("stores refused and failed slots separately and excludes them from the share denominator", async () => {
    const project = ensureActiveProject();
    updateProject(project.id, { brandAliases: ["BrandZ"], domain: "https://www.brandz.example/", expectedUpdatedAt: project.updatedAt });
    vi.mocked(generateText).mockReset();
    vi.mocked(generateText)
      .mockResolvedValueOnce("분석 도구로는 BrandZ가 자주 쓰입니다.")
      .mockResolvedValueOnce("positive")
      .mockResolvedValueOnce("죄송하지만 해당 정보를 제공할 수 없습니다.")
      .mockRejectedValueOnce(new AppError("openai 모델 호출에 실패했습니다.", 502, "LLM_REQUEST_FAILED"));
    const result = await runShareMeasurement({
      questions: ["좋은 분석 도구의 기준은 무엇인가요?", "기업용 분석 도구를 비교해 주세요.", "분석 도구 도입 비용은 어느 정도인가요?"],
      providers: ["openai"], repetitions: 1,
    });
    expect(result.status).toBe("completed");
    expect(result.answerShare).toBe(100);
    expect(result).toMatchObject({ quality: { planned: 3, succeeded: 1, refused: 1, failed: 1 } });
    const rows = getDatabase().sqlite.prepare("SELECT slot_status, brand_mentioned, matched_spans, metric_version FROM measure_results WHERE run_id = ? ORDER BY id").all(result.id) as {
      slot_status: string; brand_mentioned: number; matched_spans: string; metric_version: string;
    }[];
    expect(rows.map((row) => row.slot_status)).toEqual(["succeeded", "refused", "failed"]);
    expect(JSON.parse(rows[0]!.matched_spans)[0]).toMatchObject({ alias: "BrandZ" });
    expect(rows.every((row) => row.metric_version === "m1.0")).toBe(true);
  });

  it("fails the run when every slot fails", async () => {
    vi.mocked(generateText).mockReset();
    vi.mocked(generateText).mockRejectedValue(new AppError("openai 모델 호출에 실패했습니다.", 502, "LLM_REQUEST_FAILED"));
    await expect(runShareMeasurement({
      questions: ["좋은 분석 도구의 기준은 무엇인가요?"], providers: ["openai"], repetitions: 1,
    })).rejects.toMatchObject({ code: "LLM_REQUEST_FAILED" });
    vi.mocked(generateText).mockReset();
  });

  it("exposes brand aliases and normalized domain on the active project", () => {
    const settings = getPublicSettings();
    expect(settings.brandAliases).toEqual(["BrandZ"]);
    expect(settings.domain).toBe("brandz.example");
  });

  it("stores classified citations for web-search measurements and summarizes own citation coverage", async () => {
    const project = ensureActiveProject();
    updateProject(project.id, { competitorDomains: ["rival.example"], expectedUpdatedAt: project.updatedAt });
    vi.mocked(generateText).mockReset();
    vi.mocked(generateGroundedText).mockReset();
    vi.mocked(generateText).mockResolvedValue("neutral");
    vi.mocked(generateGroundedText)
      .mockResolvedValueOnce({
        text: "BrandZ와 경쟁사A를 비교했습니다.", returnedModel: "gpt-returned", searchPerformed: true,
        citations: [
          { url: "https://brandz.example/docs", domain: "brandz.example", title: "Docs", kind: "cited" },
          { url: "https://news.naver.com/a", domain: "news.naver.com", title: "뉴스", kind: "searched" },
        ],
      })
      .mockResolvedValueOnce({
        text: "경쟁사A를 추천합니다.", returnedModel: "gpt-returned", searchPerformed: true,
        citations: [{ url: "https://rival.example/p", domain: "rival.example", title: "Rival", kind: "cited" }],
      });
    const result = await runShareMeasurement({
      questions: ["좋은 분석 도구의 기준은 무엇인가요?", "기업용 분석 도구를 비교해 주세요."],
      providers: ["openai"], repetitions: 1, searchMode: "web",
    });
    expect(result).toMatchObject({
      searchMode: "web",
      citations: { ownCitationCoverage: { numerator: 1, denominator: 2, value: 50 }, citedByCategory: { own: 1, competitor: 1 } },
    });
    const db = getDatabase().sqlite;
    const citations = db.prepare("SELECT domain, kind, category FROM measure_citations WHERE run_id = ? ORDER BY id").all(result.id);
    expect(citations).toEqual([
      { domain: "brandz.example", kind: "cited", category: "own" },
      { domain: "news.naver.com", kind: "searched", category: "media" },
      { domain: "rival.example", kind: "cited", category: "competitor" },
    ]);
    const conditions = db.prepare("SELECT search_mode, search_performed, citation_supported, returned_model FROM measure_results WHERE run_id = ? LIMIT 1").get(result.id);
    expect(conditions).toEqual({ search_mode: "web", search_performed: 1, citation_supported: 1, returned_model: "gpt-returned" });
  });

  it("records the failure reason when a provider rejects the search tool", async () => {
    vi.mocked(generateGroundedText).mockReset();
    vi.mocked(generateGroundedText)
      .mockRejectedValueOnce(new AppError("openai에서 웹검색 도구를 사용할 수 없습니다.", 502, "SEARCH_UNSUPPORTED"))
      .mockResolvedValueOnce({ text: "일반 답변", returnedModel: null, searchPerformed: false, citations: [] });
    const result = await runShareMeasurement({
      questions: ["좋은 분석 도구의 기준은 무엇인가요?", "기업용 분석 도구를 비교해 주세요."],
      providers: ["openai"], repetitions: 1, searchMode: "web",
    });
    const rows = getDatabase().sqlite.prepare("SELECT slot_status, slot_error FROM measure_results WHERE run_id = ? ORDER BY id").all(result.id);
    expect(rows).toEqual([{ slot_status: "failed", slot_error: "SEARCH_UNSUPPORTED" }, { slot_status: "succeeded", slot_error: null }]);
  });

  it("rejects questions that contain a brand alias", async () => {
    await expect(runShareMeasurement({ questions: ["BrandZ 같은 분석 도구를 추천해 주세요"], providers: ["openai"], repetitions: 1 }))
      .rejects.toMatchObject({ code: "BRANDED_QUESTION" });
  });
});
