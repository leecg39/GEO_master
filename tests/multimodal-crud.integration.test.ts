import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/url-security", () => ({ fetchPublicText: vi.fn() }));

import { POST as createMultimodal } from "@/app/api/multimodal/route";
import { GET as listContents } from "@/app/api/contents/route";
import { DELETE as deleteContent, GET as getContent, PATCH as updateContent } from "@/app/api/contents/[id]/route";
import { GET as listRevisions } from "@/app/api/contents/[id]/revisions/route";
import { closeDatabase, getDatabase } from "@/lib/db";
import { activateProject, createProject, ensureActiveProject } from "@/lib/projects";
import { fetchPublicText } from "@/lib/url-security";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-multimodal-crud-"));
const databasePath = path.join(tempDir, "multimodal.db");
const previousDb = process.env.GEO_DB_PATH;
const requestId = "30000000-0000-4000-8000-000000000001";
const context = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const request = (url: string, method: string, body: unknown) => new NextRequest(url, {
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

interface ContentResource {
  id: number;
  projectId: number;
  tool: string;
  title: string;
  notes: string;
  status: string;
  pinned: boolean;
  metadata: Record<string, unknown>;
  output: { summary: { requested: number; succeeded: number; failed: number; images: number; videos: number; issues: number } };
  revisionCount: number;
  updatedAt: string;
}

let projectId: number;
let otherProjectId: number;
let content: ContentResource;

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  projectId = ensureActiveProject().id;
  otherProjectId = createProject({
    name: "다른 멀티모달 프로젝트", brandName: "다른 브랜드", category: "감사", competitors: [], activate: false,
  }).id;
});

beforeEach(() => {
  vi.mocked(fetchPublicText).mockReset().mockResolvedValue({
    url: "https://example.com/final",
    status: 200,
    contentType: "text/html; charset=utf-8",
    text: "<html><body><img src='/chart-q3.png' alt='3분기 전환율은 27%로 상승'><video title='제품 소개'><track kind='captions' src='/ko.vtt' srclang='ko'><track kind='chapters' src='/chapters.vtt'></video><div class='transcript'>대본 보기</div></body></html>",
  });
});

afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb;
});

