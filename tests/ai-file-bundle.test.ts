import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/url-security", async () => {
  const actual = await vi.importActual<typeof import("@/lib/url-security")>("@/lib/url-security");
  return { ...actual, fetchPublicText: vi.fn() };
});

import { BUNDLE_FILES, checkAiFileBundle } from "@/lib/ai-file-bundle";
import { fetchPublicText } from "@/lib/url-security";

const reply = (url: string, status: number, text: string, contentType = "text/plain") => ({ url, status, text, contentType });

beforeEach(() => { vi.mocked(fetchPublicText).mockReset(); });

describe("checkAiFileBundle", () => {
  it("lists the four bundle files and labels everything except llms.txt as optional compatibility files", () => {
    expect(BUNDLE_FILES.map((file) => [file.path, file.tier])).toEqual([
      ["/llms.txt", "standard"], ["/llms-ko.txt", "optional"], ["/ai.txt", "optional"], ["/ai-ko.txt", "optional"],
    ]);
  });

  it("probes each file by real request and classifies present / missing / unknown", async () => {
    vi.mocked(fetchPublicText).mockImplementation(async (url: string) => {
      if (url.endsWith("/llms.txt")) return reply(url, 200, "# 예시\n> 요약");
      if (url.endsWith("/llms-ko.txt")) return reply(url, 404, "not found", "text/html");
      if (url.endsWith("/ai.txt")) return reply(url, 200, "<!doctype html><html><body>없는 페이지</body></html>", "text/html");
      throw new Error("down");
    });
    const result = await checkAiFileBundle("https://example.com");
    expect(result.files.map((file) => [file.path, file.state])).toEqual([
      ["/llms.txt", "present"], ["/llms-ko.txt", "missing"], ["/ai.txt", "missing"], ["/ai-ko.txt", "unknown"],
    ]);
    expect(result.files[0]).toMatchObject({ contentType: "text/plain", httpStatus: 200 });
    expect(result.files[0]!.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.files[2]!.detail).toContain("소프트 404");
    expect(result.note).toContain("보편적인 규격이 아닙니다");
  });

  it("flags a present file with a non-text MIME type", async () => {
    vi.mocked(fetchPublicText).mockImplementation(async (url: string) => reply(url, 200, "# x", "application/octet-stream"));
    const result = await checkAiFileBundle("https://example.com");
    expect(result.files[0]!.warnings).toContain("MIME 유형이 text/plain 또는 Markdown이 아닙니다 (application/octet-stream)");
  });

  it("rejects non-http websites", async () => {
    await expect(checkAiFileBundle("file:///etc/passwd")).rejects.toThrow();
  });
});
