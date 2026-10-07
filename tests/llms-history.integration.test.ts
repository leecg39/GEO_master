import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/llms-txt", async () => {
  const actual = await vi.importActual<typeof import("@/lib/llms-txt")>("@/lib/llms-txt");
  return { ...actual, verifyRemoteLlmsTxt: vi.fn() };
});

import { closeDatabase } from "@/lib/db";
import { createLlmsDocument, updateLlmsDocument, verifyStoredLlmsDocument } from "@/lib/llms-documents";
import { diffLines, getLlmsRevisionDiff, listLlmsRevisions, restoreLlmsRevision } from "@/lib/llms-history";
import { validateLlmsTxt, verifyRemoteLlmsTxt } from "@/lib/llms-txt";
import { ensureActiveProject } from "@/lib/projects";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-llms-history-"));
const databasePath = path.join(dir, "geo.db");
const prevDb = process.env.GEO_DB_PATH;
const prevKey = process.env.GEO_MASTER_KEY;
const input = { title: "공식 llms", website: "https://example.com", brandName: "예시", summary: "예시 브랜드의 공식 문서를 안내하는 llms.txt입니다.", resources: [{ title: "소개", url: "https://example.com/about", description: "소개" }] };
let docId = 0;
let updatedAt = "";

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "llms-history-master-key-with-32-characters";
  ensureActiveProject();
});
afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(dir, { recursive: true, force: true });
  if (prevDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = prevDb;
  if (prevKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = prevKey;
});

describe("diffLines", () => {
  it("marks added, removed and unchanged lines", () => {
    expect(diffLines("a\nb\nc", "a\nx\nc")).toEqual([
      { type: "same", text: "a" }, { type: "removed", text: "b" }, { type: "added", text: "x" }, { type: "same", text: "c" },
    ]);
    expect(diffLines("", "a")).toEqual([{ type: "added", text: "a" }]);
  });
});

describe("llms document revisions (Qshop P07)", () => {
  it("records revision 1 on create", () => {
    const doc = createLlmsDocument(input);
    docId = doc.id; updatedAt = doc.updatedAt;
    expect(listLlmsRevisions(docId).map((r) => [r.revision, r.origin])).toEqual([[1, "created"]]);
  });

  it("records a new revision only when the document text actually changes", () => {
    const same = updateLlmsDocument(docId, { title: "제목만 변경", expectedUpdatedAt: updatedAt });
    expect(listLlmsRevisions(docId)).toHaveLength(1);
    const changed = updateLlmsDocument(docId, { document: "# 예시\n\n> 예시 브랜드의 공식 문서를 안내하는 llms.txt입니다.\n\n## 새 섹션\n\n- [새 문서](https://example.com/new): 설명\n", expectedUpdatedAt: same.updatedAt });
    updatedAt = changed.updatedAt;
    expect(listLlmsRevisions(docId).map((r) => [r.revision, r.origin])).toEqual([[2, "edited"], [1, "created"]]);
  });

  it("keeps the previous content when a remote check overwrites the document", async () => {
    vi.mocked(verifyRemoteLlmsTxt).mockResolvedValueOnce({
      document: "# 원격\n\n> 서버에 실제로 올라가 있는 llms.txt 내용입니다.\n", validation: validateLlmsTxt("# 원격\n"), url: "https://example.com/llms.txt", contentType: "text/plain",
    } as Awaited<ReturnType<typeof verifyRemoteLlmsTxt>>);
    const verified = await verifyStoredLlmsDocument(docId, { expectedUpdatedAt: updatedAt });
    updatedAt = verified.updatedAt;
    expect(listLlmsRevisions(docId).map((r) => [r.revision, r.origin])).toEqual([[3, "remote"], [2, "edited"], [1, "created"]]);
  });

  it("diffs two revisions and restores an old one as a new revision", () => {
    const diff = getLlmsRevisionDiff(docId, 2, 3);
    expect(diff.some((line) => line.type === "removed" && line.text.includes("새 섹션"))).toBe(true);
    expect(diff.some((line) => line.type === "added" && line.text.includes("서버에 실제로"))).toBe(true);
    const restored = restoreLlmsRevision(docId, 2, { expectedUpdatedAt: updatedAt });
    expect(restored.document).toContain("새 섹션");
    expect(listLlmsRevisions(docId)[0]).toMatchObject({ revision: 4, origin: "restored" });
    expect(() => getLlmsRevisionDiff(docId, 2, 99)).toThrow();
  });

  it("rejects stale restores", () => {
    expect(() => restoreLlmsRevision(docId, 1, { expectedUpdatedAt: "2000-01-01T00:00:00.000Z" })).toThrow();
  });
});
