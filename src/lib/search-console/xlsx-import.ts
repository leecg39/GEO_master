/**
 * Search Console 성과 보고서 Excel 내보내기 파서 (Qshop P10 대안 경로).
 * 공개 API가 SNS 플랫폼 속성을 노출하지 않을 때 콘솔에서 내려받은 파일을 가져온다.
 * - 신뢰할 수 없는 업로드: 입력·해제 크기와 행 수를 제한하고, 형식이 어긋나면 일부만 읽지 않고 거부한다
 * - 0과 N/A를 구분한다: 비어 있는 CTR·순위는 null이며, 노출이 0이면 hasData=false로 표시한다
 */
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { AppError } from "@/lib/errors";

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 20 * 1024 * 1024;
const MAX_ROWS_PER_SHEET = 10_000;

export interface MetricRow { clicks: number; impressions: number; ctr: number | null; position: number | null }
export interface DailyRow extends MetricRow { date: string }
export interface DimensionRow extends MetricRow { key: string }
export type DimensionKind = "queries" | "pages" | "countries" | "devices" | "appearances";

export interface ParsedConsoleExport {
  daily: DailyRow[];
  dimensions: Record<DimensionKind, DimensionRow[]>;
  filters: Record<string, string>;
  period: { start: string; end: string } | null;
  totals: MetricRow;
  /** 노출이 하나라도 있으면 true. 모두 0이면 "성과 0"인지 "아직 데이터 없음"인지 구분할 수 없다 */
  hasData: boolean;
  contentHash: string;
}

const HEADERS = {
  date: ["날짜", "date"], clicks: ["클릭수", "클릭", "clicks"], impressions: ["노출", "노출수", "impressions"],
  ctr: ["ctr"], position: ["게재 순위", "평균 게재순위", "position", "average position"],
};
/** 첫 열 헤더 → 차원 종류 */
const DIMENSION_HEADERS: Array<[DimensionKind, string[]]> = [
  ["queries", ["인기 검색어", "검색어", "top queries", "queries"]],
  ["pages", ["인기 게시물", "인기 페이지", "게시물", "페이지", "top pages", "pages", "posts"]],
  ["countries", ["국가", "countries", "country"]],
  ["devices", ["기기", "devices", "device"]],
  ["appearances", ["검색 노출", "검색 결과 디자인", "search appearance"]],
];

const fail = (code: string, message: string): never => { throw new AppError(message, 422, code); };
const norm = (value: string) => value.trim().toLowerCase();

function decodeXml(text: string) {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function textOf(xml: string) {
  return decodeXml([...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((match) => match[1]).join(""));
}

function readSheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= MAX_ROWS_PER_SHEET) fail("XLSX_TOO_LARGE", `시트의 행이 ${MAX_ROWS_PER_SHEET}개를 넘습니다.`);
    const cells: string[] = [];
    for (const cell of rowMatch[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1]!;
      const body = cell[2] ?? "";
      const type = /\bt="([^"]*)"/.exec(attrs)?.[1];
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const index = ref ? [...ref].reduce((sum, ch) => sum * 26 + ch.charCodeAt(0) - 64, 0) - 1 : cells.length;
      while (cells.length < index) cells.push("");
      if (type === "s") cells.push(shared[Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1])] ?? "");
      else if (type === "inlineStr") cells.push(textOf(body));
      else cells.push(decodeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? ""));
    }
    rows.push(cells);
  }
  return rows;
}

