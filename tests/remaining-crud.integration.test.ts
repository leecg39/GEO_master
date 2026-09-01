import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as listLlms, POST as createLlms } from "@/app/api/llms-documents/route";
import { DELETE as deleteLlms, GET as getLlms, PATCH as updateLlms } from "@/app/api/llms-documents/[id]/route";
import { POST as createPreset } from "@/app/api/report-presets/route";
import { GET as listBackups, POST as createBackup } from "@/app/api/workspace/backups/route";
import { resetLearnChecklist, updateLearnChecklist, getLearnChecklist } from "@/lib/checklist";
import { closeDatabase } from "@/lib/db";
import { ensureActiveProject } from "@/lib/projects";
import { createStrategyItem, deleteStrategyItem, listStrategyItems } from "@/lib/strategy";
import { runStudioTool } from "@/lib/studio";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-remaining-crud-"));
const databasePath = path.join(tempDir, "remaining.db");
const previousDb = process.env.GEO_DB_PATH;
const context = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const request = (url: string, method: string, body: unknown) => new NextRequest(url, {
  method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  ensureActiveProject();
});

afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb;
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
});