describe.sequential("multimodal audit full CRUD", () => {
  it("strictly creates revision-backed evidence and identical UUID retry does not refetch", async () => {
    const invalid = await createMultimodal(request("http://localhost/api/multimodal", "POST", {
      urls: ["https://example.com/article"], unknown: true,
    }));
    expect(invalid.status).toBe(422);
    expect(fetchPublicText).not.toHaveBeenCalled();

    const payload = {
      urls: ["https://example.com/article"],
      title: "핵심 랜딩 페이지 감사",
      notes: "9월 접근성 점검",
      clientRequestId: requestId,
    };
    const created = await createMultimodal(request("http://localhost/api/multimodal", "POST", payload));
    expect(created.status).toBe(201);
    const audit = (await created.json()).audit;
    expect(audit).toMatchObject({ contentId: expect.any(Number), summary: { requested: 1, succeeded: 1, failed: 0, images: 1, videos: 1 } });
    expect(fetchPublicText).toHaveBeenCalledTimes(1);

    const detail = await getContent(new NextRequest(`http://localhost/api/contents/${audit.contentId}`), context(audit.contentId));
    content = (await detail.json()).content;
    expect(content).toMatchObject({
      projectId, tool: "multimodal-audit", title: payload.title, notes: payload.notes,
      revisionCount: 1, output: { summary: audit.summary },
    });
    const metadata = JSON.parse((getDatabase().sqlite.prepare("SELECT metadata FROM contents WHERE id = ?").get(content.id) as { metadata: string }).metadata);
    expect(metadata._requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(content.metadata).not.toHaveProperty("_requestHash");

    const retry = await createMultimodal(request("http://localhost/api/multimodal", "POST", payload));
    expect(retry.status).toBe(201);
    expect((await retry.json()).audit.contentId).toBe(content.id);
    expect(fetchPublicText).toHaveBeenCalledTimes(1);

    const mismatch = await createMultimodal(request("http://localhost/api/multimodal", "POST", { ...payload, notes: "다른 메모" }));
    expect(mismatch.status).toBe(409);
    expect((await mismatch.json()).code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(fetchPublicText).toHaveBeenCalledTimes(1);
  });

  it("persists partial failures and identical retry does not repeat failed network calls", async () => {
    vi.mocked(fetchPublicText).mockRejectedValueOnce(new Error("network failed"));
    const payload = {
      urls: ["https://example.org/unavailable"],
      title: "부분 실패 감사",
      clientRequestId: "30000000-0000-4000-8000-000000000099",
    };
    const created = await createMultimodal(request("http://localhost/api/multimodal", "POST", payload));
    expect(created.status).toBe(201);
    expect((await created.clone().json()).audit.summary).toMatchObject({ requested: 1, succeeded: 0, failed: 1 });
    expect(fetchPublicText).toHaveBeenCalledTimes(1);
    const retry = await createMultimodal(request("http://localhost/api/multimodal", "POST", payload));
    expect((await retry.json()).audit.contentId).toBe((await created.json()).audit.contentId);
    expect(fetchPublicText).toHaveBeenCalledTimes(1);
  });

  it("lists and searches only multimodal content with immutable detail and revision evidence", async () => {
    const list = await listContents(new NextRequest("http://localhost/api/contents?tool=multimodal-audit&q=%EB%9E%9C%EB%94%A9&limit=1"));
    expect(list.status).toBe(200);
    const page = await list.json();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: content.id, tool: "multimodal-audit", title: "핵심 랜딩 페이지 감사" });
    expect(page.items[0]).not.toHaveProperty("output");

    const revisions = await listRevisions(new NextRequest(`http://localhost/api/contents/${content.id}/revisions`), context(content.id));
    expect(revisions.status).toBe(200);
    expect((await revisions.json()).items[0]).toMatchObject({ contentId: content.id, revision: 1, origin: "generated" });
  });

  it("updates only metadata with stale protection and preserves audit evidence", async () => {
    const immutable = await updateContent(request(`http://localhost/api/contents/${content.id}`, "PATCH", {
      output: { summary: {} }, expectedUpdatedAt: content.updatedAt,
    }), context(content.id));
    expect(immutable.status).toBe(422);
    const stale = await updateContent(request(`http://localhost/api/contents/${content.id}`, "PATCH", {
      title: "오래된 수정", expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    }), context(content.id));
    expect(stale.status).toBe(409);

    const outputBefore = (getDatabase().sqlite.prepare("SELECT output FROM contents WHERE id = ?").get(content.id) as { output: string }).output;
    const updated = await updateContent(request(`http://localhost/api/contents/${content.id}`, "PATCH", {
      title: "핵심 랜딩 페이지 감사 · 검토",
      notes: "디자인팀 공유",
      status: "review",
      pinned: true,
      expectedUpdatedAt: content.updatedAt,
    }), context(content.id));
    expect(updated.status).toBe(200);
    content = (await updated.json()).content;
    expect(content).toMatchObject({ title: "핵심 랜딩 페이지 감사 · 검토", notes: "디자인팀 공유", status: "review", pinned: true });
    expect((getDatabase().sqlite.prepare("SELECT output FROM contents WHERE id = ?").get(content.id) as { output: string }).output).toBe(outputBefore);
  });

  it("isolates projects, then confirms revision cascade delete and 404", async () => {
    activateProject(otherProjectId);
    expect((await listContents(new NextRequest("http://localhost/api/contents?tool=multimodal-audit")).json()).items).toEqual([]);
    expect((await getContent(new NextRequest(`http://localhost/api/contents/${content.id}`), context(content.id))).status).toBe(409);
    activateProject(projectId);

    const guarded = await deleteContent(request(`http://localhost/api/contents/${content.id}`, "DELETE", {
      expectedUpdatedAt: content.updatedAt, cascadeConfirmed: false,
    }), context(content.id));
    expect(guarded.status).toBe(409);
    const deleted = await deleteContent(request(`http://localhost/api/contents/${content.id}`, "DELETE", {
      expectedUpdatedAt: content.updatedAt, cascadeConfirmed: true,
    }), context(content.id));
    expect(deleted.status).toBe(204);
    expect((getDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM content_revisions WHERE content_id = ?").get(content.id) as { count: number }).count).toBe(0);
    const missing = await getContent(new NextRequest(`http://localhost/api/contents/${content.id}`), context(content.id));
    expect(missing.status).toBe(404);
  });
});
