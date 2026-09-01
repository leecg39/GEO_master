import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as listContentsRoute } from "@/app/api/contents/route";
import { DELETE as deleteContentRoute, GET as getContentRoute, PATCH as updateContentRoute } from "@/app/api/contents/[id]/route";
import { GET as listRevisionsRoute, POST as createRevisionRoute } from "@/app/api/contents/[id]/revisions/route";
import {
  contentRequestHash,
  findContentByRequest,
  storeGeneratedContent,
  type ContentResource,
} from "@/lib/contents";
import { closeDatabase, getDatabase } from "@/lib/db";
import { activateProject, createProject, ensureActiveProject } from "@/lib/projects";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-contents-"));
const databasePath = path.join(tempDir, "contents.db");
const previousDb = process.env.GEO_DB_PATH;

let projectId: number;
let otherProjectId: number;
let firstContent: ContentResource;
let secondContent: ContentResource;
const requestId = "20000000-0000-4000-8000-000000000001";
const requestHash = contentRequestHash({ action: "rewrite", text: "원문" });
const context = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const request = (url: string, method: string, body: unknown) => new NextRequest(url, {
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function detail(id: number) {
  const response = await getContentRoute(new NextRequest(`http://localhost/api/contents/${id}`), context(id));
  return (await response.json()).content as ContentResource;
}

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  const active = ensureActiveProject();
  projectId = active.id;
  otherProjectId = createProject({
    name: "다른 콘텐츠 프로젝트", brandName: "다른 브랜드", category: "콘텐츠", competitors: [], activate: false,
  }).id;
});

afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb;
});

