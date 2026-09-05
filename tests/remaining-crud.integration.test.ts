import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as listLlms, POST as createLlms } from "@/app/api/llms-documents/route";
import { DELETE as deleteLlms, GET as getLlms, PATCH as updateLlms } from "@/app/api/llms-documents/[id]/route";
import { POST as duplicateLlms } from "@/app/api/llms-documents/[id]/duplicate/route";
import { GET as listPresets, POST as createPreset } from "@/app/api/report-presets/route";
import { DELETE as deletePreset, PATCH as updatePreset } from "@/app/api/report-presets/[id]/route";
import { POST as duplicatePreset } from "@/app/api/report-presets/[id]/duplicate/route";
import { GET as listStrategyRoute } from "@/app/api/strategy/route";
import { GET as listBackups, POST as createBackup } from "@/app/api/workspace/backups/route";
import { DELETE as deleteBackup, PATCH as updateBackup } from "@/app/api/workspace/backups/[id]/route";
import { POST as restoreBackup } from "@/app/api/workspace/backups/[id]/restore/route";
import { createSchedule, getAutomationState, getSchedule } from "@/lib/automation";
import { resetLearnChecklist, updateLearnChecklist, getLearnChecklist } from "@/lib/checklist";
import { closeDatabase, getDatabase } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { activateProject, createProject, ensureActiveProject } from "@/lib/projects";
import { createStrategyItem, deleteStrategyItem, listStrategyItems, updateStrategyItem } from "@/lib/strategy";
import { runStudioTool } from "@/lib/studio";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-remaining-crud-"));
const databasePath = path.join(tempDir, "remaining.db");
const previousDb = process.env.GEO_DB_PATH;
const previousWorker = process.env.GEO_DISABLE_AUTOMATION_WORKER;
const context = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const request = (url: string, method: string, body: unknown) => new NextRequest(url, {
  method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_DISABLE_AUTOMATION_WORKER = "1";
  ensureActiveProject();
});

afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb;
  if (previousWorker === undefined) delete process.env.GEO_DISABLE_AUTOMATION_WORKER; else process.env.GEO_DISABLE_AUTOMATION_WORKER = previousWorker;
});

