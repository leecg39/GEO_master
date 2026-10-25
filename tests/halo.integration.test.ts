import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/llm", () => ({ generateText: vi.fn() }));
import { closeDatabase, getDatabase } from "@/lib/db";
import { activateProject, createProject, ensureActiveProject, updateProject } from "@/lib/projects";
import { getPublicSettings, updateSettings } from "@/lib/settings";
import { createQuestion, createQuestionSet } from "@/lib/question-pool";
import { adoptOpportunity, createOpportunity, deleteOpportunity, getOpportunity, listOpportunities, refreshOpportunities, updateOpportunity } from "@/lib/opportunities";
import { knowledgeDocuments, writingProfiles } from "@/lib/library";
import { createFact } from "@/lib/facts";
import { generateText } from "@/lib/llm";
import { runStudioTool } from "@/lib/studio";
import { getContent, storeGeneratedContent } from "@/lib/contents";
import { buildWorkspaceSnapshot, importWorkspace, workspaceSnapshotSchema } from "@/lib/workspace";
import { GET as libraryGET, POST as libraryPOST } from "@/app/api/knowledge-documents/route";
import { GET as opportunityGET } from "@/app/api/opportunities/route";
import { formatHaloTime } from "@/components/halo-api";
import { liveStudioSelection } from "@/components/studio-selection";

let directory: string, databasePath: string, projectId: number;
const question = "업무에 좋은 분석 도구는 무엇인가요?";
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "geo-halo-test-")); databasePath = path.join(directory, "geo.db");
  vi.stubEnv("GEO_DB_PATH", databasePath); vi.stubEnv("GEO_MASTER_KEY", "halo-integration-master-key-more-than-32"); vi.stubEnv("GEO_ENABLE_HALOX", "1");
  const initial = ensureActiveProject();
  projectId = updateProject(initial.id, { name: "자사 프로젝트", brandName: "자사브랜드", competitors: ["경쟁브랜드"], expectedUpdatedAt: initial.updatedAt }).id;
  vi.mocked(generateText).mockReset();
});
afterEach(() => { closeDatabase(databasePath); fs.rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });
function configureProvider() {
  updateSettings({ models: { openai: "gpt-test", anthropic: "claude-test", gemini: "gemini-test", grok: "grok-test" }, repetitions: 1,
    modelWeights: { openai: 1, anthropic: 0, gemini: 0, grok: 0 }, apiKeys: { openai: "sk-test" }, expectedUpdatedAt: getPublicSettings().updatedAt });
}
function seed(response: string, options: { at?: string; question?: string; status?: string; supported?: boolean; cited?: "own" | "other"; kind?: string; model?: string; provider?: string } = {}) {
  const sqlite = getDatabase().sqlite, at = options.at ?? "2026-10-20T12:00:00.000Z";
  const runId = Number(sqlite.prepare(`INSERT INTO measure_runs (project_id, status, models, repetitions, total_queries, summary, created_at, completed_at)
    VALUES (?, 'completed', '[]', 1, 1, '{"searchMode":"web"}', ?, ?)`).run(projectId, at, at).lastInsertRowid);
  const resultId = Number(sqlite.prepare(`INSERT INTO measure_results (run_id, question_text, provider, model, repetition, response, brand_mentioned, sentiment, slot_status, search_mode, citation_supported, metric_version, created_at)
    VALUES (?, ?, ?, ?, 1, ?, 0, 'neutral', ?, 'web', ?, 'v2', ?)`)
    .run(runId, options.question ?? question, options.provider ?? "openai", options.model ?? "gpt-test", response, options.status ?? "succeeded", options.supported === false ? 0 : 1, at).lastInsertRowid);
  if (options.cited) sqlite.prepare("INSERT INTO measure_citations (run_id, result_id, url, domain, kind, category, created_at) VALUES (?, ?, 'https://example.com/source', 'example.com', ?, ?, ?)").run(runId, resultId, options.kind ?? "cited", options.cited, at);
  return { runId, resultId };
}
function accepted() {
  const set = createQuestionSet({ name: "핵심 질문" }); createQuestion(set.id, { text: question }); seed("경쟁브랜드를 추천합니다.");
  const item = refreshOpportunities().items.find(item => item.kind === "competitor_gap")!;
  return adoptOpportunity(item.id, { expectedUpdatedAt: item.updatedAt });
}

