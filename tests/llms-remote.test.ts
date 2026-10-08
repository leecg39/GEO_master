import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/url-security", async () => {
  const actual = await vi.importActual<typeof import("@/lib/url-security")>("@/lib/url-security");
  return { ...actual, fetchPublicText: vi.fn() };
});

import { closeDatabase } from "@/lib/db";
import { createLlmsDocument, getLlmsDocument, updateLlmsDocument, verifyStoredLlmsDocument } from "@/lib/llms-documents";
import { verifyRemoteLlmsTxt } from "@/lib/llms-txt";
import { ensureActiveProject } from "@/lib/projects";
import { fetchPublicText } from "@/lib/url-security";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "geo-llms-remote-"));
const databasePath = path.join(directory, "test.db");
const previousDb = process.env.GEO_DB_PATH;
const docsFile = "# Docs\n\n> 문서 영역만 다루는 llms.txt입니다.\n\n## Docs\n\n- [A](https://example.com/docs/a): 설명\n";

beforeAll(() => { process.env.GEO_DB_PATH = databasePath; ensureActiveProject(); });
afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(directory, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb;
});
beforeEach(() => { vi.mocked(fetchPublicText).mockReset(); });

describe("remote llms.txt verification", () => {
  it("checks a path-scoped file and validates it against that scope", async () => {
    vi.mocked(fetchPublicText).mockImplementation(async (url: string) => ({ url, status: 200, text: docsFile, contentType: "text/plain; charset=utf-8" }));
    const result = await verifyRemoteLlmsTxt("https://example.com/shop", "/docs/llms.txt");
    expect(vi.mocked(fetchPublicText).mock.calls[0]?.[0]).toBe("https://example.com/docs/llms.txt");
    expect(result).toMatchObject({ path: "/docs/llms.txt", validation: { valid: true } });
  });

  it("defaults to the site root and rejects paths that are not an llms.txt on the same site", async () => {
    vi.mocked(fetchPublicText).mockImplementation(async (url: string) => ({ url, status: 200, text: "# Site\n", contentType: "text/plain" }));
    await verifyRemoteLlmsTxt("https://example.com/a/b");
    expect(vi.mocked(fetchPublicText).mock.calls[0]?.[0]).toBe("https://example.com/llms.txt");
    for (const bad of ["/docs/readme.txt", "https://evil.example/llms.txt", "//evil.example/llms.txt", "docs/llms.txt", "/docs/llms.txt?x=1"]) {
      await expect(verifyRemoteLlmsTxt("https://example.com", bad)).rejects.toMatchObject({ code: "INVALID_LLMS_PATH" });
    }
  });

  it("does not count an HTML page answering with 200 as a published llms.txt", async () => {
    vi.mocked(fetchPublicText).mockImplementation(async (url: string) => ({ url, status: 200, text: "<!doctype html><html><body><h1>페이지를 찾을 수 없습니다</h1></body></html>", contentType: "text/html" }));
    await expect(verifyRemoteLlmsTxt("https://example.com")).rejects.toMatchObject({ code: "LLMS_HTML_RESPONSE" });
  });

  it.each([
    [401, "LLMS_AUTH_REQUIRED", "인증이 필요합니다"],
    [403, "LLMS_ACCESS_DENIED", "접근이 차단되었습니다"],
    [404, "LLMS_NOT_FOUND", "파일을 해당 경로에 업로드"],
    [410, "LLMS_NOT_FOUND", "파일을 해당 경로에 업로드"],
    [429, "LLMS_RATE_LIMITED", "요청 한도를 초과"],
    [500, "LLMS_HTTP_ERROR", "사이트 응답 상태"],
    [503, "LLMS_HTTP_ERROR", "사이트 응답 상태"],
  ])("explains upstream HTTP %i without misreporting it as a missing file", async (status, code, guidance) => {
    vi.mocked(fetchPublicText).mockImplementation(async (url: string) => ({ url, status, text: "<html>Error</html>", contentType: "text/html" }));
    await expect(verifyRemoteLlmsTxt("https://example.com", "/docs/llms.txt")).rejects.toMatchObject({
      status: 422, code, message: expect.stringContaining(guidance),
      details: { requestedUrl: "https://example.com/docs/llms.txt", url: "https://example.com/docs/llms.txt", upstreamStatus: status },
    });
  });

  it("warns when the request was redirected away from the llms.txt path", async () => {
    vi.mocked(fetchPublicText).mockImplementation(async () => ({ url: "https://example.com/llms-guide.txt", status: 200, text: "# Site\n", contentType: "text/plain" }));
    const result = await verifyRemoteLlmsTxt("https://example.com");
    expect(result.validation.issues.find((issue) => issue.code === "REDIRECTED")).toMatchObject({ category: "quality", severity: "warning" });
  });
});

describe("stored llms.txt documents with a scope path", () => {
  const base = {
    title: "문서 영역", website: "https://example.com", brandName: "Example", summary: "Example 문서 영역을 안내하는 llms.txt 초안입니다.",
    resources: [{ title: "A", url: "https://example.com/docs/a", description: "설명" }],
  };

  it("stores the scope path, verifies that path and keeps the draft when an HTML page answers", async () => {
    const created = createLlmsDocument({ ...base, scopePath: "/docs/llms.txt" });
    expect(created.scopePath).toBe("/docs/llms.txt");
    vi.mocked(fetchPublicText).mockImplementation(async (url: string) => ({ url, status: 200, text: "<html><body>오류</body></html>", contentType: "text/html" }));
    await expect(verifyStoredLlmsDocument(created.id, { expectedUpdatedAt: created.updatedAt })).rejects.toMatchObject({ code: "LLMS_HTML_RESPONSE" });
    expect(vi.mocked(fetchPublicText).mock.calls[0]?.[0]).toBe("https://example.com/docs/llms.txt");
    expect(getLlmsDocument(created.id)).toMatchObject({ document: created.document, status: created.status });
  });

  it("defaults to the root path and validates scope changes", () => {
    const created = createLlmsDocument(base);
    expect(created.scopePath).toBe("/llms.txt");
    expect(() => updateLlmsDocument(created.id, { scopePath: "/docs/readme.txt", expectedUpdatedAt: created.updatedAt })).toThrow();
    expect(updateLlmsDocument(created.id, { scopePath: "/docs/llms.txt", expectedUpdatedAt: created.updatedAt })).toMatchObject({ scopePath: "/docs/llms.txt" });
  });

  it("keeps a saved draft and its verification state when authentication blocks the public file", async () => {
    const created = createLlmsDocument(base);
    const before = getLlmsDocument(created.id);
    vi.mocked(fetchPublicText).mockImplementation(async (url: string) => ({ url, status: 401, text: "Authorization Required", contentType: "text/html" }));
    await expect(verifyStoredLlmsDocument(created.id, { expectedUpdatedAt: created.updatedAt })).rejects.toMatchObject({ code: "LLMS_AUTH_REQUIRED" });
    expect(getLlmsDocument(created.id)).toEqual(before);
  });
});