function unzipSafely(buffer: Buffer) {
  if (buffer.length > MAX_INPUT_BYTES) fail("XLSX_TOO_LARGE", "파일이 너무 큽니다(2MB 이하만 가져올 수 있습니다).");
  let total = 0;
  try {
    return unzipSync(new Uint8Array(buffer), {
      filter: (file) => {
        total += file.originalSize;
        if (total > MAX_UNZIPPED_BYTES) throw new AppError("압축을 풀면 너무 큰 파일입니다.", 422, "XLSX_TOO_LARGE");
        return /^xl\/(workbook\.xml|sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(file.name);
      },
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    return fail("XLSX_INVALID", "xlsx 파일이 아닙니다. 콘솔에서 내려받은 Excel 파일을 올려 주세요.");
  }
}

function metricIndexes(header: string[]) {
  const find = (names: string[]) => header.findIndex((cell) => names.includes(norm(cell)));
  return { clicks: find(HEADERS.clicks), impressions: find(HEADERS.impressions), ctr: find(HEADERS.ctr), position: find(HEADERS.position) };
}

function parseNumber(raw: string | undefined, row: number, label: string): number | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const percent = value.endsWith("%");
  const number = Number(percent ? value.slice(0, -1).replace(/,/g, "") : value.replace(/,/g, ""));
  if (!Number.isFinite(number) || number < 0) return fail("XLSX_INVALID_ROW", `${row}행의 ${label} 값이 올바르지 않습니다: ${value}`);
  return percent ? number / 100 : number;
}

function toMetrics(cells: string[], indexes: ReturnType<typeof metricIndexes>, row: number): MetricRow {
  const clicks = parseNumber(cells[indexes.clicks], row, "클릭수") ?? 0;
  const impressions = parseNumber(cells[indexes.impressions], row, "노출") ?? 0;
  const ctr = indexes.ctr >= 0 ? parseNumber(cells[indexes.ctr], row, "CTR") : null;
  const position = indexes.position >= 0 ? parseNumber(cells[indexes.position], row, "게재 순위") : null;
  if (clicks > impressions) fail("XLSX_INVALID_ROW", `${row}행의 클릭수(${clicks})가 노출(${impressions})보다 많습니다.`);
  if (ctr !== null && ctr > 1) fail("XLSX_INVALID_ROW", `${row}행의 CTR이 100%를 넘습니다.`);
  return { clicks, impressions, ctr, position };
}

function totalsOf(daily: DailyRow[]): MetricRow {
  const clicks = daily.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = daily.reduce((sum, row) => sum + row.impressions, 0);
  const weighted = daily.filter((row) => row.position !== null && row.impressions > 0);
  const weight = weighted.reduce((sum, row) => sum + row.impressions, 0);
  return {
    clicks, impressions,
    ctr: impressions > 0 ? clicks / impressions : null,
    position: weight > 0 ? weighted.reduce((sum, row) => sum + row.position! * row.impressions, 0) / weight : null,
  };
}

export function parseConsoleExport(buffer: Buffer): ParsedConsoleExport {
  const files = unzipSafely(buffer);
  const workbookXml = files["xl/workbook.xml"];
  if (!workbookXml) fail("XLSX_INVALID", "xlsx 구조를 읽을 수 없습니다(workbook.xml 없음).");
  const decoder = new TextDecoder();
  const sharedXml = files["xl/sharedStrings.xml"];
  const shared = sharedXml ? [...decoder.decode(sharedXml).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => textOf(match[1]!)) : [];
  const names = [...decoder.decode(workbookXml!).matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((match) => decodeXml(match[1]!));

  const sheets = names.map((name, i) => {
    const xml = files[`xl/worksheets/sheet${i + 1}.xml`];
    return { name, rows: xml ? readSheetRows(decoder.decode(xml), shared) : [] };
  });

  const dailySheet = sheets.find((sheet) => HEADERS.date.includes(norm(sheet.rows[0]?.[0] ?? "")));
  if (!dailySheet) fail("XLSX_NO_DAILY_SHEET", "날짜별 성과 시트(차트)를 찾지 못했습니다. 콘솔의 실적 보고서에서 내려받은 파일이 맞는지 확인하세요.");
  const dailyIndexes = metricIndexes(dailySheet!.rows[0]!);
  if (dailyIndexes.clicks < 0 || dailyIndexes.impressions < 0) fail("XLSX_NO_DAILY_SHEET", "날짜별 시트에 클릭수·노출 열이 없습니다.");
  const daily: DailyRow[] = dailySheet!.rows.slice(1).filter((cells) => cells.some((cell) => cell.trim())).map((cells, i) => {
    const date = (cells[0] ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) fail("XLSX_INVALID_ROW", `${i + 2}행의 날짜가 올바르지 않습니다: ${date}`);
    return { date, ...toMetrics(cells, dailyIndexes, i + 2) };
  });

  const dimensions: Record<DimensionKind, DimensionRow[]> = { queries: [], pages: [], countries: [], devices: [], appearances: [] };
  for (const sheet of sheets) {
    if (sheet === dailySheet) continue;
    const first = norm(sheet.rows[0]?.[0] ?? "");
    const kind = DIMENSION_HEADERS.find(([, names]) => names.includes(first))?.[0];
    if (!kind) continue;
    const indexes = metricIndexes(sheet.rows[0]!);
    if (indexes.clicks < 0 || indexes.impressions < 0) continue;
    dimensions[kind] = sheet.rows.slice(1).filter((cells) => (cells[0] ?? "").trim()).map((cells, i) => ({ key: cells[0]!.trim(), ...toMetrics(cells, indexes, i + 2) }));
  }

  const filterSheet = sheets.find((sheet) => ["필터", "filters"].includes(norm(sheet.rows[0]?.[0] ?? "")));
  const filters = Object.fromEntries((filterSheet?.rows.slice(1) ?? []).filter((cells) => cells[0]).map((cells) => [cells[0]!.trim(), (cells[1] ?? "").trim()]));

  const dates = daily.map((row) => row.date).sort();
  const totals = totalsOf(daily);
  return {
    daily, dimensions, filters,
    period: dates.length ? { start: dates[0]!, end: dates.at(-1)! } : null,
    totals,
    hasData: totals.impressions > 0,
    contentHash: createHash("sha256").update(buffer).digest("hex"),
  };
}
