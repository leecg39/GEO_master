import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const auditHtml = `<!doctype html><html><head><title>통합 진단 문서</title><meta name="description" content="통합 진단 테스트 문서입니다."></head><body><main><h1>진단</h1><p>통합 테스트를 위한 충분한 길이의 첫 문단으로 안전한 진단 저장 동작을 확인합니다.</p></main></body></html>`;

vi.mock("@/lib/url-security", () => ({
  fetchPublicText: vi.fn(async (url: string) => url.endsWith("robots.txt") || url.endsWith("llms.txt") || url.endsWith("sitemap.xml")
    ? { url, status: 404, text: "", contentType: "text/plain" }
    : { url, status: 200, text: auditHtml, contentType: "text/html; charset=utf-8" }),
}));

import { GET as listAudits, POST as createAudit } from "@/app/api/audits/route";
import { DELETE as deleteAudit, GET as getAudit, PATCH as updateAudit } from "@/app/api/audits/[id]/route";
import { closeDatabase, getDatabase } from "@/lib/db";
import { activateProject, createProject, ensureActiveProject } from "@/lib/projects";
import { fetchPublicText } from "@/lib/url-security";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-audits-crud-"));
const databasePath = path.join(tempDir, "audits.db");
const previousDb = process.env.GEO_DB_PATH;
const previousKey = process.env.GEO_MASTER_KEY;

type Audit = {
  id: number; projectId: number; title: string; notes: string; clientRequestId: string | null;
  url: string; score: number; total: number; grade: string; items: unknown[]; metadata: Record<string, unknown>;
  createdAt: string; updatedAt: string;
};

let projectId: number;
let otherProjectId: number;
let firstAudit: Audit;
let secondAudit: Audit;
const firstRequestId = "00000000-0000-4000-8000-000000000001";
const context = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const request = (url: string, method: string, body: unknown) => new NextRequest(url, {
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "audit-crud-integration-master-key-32-chars";
  projectId = ensureActiveProject().id;
  otherProjectId = createProject({
    name: "다른 진단 프로젝트", brandName: "다른 브랜드", category: "테스트", competitors: [], activate: false,
  }).id;
});

afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb;
  if (previousKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = previousKey;
});

