import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/url-security", () => ({ fetchPublicText: vi.fn() }));

import { approveChangeItem, createChangeItem, markDelivered, verifyChangeItem } from "@/lib/change-items";
import { closeDatabase } from "@/lib/db";
import { extractPageField, fieldMatches } from "@/lib/page-fields";
import { ensureActiveProject } from "@/lib/projects";
import { fetchPublicText } from "@/lib/url-security";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-change-verify-"));
const databasePath = path.join(dir, "geo.db");
const prevDb = process.env.GEO_DB_PATH;
const prevKey = process.env.GEO_MASTER_KEY;
const page = (head: string, body = "") => ({ url: "https://example.com/about", status: 200, contentType: "text/html", text: `<html><head>${head}</head><body>${body}</body></html>` });

function delivered(field: string, proposedValue: string) {
  const item = createChangeItem({ url: "https://example.com/about", field, originalValue: "old", proposedValue });
  const approved = approveChangeItem(item.id, { expectedUpdatedAt: item.updatedAt });
  return markDelivered(approved.id, { method: "manual" });
}

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "change-verify-master-key-with-32-characters";
  ensureActiveProject();
});
beforeEach(() => vi.mocked(fetchPublicText).mockReset());
afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(dir, { recursive: true, force: true });
  if (prevDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = prevDb;
  if (prevKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = prevKey;
});

describe("extractPageField", () => {
  it("reads head fields from real HTML", () => {
    const html = page(`<title> 새 제목 </title><meta name="description" content="설명입니다"><link rel="canonical" href="https://example.com/about"><meta property="og:image" content="https://example.com/og.png"><meta name="robots" content="noindex">`).text;
    expect(extractPageField(html, "title")).toBe("새 제목");
    expect(extractPageField(html, "description")).toBe("설명입니다");
    expect(extractPageField(html, "canonical")).toBe("https://example.com/about");
    expect(extractPageField(html, "og_image")).toBe("https://example.com/og.png");
    expect(extractPageField(html, "robots_meta")).toBe("noindex");
    expect(extractPageField("<html></html>", "title")).toBeNull();
  });

  it("compares whitespace-insensitively; JSON-LD by parsed equality; body by containment", () => {
    expect(fieldMatches("title", "A  B", "A B")).toBe(true);
    expect(fieldMatches("title", "A", "B")).toBe(false);
    expect(fieldMatches("title", null, "B")).toBe(false);
    const ld = page(`<script type="application/ld+json">{"@type":"Organization","name":"채널톡"}</script>`).text;
    expect(fieldMatches("json_ld", extractPageField(ld, "json_ld"), '{ "name": "채널톡", "@type": "Organization" }')).toBe(true);
    expect(fieldMatches("body", extractPageField(page("", "<p>환영합니다. 채널톡은 상담 도구입니다.</p>").text, "body"), "채널톡은 상담 도구입니다")).toBe(true);
  });
});

describe("verifyChangeItem (Qshop P09)", () => {
  it("verifies only when the live field equals the proposal", async () => {
    vi.mocked(fetchPublicText).mockResolvedValue(page("<title>채널톡 | 고객 상담</title>"));
    const item = delivered("title", "채널톡 | 고객 상담");
    const result = await verifyChangeItem(item.id);
    expect(result.item.status).toBe("verified");
    expect(result.check).toMatchObject({ matched: true, httpStatus: 200 });
  });

  it("stays pending (not verified, not failed) when HTTP 200 but the field is unchanged", async () => {
    vi.mocked(fetchPublicText).mockResolvedValue(page("<title>예전 제목</title>"));
    const item = delivered("title", "새 제목");
    const result = await verifyChangeItem(item.id);
    expect(result.item.status).toBe("verification_pending");
    expect(result.check).toMatchObject({ matched: false, actual: "예전 제목" });
  });

  it("marks failed on HTTP errors and keeps status on network errors", async () => {
    vi.mocked(fetchPublicText).mockResolvedValueOnce({ ...page(""), status: 404 });
    const missing = delivered("title", "새 제목");
    expect((await verifyChangeItem(missing.id)).item.status).toBe("failed");
    vi.mocked(fetchPublicText).mockRejectedValueOnce(new Error("down"));
    const flaky = delivered("title", "또 다른 제목");
    await expect(verifyChangeItem(flaky.id)).rejects.toMatchObject({ code: "VERIFY_FETCH_FAILED" });
  });

  it("refuses to verify items that were never delivered", async () => {
    const draft = createChangeItem({ url: "https://example.com/about", field: "title", originalValue: "x", proposedValue: "y" });
    await expect(verifyChangeItem(draft.id)).rejects.toMatchObject({ code: "CHANGE_NOT_DELIVERED" });
  });
});