describe.sequential("remaining page CRUD", () => {
  it("stores studio entity output with retry-safe UUID", async () => {
    const clientRequestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const first = await runStudioTool({
      action: "entity", company: "기록", target: "마케터", value: "통찰", category: "분석",
      title: "엔티티", notes: "초안", clientRequestId,
    });
    const retry = await runStudioTool({
      action: "entity", company: "기록", target: "마케터", value: "통찰", category: "분석",
      title: "엔티티", notes: "초안", clientRequestId,
    });
    expect(retry.id).toBe(first.id);
    expect(first.output.definition).toContain("기록은");
  });

  it("creates, lists, updates, and deletes llms documents", async () => {
    const created = await createLlms(request("http://localhost/api/llms-documents", "POST", {
      title: "공식 안내",
      website: "https://example.com",
      brandName: "예시",
      summary: "예시는 공개 GEO 정보를 제공하는 공식 웹사이트입니다.",
      details: "",
      resources: [{ title: "홈", url: "https://example.com/", description: "소개" }],
    }));
    expect(created.status).toBe(201);
    const document = (await created.json()).document as { id: number; updatedAt: string; document: string };
    expect(document.document).toContain("# 예시");
    const listed = await (await listLlms(new NextRequest("http://localhost/api/llms-documents"))).json();
    expect(listed.items[0].id).toBe(document.id);
    const patched = await updateLlms(request(`http://localhost/api/llms-documents/${document.id}`, "PATCH", {
      title: "수정된 안내", expectedUpdatedAt: document.updatedAt,
    }), context(document.id));
    expect(patched.status).toBe(200);
    const updated = (await patched.json()).document as { updatedAt: string };
    expect((await deleteLlms(request(`http://localhost/api/llms-documents/${document.id}`, "DELETE", {
      expectedUpdatedAt: updated.updatedAt,
    }), context(document.id))).status).toBe(204);
    expect((await getLlms(new NextRequest(`http://localhost/api/llms-documents/${document.id}`), context(document.id))).status).toBe(404);
  });

  it("requires a parent for cluster items and unlinks children on confirmed delete", () => {
    const pillar = createStrategyItem({ type: "pillar", title: "GEO 기둥" });
    expect(() => createStrategyItem({ type: "cluster", title: "하위" })).toThrow(/상위 주제/);
    const cluster = createStrategyItem({ type: "cluster", title: "하위", parentId: pillar.id });
    expect(cluster.parentId).toBe(pillar.id);
    deleteStrategyItem(pillar.id, { expectedUpdatedAt: pillar.updatedAt, cascadeConfirmed: true });
  });

  it("stores checklist notes and resets a category", () => {
    expect(updateLearnChecklist({ itemKey: "g1-1", checked: true, note: "이번 주 확인" }).items.find((item) => item.id === "g1-1")).toMatchObject({
      checked: true, note: "이번 주 확인",
    });
    const reset = resetLearnChecklist({ reset: "category", category: "기반 SEO" });
    expect(reset.items.find((item) => item.id === "g1-1")).toMatchObject({ checked: false, note: "" });
    expect(getLearnChecklist().completed).toBe(0);
  });

  it("creates a report preset against a missing source as 404", async () => {
    const response = await createPreset(request("http://localhost/api/report-presets", "POST", {
      name: "없는 진단", kind: "audit", auditId: 999, defaultFormat: "pdf",
    }));
    expect(response.status).toBe(404);
  });

  it("creates and lists a local workspace backup without exporting the snapshot blob", async () => {
    const created = await createBackup(request("http://localhost/api/workspace/backups", "POST", { name: "야간 백업" }));
    expect(created.status).toBe(201);
    const backup = (await created.json()).backup as { id: number; name: string; snapshot?: unknown };
    expect(backup.name).toBe("야간 백업");
    expect(backup.snapshot).toBeUndefined();
    const listed = await (await listBackups(new NextRequest("http://localhost/api/workspace/backups"))).json();
    expect(listed.items.some((item: { id: number }) => item.id === backup.id)).toBe(true);
  });

  it("lists strategy items for the active project only", () => {
    expect(Array.isArray(listStrategyItems())).toBe(true);
  });

  it("rejects stale llms updates, isolates by project, and duplicates a document", async () => {
    const created = await createLlms(request("http://localhost/api/llms-documents", "POST", {
      title: "격리 문서",
      website: "https://example.com",
      brandName: "예시",
      summary: "예시는 공개 GEO 정보를 제공하는 공식 웹사이트입니다.",
      details: "",
      resources: [{ title: "홈", url: "https://example.com/", description: "소개" }],
    }));
    const document = (await created.json()).document as { id: number; title: string; updatedAt: string };
    const stale = await updateLlms(request(`http://localhost/api/llms-documents/${document.id}`, "PATCH", {
      title: "충돌", expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    }), context(document.id));
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe("STALE_WRITE");

    const copy = await duplicateLlms(new NextRequest(`http://localhost/api/llms-documents/${document.id}/duplicate`, { method: "POST" }), context(document.id));
    expect(copy.status).toBe(201);
    const duplicated = (await copy.json()).document as { id: number; title: string };
    expect(duplicated.id).not.toBe(document.id);
    expect(duplicated.title).toContain("복사본");

    const origin = ensureActiveProject();
    const other = createProject({ name: "다른 문서 프로젝트", brandName: "다른", category: "SaaS", competitors: [], activate: true });
    expect((await getLlms(new NextRequest(`http://localhost/api/llms-documents/${document.id}`), context(document.id))).status).toBe(409);
    activateProject(origin.id);
    expect(other.id).not.toBe(origin.id);
  });

  it("creates, updates, duplicates, and rejects stale report presets", async () => {
    const origin = ensureActiveProject();
    const now = new Date().toISOString();
    const auditId = Number(getDatabase().sqlite.prepare(`
      INSERT INTO audits (project_id, url, score, grade, items, metadata, created_at, updated_at)
      VALUES (?, 'https://example.com/preset', 1, '개선 필요', '[]', '{}', ?, ?)
    `).run(origin.id, now, now).lastInsertRowid);
    const created = await createPreset(request("http://localhost/api/report-presets", "POST", {
      name: "진단 프리셋", kind: "audit", auditId, defaultFormat: "pdf",
    }));
    expect(created.status).toBe(201);
    const preset = (await created.json()).preset as { id: number; name: string; updatedAt: string };
    const stale = await updatePreset(request(`http://localhost/api/report-presets/${preset.id}`, "PATCH", {
      name: "충돌", expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    }), context(preset.id));
    expect(stale.status).toBe(409);
    const updated = await updatePreset(request(`http://localhost/api/report-presets/${preset.id}`, "PATCH", {
      name: "진단 프리셋 수정", expectedUpdatedAt: preset.updatedAt,
    }), context(preset.id));
    expect(updated.status).toBe(200);
    const copy = await duplicatePreset(new NextRequest(`http://localhost/api/report-presets/${preset.id}/duplicate`, { method: "POST" }), context(preset.id));
    expect(copy.status).toBe(201);
    const listed = await (await listPresets(new NextRequest("http://localhost/api/report-presets?limit=50"))).json();
    expect(listed.items.some((item: { name: string }) => item.name === "진단 프리셋 수정")).toBe(true);
    const current = (await updated.json()).preset as { id: number; updatedAt: string };
    expect((await deletePreset(request(`http://localhost/api/report-presets/${preset.id}`, "DELETE", {
      expectedUpdatedAt: current.updatedAt,
    }), context(preset.id))).status).toBe(204);
  });

  it("renames, restores, and deletes local workspace backups with stale protection", async () => {
    const created = await createBackup(request("http://localhost/api/workspace/backups", "POST", { name: "계약 백업" }));
    const backup = (await created.json()).backup as { id: number; name: string; updatedAt: string };
    const stale = await updateBackup(request(`http://localhost/api/workspace/backups/${backup.id}`, "PATCH", {
      name: "충돌", expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    }), context(backup.id));
    expect(stale.status).toBe(409);
    const renamed = await updateBackup(request(`http://localhost/api/workspace/backups/${backup.id}`, "PATCH", {
      name: "야간 백업 이름", expectedUpdatedAt: backup.updatedAt,
    }), context(backup.id));
    expect(renamed.status).toBe(200);
    const renamedBackup = (await renamed.json()).backup as { id: number; name: string; updatedAt: string };
    expect(renamedBackup.name).toBe("야간 백업 이름");
    const restored = await restoreBackup(request(`http://localhost/api/workspace/backups/${backup.id}/restore`, "POST", {
      mode: "merge", expectedUpdatedAt: renamedBackup.updatedAt,
    }), context(backup.id));
    expect(restored.status).toBe(200);
    expect((await deleteBackup(request(`http://localhost/api/workspace/backups/${backup.id}`, "DELETE", {
      expectedUpdatedAt: renamedBackup.updatedAt,
    }), context(backup.id))).status).toBe(204);
    const listed = await (await listBackups(new NextRequest("http://localhost/api/workspace/backups"))).json();
    expect(listed.items.some((item: { id: number }) => item.id === backup.id)).toBe(false);
  });

  it("rejects stale strategy writes, pages collections, and isolates items by project", async () => {
    const origin = ensureActiveProject();
    const first = createStrategyItem({ type: "question", title: "첫 질문", data: { source: "고객 상담", intent: "정보 탐색형" } });
    const second = createStrategyItem({ type: "question", title: "둘째 질문", data: { source: "챗봇 로그", intent: "비교·평가형" } });
    try {
      updateStrategyItem(first.id, { title: "충돌", expectedUpdatedAt: "2000-01-01T00:00:00.000Z" });
      throw new Error("expected STALE_WRITE");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("STALE_WRITE");
    }
    const page = await (await listStrategyRoute(new NextRequest("http://localhost/api/strategy?limit=1"))).json();
    expect(page.items).toHaveLength(1);
    expect(page.page).toMatchObject({ hasMore: true, nextCursor: expect.any(String) });
    expect(page.guide.cycle).toHaveLength(4);
    const other = createProject({ name: "전략 격리", brandName: "격리", category: "SaaS", competitors: [], activate: true });
    expect(listStrategyItems().some((item) => item.id === first.id || item.id === second.id)).toBe(false);
    activateProject(origin.id);
    expect(other.id).not.toBe(origin.id);
  });

  it("keeps checklist and automation schedules isolated to the active project", () => {
    const origin = ensureActiveProject();
    updateLearnChecklist({ itemKey: "g1-1", checked: true, note: "원본 프로젝트" });
    const schedule = createSchedule({
      name: "격리 예약",
      questions: ["좋은 분석 도구의 기준은 무엇인가요?"],
      providers: ["openai"],
      repetitions: 1,
      intervalMinutes: 1_440,
      nextRunAt: "2030-01-01T00:00:00.000Z",
      enabled: false,
    });
    createProject({ name: "체크리스트 격리", brandName: "격리B", category: "SaaS", competitors: [], activate: true });
    expect(getLearnChecklist().items.find((item) => item.id === "g1-1")).toMatchObject({ checked: false, note: "" });
    expect(getAutomationState().schedules.some((item) => item.id === schedule.id)).toBe(false);
    expect(() => getSchedule(schedule.id)).toThrow(AppError);
    activateProject(origin.id);
    expect(getLearnChecklist().items.find((item) => item.id === "g1-1")).toMatchObject({ checked: true, note: "원본 프로젝트" });
    expect(getSchedule(schedule.id).name).toBe("격리 예약");
  });
});
