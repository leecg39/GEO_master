import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET } from "@/app/api/monitoring/responses/route";
import { GET as aggregateGet } from "@/app/api/monitoring/route";
import { closeDatabase, getDatabase } from "@/lib/db";
import { createProject, updateProject } from "@/lib/projects";
import { createQuestion, createQuestionSet } from "@/lib/question-pool";
import { getMonitoringData, monitoringQuestionKey } from "@/lib/monitoring";
import { getMonitoringResponses } from "@/lib/monitoring-responses";

let directory: string;
let project: ReturnType<typeof createProject>;
const text = "어느 전기자전거 서비스를 선택하면 좋을까요?";
const question = monitoringQuestionKey(text);
const range = { start: "2026-06-01", end: "2026-06-30" };
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "geo-response-"));
  vi.stubEnv("GEO_DB_PATH", path.join(directory, "qa.db")); vi.stubEnv("GEO_AUTH_MODE", "local");
  project = createProject({ name: "응답 근거", brandName: "라이클", brandAliases: ["LYCLE"], competitors: ["모토벨로"], category: "모빌리티", activate: true });
});
afterEach(() => { closeDatabase(); fs.rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });
function run(at = "2026-06-01T00:00:00Z", id = project.id, summary = '{"searchMode":"web"}') {
  return Number(getDatabase().sqlite.prepare(`INSERT INTO measure_runs(project_id,status,models,repetitions,total_queries,summary,created_at,completed_at)
    VALUES(?,'completed','[]',3,12,?,?,?)`).run(id, summary, at, at).lastInsertRowid);
}
function answer(runId: number, provider = "openai", response = "라이클과 모토벨로를 비교합니다.", options: { text?: string; status?: string; repetition?: number; searchMode?: string; searchPerformed?: number | null; model?: string; returnedModel?: string | null; version?: string } = {}) {
  return Number(getDatabase().sqlite.prepare(`INSERT INTO measure_results(run_id,question_text,provider,model,repetition,response,brand_mentioned,sentiment,
    slot_status,search_mode,search_performed,returned_model,metric_version,created_at) VALUES(?,?,?,?,?,?,0,'neutral',?,?,?,?,?,'2026-06-01T00:00:00Z')`)
    .run(runId, options.text ?? text, provider, options.model ?? "test-v1", options.repetition ?? 1, response, options.status ?? "succeeded",
      options.searchMode ?? "web", options.searchPerformed === undefined ? 1 : options.searchPerformed, options.returnedModel ?? null, options.version ?? "v2").lastInsertRowid);
}
function data(runId: number, extra: Record<string, unknown> = {}) { return getMonitoringResponses({ ...range, runId, question, projectId: project.id, ...extra }); }
function request(runId: number, extra: Record<string, string> = {}, headers?: Record<string, string>) {
  return new NextRequest(`http://localhost/api/monitoring/responses?${new URLSearchParams({ ...range, runId: String(runId), question, projectId: String(project.id), ...extra })}`, { headers });
}
it("returns exact question evidence and the same current-dictionary metrics as the chart", () => {
  const id = run();
  answer(id); answer(id, "anthropic", "LYCLE을 살펴보세요."); answer(id, "gemini", "모토벨로");
  answer(id, "grok", "https://lycle.example.com", { searchMode: "off", searchPerformed: null });
  answer(id, "openai", "라이클", { text: `${text} 추가 질문` });
  answer(id, "perplexity");
  const result = data(id);
  expect(result.items).toHaveLength(4);
  expect(result.providers.map((p) => p.name)).toEqual(["ChatGPT", "Claude", "Gemini", "Grok"]);
  expect(result.summary).toMatchObject({ share: 50, mentions: 2, succeeded: 4, mentionedProviderCount: 2, measuredProviderCount: 4 });
  expect(result.summary.share).toBe(getMonitoringData({ ...range, question }).selected?.question.current?.share);
  const own = result.items[1].mentions.find((m) => m.own)!;
  expect(result.items[1].response.slice(own.start, own.end)).toBe("LYCLE");
  expect(result.items[3].mentions).toEqual([]);
});
it("keeps all-slot denominators across pages and provider filters", () => {
  const id = run();
  answer(id); answer(id, "openai", "없음", { repetition: 2 }); answer(id, "openai", "", { repetition: 3, status: "failed" });
  answer(id, "anthropic", "거절", { status: "refused" }); answer(id, "grok", "모토벨로");
  const first = data(id, { limit: 1 });
  expect(first.summary).toMatchObject({ succeeded: 3, failed: 1, refused: 1, share: 33.3 });
  expect(first.providers[0]).toMatchObject({ resultCount: 3, share: 50 });
  const second = data(id, { limit: 1, cursor: first.page.nextCursor });
  expect(second.items[0].id).toBeGreaterThan(first.items[0].id);
  expect(second.summary).toEqual(first.summary);
  expect(data(id, { provider: "grok" }).summary).toEqual(first.summary);
  expect(data(id, { provider: "grok" }).items.map((r) => r.provider)).toEqual(["grok"]);
  expect(() => data(id, { provider: "grok", cursor: first.page.nextCursor })).toThrow("다른 질문");
  const other = run("2026-06-08T00:00:00Z"); answer(other);
  expect(() => data(other, { cursor: first.page.nextCursor })).toThrow("다른 질문");
  expect(() => data(id, { cursor: "broken" })).toThrow("커서");
});
it("groups search conditions inside the same provider and separates stored citation kinds", () => {
  const id = run(); const resultId = answer(id); answer(id, "openai", "라이클", { repetition: 2, searchMode: "off", searchPerformed: 0 });
  const db = getDatabase().sqlite;
  for (const [kind, url] of [["cited", "https://example.com/cited"], ["inline", "https://example.com/inline"], ["searched", "https://example.com/search"], ["cited", "javascript:alert(1)"], ["cited", "https://user:secret@example.com"]]) {
    db.prepare("INSERT INTO measure_citations(run_id,result_id,url,domain,kind,category,created_at) VALUES(?,?,?,'example.com',?,'own','2026-06-01')").run(id, resultId, url, kind);
  }
  const result = data(id);
  expect(result.providers).toHaveLength(4);
  expect(result.providers[0].groups.map((g) => g.searchMode)).toEqual(["web", "off"]);
  expect(result.items[0].sources.map((s) => s.kind)).toEqual(["cited", "inline", "searched"]);
  expect(result.items[0].sources[0].storedCategory).toBe("own");
  expect(result.run.requestedSearchMode).toBe("web");
});
it("distinguishes failure, unmeasured services, zero mentions and missing legacy raw answers", () => {
  const id = run(); answer(id, "openai", "", { status: "failed" }); answer(id, "anthropic", "언급 없음");
  const result = data(id);
  expect(result.providers[0]).toMatchObject({ share: null, failed: 1 });
  expect(result.providers[1]).toMatchObject({ share: 0, succeeded: 1 });
  expect(result.providers[2]).toMatchObject({ share: null, resultCount: 0 });
  const set = createQuestionSet({ name: "원문 없는 실행" }); createQuestion(set.id, { text });
  const empty = data(run("2026-06-08T00:00:00Z"));
  expect(empty.run.rawAnswerCount).toBe(0); expect(empty.items).toEqual([]);
  expect(empty.providers).toHaveLength(4); expect(empty.summary.share).toBeNull();
});
it("does not invent search conditions for legacy data and recomputes after alias changes", () => {
  const id = run("2026-06-01T00:00:00Z", project.id, "{}"); answer(id, "openai", "새별칭을 확인하세요.", { searchMode: "off", searchPerformed: null, version: "legacy" });
  expect(data(id).items[0].searchMode).toBe("unknown");
  expect(data(id).summary.share).toBe(0);
  updateProject(project.id, { brandAliases: ["새별칭"], expectedUpdatedAt: project.updatedAt });
  expect(data(id).summary.share).toBe(100);
  expect(getMonitoringData({ ...range, question }).selected?.question.current?.share).toBe(100);
});
it("filters all projections to the latest run's same question/model/search/repetition conditions", async () => {
  const a = run(); answer(a, "openai", "라이클");
  const b = run("2026-06-08T00:00:00Z"); answer(b, "openai", "모토벨로", { model: "test-v2" });
  const c = run("2026-06-15T00:00:00Z"); answer(c, "openai", "없음");
  const all = getMonitoringData({ ...range, question });
  expect(all.runCount).toBe(3);
  const filtered = getMonitoringData({ ...range, question, comparison: "same" });
  expect(filtered.runCount).toBe(2);
  expect(filtered.conditions.excludedRuns).toBe(1);
  expect(filtered.selected?.trends.map((r) => r.id)).toEqual([a, c]);
  expect(filtered.overview).toMatchObject({ baseline: { share: 100 }, current: { share: 0 }, delta: -100 });
  expect(data(a, { comparison: "same" }).summary.share).toBe(100);
  expect(() => data(b, { comparison: "same" })).toThrow("비교 조건");
  const response = await aggregateGet(new NextRequest(`http://localhost/api/monitoring?${new URLSearchParams({ ...range, comparison: "same", format: "csv", question })}`));
  const csv = await response.text();
  expect(csv).toContain('"최근 실행과 같은 조건","제외 실행","1"');
  expect(csv).not.toContain("2026-06-08T00:00:00.000Z");
});
it("explains condition differences and refuses equality claims for unknown conditions", () => {
  const a = run(); answer(a);
  const b = run("2026-06-08T00:00:00Z", project.id, '{"searchMode":"off"}');
  answer(b, "grok", "없음", { model: "other", searchMode: "off", repetition: 2, text: "다른 질문입니다" });
  const result = getMonitoringData(range);
  expect(result.conditions.differences.join(" ")).toContain("질문 구성");
  expect(result.conditions.differences.join(" ")).toContain("모델 버전");
  expect(result.conditions.differences.join(" ")).toContain("검색 요청");
  const legacy = run("2026-06-15T00:00:00Z", project.id, "{}"); answer(legacy, "openai", "응답", { version: "legacy" });
  expect(() => getMonitoringData({ ...range, comparison: "same" })).toThrow("조건 기록이 부족");
});
it("rejects unknown questions, incomplete or unsupported runs, wrong dates and other projects", async () => {
  const id = run(); answer(id);
  expect((await GET(request(id, { question: "a".repeat(64) }))).status).toBe(404);
  expect((await GET(request(id, { start: "2026-06-02" }))).status).toBe(404);
  expect((await GET(request(id, { projectId: "9999" }))).status).toBe(409);
  expect((await GET(request(id, { provider: "perplexity" }))).status).toBe(422);
  const other = createProject({ name: "다른 프로젝트", brandName: "다름", category: "기타", competitors: [], activate: false });
  const hidden = run("2026-06-01T00:00:00Z", other.id); answer(hidden);
  expect((await GET(request(hidden))).status).toBe(404);
  const unsupported = run(); answer(unsupported, "perplexity");
  expect((await GET(request(unsupported))).status).toBe(404);
  getDatabase().sqlite.prepare("UPDATE measure_runs SET status = 'running' WHERE id = ?").run(id);
  expect((await GET(request(id))).status).toBe(404);
});
it("enforces account context and private no-store for raw responses", async () => {
  const id = run(); answer(id);
  const ok = await GET(request(id)); expect(ok.status).toBe(200); expect(ok.headers.get("cache-control")).toBe("private, no-store");
  vi.stubEnv("GEO_AUTH_MODE", "proxy"); vi.stubEnv("GEO_AUTH_PROXY_SECRET", "raw-response-test-secret-longer-than-thirty-two");
  expect((await GET(request(id))).status).toBe(401);
  expect((await GET(request(id, {}, { "x-geo-auth-secret": process.env.GEO_AUTH_PROXY_SECRET!, "x-geo-auth-user": "qa-user" }))).status).toBe(200);
});
