import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/url-security", async () => ({ ...await vi.importActual<typeof import("@/lib/url-security")>("@/lib/url-security"), fetchPublicText: vi.fn() }));
import { closeDatabase } from "@/lib/db";
import { createLlmsDocument, getLlmsDocument, updateLlmsDocument, validateStoredLlmsDocument, verifyStoredLlmsDocument } from "@/lib/llms-documents";
import { listLlmsRevisions, restoreLlmsRevision } from "@/lib/llms-history";
import { verifyRemoteLlmsTxt } from "@/lib/llms-txt";
import { ensureActiveProject } from "@/lib/projects";
import { fetchPublicText } from "@/lib/url-security";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-llms-rsi-"));
const db = path.join(dir, "test.db");
const previous = process.env.GEO_DB_PATH;
const local = "# Local\n\n> 공식 사이트의 사용 안내와 문서 목록을 제공합니다.\n\n## Docs\n\n- [Guide](https://example.com/outside): 공개 안내\n";
const remote = "# Remote\n\n> 공개 서버에 게시된 안내와 문서 목록을 제공합니다.\n";
const base = { title: "공식 문서", website: "https://example.com", brandName: "Example", summary: "공식 사이트의 사용 안내와 문서 목록을 제공합니다.", resources: [{ title: "Guide", url: "https://example.com/outside" }], document: local };
beforeAll(() => { process.env.GEO_DB_PATH = db; ensureActiveProject(); });
afterAll(() => { closeDatabase(db); fs.rmSync(dir, { recursive: true, force: true }); if (previous === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previous; });
beforeEach(() => { vi.mocked(fetchPublicText).mockReset(); vi.mocked(fetchPublicText).mockImplementation(async url => ({ url, status: 200, text: remote, contentType: "text/plain" })); });
async function deployed(scopePath = "/llms.txt") { const doc = createLlmsDocument({ ...base, scopePath }); return verifyStoredLlmsDocument(doc.id, { expectedUpdatedAt: doc.updatedAt }); }

describe("storage", () => {
  it.each([{ document: "# Changed\n" }, { website: "https://other.example" }, { scopePath: "/docs/llms.txt" }])("invalidates deployment evidence when its subject changes: %j", async patch => {
    const doc = await deployed();
    const next = updateLlmsDocument(doc.id, { ...patch, expectedUpdatedAt: doc.updatedAt });
    expect(next).toMatchObject({ status: "validated", remoteUrl: null, remoteContentType: null, remoteCheckedAt: null });
  });
  it("derives draft status from invalid edited content", async () => {
    const doc = await deployed();
    expect(updateLlmsDocument(doc.id, { document: "not a document", expectedUpdatedAt: doc.updatedAt })).toMatchObject({ status: "draft", validation: { valid: false }, remoteUrl: null });
  });
  it("does not allow a client to claim deployment without a successful remote check", () => {
    const doc = createLlmsDocument(base);
    try { updateLlmsDocument(doc.id, { status: "deployed", expectedUpdatedAt: doc.updatedAt }); } catch { /* Rejecting the claim is also valid. */ }
    expect(getLlmsDocument(doc.id).status).not.toBe("deployed");
  });
  it("preserves deployment evidence for title-only changes", async () => {
    const doc = await deployed();
    expect(updateLlmsDocument(doc.id, { title: "Renamed", expectedUpdatedAt: doc.updatedAt })).toMatchObject({ status: "deployed", remoteUrl: doc.remoteUrl, remoteCheckedAt: doc.remoteCheckedAt });
  });
  it("does not demote an unchanged deployed document during local validation", async () => {
    const doc = await deployed();
    expect(validateStoredLlmsDocument(doc.id, { expectedUpdatedAt: doc.updatedAt })).toMatchObject({ status: "deployed", remoteUrl: doc.remoteUrl });
  });
});
describe("history", () => {
  it("clears deployment evidence when restoring another revision", async () => {
    const doc = await deployed();
    restoreLlmsRevision(doc.id, 1, { expectedUpdatedAt: doc.updatedAt });
    expect(getLlmsDocument(doc.id)).toMatchObject({ document: local, status: "validated", remoteUrl: null, remoteContentType: null, remoteCheckedAt: null });
  });
  it("validates a restored revision against the stored path scope", async () => {
    const doc = await deployed("/docs/llms.txt");
    restoreLlmsRevision(doc.id, 1, { expectedUpdatedAt: doc.updatedAt });
    expect(getLlmsDocument(doc.id).validation.issues.map((issue: { code: string }) => issue.code)).toContain("OUTSIDE_SCOPE");
  });
  it("keeps earlier text recoverable after a valid remote import", async () => {
    const doc = await deployed();
    expect(listLlmsRevisions(doc.id).map(r => r.origin)).toEqual(["remote", "created"]);
  });
});
describe("remote", () => {
  it.each([[200, "Not Found"], [204, ""], [200, '{"error":"permission denied"}']])("rejects HTTP %i non-document content without mutating a saved draft", async (status, text) => {
    const doc = createLlmsDocument(base);
    const before = getLlmsDocument(doc.id);
    const revisions = listLlmsRevisions(doc.id);
    vi.mocked(fetchPublicText).mockImplementation(async url => ({ url, status, text, contentType: "text/plain" }));
    await expect(verifyStoredLlmsDocument(doc.id, { expectedUpdatedAt: doc.updatedAt })).rejects.toThrow();
    expect(getLlmsDocument(doc.id)).toEqual(before);
    expect(listLlmsRevisions(doc.id)).toEqual(revisions);
  });
  it("still accepts the minimum valid Markdown document", async () => {
    vi.mocked(fetchPublicText).mockImplementation(async url => ({ url, status: 200, text: "# Site\n", contentType: "text/plain" }));
    expect((await verifyRemoteLlmsTxt("https://example.com")).validation.valid).toBe(true);
  });
});
