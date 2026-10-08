import { load } from "cheerio";
import { unzipSync } from "fflate";
import { AppError } from "@/lib/errors";
import { MAX_GSC_FILE_BYTES, type SearchMetricRow, type SearchPerformanceReport } from "./types";

const invalid = (message: string) => new AppError(message, 422, "INVALID_GSC_EXPORT");
const MAX_XML_BYTES = 20 * 1024 * 1024;
const aliases = [
  ["차트", "Chart"], ["검색어 수", "검색어", "Queries"], ["게시물", "페이지", "Posts", "Pages"],
  ["국가", "Countries"], ["기기", "Devices"], ["검색 노출", "Search appearance"], ["필터", "Filters"],
];

/** Reads only standard, unmodified Search Console .xlsx exports. Never evaluates formulas. */
export function parseGscExcel(input: Uint8Array): SearchPerformanceReport {
  if (!input.length || input.length > MAX_GSC_FILE_BYTES) throw new AppError("Excel 파일은 5MB 이하여야 합니다.", 413, "GSC_FILE_TOO_LARGE");
  if (input[0] !== 0x50 || input[1] !== 0x4b) throw invalid("Search Console에서 내려받은 .xlsx 파일을 선택해 주세요.");
  try {
    let size = 0;
    const names = new Set<string>();
    const files = unzipSync(input, { filter(entry) {
      size += entry.originalSize;
      if (names.has(entry.name) || names.size >= 200 || size > MAX_XML_BYTES || entry.originalSize > MAX_XML_BYTES
        || /(^|\/)\.\.(\/|$)|\\/.test(entry.name)) throw invalid("Excel 압축 구조 또는 크기가 허용 범위를 초과했습니다.");
      names.add(entry.name);
      return entry.name.startsWith("xl/") && /\.(xml|rels)$/.test(entry.name);
    } });
    const xml = (name: string) => {
      if (!files[name]) throw invalid("Excel 보고서 구성 파일을 찾을 수 없습니다.");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(files[name]);
      if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw invalid("허용되지 않는 XML 형식입니다.");
      return load(text, { xml: true });
    };
    const workbook = xml("xl/workbook.xml");
    const rels = xml("xl/_rels/workbook.xml.rels");
    const shared = files["xl/sharedStrings.xml"] ? xml("xl/sharedStrings.xml") : null;
    const strings = shared ? shared("si").toArray().map((el) => shared(el).find("t").text()) : [];
    let totalRows = 0;
    const sheets = new Map<string, string[][]>();
    workbook("sheet").each((_, sheet) => {
      const name = workbook(sheet).attr("name") ?? "";
      if (!aliases.some((values) => values.includes(name))) return;
      const relation = rels("Relationship").toArray().find((el) => rels(el).attr("Id") === workbook(sheet).attr("r:id"));
      if (!relation || rels(relation).attr("TargetMode") === "External") throw invalid("외부 시트 참조는 지원하지 않습니다.");
      const target = rels(relation).attr("Target") ?? "";
      const filename = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
      if (!/^xl\/worksheets\/[^/]+\.xml$/.test(filename)) throw invalid("올바른 보고서 시트 경로가 아닙니다.");
      const $ = xml(filename);
      if ($("f").length) throw invalid("수식이 포함된 파일은 지원하지 않습니다. Search Console 원본을 다시 내려받아 주세요.");
      const rows: string[][] = [];
      $("sheetData > row").each((_, row) => {
        if (++totalRows > 30000) throw invalid("보고서 행 수가 너무 많습니다. 조회 기간을 줄여 주세요.");
        const values: string[] = [];
        $(row).children("c").each((__, cell) => {
          const ref = $(cell).attr("r") ?? "";
          const column = /^([A-Z]+)\d+$/.exec(ref)?.[1];
          if (!column) throw invalid("Excel 셀 위치가 올바르지 않습니다.");
          const index = [...column].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
          if (index > 30) throw invalid("비교 보고서는 지원하지 않습니다. 단일 기간으로 내보내 주세요.");
          const type = $(cell).attr("t");
          const value = $(cell).children("v").text();
          const text = type === "s" ? strings[Number(value)] : type === "inlineStr" ? $(cell).find("t").text() : value;
          if (text === undefined || text.length > 4096 || values[index] !== undefined) throw invalid("Excel 셀 값이 올바르지 않습니다.");
          values[index] = text.trim();
        });
        if (values.some(Boolean)) rows.push(values);
      });
      if (sheets.has(name)) throw invalid("중복된 보고서 시트가 있습니다.");
      sheets.set(name, rows);
    });
    const sheet = (index: number) => aliases[index].map((name) => sheets.get(name)).find(Boolean);
    const chart = sheet(0);
    const filters = sheet(6);
    if (!chart || !filters || !["날짜", "Date"].includes(chart[0]?.[0])) throw invalid("Search Console 실적 보고서의 차트·필터 시트가 필요합니다.");
    const number = (value: string | undefined, optional = false, percent = false): number | null => {
      if (optional && (value === undefined || value === "" || value === "—" || value === "-")) return null;
      const clean = (value ?? "").replaceAll(",", "");
      if (!/^\d+(\.\d+)?%?$/.test(clean) || (!percent && clean.endsWith("%"))) throw invalid("클릭·노출·비율·순위 값이 올바르지 않습니다.");
      const n = Number(clean.replace("%", "")) / (percent && clean.endsWith("%") ? 100 : 1);
      if (!Number.isFinite(n) || n > Number.MAX_SAFE_INTEGER || (percent && n > 1)) throw invalid("지표 값이 허용 범위를 초과했습니다.");
      return n;
    };
    const metrics = (rows: string[][]): SearchMetricRow[] => {
      const head = rows[0] ?? [];
      if (head.length !== 5 || !["클릭수", "Clicks"].includes(head[1]) || !["노출", "노출수", "Impressions"].includes(head[2])
        || head[3] !== "CTR" || !["게재 순위", "게재순위", "Position"].includes(head[4])) throw invalid("지원하지 않는 열 형식입니다. 비교를 해제하고 원본 실적 보고서를 내려받아 주세요.");
      const seen = new Set<string>();
      return rows.slice(1).map((row) => {
        if (!row[0] || row.length > 5 || seen.has(row[0])) throw invalid("보고서에 비어 있거나 중복된 행이 있습니다.");
        seen.add(row[0]);
        const clicks = number(row[1])!;
        const impressions = number(row[2])!;
        const ctr = number(row[3], true, true);
        const position = number(row[4], true);
        if (!Number.isInteger(clicks) || !Number.isInteger(impressions) || (impressions === 0 && clicks > 0)) throw invalid("클릭·노출 집계가 올바르지 않습니다.");
        return { key: row[0], clicks, impressions, ctr: impressions ? ctr : null, position: impressions && position ? position : null };
      });
    };
    const daily = metrics(chart).sort((a, b) => a.key.localeCompare(b.key));
    if (!daily.length || daily.some((row) => !/^\d{4}-\d{2}-\d{2}$/.test(row.key) || new Date(`${row.key}T00:00:00Z`).toISOString().slice(0, 10) !== row.key)) {
      throw invalid("날짜별 데이터가 있는 실적 보고서가 필요합니다.");
    }
    const filterPairs = filters.slice(1).map((row): [string, string] => [row[0] ?? "", row[1] ?? ""]);
    const searchType = filterPairs.find(([name]) => ["검색 유형", "Search type"].includes(name))?.[1];
    if (!searchType) throw invalid("검색 유형 필터를 확인할 수 없습니다.");
    const clicks = daily.reduce((n, row) => n + row.clicks, 0);
    const impressions = daily.reduce((n, row) => n + row.impressions, 0);
    const position = impressions && daily.every((row) => !row.impressions || row.position !== null)
      ? daily.reduce((n, row) => n + (row.position ?? 0) * row.impressions, 0) / impressions : null;
    return {
      periodStart: daily[0].key, periodEnd: daily.at(-1)!.key, timezone: "America/Los_Angeles", searchType,
      filters: filterPairs, daily, tables: aliases.slice(1, 6).flatMap((names, i) => {
        const rows = sheet(i + 1);
        return rows ? [{ name: names[0], rows: metrics(rows) }] : [];
      }),
      totals: { clicks, impressions, ctr: impressions ? clicks / impressions : null, position },
      dataState: impressions ? "measured" : "no_activity",
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw invalid("Excel 파일을 읽지 못했습니다. Search Console에서 원본 .xlsx 파일을 다시 내려받아 주세요.");
  }
}