describe.sequential("audit evidence CRUD API", () => {
  it("strictly validates create and rejects unknown manual overrides before fetching", async () => {
    const extra = await createAudit(request("http://localhost/api/audits", "POST", {
      url: "https://example.com/extra", extra: true,
    }));
    expect(extra.status).toBe(422);
    const unknown = await createAudit(request("http://localhost/api/audits", "POST", {
      url: "https://example.com/unknown", manualOverrides: { "not-a-rule": true },
    }));
    expect(unknown.status).toBe(422);
    expect((await unknown.json()).code).toBe("UNKNOWN_AUDIT_OVERRIDE");
    expect(vi.mocked(fetchPublicText)).not.toHaveBeenCalled();
  });

  it("creates 32 immutable evidence items and returns an identical retry without another fetch", async () => {
    const payload = {
      url: "https://example.com/guide",
      title: "9월 공식 사이트 진단",
      notes: "배포 전 기준선",
      manualOverrides: { "geo-search-intent": true },
      clientRequestId: firstRequestId,
    };
    const response = await createAudit(request("http://localhost/api/audits", "POST", payload));
    expect(response.status).toBe(201);
    firstAudit = (await response.json()).audit;
    expect(firstAudit).toMatchObject({ projectId, title: payload.title, notes: payload.notes, total: 32, clientRequestId: firstRequestId });
    expect(firstAudit.items).toHaveLength(32);
    expect(firstAudit.metadata).not.toHaveProperty("_requestHash");
    // Qshop P03: 진단이 읽은 실제 페이지 근거
    const evidence = firstAudit.metadata.pageEvidence as { contentHash: string; fetchedAt: string };
    expect(evidence).toMatchObject({ httpStatus: 200, renderMode: "native", parserVersion: expect.any(String) });
    // 수정안 작업대 연결: 진단이 읽은 현재 필드 값이 기록된다 (없는 필드는 null)
    expect(firstAudit.metadata.pageFields).toHaveProperty("title");
    expect(Object.keys(firstAudit.metadata.pageFields as object).sort()).toEqual(["canonical", "description", "og_image", "robots_meta", "title"]);
    // 정본은 page_snapshots: 단일 URL 진단도 같은 스냅샷에 기록하고 pageEvidence는 그것을 가리킨다
    const snapshotId = (firstAudit.metadata.pageEvidence as { snapshotId: number }).snapshotId;
    const snapshot = getDatabase().sqlite.prepare("SELECT url, content_hash, status_code, render_mode FROM page_snapshots WHERE id = ?").get(snapshotId) as { url: string; content_hash: string; status_code: number; render_mode: string } | undefined;
    expect(snapshot).toMatchObject({ content_hash: evidence.contentHash, status_code: 200, render_mode: "native" });
    expect(evidence.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Date.parse(evidence.fetchedAt)).not.toBeNaN();
    const fetchCalls = vi.mocked(fetchPublicText).mock.calls.length;
    expect(fetchCalls).toBe(4);
    expect((getDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM audit_items WHERE audit_id = ?").get(firstAudit.id) as { count: number }).count).toBe(32);

    const retry = await createAudit(request("http://localhost/api/audits", "POST", payload));
    expect(retry.status).toBe(201);
    expect((await retry.json()).audit.id).toBe(firstAudit.id);
    expect(vi.mocked(fetchPublicText)).toHaveBeenCalledTimes(fetchCalls);

    const mismatch = await createAudit(request("http://localhost/api/audits", "POST", { ...payload, notes: "다른 요청" }));
    expect(mismatch.status).toBe(409);
    expect((await mismatch.json()).code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(vi.mocked(fetchPublicText)).toHaveBeenCalledTimes(fetchCalls);
    // 같은 URL·같은 내용을 새 요청으로 다시 진단해도 스냅샷은 중복되지 않고 마지막 확인 시각만 갱신된다
    const before = (getDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM page_snapshots").get() as { count: number }).count;
    const again = await createAudit(request("http://localhost/api/audits", "POST", { ...payload, clientRequestId: undefined, notes: "재진단" }));
    expect(again.status).toBe(201);
    expect((getDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM page_snapshots").get() as { count: number }).count).toBe(before);
  });

  it("supports cursor list, escaped search, and item detail", async () => {
    const response = await createAudit(request("http://localhost/api/audits", "POST", {
      url: "https://example.com/pricing", title: "가격 페이지 진단", notes: "검색 대상",
      clientRequestId: "00000000-0000-4000-8000-000000000002",
    }));
    secondAudit = (await response.json()).audit;

    const firstPage = await listAudits(new NextRequest("http://localhost/api/audits?limit=1")).json();
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.audits).toEqual(firstPage.items);
    expect(firstPage.page).toMatchObject({ hasMore: true, nextCursor: expect.any(String) });
    const nextPage = await listAudits(new NextRequest(`http://localhost/api/audits?limit=1&cursor=${encodeURIComponent(firstPage.page.nextCursor)}`)).json();
    expect(nextPage.items[0].id).not.toBe(firstPage.items[0].id);

    const searched = await listAudits(new NextRequest(`http://localhost/api/audits?q=${encodeURIComponent("가격")}`)).json();
    expect(searched.items.map((audit: Audit) => audit.id)).toEqual([secondAudit.id]);
    const detail = await getAudit(new NextRequest(`http://localhost/api/audits/${firstAudit.id}`), context(firstAudit.id));
    expect((await detail.json()).audit).toMatchObject({ id: firstAudit.id, title: firstAudit.title, total: 32 });
    const invalidQuery = listAudits(new NextRequest("http://localhost/api/audits?sort=score"));
    expect(invalidQuery.status).toBe(422);
  });

  it("allows only title/notes updates with stale-write protection and keeps evidence unchanged", async () => {
    const immutable = await updateAudit(request(`http://localhost/api/audits/${firstAudit.id}`, "PATCH", {
      score: 32, expectedUpdatedAt: firstAudit.updatedAt,
    }), context(firstAudit.id));
    expect(immutable.status).toBe(422);

    const stale = await updateAudit(request(`http://localhost/api/audits/${firstAudit.id}`, "PATCH", {
      title: "오래된 수정", expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    }), context(firstAudit.id));
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe("STALE_WRITE");

    const originalItems = JSON.stringify(firstAudit.items);
    const response = await updateAudit(request(`http://localhost/api/audits/${firstAudit.id}`, "PATCH", {
      title: "공식 사이트 진단 · 검토 완료", notes: "콘텐츠 팀 전달", expectedUpdatedAt: firstAudit.updatedAt,
    }), context(firstAudit.id));
    expect(response.status).toBe(200);
    firstAudit = (await response.json()).audit;
    expect(firstAudit).toMatchObject({ title: "공식 사이트 진단 · 검토 완료", notes: "콘텐츠 팀 전달" });
    expect(JSON.stringify(firstAudit.items)).toBe(originalItems);
    expect(firstAudit.url).toBe("https://example.com/guide");
  });

  it("isolates history by active project", async () => {
    activateProject(otherProjectId);
    const list = await listAudits(new NextRequest("http://localhost/api/audits")).json();
    expect(list.items).toEqual([]);
    const foreign = await getAudit(new NextRequest(`http://localhost/api/audits/${firstAudit.id}`), context(firstAudit.id));
    expect(foreign.status).toBe(409);
    expect((await foreign.json()).code).toBe("PROJECT_SCOPE_MISMATCH");

    const own = await createAudit(request("http://localhost/api/audits", "POST", {
      url: "https://other.example.com", clientRequestId: "00000000-0000-4000-8000-000000000003",
    }));
    expect((await own.json()).audit.projectId).toBe(otherProjectId);
    activateProject(projectId);
  });

  it("requires dependency confirmation, cascades items, and detaches report presets", async () => {
    const sqlite = getDatabase().sqlite;
    const now = new Date().toISOString();
    sqlite.prepare(`
      INSERT INTO report_presets (project_id, name, kind, audit_id, config, default_format, created_at, updated_at)
      VALUES (?, '진단 리포트', 'audit', ?, '{}', 'pdf', ?, ?)
    `).run(projectId, firstAudit.id, now, now);

    const guarded = await deleteAudit(request(`http://localhost/api/audits/${firstAudit.id}`, "DELETE", {
      expectedUpdatedAt: firstAudit.updatedAt, cascadeConfirmed: false,
    }), context(firstAudit.id));
    expect(guarded.status).toBe(409);
    expect(await guarded.json()).toMatchObject({
      code: "AUDIT_HAS_DEPENDENCIES", details: { dependencies: { reportPresets: 1 }, total: 1 },
    });

    const deleted = await deleteAudit(request(`http://localhost/api/audits/${firstAudit.id}`, "DELETE", {
      expectedUpdatedAt: firstAudit.updatedAt, cascadeConfirmed: true,
    }), context(firstAudit.id));
    expect(deleted.status).toBe(204);
    expect(sqlite.prepare("SELECT id FROM audits WHERE id = ?").get(firstAudit.id)).toBeUndefined();
    expect((sqlite.prepare("SELECT COUNT(*) AS count FROM audit_items WHERE audit_id = ?").get(firstAudit.id) as { count: number }).count).toBe(0);
    expect((sqlite.prepare("SELECT audit_id FROM report_presets WHERE name = '진단 리포트'").get() as { audit_id: number | null }).audit_id).toBeNull();
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);

    const missing = await getAudit(new NextRequest(`http://localhost/api/audits/${firstAudit.id}`), context(firstAudit.id));
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe("AUDIT_NOT_FOUND");
  });
});
