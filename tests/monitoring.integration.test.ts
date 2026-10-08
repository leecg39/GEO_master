import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/monitoring/route";
import { closeDatabase, getDatabase } from "@/lib/db";
import { createProject, activateProject } from "@/lib/projects";
import { createQuestion, createQuestionSet, updateQuestion } from "@/lib/question-pool";
import { getMonitoringData, monitoringCsv, monitoringQuestionKey, monitoringRange } from "@/lib/monitoring";

let directory: string;
let projectId: number;
const range = { start: "2026-06-01", end: "2026-06-30" };
const question = "배달용으로 어떤 전기자전거를 렌탈하면 좋을지 알려줘";
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "geo-monitoring-"));
  vi.stubEnv("GEO_DB_PATH", path.join(directory, "test.db"));
  vi.stubEnv("GEO_AUTH_MODE", "local");
  projectId = createProject({ name: "라이트 모니터링", brandName: "라이클", category: "모빌리티", competitors: ["모토벨로", "모션"], brandAliases: ["LYCLE"], activate: true }).id;
});
afterEach(() => { closeDatabase(); fs.rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });

function run(at: string, options: { projectId?: number; status?: string; createdAt?: string } = {}) {
  const row = getDatabase().sqlite.prepare(`INSERT INTO measure_runs (project_id, status, models, repetitions, total_queries, created_at, completed_at)
    VALUES (?, ?, '[]', 1, 1, ?, ?)`).run(options.projectId ?? projectId, options.status ?? "completed", options.createdAt ?? at, at);
  return Number(row.lastInsertRowid);
}
function answer(runId: number, response: string, options: { provider?: string; status?: string; question?: string } = {}) {
  getDatabase().sqlite.prepare(`INSERT INTO measure_results (run_id, question_text, provider, model, repetition, response, brand_mentioned, sentiment, slot_status, created_at)
    VALUES (?, ?, ?, 'test-model', 1, ?, 0, 'neutral', ?, '2026-06-01T00:00:00Z')`)
    .run(runId, options.question ?? question, options.provider ?? "openai", response, options.status ?? "succeeded");
}
function data(selected?: string) { return getMonitoringData({ ...range, ...(selected ? { question: monitoringQuestionKey(selected) } : {}) }); }
function request(query: Record<string, string> = {}, headers?: Record<string, string>) {
  return new NextRequest(`http://localhost/api/monitoring?${new URLSearchParams({ ...range, ...query })}`, { headers });
}