describe("opportunity evidence and lifecycle", () => {
  it("preserves the same follow-up snapshot when re-saving after partial source deletion", () => {
    const original = accepted(), next = seed("자사브랜드", { at: "2026-10-25T00:00:00Z" });
    const extra = seed("경쟁브랜드", { at: "2026-10-25T00:00:00Z" });
    getDatabase().sqlite.prepare("UPDATE measure_results SET run_id = ? WHERE id = ?").run(next.runId, extra.resultId);
    const linked = updateOpportunity(original.id, { expectedUpdatedAt: original.updatedAt, followupRunId: next.runId });
    getDatabase().sqlite.prepare("DELETE FROM measure_results WHERE id = ?").run(extra.resultId);
    expect(getOpportunity(original.id).followupSourceMissing).toBe(true);
    const saved = updateOpportunity(original.id, { expectedUpdatedAt: linked.updatedAt, followupRunId: next.runId, appliedUrl: "https://example.com/updated", appliedAt: "2026-10-25" });
    expect(saved.followupEvidence).toEqual(linked.followupEvidence);
    expect(saved.followup).toEqual(linked.followup);
    expect(saved.followupSourceMissing).toBe(true);
    expect(saved.comparison?.comparable).toBe(false);
  });
  it("retains detached follow-up evidence and remaps its surviving references in v3 backups", () => {
    const original = accepted(), next = seed("자사브랜드", { at: "2026-10-25T00:00:00Z" });
    const linked = updateOpportunity(original.id, { expectedUpdatedAt: original.updatedAt, followupRunId: next.runId });
    const snapshot = buildWorkspaceSnapshot();
    importWorkspace({ mode: "merge", snapshot });
    const copied = buildWorkspaceSnapshot().data.opportunities.find(item => item.id !== original.id)!;
    expect(copied.followupEvidence?.samples[0].resultId).not.toBe(next.resultId);
    getDatabase().sqlite.prepare("DELETE FROM measure_runs WHERE id = ?").run(next.runId);
    const detached = getOpportunity(original.id);
    expect(detached).toMatchObject({ followupRunId: null, followupSourceMissing: true, followup: linked.followup, comparison: null });
    updateOpportunity(original.id, { expectedUpdatedAt: detached.updatedAt, notes: "삭제 후에도 유지" });
    expect(getOpportunity(original.id).followup).toEqual(linked.followup);
    const portable = buildWorkspaceSnapshot();
    expect(portable.data.opportunities.find(item => item.id === original.id)?.followupEvidence?.samples[0].resultId).toBeNull();
    importWorkspace({ mode: "replace", confirmReplace: true, snapshot: portable });
    expect(getOpportunity(original.id)).toMatchObject({ followupSourceMissing: true, followup: { mentions: 1 } });
  });
  it("never replaces a pending candidate's deleted original evidence with a newer run", () => {
    const original = seed("경쟁브랜드의 원본 답변");
    const item = refreshOpportunities().items[0];
    getDatabase().sqlite.prepare("DELETE FROM measure_runs WHERE id = ?").run(original.runId);
    seed("경쟁브랜드의 다른 답변", { at: "2026-10-24T00:00:00Z" });
    refreshOpportunities();
    expect(getOpportunity(item.id)).toMatchObject({ sourceMissing: true, baselineRunId: null, evidence: item.evidence });
  });
  it("renders the same KST timestamp across server and browser timezone settings", () => {
    for (const zone of ["UTC", "America/Los_Angeles", "Asia/Seoul"]) {
      vi.stubEnv("TZ", zone);
      expect(formatHaloTime("2026-10-20T23:05:00Z")).toBe("2026-10-21 08:05 KST");
    }
    expect(formatHaloTime("invalid")).toBe("시각 미상");
  });
  it.each([
    ["자사브랜드를 추천합니다.", "succeeded", true, undefined, []],
    ["경쟁브랜드를 추천합니다.", "succeeded", true, undefined, ["competitor_gap"]],
    ["자사브랜드와 경쟁브랜드를 추천합니다.", "succeeded", true, "own", []],
    ["경쟁브랜드를 추천합니다.", "succeeded", true, "other", ["competitor_gap", "citation_gap"]],
    ["추천 자료입니다.", "succeeded", false, "other", []],
    ["경쟁브랜드", "failed", true, "other", ["unmeasured"]],
    ["경쟁브랜드", "refused", true, "other", ["unmeasured"]],
  ] as const)("uses real successful evidence: %s / %s", (response, status, supported, cited, expected) => {
    const set = createQuestionSet({ name: "질문" }); createQuestion(set.id, { text: question });
    seed(response, { status, supported, cited });
    expect(refreshOpportunities().items.map(item => item.kind).sort()).toEqual([...expected].sort());
  });
  it("never treats inline URLs as citations and uses the latest completed question run", () => {
    seed("경쟁브랜드", { at: "2026-10-18T00:00:00Z", cited: "other" });
    seed("자사브랜드", { at: "2026-10-19T00:00:00Z", cited: "other", kind: "inline" });
    expect(refreshOpportunities().items).toHaveLength(0);
  });
  it("keeps zero successful samples distinct from zero mentions", () => {
    const set = createQuestionSet({ name: "질문" }); createQuestion(set.id, { text: question });
    const item = refreshOpportunities().items[0];
    expect(item).toMatchObject({ kind: "unmeasured", baselineRunId: null, evidence: { succeeded: 0, citationEligible: 0, samples: [] } });
  });
  it("does not turn unsupported providers into measured evidence", () => {
    const set = createQuestionSet({ name: "질문" }); createQuestion(set.id, { text: question });
    seed("경쟁브랜드", { provider: "demo", cited: "other" });
    expect(refreshOpportunities().items).toMatchObject([{ kind: "unmeasured", evidence: { succeeded: 0, samples: [] } }]);
  });
  it("deduplicates, adopts once and freezes accepted evidence across refreshes", () => {
    const item = accepted();
    expect(adoptOpportunity(item.id, { expectedUpdatedAt: "stale" }).strategyId).toBe(item.strategyId);
    seed("경쟁브랜드의 새로운 답변", { at: "2026-10-23T00:00:00Z" }); refreshOpportunities();
    expect(getOpportunity(item.id).baselineRunId).toBe(item.baselineRunId);
    expect(getDatabase().sqlite.prepare("SELECT COUNT(*) AS n FROM strategy_items").get()).toEqual({ n: 1 });
    expect(listOpportunities()).toHaveLength(1);
    const manual = createOpportunity({ question: "  새로운   질문을 알려주세요? " });
    expect(createOpportunity({ question: "새로운 질문을 알려주세요?" }).id).toBe(manual.id);
  });
  it("enforces revisions, project scope and reversible dismissal", () => {
    const item = createOpportunity({ question });
    const dismissed = updateOpportunity(item.id, { expectedUpdatedAt: item.updatedAt, status: "dismissed" });
    expect(() => updateOpportunity(item.id, { expectedUpdatedAt: item.updatedAt, notes: "stale" })).toThrow("다른 화면");
    expect(() => adoptOpportunity(item.id, { expectedUpdatedAt: dismissed.updatedAt })).toThrow("보류");
    const reopened = updateOpportunity(item.id, { expectedUpdatedAt: dismissed.updatedAt, status: "pending" });
    expect(reopened.decisions.map(row => row.action)).toEqual(["created", "dismissed", "pending"]);
    createProject({ name: "다른 프로젝트", brandName: "타사", category: "", competitors: [], activate: true });
    expect(() => getOpportunity(item.id)).toThrow("현재 프로젝트");
    expect(listOpportunities()).toHaveLength(0);
  });
  it("records application and compares only the chosen follow-up; preserves deleted evidence", () => {
    const item = accepted(), followup = seed("자사브랜드", { at: "2026-10-22T12:00:00Z", cited: "own" });
    const updated = updateOpportunity(item.id, { expectedUpdatedAt: item.updatedAt, followupRunId: followup.runId, appliedUrl: "https://example.com/guide", appliedAt: "2026-10-21" });
    expect(updated.comparison).toMatchObject({ comparable: true, mentionDelta: 100, citationDelta: 100 }); expect(updated.followup?.mentions).toBe(1);
    const different = seed("자사브랜드", { at: "2026-10-24T12:00:00Z", model: "other-model" });
    expect(updateOpportunity(item.id, { expectedUpdatedAt: updated.updatedAt, followupRunId: different.runId }).comparison).toMatchObject({ comparable: false, mentionDelta: null, citationDelta: null });
    getDatabase().sqlite.prepare("DELETE FROM measure_runs WHERE id = ?").run(item.baselineRunId);
    const detached = getOpportunity(item.id); expect(detached.sourceMissing).toBe(true); expect(detached.evidence.samples[0].response).toContain("경쟁브랜드");
  });
  it("does not attach unrelated or earlier measurements", () => {
    const item = accepted(), unrelated = seed("자사브랜드", { question: "전혀 다른 질문입니다", at: "2026-10-22T12:00:00Z" });
    expect(() => updateOpportunity(item.id, { expectedUpdatedAt: item.updatedAt, followupRunId: unrelated.runId })).toThrow("같은 질문");
    expect(() => updateOpportunity(item.id, { expectedUpdatedAt: item.updatedAt, appliedUrl: "https://example.com" })).toThrow("함께");
  });
});

