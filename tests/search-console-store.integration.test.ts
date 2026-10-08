import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase } from "@/lib/db";
import { createProject, ensureActiveProject } from "@/lib/projects";
import { deleteConsoleImport, importConsoleExport, listConsoleImports, getConsoleImport } from "@/lib/search-console/store";
import { buildXlsx } from "./helpers-xlsx";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-gsc-import-"));
const databasePath = path.join(dir, "geo.db");
const prevDb = process.env.GEO_DB_PATH;
const prevKey = process.env.GEO_MASTER_KEY;
const H = ["날짜", "클릭수", "노출", "CTR", "게재 순위"];
const file = (rows: string[][]) => buildXlsx({ 차트: [H, ...rows], "검색어 수": [["인기 검색어", "클릭수", "노출", "CTR", "게재 순위"], ["채널톡", "2", "50", "4%", "5"]], 필터: [["필터", "값"], ["검색 유형", "웹"]] });
const empty = fs.readFileSync(path.join(__dirname, "fixtures/search-console/empty-console-export.xlsx"));

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "gsc-import-master-key-with-32-characters";
  ensureActiveProject();
});
afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(dir, { recursive: true, force: true });
  if (prevDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = prevDb;
  if (prevKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = prevKey;
});

describe("console export store", () => {
  it("stores an import with its period, source, totals and rows; requires a property label", () => {
    expect(() => importConsoleExport({ fileName: "a.xlsx", propertyLabel: "", buffer: file([["2026-09-08", "1", "10", "", ""]]) })).toThrow();
    const result = importConsoleExport({ fileName: "instagram-performance.xlsx", propertyLabel: "Instagram @annatar2908", buffer: file([["2026-09-08", "2", "50", "4%", "5"], ["2026-09-09", "0", "0", "", ""]]) });
    expect(result).toMatchObject({ duplicate: false, import: { propertyLabel: "Instagram @annatar2908", source: "console_export", periodStart: "2026-09-08", periodEnd: "2026-09-09", hasData: true, totals: { clicks: 2, impressions: 50 } } });
    const detail = getConsoleImport(result.import.id);
    expect(detail.daily).toHaveLength(2);
    expect(detail.dimensions.queries).toEqual([{ key: "채널톡", clicks: 2, impressions: 50, ctr: 0.04, position: 5 }]);
    expect(detail.filters).toEqual({ "검색 유형": "웹" });
  });

  it("recognizes the same file for the same property as a duplicate and does not store it twice", () => {
    const buffer = file([["2026-09-08", "2", "50", "4%", "5"], ["2026-09-09", "0", "0", "", ""]]);
    const again = importConsoleExport({ fileName: "copy.xlsx", propertyLabel: "Instagram @annatar2908", buffer });
    expect(again.duplicate).toBe(true);
    expect(listConsoleImports().filter((item) => item.propertyLabel === "Instagram @annatar2908")).toHaveLength(1);
    // 같은 파일이라도 다른 속성이면 별도 가져오기 (파일에는 속성 이름이 없다)
    const other = importConsoleExport({ fileName: "x.xlsx", propertyLabel: "X @annatar2908", buffer });
    expect(other.duplicate).toBe(false);
  });

  it("marks an all-zero export as no data instead of reporting zero performance", () => {
    const result = importConsoleExport({ fileName: "tiktok-performance.xlsx", propertyLabel: "TikTok @userv6z8w49gz5", buffer: empty });
    expect(result.import).toMatchObject({ hasData: false, totals: { clicks: 0, impressions: 0, ctr: null, position: null }, periodStart: "2026-09-08", periodEnd: "2026-10-05" });
    expect(result.warning).toContain("노출이 0");
  });

  it("keeps imports project-scoped and deletes by id", () => {
    const first = listConsoleImports()[0]!;
    createProject({ name: "다른", brandName: "다른", category: "", competitors: [], activate: true });
    expect(listConsoleImports()).toEqual([]);
    expect(() => getConsoleImport(first.id)).toThrow();
    expect(() => deleteConsoleImport(first.id)).toThrow();
  });
});
