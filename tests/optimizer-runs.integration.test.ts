import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/llm", () => ({ generateText: vi.fn() }));
vi.mock("@/lib/url-security", () => ({ fetchPublicText: vi.fn() }));

import { closeDatabase, getDatabase } from "@/lib/db";
import { generateText } from "@/lib/llm";
import {
  cancelOptimizationRun, extractReadableText, fetchSourceText, getOptimizationRun, listOptimizationRuns, startOptimizationRun,
  waitForOptimizationRun,
} from "@/lib/optimizer-runs";
import { ensureActiveProject, updateProject } from "@/lib/projects";
import { getPublicSettings, updateSettings } from "@/lib/settings";
import { fetchPublicText } from "@/lib/url-security";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-optimizer-test-"));
const databasePath = path.join(tempDir, "geo.db");
const previousDb = process.env.GEO_DB_PATH;
const previousKey = process.env.GEO_MASTER_KEY;

const request = {
  title: "도입부 최적화",
  query: "중소기업용 분석 도구를 추천해 주세요",
  original: "브랜드Z는 중소기업을 위한 분석 도구입니다. 설치가 간단하고 대시보드를 바로 쓸 수 있습니다.",
  competitorSources: [{ label: "경쟁사A", url: null, text: "경쟁사A는 대기업을 위한 분석 플랫폼으로 다양한 연동을 제공합니다." }],
  allowedSources: [], quotes: [], provider: "openai", popsize: 2, generations: 1, completions: 1, seed: 3,
};

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "optimizer-runs-master-key-with-32-characters";
  const project = ensureActiveProject();
  updateProject(project.id, { name: "브랜드Z", brandName: "브랜드Z", competitors: ["경쟁사A"], expectedUpdatedAt: project.updatedAt });
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

describe("optimization runs", () => {
  it("rejects a request whose confirmed call estimate does not match", () => {
    expect(() => startOptimizationRun({ ...request, confirmedCalls: 1 })).toThrow(/예상 호출/);
  });

  it("runs in the background, stores progress and a simulation result", async () => {
    vi.mocked(generateText).mockImplementation(async ({ system }) => {
      if (system.includes("재작성")) return "## 중소기업용 분석 도구\n브랜드Z는 설치가 간단한 분석 도구입니다.";
      if (system.includes("평가")) return '{"content_fluency":4,"content_usefulness":4,"content_credibility":4,"content_structure":4}';
      return "중소기업에는 설치가 간단한 브랜드Z가 맞습니다 [2]. 대기업은 경쟁사A를 씁니다 [1].";
    });
    const started = startOptimizationRun({ ...request, confirmedCalls: 2 + 4 * 3 });
    expect(started.status).toBe("running");
    expect(() => startOptimizationRun({ ...request, confirmedCalls: 2 + 4 * 3 })).toThrow(/이미 실행 중/);
    await waitForOptimizationRun(started.id);
    const run = getOptimizationRun(started.id);
    expect(run.status).toBe("completed");
    expect(run.result?.candidates).toHaveLength(4);
    expect(run.result?.baseline.visibility).toBeGreaterThan(0);
    expect(run.progress).toMatchObject({ evaluated: 4, total: 4 });
    expect(listOptimizationRuns().map((item) => item.id)).toContain(started.id);
  });

  it("marks long-silent running rows as stale failures", () => {
    const db = getDatabase().sqlite;
    const id = Number(db.prepare("INSERT INTO optimization_runs (project_id, title, query, input, status, progress, created_at, updated_at) VALUES (?, 't', 'q', '{}', 'running', '{}', ?, ?)")
      .run(ensureActiveProject().id, "2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z").lastInsertRowid);
    expect(getOptimizationRun(id)).toMatchObject({ status: "failed", errorCode: "STALE_RUN" });
  });

  it("rejects canceling a finished run", () => {
    const finished = listOptimizationRuns().find((item) => item.status === "completed")!;
    expect(() => cancelOptimizationRun(finished.id)).toThrow();
  });
});

describe("competitor source fetching", () => {
  it("extracts readable text without scripts or navigation", () => {
    const text = extractReadableText("<html><head><title>T</title><script>alert(1)</script></head><body><nav>메뉴</nav><main><h1>제목</h1><p>본문 문단입니다.</p></main></body></html>");
    expect(text).toContain("제목");
    expect(text).toContain("본문 문단입니다.");
    expect(text).not.toContain("alert");
    expect(text).not.toContain("메뉴");
  });

  it("fetches public pages through the SSRF-guarded fetcher", async () => {
    vi.mocked(fetchPublicText).mockResolvedValueOnce({ url: "https://rival.example/p", status: 200, contentType: "text/html", text: "<title>Rival</title><p>경쟁 페이지 본문입니다. 충분히 긴 설명이 들어 있습니다.</p>" });
    await expect(fetchSourceText("https://rival.example/p")).resolves.toMatchObject({ url: "https://rival.example/p", title: "Rival" });
    vi.mocked(fetchPublicText).mockResolvedValueOnce({ url: "https://rival.example/x", status: 404, contentType: "text/html", text: "" });
    await expect(fetchSourceText("https://rival.example/x")).rejects.toThrow();
  });
});
