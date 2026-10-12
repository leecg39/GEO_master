import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/url-security", () => ({ fetchPublicText: vi.fn() }));

import { GET as getChangeReport } from "@/app/api/change-items/report/route";
import { approveChangeItem, createChangeItem, markDelivered, reportCurrentValue, verifyChangeItem } from "@/lib/change-items";
import { buildChangeReport } from "@/lib/change-report";
import { changeReportToMarkdown } from "@/lib/change-report-markdown";
import { closeDatabase, getDatabase } from "@/lib/db";
import { createProject, ensureActiveProject } from "@/lib/projects";
import { getServerSettings } from "@/lib/settings";
import { fetchPublicText } from "@/lib/url-security";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-change-report-"));
const databasePath = path.join(dir, "geo.db");
const prevDb = process.env.GEO_DB_PATH;
const prevKey = process.env.GEO_MASTER_KEY;
const URL_A = "https://example.com/a";
const SECRET = "sk-report-secret-should-never-appear-1234567890";
const page = (title: string, url = `${URL_A}/`) => ({ url, status: 200, contentType: "text/html", text: `<html><head><title>${title}</title></head><body></body></html>` });

let projectId: number;
const ids: Record<string, number> = {};

function deliver(url: string, field: string, originalValue: string, proposedValue: string) {
  const item = createChangeItem({ url, field, originalValue, proposedValue });
  const approved = approveChangeItem(item.id, { expectedUpdatedAt: item.updatedAt });
  return markDelivered(approved.id, { method: "manual" });
}

function insertAudit(url: string, score: number, createdAt: string, project = projectId) {
  return Number(getDatabase().sqlite.prepare(`
    INSERT INTO audits (project_id, title, notes, url, score, grade, items, metadata, created_at, updated_at)
    VALUES (?, '', '', ?, ?, '보통', '[]', '{}', ?, ?)
  `).run(project, url, score, createdAt, createdAt).lastInsertRowid);
}

