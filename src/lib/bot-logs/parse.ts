/**
 * Qshop P11 — 서버 접근 로그(Nginx/Apache combined 형식, gzip 가능)를 읽는다.
 * 원본의 날짜·시간대 오프셋을 그대로 쓰고, 쿼리스트링은 버린다(개인정보·집계 안정성).
 */
import { Gunzip } from "fflate";
import { AppError } from "@/lib/errors";

export const MAX_LOG_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_LOG_TEXT_BYTES = 50 * 1024 * 1024;
const MAX_LOG_LINES = 500_000;
const MAX_PATH_LENGTH = 300;
const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
const QUOTED = '"((?:[^"\\\\]|\\\\.)*)"';
const LINE = new RegExp(`^(\\S+) \\S+ \\S+ \\[(\\d{2})/([A-Za-z]{3})/(\\d{4}):\\d{2}:\\d{2}:\\d{2} ([+-]\\d{4})\\] ${QUOTED} (\\d{3}) \\S+(?: ${QUOTED} ${QUOTED})?`);

export interface LogEntry {
  ip: string;
  /** 로그에 적힌 현지 날짜(YYYY-MM-DD) */
  date: string;
  offset: string;
  method: string;
  path: string;
  status: number;
  userAgent: string;
}

export interface ParsedAccessLog {
  format: "combined" | "common";
  entries: LogEntry[];
  counts: { lines: number; parsed: number; skipped: number };
  offsets: string[];
}

const fail = (code: string, message: string, status = 422): never => { throw new AppError(message, status, code); };
const unescape = (value: string) => value.replace(/\\(["\\])/g, "$1");

function gunzipLimited(input: Uint8Array) {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const stream = new Gunzip((chunk) => {
    total += chunk.length;
    if (total > MAX_LOG_TEXT_BYTES) fail("LOG_TOO_LARGE", "압축을 푼 로그가 50MB를 넘습니다. 기간을 나눠 올려 주세요.", 413);
    chunks.push(chunk);
  });
  try {
    for (let offset = 0; offset < input.length; offset += 64 * 1024) {
      stream.push(input.subarray(offset, offset + 64 * 1024), offset + 64 * 1024 >= input.length);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    fail("LOG_INVALID", "gzip 로그를 풀지 못했습니다. 파일이 손상되었는지 확인해 주세요.");
  }
  return Buffer.concat(chunks, total);
}

/** 재설정 링크·세션 ID처럼 보이는 경로 조각(긴 영숫자 토큰, 16진수/UUID)은 저장하지 않는다 */
function maskSegment(segment: string) {
  return /^[A-Za-z0-9_]{20,}$/.test(segment) || /^[0-9a-f-]{32,}$/i.test(segment) ? ":id" : segment;
}

function validDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function pathOf(target: string) {
  let path = target;
  if (/^https?:\/\//i.test(path)) {
    try { path = new URL(path).pathname; } catch { path = "/"; }
  }
  path = path.split(/[?#]/)[0] ?? "";
  return path.split("/").map(maskSegment).join("/").slice(0, MAX_PATH_LENGTH);
}

function parseLine(text: string): LogEntry | null {
  const match = LINE.exec(text);
  if (!match) return null;
  const [, ip, day, monthName, year, offset, request, status, , userAgent] = match;
  const month = MONTHS[monthName!.toLowerCase()];
  if (!month || !validDate(Number(year), Number(month), Number(day))) return null;
  const requestParts = /^(\S+) (\S+)(?: \S+)?$/.exec(unescape(request!));
  return {
    ip: ip!,
    date: `${year}-${month}-${day}`,
    offset: offset!,
    method: requestParts?.[1] ?? "-",
    path: requestParts ? pathOf(requestParts[2]!) : "",
    status: Number(status),
    userAgent: userAgent === undefined ? "" : unescape(userAgent),
  };
}

/** 로그 파일(평문 또는 gzip)을 줄 단위로 해석한다. 해석하지 못한 줄은 건너뛰고 개수를 남긴다 */
export function parseAccessLog(buffer: Buffer): ParsedAccessLog {
  if (buffer.length === 0) fail("LOG_EMPTY", "빈 파일입니다.");
  if (buffer.length > MAX_LOG_INPUT_BYTES) fail("LOG_TOO_LARGE", "로그 파일은 10MB(gzip 포함) 이하만 올릴 수 있습니다.", 413);
  const raw = buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipLimited(buffer) : buffer;
  if (raw.length > MAX_LOG_TEXT_BYTES) fail("LOG_TOO_LARGE", "로그가 50MB를 넘습니다. 기간을 나눠 올려 주세요.", 413);
  const lines = raw.toString("utf8").split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length > MAX_LOG_LINES) fail("LOG_TOO_LARGE", `로그가 ${MAX_LOG_LINES.toLocaleString("ko-KR")}줄을 넘습니다. 기간을 나눠 올려 주세요.`, 413);

  const entries: LogEntry[] = [];
  const offsets = new Set<string>();
  for (const text of lines) {
    const entry = parseLine(text);
    if (!entry) continue;
    entries.push(entry);
    offsets.add(entry.offset);
  }
  if (entries.length === 0) fail("LOG_UNRECOGNIZED", "Nginx/Apache 접근 로그(combined 형식)로 해석할 수 있는 줄이 없습니다.");
  return {
    format: entries.some((entry) => entry.userAgent) ? "combined" : "common",
    entries,
    counts: { lines: lines.length, parsed: entries.length, skipped: lines.length - entries.length },
    offsets: [...offsets].sort(),
  };
}