describe("library and captured generation context", () => {
  it("only selects live sources when reusing historical content without mutating its snapshot", () => {
    const input = { opportunityId: 1, writingProfileId: 2, knowledgeDocumentIds: [3, 4, 4], generationContext: { historical: "보존할 본문" } };
    expect(liveStudioSelection(input, { opportunities: [], profiles: [], documents: [{ id: 4 }] })).toEqual({ opportunityId: "", writingProfileId: "", knowledgeDocumentIds: [4] });
    expect(input.knowledgeDocumentIds).toEqual([3, 4, 4]); expect(input.generationContext.historical).toBe("보존할 본문");
  });
  it.each([true, false])("rejects a late generation after workspace replace (request key: %s)", async keyed => {
    configureProvider();
    const snapshot = buildWorkspaceSnapshot();
    let resolve!: (text: string) => void;
    vi.mocked(generateText).mockImplementationOnce(() => new Promise<string>(done => { resolve = done; }));
    const running = runStudioTool({ action: "intro", topic: "원래 작업", provider: "openai", ...(keyed ? { clientRequestId: randomUUID() } : {}) });
    importWorkspace({ mode: "replace", confirmReplace: true, snapshot });
    resolve("복원 이전의 늦은 답변");
    await expect(running).rejects.toMatchObject({ code: "STUDIO_CONTEXT_INVALIDATED" });
    expect(buildWorkspaceSnapshot().data.contents).toHaveLength(0);
  });
  it("does not let an old execution complete or fail a replacement execution with the same request ID", async () => {
    configureProvider(); const snapshot = buildWorkspaceSnapshot();
    let resolveOld!: (text: string) => void, resolveNew!: (text: string) => void;
    vi.mocked(generateText).mockImplementationOnce(() => new Promise<string>(done => { resolveOld = done; }))
      .mockImplementationOnce(() => new Promise<string>(done => { resolveNew = done; }));
    const input = { action: "intro", topic: "동일 입력", provider: "openai", clientRequestId: randomUUID() };
    const old = runStudioTool(input);
    importWorkspace({ mode: "replace", confirmReplace: true, snapshot });
    const current = runStudioTool(input);
    resolveOld("이전 답변");
    await expect(old).rejects.toMatchObject({ code: "STUDIO_CONTEXT_INVALIDATED" });
    resolveNew("새 답변");
    const result = await current;
    expect(getContent(result.id).output).toMatchObject({ intro: "새 답변" });
    expect(buildWorkspaceSnapshot().data.contents).toHaveLength(1);
  });
  it("validates URL input, revisions and cross-project reads", () => {
    expect(() => knowledgeDocuments.create({ name: "자료", body: "본문", sourceUrl: "javascript:alert(1)" })).toThrow();
    const item = knowledgeDocuments.create({ name: "자료", body: "본문", sourceUrl: "https://example.com" });
    const changed = knowledgeDocuments.update(item.id, { data: { ...item.data, body: "다음 본문" }, expectedUpdatedAt: item.updatedAt });
    expect(() => knowledgeDocuments.delete(item.id, { expectedUpdatedAt: item.updatedAt })).toThrow("다른 화면");
    createProject({ name: "다른 프로젝트", brandName: "타사", category: "", competitors: [], activate: true });
    expect(() => knowledgeDocuments.get(item.id)).toThrow("현재 프로젝트");
    activateProject(projectId); knowledgeDocuments.delete(item.id, { expectedUpdatedAt: changed.updatedAt }); expect(knowledgeDocuments.list()).toHaveLength(0);
  });
  it("blocks concurrent provider calls and saves the original project and immutable sources after a project switch", async () => {
    configureProvider(); const opportunity = accepted();
    const document = knowledgeDocuments.create({ name: "제품", body: "고객 만족도 98%라는 미확인 자료" });
    const profile = writingProfiles.create({ name: "운영자", tone: "짧고 구체적으로" });
    createFact({ attribute: "가격", value: "12,000", unit: "원", verified: true });
    let resolve!: (text: string) => void;
    vi.mocked(generateText).mockImplementationOnce(() => new Promise<string>(done => { resolve = done; }));
    const input = { action: "intro", topic: "제품", provider: "openai", projectId, clientRequestId: randomUUID(), writingProfileId: profile.id, knowledgeDocumentIds: [document.id], opportunityId: opportunity.id };
    const running = runStudioTool(input);
    await expect(runStudioTool(input)).rejects.toMatchObject({ code: "STUDIO_REQUEST_ALREADY_STARTED" });
    knowledgeDocuments.delete(document.id, { expectedUpdatedAt: document.updatedAt });
    writingProfiles.update(profile.id, { data: { ...profile.data, tone: "바뀐 문체" }, expectedUpdatedAt: profile.updatedAt });
    const other = createProject({ name: "다른 프로젝트", brandName: "타사", category: "", competitors: [], activate: true });
    resolve("요금은 월 12,000원입니다. 고객 만족도는 98%입니다.");
    const generated = await running;
    expect(vi.mocked(generateText)).toHaveBeenCalledTimes(1);
    const prompt = vi.mocked(generateText).mock.calls[0][0].prompt;
    expect(prompt).toContain("사실 메모만 근거"); expect(prompt).toContain("짧고 구체적으로");
    expect(ensureActiveProject().id).toBe(other.id);
    activateProject(projectId);
    const saved = getContent(generated.id);
    expect(saved.projectId).toBe(projectId); expect(saved.status).toBe("draft");
    expect(saved.input).toMatchObject({ generationContext: { knowledgeDocuments: [{ id: document.id, data: { body: document.data.body } }], writingProfile: { data: { tone: profile.data.tone } } } });
    expect(generated.output).toMatchObject({ evidence: { needsEvidence: 1 } });
    expect(getOpportunity(opportunity.id).contents.map(item => item.id)).toContain(generated.id);
  });
  it("replays completed requests without another call and rejects changed source versions", async () => {
    configureProvider(); const profile = writingProfiles.create({ name: "문체" });
    const input = { action: "intro", topic: "주제", provider: "openai", writingProfileId: profile.id, clientRequestId: randomUUID() };
    vi.mocked(generateText).mockResolvedValue("근거 있는 설명입니다.");
    const first = await runStudioTool(input); expect((await runStudioTool(input)).id).toBe(first.id); expect(generateText).toHaveBeenCalledTimes(1);
    writingProfiles.update(profile.id, { expectedUpdatedAt: profile.updatedAt, data: { ...profile.data, tone: "새 문체" } });
    await expect(runStudioTool(input)).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" }); expect(generateText).toHaveBeenCalledTimes(1);
  });
  it("records provider failure and requires a new request to retry", async () => {
    configureProvider(); const input = { action: "intro", topic: "주제", provider: "openai", clientRequestId: randomUUID() };
    vi.mocked(generateText).mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(runStudioTool(input)).rejects.toThrow("provider unavailable");
    await expect(runStudioTool(input)).rejects.toMatchObject({ code: "STUDIO_GENERATION_FAILED" });
    expect(generateText).toHaveBeenCalledTimes(1);
    vi.mocked(generateText).mockResolvedValueOnce("다시 생성한 결과");
    expect((await runStudioTool({ ...input, clientRequestId: randomUUID() })).id).toBeGreaterThan(0);
  });
});

