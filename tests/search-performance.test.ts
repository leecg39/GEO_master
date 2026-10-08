import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzipSync, zipSync, strToU8 } from "fflate";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseGscExcel } from "@/lib/search-performance/excel";
import { importSearchPerformance, getSearchPerformanceImport, listSearchPerformanceImports, deleteSearchPerformanceImport, normalizeSocialProperty } from "@/lib/search-performance";
import { closeDatabase, getDatabase } from "@/lib/db";
import { ensureActiveProject, createProject, deleteProject } from "@/lib/projects";
import { withRequestAccount } from "@/lib/request-account";
import { GET, POST } from "@/app/api/search-performance/route";
import { proxy } from "@/proxy";

const fixture = fs.readFileSync(new URL("./fixtures/gsc/empty-ko.xlsx", import.meta.url));
const original = unzipSync(fixture);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-gsc-import-"));
const databasePath = path.join(tempDir, "test.db");
const secret = "gsc-import-test-proxy-secret-32-characters";
const cells = (values: string[], row: number) => `<row r="${row}">${values.map((v, i) => `<c r="${String.fromCharCode(65 + i)}${row}" t="inlineStr"><is><t>${v}</t></is></c>`).join("")}</row>`;
function changedChart(rows: string[][], suffix = "") {
  const xml = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((values, i) => cells(values, i + 1)).join("")}${suffix}</sheetData></worksheet>`;
  return zipSync({ ...original, "xl/worksheets/sheet1.xml": strToU8(xml) });
}
const headers = ["날짜", "클릭수", "노출", "CTR", "게재 순위"];

describe("Search Console Excel parser", () => {
  it("reads an actual Korean export and preserves blank metrics as null", () => {
    const report = parseGscExcel(fixture);
    expect(report).toMatchObject({ periodStart: "2026-09-08", periodEnd: "2026-10-05", searchType: "웹", dataState: "no_activity",
      totals: { clicks: 0, impressions: 0, ctr: null, position: null } });
    expect(report.daily).toHaveLength(28);
    expect(report.tables).toHaveLength(5);
    expect(report.tables.every((table) => table.rows.length === 0)).toBe(true);
  });
  it("calculates CTR from summed counts and weights position by impressions", () => {
    const report = parseGscExcel(changedChart([headers, ["2026-10-02", "20", "100", "20%", "2"], ["2026-10-01", "30", "300", "10%", "6"]]));
    expect(report.totals).toEqual({ clicks: 50, impressions: 400, ctr: 0.125, position: 5 });
    expect(report.daily[0].key).toBe("2026-10-01");
    expect(report.dataState).toBe("measured");
  });
  it("does not invent a position when a positive-impression row has no rank", () => {
    expect(parseGscExcel(changedChart([headers, ["2026-10-01", "1", "10", "10%", ""]])).totals.position).toBeNull();
  });
  it.each([
    ["negative", [headers, ["2026-10-01", "-1", "10", "10%", "2"]]],
    ["fractional counts", [headers, ["2026-10-01", "1.2", "10", "10%", "2"]]],
    ["invalid date", [headers, ["2026-02-30", "1", "10", "10%", "2"]]],
    ["duplicate dates", [headers, ["2026-10-01", "1", "10", "10%", "2"], ["2026-10-01", "1", "10", "10%", "2"]]],
    ["comparison columns", [[...headers, "前期"], ["2026-10-01", "1", "10", "10%", "2", "3"]]],
  ])("rejects %s", (_, rows) => { expect(() => parseGscExcel(changedChart(rows as string[][]))).toThrow(); });
  it("rejects formulas instead of using a cached value", () => {
    expect(() => parseGscExcel(changedChart([headers], '<row r="2"><c r="A2"><f>1+1</f><v>2</v></c></row>'))).toThrow(/수식/);
  });
  it("rejects invalid files, oversized uploads and oversized expanded XML", () => {
    expect(() => parseGscExcel(Buffer.from("not an excel"))).toThrow(/xlsx/);
    expect(() => parseGscExcel(new Uint8Array(5 * 1024 * 1024 + 1))).toThrow(/5MB/);
    const bomb = zipSync({ ...original, "xl/oversized.xml": new Uint8Array(21 * 1024 * 1024) });
    expect(() => parseGscExcel(bomb)).toThrow(/크기/);
  });
  it("rejects XML entities and external workbook relationships", () => {
    expect(() => parseGscExcel(zipSync({ ...original, "xl/workbook.xml": strToU8('<!DOCTYPE a [<!ENTITY x "boom">]><a/>') }))).toThrow(/XML/);
    const rels = new TextDecoder().decode(original["xl/_rels/workbook.xml.rels"]).replaceAll('Target="', 'TargetMode="External" Target="');
    expect(() => parseGscExcel(zipSync({ ...original, "xl/_rels/workbook.xml.rels": strToU8(rels) }))).toThrow(/외부/);
  });
});

beforeEach(() => {
  vi.stubEnv("GEO_DB_PATH", databasePath);
  vi.stubEnv("GEO_AUTH_MODE", "local");
  ensureActiveProject();
  getDatabase().sqlite.exec("DELETE FROM gsc_imports");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => { closeDatabase(databasePath); fs.rmSync(tempDir, { recursive: true, force: true }); });
function payload(propertyUrl = "https://instagram.com/annatar2908") {
  return { projectId: ensureActiveProject().id, propertyUrl, filename: "report.xlsx", base64: fixture.toString("base64") };
}
function account<T>(id: string, work: () => T) {
  return withRequestAccount(new Headers({ "x-geo-auth-secret": secret, "x-geo-auth-user": id }), work);
}

describe("Search performance import persistence and access", () => {
  it("imports all three profiles, deduplicates per profile and never creates an OAuth connection", () => {
    for (const url of ["https://instagram.com/annatar2908", "https://x.com/annatar2908", "https://www.tiktok.com/@userv6z8w49gz5"]) {
      expect(importSearchPerformance(payload(url)).duplicate).toBe(false);
      expect(importSearchPerformance(payload(url)).duplicate).toBe(true);
    }
    expect(listSearchPerformanceImports().imports).toHaveLength(3);
    expect(getDatabase().sqlite.prepare("SELECT COUNT(*) AS n FROM gsc_connections").get()).toEqual({ n: 0 });
    const id = listSearchPerformanceImports().imports[0].id;
    closeDatabase(databasePath);
    expect(getSearchPerformanceImport(id).report.daily).toHaveLength(28);
  });
  it("normalizes X aliases and rejects posts, unsupported domains and URL credentials", () => {
    expect(normalizeSocialProperty("https://twitter.com/Annatar2908/").url).toBe("https://x.com/annatar2908");
    for (const url of ["https://x.com/annatar2908/status/1", "https://example.com/user", "https://user:pass@x.com/annatar2908"]) {
      expect(() => normalizeSocialProperty(url)).toThrow();
    }
  });
  it("does not save invalid workbooks or an import addressed to a stale project", () => {
    expect(() => importSearchPerformance({ ...payload(), base64: Buffer.from("invalid").toString("base64") })).toThrow();
    expect(() => importSearchPerformance({ ...payload(), projectId: 999999 })).toThrow(/프로젝트/);
    expect(listSearchPerformanceImports().imports).toEqual([]);
  });
  it("keeps imports isolated by active project", () => {
    const first = importSearchPerformance(payload());
    createProject({ name: "다른 프로젝트", brandName: "Another", category: "", competitors: [], activate: true });
    expect(listSearchPerformanceImports().imports).toEqual([]);
    expect(() => getSearchPerformanceImport(first.imported.id)).toThrow(/찾을/);
    expect(() => deleteSearchPerformanceImport(first.imported.id)).toThrow(/찾을/);
  });
  it("enforces account ownership and guest restrictions", () => {
    const input = payload();
    vi.stubEnv("GEO_AUTH_MODE", "proxy"); vi.stubEnv("GEO_AUTH_PROXY_SECRET", secret);
    const first = account("member-a", () => importSearchPerformance(input));
    expect(account("member-b", () => listSearchPerformanceImports().imports)).toEqual([]);
    expect(() => account("member-b", () => getSearchPerformanceImport(first.imported.id))).toThrow(/찾을/);
    expect(() => account("member-b", () => deleteSearchPerformanceImport(first.imported.id))).toThrow(/찾을/);
    expect(() => account("guest", () => importSearchPerformance(input))).toThrow(/게스트/);
    account("member-a", () => deleteSearchPerformanceImport(first.imported.id));
    expect(account("member-a", () => listSearchPerformanceImports().imports)).toEqual([]);
  });
  it("requires dependency confirmation before deleting a project with imported reports", () => {
    const current = ensureActiveProject();
    const imported = importSearchPerformance(payload());
    const replacement = createProject({ name: "삭제 후 프로젝트", brandName: "Replacement", category: "", competitors: [], activate: false });
    const input = { expectedUpdatedAt: current.updatedAt, replacementProjectId: replacement.id };
    expect(() => deleteProject(current.id, input)).toThrowError(expect.objectContaining({ code: "PROJECT_HAS_DEPENDENCIES" }));
    expect(getSearchPerformanceImport(imported.imported.id).id).toBe(imported.imported.id);
    deleteProject(current.id, { ...input, cascadeConfirmed: true });
    expect(getDatabase().sqlite.prepare("SELECT id FROM gsc_imports WHERE id = ?").get(imported.imported.id)).toBeUndefined();
  });
  it("serves imports through the same API used by the UI and sets private no-store", async () => {
    const response = await POST(new NextRequest("http://localhost/api/search-performance", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload()),
    }));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const list = await GET(new NextRequest("http://localhost/api/search-performance"));
    expect((await list.json()).imports).toHaveLength(1);
  });
  it("rejects bad request sizes, missing authentication and cross-origin writes", async () => {
    expect((await POST(new NextRequest("http://localhost/api/search-performance", { method: "POST", headers: { "content-type": "application/json", "content-length": "9999999" }, body: "{}" }))).status).toBe(413);
    expect((await proxy(new NextRequest("http://localhost/api/search-performance", { method: "POST", headers: { origin: "https://other.example", "content-type": "application/json" }, body: "{}" }))).status).toBe(403);
    vi.stubEnv("GEO_AUTH_MODE", "proxy"); vi.stubEnv("GEO_AUTH_PROXY_SECRET", secret);
    expect((await GET(new NextRequest("http://localhost/api/search-performance"))).status).toBe(401);
  });
});
