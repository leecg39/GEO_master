/**
 * Qshop P13 — 사업 성과 이벤트 집계 CSV(GA4 보고서 내보내기 등)를 읽는다.
 * 일자 × 이벤트 이름 × (선택) 페이지 경로 × 횟수만 받는다. 클릭·폼 제출·전환 구분은 사용자가 정의한다(definitions).
 */
import { AppError } from "@/lib/errors";
import { sanitizePath } from "@/lib/path-privacy";

export const MAX_OUTCOME_CSV_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 200_000;
const HEADERS = {
  date: ["date", "날짜", "일자", "day"],
  event: ["event name", "이벤트 이름", "event_name", "event", "이벤트"],
  count: ["event count", "이벤트 수", "event_count", "count", "events", "횟수"],
  path: ["page path", "페이지 경로", "page_path", "page path and screen class", "페이지 경로 및 화면 클래스", "path", "landing page", "방문 페이지"],
} as const;

export interface OutcomeEventRow { date: string; eventName: string; path: string; count: number }
export interface ParsedOutcomeCsv {
  events: OutcomeEventRow[];
  period: { start: string; end: string };
  counts: { rows: number; used: number; skipped: number };
}

const fail = (code: string, message: string, status = 422): never => { throw new AppError(message, status, code); };
const norm = (value: string) => value.trim().toLowerCase();

/** RFC 4180 수준의 CSV 해석(따옴표 안 쉼표·줄바꿈·"" 이스케이프). 각 레코드의 시작 줄 번호를 함께 돌려준다 */
function parseCsv(text: string): Array<{ line: number; cells: string[] }> {
  const records: Array<{ line: number; cells: string[] }> = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else { if (ch === "\n") line += 1; cell += ch; }
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { cells.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      cells.push(cell);
      records.push({ line: recordLine, cells });
      cells = []; cell = ""; line += 1; recordLine = line;
    } else cell += ch;
  }
  if (cell || cells.length) { cells.push(cell); records.push({ line: recordLine, cells }); }
  return records;
}

function parseDate(raw: string): string | null {
  const value = raw.trim();
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value) ?? /^(\d{4})[-/.]\s?(\d{1,2})[-/.]\s?(\d{1,2})\.?$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseCount(raw: string): number | null {
  const value = raw.trim().replace(/,/g, "");
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
}

export function parseOutcomeCsv(buffer: Buffer): ParsedOutcomeCsv {
  if (buffer.length > MAX_OUTCOME_CSV_BYTES) fail("OUTCOME_TOO_LARGE", "CSV는 5MB 이하만 올릴 수 있습니다. 기간을 나눠 내보내 주세요.", 413);
  const text = buffer.toString("utf8").replace(/^﻿/, "");
  const allRecords = parseCsv(text);
  const range: { start?: string; end?: string } = {};
  for (const { cells } of allRecords) {
    const metadata = cells.join(",").trim();
    const match = /^#\s*(Start date|End date|시작 날짜|종료 날짜)\s*:\s*(.*?)\s*$/i.exec(metadata);
    if (!match) continue;
    const key = /^(start date|시작 날짜)$/i.test(match[1]!) ? "start" : "end";
    const date = parseDate(match[2]!);
    if (!date || (range[key] && range[key] !== date)) fail("OUTCOME_INVALID_PERIOD", "보고서의 시작·종료 날짜가 잘못되었거나 서로 충돌합니다.");
    range[key] = date!;
  }
  if ((range.start || range.end) && (!range.start || !range.end || range.start > range.end)) {
    fail("OUTCOME_INVALID_PERIOD", "보고서의 시작·종료 날짜를 모두 올바른 순서로 지정해 주세요.");
  }
  // 기간을 읽은 뒤 GA4 메타데이터와 빈 줄을 제외한다.
  const records = allRecords.filter(({ cells }) => !(cells.length === 1 && !cells[0]!.trim()) && !cells[0]!.trim().startsWith("#"));
  const headerIndex = records.findIndex(({ cells }) => {
    const names = cells.map(norm);
    return names.some((name) => (HEADERS.date as readonly string[]).includes(name))
      && names.some((name) => (HEADERS.event as readonly string[]).includes(name))
      && names.some((name) => (HEADERS.count as readonly string[]).includes(name));
  });
  if (headerIndex < 0) fail("OUTCOME_HEADER_NOT_FOUND", "날짜·이벤트 이름·이벤트 수 열이 있는 머리글을 찾지 못했습니다.");
  const header = records[headerIndex]!.cells.map(norm);
  const column = (aliases: readonly string[]) => header.findIndex((name) => aliases.includes(name));
  const [dateCol, eventCol, countCol, pathCol] = [column(HEADERS.date), column(HEADERS.event), column(HEADERS.count), column(HEADERS.path)];
  const rows = records.slice(headerIndex + 1);
  if (rows.length > MAX_ROWS) fail("OUTCOME_TOO_LARGE", `행이 ${MAX_ROWS.toLocaleString("ko-KR")}개를 넘습니다. 기간을 나눠 내보내 주세요.`, 413);

  const totals = new Map<string, OutcomeEventRow>();
  let used = 0;
  let skipped = 0;
  for (const { line, cells } of rows) {
    const rawDate = (cells[dateCol] ?? "").trim();
    // 날짜가 빈 행은 보고서의 총계 행이다(이중 집계 방지)
    if (!rawDate) { skipped += 1; continue; }
    const date = parseDate(rawDate);
    const eventName = (cells[eventCol] ?? "").trim();
    const count = parseCount(cells[countCol] ?? "");
    if (!date || !eventName || eventName.length > 120 || count === null) {
      fail("OUTCOME_INVALID_ROW", `${line}행: 날짜(${rawDate || "빈 값"})·이벤트 이름·0 이상의 정수 이벤트 수를 확인해 주세요.`);
    }
    if (range.start && range.end && (date! < range.start || date! > range.end)) {
      fail("OUTCOME_INVALID_PERIOD", `${line}행: 이벤트 날짜가 보고서 기간 밖에 있습니다.`);
    }
    const path = pathCol >= 0 ? sanitizePath(cells[pathCol] ?? "") : "";
    const key = `${date}\u0000${eventName}\u0000${path}`;
    const current = totals.get(key);
    totals.set(key, { date: date!, eventName, path, count: (current?.count ?? 0) + count! });
    used += 1;
  }
  if (used === 0 && !range.start) fail("OUTCOME_EMPTY", "가져올 이벤트 행이 없습니다.");
  const events = [...totals.values()].sort((a, b) => a.date.localeCompare(b.date) || a.eventName.localeCompare(b.eventName) || a.path.localeCompare(b.path));
  return { events, period: { start: range.start ?? events[0]!.date, end: range.end ?? events.at(-1)!.date }, counts: { rows: rows.length, used, skipped } };
}