describe.sequential("project-scoped contents and immutable revisions", () => {
  it("atomically stores generated evidence with revision 1 and safe idempotent reuse", () => {
    expect(() => storeGeneratedContent({
      tool: "rewrite", input: { text: "원문" }, output: { after: "결과" }, unknown: true,
    })).toThrow();

    firstContent = storeGeneratedContent({
      tool: "rewrite",
      title: "GEO 리라이팅",
      notes: "초안",
      provider: "openai",
      clientRequestId: requestId,
      requestHash,
      input: { action: "rewrite", text: "원문" },
      output: { after: "결론을 먼저 제시한 결과" },
      metadata: { campaign: "9월" },
    });
    expect(firstContent).toMatchObject({
      projectId, tool: "rewrite", title: "GEO 리라이팅", revisionCount: 1, currentRevision: 1,
      input: { action: "rewrite", text: "원문" }, output: { after: "결론을 먼저 제시한 결과" },
      metadata: { campaign: "9월" },
    });
    expect(firstContent.metadata).not.toHaveProperty("_requestHash");

    const retry = storeGeneratedContent({
      tool: "rewrite",
      title: "GEO 리라이팅",
      notes: "초안",
      provider: "openai",
      clientRequestId: requestId,
      requestHash,
      input: { action: "rewrite", text: "원문" },
      output: { after: "재호출이라면 달라질 수 있는 출력" },
      metadata: { campaign: "9월" },
    });
    expect(retry.id).toBe(firstContent.id);
    expect(retry.output).toEqual(firstContent.output);
    expect(findContentByRequest(requestId, requestHash)?.id).toBe(firstContent.id);
    expect(() => findContentByRequest(requestId, "f".repeat(64))).toThrowError(/다른 콘텐츠 입력/);
    expect((getDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM content_revisions WHERE content_id = ?").get(firstContent.id) as { count: number }).count).toBe(1);
  });

  it("supports stable cursor, search, filters, detail, and reload persistence", async () => {
    secondContent = storeGeneratedContent({
      tool: "faq",
      title: "구매 FAQ",
      status: "draft",
      pinned: true,
      input: { topic: "구매" },
      output: { faqs: [{ question: "어떻게 구매하나요?", answer: "문의해 주세요." }] },
    });

    const firstPage = await listContentsRoute(new NextRequest("http://localhost/api/contents?limit=1")).json();
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.page).toMatchObject({ hasMore: true, nextCursor: expect.any(String) });
    const nextPage = await listContentsRoute(new NextRequest(`http://localhost/api/contents?limit=1&cursor=${encodeURIComponent(firstPage.page.nextCursor)}`)).json();
    expect(nextPage.items[0].id).not.toBe(firstPage.items[0].id);
    expect(firstPage.items[0]).not.toHaveProperty("input");
    expect(firstPage.items[0]).not.toHaveProperty("output");

    const filtered = await listContentsRoute(new NextRequest("http://localhost/api/contents?tool=faq&status=draft&pinned=true&q=%EA%B5%AC%EB%A7%A4")).json();
    expect(filtered.items.map((item: ContentResource) => item.id)).toEqual([secondContent.id]);
    const invalid = await listContentsRoute(new NextRequest("http://localhost/api/contents?status=unknown"));
    expect(invalid.status).toBe(422);

    closeDatabase(databasePath);
    const reloaded = await detail(secondContent.id);
    expect(reloaded).toMatchObject({ id: secondContent.id, projectId, title: "구매 FAQ", revisionCount: 1 });
  });

  it("updates only public metadata with stale protection and preserves evidence and private hash", async () => {
    const immutable = await updateContentRoute(request(`http://localhost/api/contents/${firstContent.id}`, "PATCH", {
      output: { after: "덮어쓰기" }, expectedUpdatedAt: firstContent.updatedAt,
    }), context(firstContent.id));
    expect(immutable.status).toBe(422);
    const stale = await updateContentRoute(request(`http://localhost/api/contents/${firstContent.id}`, "PATCH", {
      title: "오래된 수정", expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    }), context(firstContent.id));
    expect(stale.status).toBe(409);

    const evidenceBefore = getDatabase().sqlite.prepare("SELECT input, output FROM contents WHERE id = ?").get(firstContent.id);
    const response = await updateContentRoute(request(`http://localhost/api/contents/${firstContent.id}`, "PATCH", {
      title: "GEO 리라이팅 · 승인 대기",
      notes: "법무 검토 필요",
      status: "review",
      pinned: true,
      metadata: { owner: "콘텐츠팀" },
      expectedUpdatedAt: firstContent.updatedAt,
    }), context(firstContent.id));
    expect(response.status).toBe(200);
    firstContent = (await response.json()).content;
    expect(firstContent).toMatchObject({
      title: "GEO 리라이팅 · 승인 대기", notes: "법무 검토 필요", status: "review", pinned: true,
      metadata: { owner: "콘텐츠팀" }, revisionCount: 1,
    });
    expect(getDatabase().sqlite.prepare("SELECT input, output FROM contents WHERE id = ?").get(firstContent.id)).toEqual(evidenceBefore);
    const storedMetadata = JSON.parse((getDatabase().sqlite.prepare("SELECT metadata FROM contents WHERE id = ?").get(firstContent.id) as { metadata: string }).metadata);
    expect(storedMetadata._requestHash).toBe(requestHash);
  });

  it("creates immutable sequential revisions and rejects stale or unknown mutation fields", async () => {
    const stale = await createRevisionRoute(request(`http://localhost/api/contents/${firstContent.id}/revisions`, "POST", {
      output: { after: "오래된 편집" }, expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    }), context(firstContent.id));
    expect(stale.status).toBe(409);
    const invalid = await createRevisionRoute(request(`http://localhost/api/contents/${firstContent.id}/revisions`, "POST", {
      output: { after: "편집" }, title: "허용되지 않음", expectedUpdatedAt: firstContent.updatedAt,
    }), context(firstContent.id));
    expect(invalid.status).toBe(422);

    const created = await createRevisionRoute(request(`http://localhost/api/contents/${firstContent.id}/revisions`, "POST", {
      output: { after: "사실 검토를 반영한 편집본" }, origin: "edited", expectedUpdatedAt: firstContent.updatedAt,
    }), context(firstContent.id));
    expect(created.status).toBe(201);
    const payload = await created.json();
    firstContent = payload.content;
    expect(payload.revision).toMatchObject({ contentId: firstContent.id, revision: 2, origin: "edited" });
    expect(firstContent).toMatchObject({ currentRevision: 2, revisionCount: 2, output: { after: "사실 검토를 반영한 편집본" } });

    const firstPage = await listRevisionsRoute(new NextRequest(`http://localhost/api/contents/${firstContent.id}/revisions?limit=1`), context(firstContent.id)).then((value) => value.json());
    expect(firstPage.items[0]).toMatchObject({ revision: 2, output: { after: "사실 검토를 반영한 편집본" } });
    expect(firstPage.page.hasMore).toBe(true);
    const nextPage = await listRevisionsRoute(new NextRequest(`http://localhost/api/contents/${firstContent.id}/revisions?limit=1&cursor=${encodeURIComponent(firstPage.page.nextCursor)}`), context(firstContent.id)).then((value) => value.json());
    expect(nextPage.items[0]).toMatchObject({ revision: 1, output: { after: "결론을 먼저 제시한 결과" } });
  });

  it("isolates collection, detail, revision list, and idempotency keys by active project", async () => {
    activateProject(otherProjectId);
    const list = await listContentsRoute(new NextRequest("http://localhost/api/contents")).json();
    expect(list.items).toEqual([]);
    expect((await getContentRoute(new NextRequest(`http://localhost/api/contents/${firstContent.id}`), context(firstContent.id))).status).toBe(409);
    expect((await listRevisionsRoute(new NextRequest(`http://localhost/api/contents/${firstContent.id}/revisions`), context(firstContent.id))).status).toBe(409);
    expect(() => findContentByRequest(requestId, requestHash)).toThrowError(/다른 콘텐츠 입력/);
    activateProject(projectId);
  });

  it("requires revision cascade confirmation, deletes atomically, and returns 404", async () => {
    const guarded = await deleteContentRoute(request(`http://localhost/api/contents/${firstContent.id}`, "DELETE", {
      expectedUpdatedAt: firstContent.updatedAt, cascadeConfirmed: false,
    }), context(firstContent.id));
    expect(guarded.status).toBe(409);
    expect(await guarded.json()).toMatchObject({
      code: "CONTENT_HAS_REVISIONS", details: { dependencies: { contentRevisions: 2 }, total: 2 },
    });

    const deleted = await deleteContentRoute(request(`http://localhost/api/contents/${firstContent.id}`, "DELETE", {
      expectedUpdatedAt: firstContent.updatedAt, cascadeConfirmed: true,
    }), context(firstContent.id));
    expect(deleted.status).toBe(204);
    expect((getDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM content_revisions WHERE content_id = ?").get(firstContent.id) as { count: number }).count).toBe(0);
    expect(getDatabase().sqlite.pragma("foreign_key_check")).toEqual([]);
    const missing = await getContentRoute(new NextRequest(`http://localhost/api/contents/${firstContent.id}`), context(firstContent.id));
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe("CONTENT_NOT_FOUND");
  });
});