describe("v3 portable relationships and rollout", () => {
  it("rejects a genuine generated context referencing another project's document atomically", async () => {
    configureProvider(); const ownDoc = knowledgeDocuments.create({ name: "자사", body: "자사 자료" });
    vi.mocked(generateText).mockResolvedValue("출력");
    await runStudioTool({ action: "intro", topic: "주제", provider: "openai", knowledgeDocumentIds: [ownDoc.id] });
    createProject({ name: "다른 프로젝트", brandName: "타사", category: "", competitors: [], activate: true });
    const otherDoc = knowledgeDocuments.create({ name: "타사", body: "타사 자료" });
    const snapshot = buildWorkspaceSnapshot(), context = JSON.parse(snapshot.data.contents[0].input);
    context.generationContext.knowledgeDocuments[0] = otherDoc;
    snapshot.data.contents[0].input = JSON.stringify(context);
    const before = buildWorkspaceSnapshot().data.projects.length;
    expect(() => importWorkspace({ mode: "merge", snapshot })).toThrow("프로젝트");
    expect(buildWorkspaceSnapshot().data.projects).toHaveLength(before);
  });
  it.each(["manual note", { knowledgeDocuments: [null] }, 42])("preserves arbitrary legacy JSON named generationContext: %j", value => {
    const output = { intro: "기존 출력", generationContext: value };
    storeGeneratedContent({ tool: "intro", input: { topic: "기존 입력" }, output });
    const snapshot = buildWorkspaceSnapshot();
    importWorkspace({ mode: "merge", snapshot });
    expect(JSON.parse(buildWorkspaceSnapshot().data.contents.at(-1)!.output)).toEqual(output);
  });
  it("round-trips every new relationship and captured context with remapped IDs", async () => {
    configureProvider(); const opportunity = accepted();
    const doc = knowledgeDocuments.create({ name: "공식 자료", body: "서비스 설명" }), profile = writingProfiles.create({ name: "문체" });
    vi.mocked(generateText).mockResolvedValue("설명");
    const content = await runStudioTool({ action: "intro", topic: "제품", provider: "openai", opportunityId: opportunity.id, writingProfileId: profile.id, knowledgeDocumentIds: [doc.id] });
    const followup = seed("자사브랜드", { at: "2026-10-22T00:00:00Z" });
    updateOpportunity(opportunity.id, { expectedUpdatedAt: opportunity.updatedAt, followupRunId: followup.runId });
    const snapshot = buildWorkspaceSnapshot(); expect(snapshot.schemaVersion).toBe(3);
    importWorkspace({ mode: "merge", snapshot });
    const after = buildWorkspaceSnapshot(), copied = after.data.opportunities.find(item => item.id !== opportunity.id)!;
    expect(copied.projectId).not.toBe(projectId); expect(copied.questionId).not.toBe(opportunity.questionId);
    expect(copied.baselineRunId).not.toBe(opportunity.baselineRunId); expect(copied.followupRunId).not.toBe(followup.runId);
    const link = after.data.opportunityContents.find(item => item.opportunityId === copied.id)!; expect(link.contentId).not.toBe(content.id);
    const copiedContent = after.data.contents.find(item => item.id === link.contentId)!;
    const input = JSON.parse(copiedContent.input);
    expect(input.projectId).toBe(copied.projectId); expect(input.opportunityId).toBe(copied.id);
    expect(input.generationContext.knowledgeDocuments[0].id).not.toBe(doc.id);
    expect(getDatabase().sqlite.pragma("foreign_key_check")).toEqual([]);
    importWorkspace({ mode: "replace", confirmReplace: true, snapshot });
    expect(buildWorkspaceSnapshot().data.opportunities).toEqual(snapshot.data.opportunities);
  });
  it("keeps deleted sources as snapshots and supports legacy v1/v2 input", async () => {
    configureProvider(); const doc = knowledgeDocuments.create({ name: "삭제할 자료", body: "본문" });
    vi.mocked(generateText).mockResolvedValue("설명");
    await runStudioTool({ action: "intro", topic: "제품", provider: "openai", knowledgeDocumentIds: [doc.id] });
    knowledgeDocuments.delete(doc.id, { expectedUpdatedAt: doc.updatedAt });
    const snapshot = buildWorkspaceSnapshot(); importWorkspace({ mode: "merge", snapshot });
    const copied = buildWorkspaceSnapshot().data.contents.at(-1)!;
    expect(JSON.parse(copied.input).generationContext.knowledgeDocuments[0]).toMatchObject({ id: null, data: { body: "본문" } });
    for (const version of [1, 2]) {
      const legacy = JSON.parse(JSON.stringify(snapshot)); legacy.schemaVersion = version;
      for (const key of ["knowledgeDocuments", "writingProfiles", "opportunities", "opportunityDecisions", "opportunityContents"]) { delete legacy.data[key]; delete legacy.stats[key]; }
      expect(workspaceSnapshotSchema.parse(legacy).data.opportunities).toEqual([]);
      expect(() => importWorkspace({ mode: "merge", snapshot: legacy })).not.toThrow();
    }
  });
  it("rejects malformed relationships atomically", () => {
    const opportunity = accepted(), snapshot = buildWorkspaceSnapshot(); snapshot.data.opportunities[0].questionId = 999999;
    expect(() => importWorkspace({ mode: "merge", snapshot })).toThrow("연결 관계");
    expect(listOpportunities().map(item => item.id)).toEqual([opportunity.id]);
  });
  it("gates routes and selectors without disabling legacy studio or losing saved data", async () => {
    const item = knowledgeDocuments.create({ name: "보존할 자료", body: "본문" });
    vi.stubEnv("GEO_ENABLE_HALOX", "0");
    expect(libraryGET(new NextRequest("http://localhost/api/knowledge-documents")).status).toBe(404);
    expect(opportunityGET(new NextRequest("http://localhost/api/opportunities")).status).toBe(404);
    await expect(runStudioTool({ action: "intro", topic: "제품", knowledgeDocumentIds: [item.id] })).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
    expect((await runStudioTool({ action: "entity", company: "회사", target: "고객", value: "가치", category: "도구" })).output).toHaveProperty("definition");
    vi.stubEnv("GEO_ENABLE_HALOX", "1"); expect(knowledgeDocuments.get(item.id).data.body).toBe("본문");
  });
  it("rejects stale page project context before mutation", async () => {
    const request = new NextRequest("http://localhost/api/knowledge-documents", { method: "POST", headers: { "content-type": "application/json", "x-geo-project-id": String(projectId + 100) }, body: JSON.stringify({ name: "자료", body: "본문" }) });
    expect((await libraryPOST(request)).status).toBe(409); expect(knowledgeDocuments.list()).toHaveLength(0);
  });
  it("rechecks project context after asynchronous body parsing", async () => {
    const request = new NextRequest("http://localhost/api/knowledge-documents", { method: "POST", headers: { "content-type": "application/json", "x-geo-project-id": String(projectId) }, body: "{}" });
    vi.spyOn(request, "json").mockImplementation(async () => {
      createProject({ name: "전환한 프로젝트", brandName: "타사", category: "", competitors: [], activate: true });
      return { name: "잘못 저장되면 안 되는 자료", body: "본문" };
    });
    expect((await libraryPOST(request)).status).toBe(409);
    expect(getDatabase().sqlite.prepare("SELECT COUNT(*) AS n FROM knowledge_documents").get()).toEqual({ n: 0 });
  });
  it("deleting a candidate keeps adopted work while deleting its decision records", () => {
    const item = accepted(); deleteOpportunity(item.id, { expectedUpdatedAt: item.updatedAt });
    expect(getDatabase().sqlite.prepare("SELECT COUNT(*) AS n FROM opportunity_decisions").get()).toEqual({ n: 0 });
    expect(getDatabase().sqlite.prepare("SELECT COUNT(*) AS n FROM strategy_items").get()).toEqual({ n: 1 });
  });
});
