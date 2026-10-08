import fs from "node:fs";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseConsoleExport } from "@/lib/search-console/xlsx-import";
import { buildXlsx } from "./helpers-xlsx";

const H = ["날짜", "클릭수", "노출", "CTR", "게재 순위"];
const populated = () => buildXlsx({
  차트: [H, ["2026-09-08", "3.0", "120.0", "0.025", "8.4"], ["2026-09-09", "0.0", "0.0", "", ""], ["2026-09-10", "5", "100", "5%", "7.1"]],
  "검색어 수": [["인기 검색어", "클릭수", "노출", "CTR", "게재 순위"], ["채널톡", "6", "150", "4%", "6.5"]],
  게시물: [["인기 게시물", "클릭수", "노출", "CTR", "게재 순위"], ["https://example.com/a", "2", "40", "0.05", "9"]],
  국가: [["국가", "클릭수", "노출", "CTR", "게재 순위"], ["대한민국", "8", "220", "0.036", "7"]],
  필터: [["필터", "값"], ["검색 유형", "웹"], ["날짜", "지난 28일"]],
});

describe("parseConsoleExport", () => {
  it("parses the real exported file: all zeros stay zero but are flagged as having no impressions", () => {
    const parsed = parseConsoleExport(fs.readFileSync(path.join(__dirname, "fixtures/search-console/empty-console-export.xlsx")));
    expect(parsed.daily).toHaveLength(28);
    expect(parsed.daily[0]).toEqual({ date: "2026-09-08", clicks: 0, impressions: 0, ctr: null, position: null });
    expect(parsed.period).toEqual({ start: "2026-09-08", end: "2026-10-05" });
    expect(parsed.totals).toEqual({ clicks: 0, impressions: 0, ctr: null, position: null });
    expect(parsed.hasData).toBe(false);
    expect(parsed.dimensions).toEqual({ queries: [], pages: [], countries: [], devices: [], appearances: [] });
    expect(parsed.filters).toEqual({ "검색 유형": "웹", 날짜: "지난 28일" });
    expect(parsed.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("parses daily rows, ratios and percent strings, blank CTR/position as null, and dimension sheets", () => {
    const parsed = parseConsoleExport(populated());
    expect(parsed.daily).toEqual([
      { date: "2026-09-08", clicks: 3, impressions: 120, ctr: 0.025, position: 8.4 },
      { date: "2026-09-09", clicks: 0, impressions: 0, ctr: null, position: null },
      { date: "2026-09-10", clicks: 5, impressions: 100, ctr: 0.05, position: 7.1 },
    ]);
    expect(parsed.hasData).toBe(true);
    expect(parsed.dimensions.queries).toEqual([{ key: "채널톡", clicks: 6, impressions: 150, ctr: 0.04, position: 6.5 }]);
    expect(parsed.dimensions.countries[0]!.key).toBe("대한민국");
    // 합계의 CTR은 값을 평균하지 않고 클릭÷노출로 계산하고, 순위는 노출 가중 평균
    expect(parsed.totals.clicks).toBe(8);
    expect(parsed.totals.impressions).toBe(220);
    expect(parsed.totals.ctr).toBeCloseTo(8 / 220);
    expect(parsed.totals.position).toBeCloseTo((8.4 * 120 + 7.1 * 100) / 220);
  });

  it("reads inline strings and English headers", () => {
    const parsed = parseConsoleExport(buildXlsx({ Chart: [["Date", "Clicks", "Impressions", "CTR", "Position"], ["2026-10-01", "1", "10", "10%", "3"]] }, { sharedStrings: false }));
    expect(parsed.daily).toEqual([{ date: "2026-10-01", clicks: 1, impressions: 10, ctr: 0.1, position: 3 }]);
  });

  it("rejects files that are not xlsx, lack the date sheet, or contain invalid values", () => {
    expect(() => parseConsoleExport(Buffer.from("not a zip"))).toThrow(expect.objectContaining({ code: "XLSX_INVALID" }));
    expect(() => parseConsoleExport(buildXlsx({ 기타: [["a"]] }))).toThrow(expect.objectContaining({ code: "XLSX_NO_DAILY_SHEET" }));
    expect(() => parseConsoleExport(buildXlsx({ 차트: [H, ["어제", "1", "1", "", ""]] }))).toThrow(expect.objectContaining({ code: "XLSX_INVALID_ROW" }));
    expect(() => parseConsoleExport(buildXlsx({ 차트: [H, ["2026-09-08", "-1", "1", "", ""]] }))).toThrow(expect.objectContaining({ code: "XLSX_INVALID_ROW" }));
    // 클릭이 노출보다 많을 수 없다
    expect(() => parseConsoleExport(buildXlsx({ 차트: [H, ["2026-09-08", "5", "2", "", ""]] }))).toThrow(expect.objectContaining({ code: "XLSX_INVALID_ROW" }));
  });

  it("guards against zip bombs and oversized inputs", () => {
    const bomb = Buffer.from(zipSync({ "xl/workbook.xml": strToU8("<x/>"), "xl/worksheets/sheet1.xml": new Uint8Array(30 * 1024 * 1024) }));
    expect(() => parseConsoleExport(bomb)).toThrow(expect.objectContaining({ code: "XLSX_TOO_LARGE" }));
    expect(() => parseConsoleExport(Buffer.alloc(3 * 1024 * 1024))).toThrow(expect.objectContaining({ code: "XLSX_TOO_LARGE" }));
  });
});