beforeAll(async () => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "change-report-master-key-with-32-chars!!";
  projectId = ensureActiveProject().id;
  vi.stubEnv("OPENAI_API_KEY", SECRET);
  expect(getServerSettings(["openai"]).decryptedApiKeys.openai).toBe(SECRET);
  insertAudit(URL_A, 18, "2000-01-01T00:00:00.000Z");

  const verified = deliver(URL_A, "title", "옛 제목", "새 제목");
  vi.mocked(fetchPublicText).mockResolvedValueOnce(page("새 제목"));
  await verifyChangeItem(verified.id);
  ids.verified = verified.id;

  const pending = deliver(URL_A, "description", "", "새 설명 | <b>굵게</b>");
  vi.mocked(fetchPublicText).mockResolvedValueOnce({ ...page("x", "https://example.com/elsewhere"), text: "<html><head><meta name=\"description\" content=\"예전 설명\"></head></html>" });
  await verifyChangeItem(pending.id);
  ids.pending = pending.id;

  const failed = deliver(URL_A, "canonical", "https://example.com/a", "https://example.com/a2");
  vi.mocked(fetchPublicText).mockResolvedValueOnce({ ...page(""), status: 500 });
  await verifyChangeItem(failed.id);
  ids.failed = failed.id;

  const conflict = createChangeItem({ url: URL_A, field: "og_image", originalValue: "https://cdn/a.png", proposedValue: "https://cdn/b.png" });
  reportCurrentValue(conflict.id, "https://cdn/changed.png");
  ids.conflict = conflict.id;

  ids.draft = createChangeItem({ url: URL_A, field: "robots_meta", originalValue: "noindex", proposedValue: "index,follow" }).id;
  ids.otherUrl = createChangeItem({ url: "https://example.com/b", field: "title", originalValue: "b", proposedValue: "다른 페이지" }).id;
});
beforeEach(() => { vi.mocked(fetchPublicText).mockReset(); });
afterAll(() => {
  vi.unstubAllEnvs();
  closeDatabase(databasePath);
  fs.rmSync(dir, { recursive: true, force: true });
  if (prevDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = prevDb;
  if (prevKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = prevKey;
});

describe("change report model (R04)", () => {
  it("counts every status for the URL scope and leaves other URLs out", () => {
    const report = buildChangeReport({ url: URL_A });
    expect(report.kpi).toEqual({ total: 5, draft: 1, approved: 0, delivered: 0, pending: 1, verified: 1, conflict: 1, failed: 1 });
    expect(report.items.map((item) => item.id)).not.toContain(ids.otherUrl);
  });

  it("shows original, proposed and the last public value with its check", () => {
    const item = buildChangeReport({ url: URL_A }).items.find((entry) => entry.id === ids.verified)!;
    expect(item).toMatchObject({ originalValue: "옛 제목", proposedValue: "새 제목", publicValue: "새 제목", lastHttpStatus: 200, lastResult: "matched", wordpressValue: null });
    expect(item.history).toHaveLength(1);
    expect(item.finalUrlMismatch).toBe(false);
  });

  it("flags a check whose final URL is a different page", () => {
    const item = buildChangeReport({ url: URL_A }).items.find((entry) => entry.id === ids.pending)!;
    expect(item.finalUrlMismatch).toBe(true);
    expect(item.publicValue).toBe("예전 설명");
  });

  it("lists what needs action", () => {
    const actions = buildChangeReport({ url: URL_A }).actions;
    expect(actions.map((action) => [action.id, action.kind])).toEqual(expect.arrayContaining([
      [ids.conflict, "conflict"], [ids.failed, "failed"], [ids.pending, "pending"],
    ]));
    expect(actions.map((action) => action.id)).not.toContain(ids.verified);
  });

  it("asks to run a check for items delivered but never checked", () => {
    const item = deliver("https://example.com/c", "title", "c", "확인 안 함");
    const report = buildChangeReport({ ids: [item.id] });
    expect(report.actions).toEqual([expect.objectContaining({ id: item.id, kind: "unchecked" })]);
    expect(changeReportToMarkdown(report)).toMatch(/전달됨\): 전달 후 반영 확인을 아직 하지 않았습니다/);
  });

  it("compares scores only when a real audit exists after the last delivery", () => {
    const before = buildChangeReport({ url: URL_A }).reaudits;
    expect(before).toEqual([expect.objectContaining({ url: URL_A, before: expect.objectContaining({ score: 18 }), after: null })]);
    const afterId = insertAudit(URL_A, 24, "2999-01-01T00:00:00.000Z");
    const after = buildChangeReport({ url: URL_A }).reaudits[0]!;
    expect(after.after).toMatchObject({ id: afterId, score: 24 });
    getDatabase().sqlite.prepare("DELETE FROM audits WHERE id = ?").run(afterId);
  });

  it("selects by ids, ignoring ids outside the active project", () => {
    const other = createProject({ name: "다른", brandName: "다른", category: "x", competitors: [], activate: false });
    const foreign = Number(getDatabase().sqlite.prepare(`INSERT INTO change_items (project_id, url, field, original_value, original_hash, proposed_value, created_at, updated_at)
      VALUES (?, 'https://other.example', 'title', 'a', 'h', 'b', '2026-01-01', '2026-01-01')`).run(other.id).lastInsertRowid);
    const report = buildChangeReport({ ids: [ids.verified, foreign] });
    expect(report.items.map((item) => item.id)).toEqual([ids.verified]);
  });

  it("requires exactly one scope", () => {
    expect(() => buildChangeReport({})).toThrow();
    expect(() => buildChangeReport({ url: URL_A, ids: [1] })).toThrow();
    expect(() => buildChangeReport({ ids: Array.from({ length: 101 }, (_, index) => index + 1) })).toThrow();
  });

  it("never contains stored secrets", () => {
    const report = buildChangeReport({ url: URL_A });
    expect(JSON.stringify(report)).not.toContain(SECRET);
    expect(changeReportToMarkdown(report)).not.toContain(SECRET);
  });
});

describe("change report markdown", () => {
  it("does not disguise an empty original value and escapes page text", () => {
    const text = changeReportToMarkdown(buildChangeReport({ url: URL_A }));
    expect(text).toContain("빈 값 또는 기록 없음");
    expect(text).toContain("새 설명 \\| &lt;b&gt;굵게&lt;/b&gt;");
    expect(text).not.toContain("<b>");
    expect(text).toMatch(/확인 주소가 수정안 주소와 다릅니다/);
  });

  it("states that score changes come only from real re-audits", () => {
    const text = changeReportToMarkdown(buildChangeReport({ url: URL_A }));
    expect(text).toMatch(/수정 이후 진단이 없어/);
    expect(text).not.toMatch(/\+\d+점/);
  });
});

describe("GET /api/change-items/report", () => {
  const call = (query: string) => getChangeReport(new NextRequest(`http://localhost/api/change-items/report?${query}`));

  it("returns JSON for the screen and Markdown as a download", async () => {
    const json = await call(`url=${encodeURIComponent(URL_A)}`);
    expect(json.status).toBe(200);
    expect(json.headers.get("cache-control")).toBe("no-store");
    expect((await json.json() as { kind: string }).kind).toBe("changes");
    const md = await call(`url=${encodeURIComponent(URL_A)}&format=md`);
    expect(md.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(md.headers.get("content-disposition")).toMatch(/^attachment; filename="geo-changes-\d{4}-\d{2}-\d{2}\.md"$/);
    const pdf = await call(`url=${encodeURIComponent(URL_A)}&format=pdf`);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString("ascii")).toBe("%PDF-");
    const download = await call(`ids=${ids.verified},${ids.failed}&format=json&download=1`);
    expect(download.headers.get("content-disposition")).toMatch(/\.json"$/);
  });

  it("rejects bad input", async () => {
    expect((await call("")).status).toBe(422);
    expect((await call("url=javascript:alert(1)")).status).toBe(422);
    expect((await call("ids=1,abc")).status).toBe(422);
  });
});
