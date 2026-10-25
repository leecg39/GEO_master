import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/url-security", () => ({ fetchPublicText: vi.fn() }));

import { approveChangeItem, createChangeItem, deleteChangeItem, markDelivered, verifyChangeItem } from "@/lib/change-items";
import { listChangeVerifications, MAX_VERIFICATIONS_PER_ITEM } from "@/lib/change-verifications";
import { closeDatabase, getDatabase, LATEST_SCHEMA_VERSION } from "@/lib/db";
import { ensureActiveProject } from "@/lib/projects";
import { fetchPublicText } from "@/lib/url-security";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-change-verifications-"));
const databasePath = path.join(dir, "geo.db");
const prevDb = process.env.GEO_DB_PATH;
const prevKey = process.env.GEO_MASTER_KEY;
const html = (title: string) => ({ url: "https://example.com/about/", status: 200, contentType: "text/html", text: `<html><head><title>${title}</title></head><body></body></html>` });

function delivered(proposedValue = "새 제목") {
  const item = createChangeItem({ url: "https://example.com/about", field: "title", originalValue: "old", proposedValue });
  const approved = approveChangeItem(item.id, { expectedUpdatedAt: item.updatedAt });
  return markDelivered(approved.id, { method: "manual" });
}

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "change-verifications-master-key-32-chars";
  ensureActiveProject();
});
beforeEach(() => { vi.mocked(fetchPublicText).mockReset(); });
afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(dir, { recursive: true, force: true });
  if (prevDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = prevDb;
  if (prevKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = prevKey;
});

describe("migration 28", () => {
  it("adds the change_verifications table", () => {
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(28);
    const columns = (getDatabase().sqlite.pragma("table_info(change_verifications)") as { name: string }[]).map(({ name }) => name);
    expect(columns).toEqual(expect.arrayContaining(["change_item_id", "source", "result", "http_status", "matched", "actual_excerpt", "checked_url", "final_url", "duration_ms", "error_code", "checked_at"]));
  });
});

describe("verification history (R03)", () => {
  it("records one row per check with what was seen", async () => {
    const item = delivered();
    vi.mocked(fetchPublicText).mockResolvedValueOnce(html("예전 제목")).mockResolvedValueOnce(html("새 제목"));
    await verifyChangeItem(item.id);
    await verifyChangeItem(item.id);
    const history = listChangeVerifications(item.id);
    expect(history.map((entry) => ({ result: entry.result, matched: entry.matched, httpStatus: entry.httpStatus, actual: entry.actualExcerpt }))).toEqual([
      { result: "matched", matched: true, httpStatus: 200, actual: "새 제목" },
      { result: "pending", matched: false, httpStatus: 200, actual: "예전 제목" },
    ]);
    expect(history[0]).toMatchObject({ source: "public", checkedUrl: "https://example.com/about", finalUrl: "https://example.com/about/", errorCode: null });
    expect(history[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("records HTTP errors and network errors too, keeping the existing status rules", async () => {
    const item = delivered();
    vi.mocked(fetchPublicText).mockResolvedValueOnce({ ...html(""), status: 503 }).mockRejectedValueOnce(new Error("ECONNRESET"));
    expect((await verifyChangeItem(item.id)).item.status).toBe("failed");
    await expect(verifyChangeItem(item.id)).rejects.toMatchObject({ code: "VERIFY_FETCH_FAILED" });
    const history = listChangeVerifications(item.id);
    expect(history.map(({ result, httpStatus, errorCode, matched }) => ({ result, httpStatus, errorCode, matched }))).toEqual([
      { result: "fetch_error", httpStatus: null, errorCode: "VERIFY_FETCH_FAILED", matched: null },
      { result: "http_error", httpStatus: 503, errorCode: null, matched: false },
    ]);
  });

  it("does not record anything when the item cannot be verified", async () => {
    const item = createChangeItem({ url: "https://example.com/about", field: "title", originalValue: "old", proposedValue: "x" });
    await expect(verifyChangeItem(item.id)).rejects.toMatchObject({ code: "CHANGE_NOT_DELIVERED" });
    expect(listChangeVerifications(item.id)).toEqual([]);
    expect(fetchPublicText).not.toHaveBeenCalled();
  });

  it("caps the stored excerpt at 500 characters", async () => {
    const long = "가".repeat(900);
    const item = delivered(long);
    vi.mocked(fetchPublicText).mockResolvedValueOnce(html(long));
    await verifyChangeItem(item.id);
    expect(listChangeVerifications(item.id)[0]!.actualExcerpt).toHaveLength(500);
  });

  it("keeps only the most recent checks per item", async () => {
    const item = delivered();
    vi.mocked(fetchPublicText).mockResolvedValue(html("예전 제목"));
    for (let index = 0; index < MAX_VERIFICATIONS_PER_ITEM + 3; index += 1) await verifyChangeItem(item.id);
    expect(listChangeVerifications(item.id)).toHaveLength(MAX_VERIFICATIONS_PER_ITEM);
  });

  it("removes the history with the change item", async () => {
    const item = createChangeItem({ url: "https://example.com/about", field: "title", originalValue: "old", proposedValue: "삭제 대상" });
    getDatabase().sqlite.prepare("INSERT INTO change_verifications (change_item_id, source, result, checked_url, duration_ms, checked_at) VALUES (?, 'public', 'pending', ?, 1, ?)")
      .run(item.id, item.url, new Date().toISOString());
    deleteChangeItem(item.id, { expectedUpdatedAt: item.updatedAt });
    expect(getDatabase().sqlite.prepare("SELECT COUNT(*) AS n FROM change_verifications WHERE change_item_id = ?").get(item.id)).toEqual({ n: 0 });
  });

  it("reports a missing item, not a database error, when the item is deleted during the check", async () => {
    const item = delivered();
    vi.mocked(fetchPublicText).mockImplementationOnce(async () => {
      getDatabase().sqlite.prepare("DELETE FROM change_items WHERE id = ?").run(item.id);
      return html("새 제목");
    });
    await expect(verifyChangeItem(item.id)).rejects.toMatchObject({ code: "CHANGE_NOT_FOUND" });
  });

  it("refuses to list another project's history", () => {
    expect(() => listChangeVerifications(999_999)).toThrow();
  });
});