describe("monitoring raw-answer projection", () => {
  it("includes unmeasured registered questions and only four providers without invented zeroes", () => {
    const set = createQuestionSet({ name: "대표 질문" });
    createQuestion(set.id, { text: question });
    const result = data();
    expect(result.runCount).toBe(0);
    expect(result.providers.map((item) => item.id)).toEqual(["openai", "anthropic", "gemini", "grok"]);
    expect(result.questions[0]).toMatchObject({ text: question, baseline: null, current: null, delta: null, measuredRuns: 0 });
    expect(result.overview.period.share).toBeNull();
    expect(result.weeks.every((week) => week.metric.share === null)).toBe(true);
  });

  it("weights by successful slots, counts each brand once and excludes failures, refusals and unsupported providers", () => {
    const first = run("2026-06-01T00:00:00Z");
    for (let index = 0; index < 10; index++) answer(first, index === 0 ? "라이클, 라이클, 라이클" : "언급 없음");
    const second = run("2026-06-02T00:00:00Z");
    answer(second, "LYCLE는 가능합니다.", { provider: "grok" });
    answer(second, "라이클", { status: "failed" });
    answer(second, "라이클", { status: "refused", provider: "gemini" });
    answer(second, "라이클", { provider: "perplexity" });
    const result = data(question);
    expect(result.weeks[0].metric).toEqual({ succeeded: 11, failed: 1, refused: 1, mentions: 2, share: 18.2, providerCount: 2, averageRank: 1 });
    expect(result.overview).toMatchObject({ baseline: { share: 10 }, current: { share: 100 }, delta: 90 });
    expect(result.selected!.brands[0].current?.providerCount).toBe(1);
    expect(result.providers.find((item) => item.id === "gemini")?.current).toMatchObject({ share: null, refused: 1, providerCount: null });
  });

  it("recomputes with current aliases and registered competitor order without altering stored metrics", () => {
    const id = run("2026-06-01T00:00:00Z");
    answer(id, "모토벨로, LYCLE는 편리합니다. LYCLE와 모션도 비교하세요.");
    const result = data(question);
    expect(result.selected!.brands[0]).toMatchObject({ name: "라이클", current: { share: 100, averageRank: 2 } });
    expect(result.selected!.brands.find((brand) => brand.name === "모토벨로")?.current?.averageRank).toBe(1);
    expect(result.selected!.brands.find((brand) => brand.name === "모션")?.current?.averageRank).toBe(3);
    expect(getDatabase().sqlite.prepare("SELECT brand_mentioned FROM measure_results").get()).toEqual({ brand_mentioned: 0 });
    getDatabase().sqlite.prepare("UPDATE projects SET brand_aliases = '[]' WHERE id = ?").run(projectId);
    expect(data(question).selected!.brands[0].current?.share).toBe(0);
  });

  it("uses matcher boundaries and does not treat domain-only matches as mentions", () => {
    answer(run("2026-06-01T00:00:00Z"), "라이클.kr, 슈퍼라이클, motionless. 브랜드 없음");
    expect(data().overview.current).toMatchObject({ share: 0, mentions: 0, averageRank: null, providerCount: 0 });
  });

  it("keeps missing endpoint questions and providers null instead of comparing different runs", () => {
    answer(run("2026-06-01T00:00:00Z"), "라이클", { provider: "anthropic" });
    answer(run("2026-06-08T00:00:00Z"), "라이클");
    answer(run("2026-06-15T00:00:00Z"), "라이클", { question: "나중에 새로 측정한 질문입니다" });
    const result = data(question);
    expect(result.questions.find((item) => item.text === question)).toMatchObject({ baseline: { share: 100 }, current: null, delta: null });
    expect(result.providers[0]).toMatchObject({ baseline: null, current: { share: 100 }, delta: null });
    expect(result.selected!.trends.at(-1)?.brands.own).toBeNull();
  });

  it("does not calculate a baseline or delta for a single run", () => {
    answer(run("2026-06-01T00:00:00Z"), "아무 브랜드도 없습니다");
    expect(data().overview).toMatchObject({ baseline: null, current: { share: 0 }, delta: null });
    expect(data().endpoints.baseline).toBeNull();
  });

  it("excludes unsupported-only runs from endpoints and monthly counts", () => {
    answer(run("2026-06-01T00:00:00Z"), "라이클", { provider: "perplexity" });
    const first = run("2026-06-08T00:00:00Z"); answer(first, "없음");
    const last = run("2026-06-15T00:00:00Z"); answer(last, "라이클");
    answer(run("2026-06-22T00:00:00Z"), "라이클", { provider: "perplexity" });
    const result = data(question);
    expect(result.runCount).toBe(2);
    expect(result.endpoints.baseline?.id).toBe(first);
    expect(result.endpoints.current?.id).toBe(last);
    expect(result.overview).toMatchObject({ baseline: { share: 0 }, current: { share: 100 }, delta: 100 });
    expect(result.monthlyRuns).toEqual([{ month: "2026-06", count: 2 }]);
    expect(result.selected?.trends.map((point) => point.id)).toEqual([first, last]);
  });

  it("normalizes SQLite timestamps before assigning KST weeks", () => {
    answer(run("2026-05-31 15:00:00"), "라이클");
    const result = data();
    expect(result.endpoints.current?.at).toBe("2026-05-31T15:00:00.000Z");
    expect(result.weeks[0]).toMatchObject({ week: "2026-06-01", runs: 1, metric: { share: 100 } });
  });

  it("handles the last supported calendar month without overflowing its month iterator", () => {
    answer(run("9999-12-31T14:59:00Z"), "라이클");
    const result = getMonitoringData({ start: "9999-12-01", end: "9999-12-31" });
    expect(result.runCount).toBe(1);
    expect(result.monthlyRuns).toEqual([{ month: "9999-12", count: 1 }]);
  });

  it("keeps a default period at the first supported year valid for a later export", async () => {
    const result = getMonitoringData({ end: "0001-01-01" });
    expect(result.range).toMatchObject({ start: "0001-01-01", end: "0001-01-01" });
    expect(result.monthlyRuns).toEqual([{ month: "0001-01", count: 0 }]);
    expect((await GET(request({ start: result.range.start, end: result.range.end, format: "csv" }))).status).toBe(200);
  });

  it("retains old question text after edits and merges only exactly identical registrations", () => {
    const firstSet = createQuestionSet({ name: "첫 세트" });
    const secondSet = createQuestionSet({ name: "둘째 세트" });
    const saved = createQuestion(firstSet.id, { text: question });
    createQuestion(secondSet.id, { text: question });
    answer(run("2026-06-01T00:00:00Z"), "라이클");
    expect(data().questions).toHaveLength(1);
    expect(data().questions[0].registrations).toHaveLength(2);
    updateQuestion(saved.id, { text: "새 질문으로 변경했습니다", expectedUpdatedAt: saved.updatedAt });
    expect(data().questions).toHaveLength(2);
    expect(data().questions.find((item) => item.text === question)).toMatchObject({ measuredRuns: 1, current: { share: 100 } });
    expect(data().questions.find((item) => item.text === "새 질문으로 변경했습니다")).toMatchObject({ measuredRuns: 0, current: null });
    expect(monitoringQuestionKey(question)).not.toBe(monitoringQuestionKey(`${question} `));
  });

  it("uses KST Monday weeks, inclusive dates, completion times and deterministic run endpoints", () => {
    answer(run("2026-05-31T14:59:59Z"), "라이클"); // Outside: May 31 KST
    const first = run("2026-05-31T15:00:00Z", { createdAt: "2026-05-01T00:00:00Z" });
    answer(first, "라이클");
    answer(run("2026-06-07T14:59:59Z"), "없음");
    answer(run("2026-06-07T15:00:00Z"), "라이클"); // Monday KST
    const last = run("2026-06-30T14:59:59Z"); answer(last, "라이클");
    answer(run("2026-06-30T15:00:00Z"), "라이클"); // July 1 excluded
    const result = data();
    expect(result.runCount).toBe(4);
    expect(result.endpoints.baseline?.id).toBe(first);
    expect(result.endpoints.current?.id).toBe(last);
    expect(result.weeks.slice(0, 2).map((week) => [week.week, week.runs, week.metric.share])).toEqual([["2026-06-01", 2, 50], ["2026-06-08", 1, 100]]);
    expect(result.monthlyRuns).toEqual([{ month: "2026-06", count: 4 }]);
  });

  it("scopes completed runs and registered questions to the active project", () => {
    const other = createProject({ name: "다른 프로젝트", brandName: "라이클", category: "모빌리티", competitors: [], activate: false });
    answer(run("2026-06-01T00:00:00Z", { projectId: other.id }), "라이클", { question: "비공개 다른 질문" });
    answer(run("2026-06-01T00:00:00Z", { status: "failed" }), "라이클");
    answer(run("2026-06-01T00:00:00Z", { status: "running" }), "라이클");
    expect(data().runCount).toBe(0);
    expect(data().questions).toEqual([]);
    expect(() => getMonitoringData({ ...range, projectId: other.id })).toThrow("활성 프로젝트");
    activateProject(other.id);
    expect(() => createQuestionSet({ name: "잘못된 위치", projectId })).toThrow("활성 프로젝트");
    expect(getDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM question_sets").get()).toEqual({ count: 0 });
  });

  it("does not silently truncate more than 100 runs", () => {
    for (let index = 0; index < 105; index++) answer(run("2026-06-01T00:00:00Z"), "라이클");
    expect(data().runCount).toBe(105);
    expect(data().overview.period.succeeded).toBe(105);
    expect(data().endpoints.current!.id).toBeGreaterThan(data().endpoints.baseline!.id);
  });

  it("defaults to 12 inclusive weeks in KST", () => {
    expect(monitoringRange(undefined, undefined, new Date("2026-10-07T16:00:00Z"))).toEqual({ start: "2026-07-17", end: "2026-10-08", timezone: "Asia/Seoul" });
  });
});

describe("monitoring API and CSV", () => {
  it.each<Record<string, string>>([{ start: "2026-02-30" }, { start: "2026-07-01" }, { start: "2024-01-01" }, { start: "0000-01-01" }, { end: "bad" }, { question: "bad" }, { format: "xlsx" }, { unexpected: "1" }])("rejects invalid filters %j", async (query) => {
    expect((await GET(request(query))).status).toBe(422);
  });
  it("returns private uncached JSON with the requested project guard", async () => {
    const response = await GET(request({ projectId: String(projectId) }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).project.id).toBe(projectId);
    expect((await GET(request({ projectId: "999999" }))).status).toBe(409);
  });
  it("enforces trusted account context for JSON and CSV", async () => {
    vi.stubEnv("GEO_AUTH_MODE", "proxy");
    vi.stubEnv("GEO_AUTH_PROXY_SECRET", "monitoring-test-secret-longer-than-32-characters");
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request({ format: "csv" }))).status).toBe(401);
    const response = await GET(request({}, { "x-geo-auth-secret": process.env.GEO_AUTH_PROXY_SECRET!, "x-geo-auth-user": "qa-user" }));
    expect(response.status).toBe(200);
  });
  it("does not export an overall report when the requested question is missing", async () => {
    const missing = monitoringQuestionKey("다른 프로젝트에 있는 질문");
    expect((await (await GET(request({ question: missing }))).json()).selectionMissing).toBe(true);
    expect((await GET(request({ question: missing, format: "csv" }))).status).toBe(404);
  });
  it("exports the same metrics, four providers, UTF-8 BOM and safe quoted cells", async () => {
    const unsafeQuestion = ' =HYPERLINK("https://example.com")\n질문';
    answer(run("2026-06-01T00:00:00Z"), "라이클", { question: unsafeQuestion });
    answer(run("2026-06-02T00:00:00Z"), "없음", { question: unsafeQuestion });
    const result = data();
    const csv = monitoringCsv(result);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"전체","","라이클","","100","0","\'-100"');
    expect(csv).toContain('"\' =HYPERLINK(""https://example.com"")\n질문"');
    expect(csv).not.toMatch(/perplexity/i);
    for (const name of ["ChatGPT", "Claude", "Gemini", "Grok"]) expect(csv).toContain(name);
    const response = await GET(request({ format: "csv" }));
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191]);
    expect(Buffer.from(bytes).toString("utf8")).toBe(csv);
    const selectedCsv = monitoringCsv(data(unsafeQuestion));
    expect(selectedCsv).toContain('"질문 브랜드"');
    expect(selectedCsv).toContain('"실행 추이"');
    expect(selectedCsv).not.toContain('"주별"');
  });
});
