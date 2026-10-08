import { classifyUserAgent } from "./classify";
import type { ParsedAccessLog } from "./parse";
import type { VerificationState } from "./verify";

export interface BotHitRow {
  date: string;
  botToken: string;
  operator: string;
  purpose: "search" | "training" | "user";
  statusClass: string;
  hits: number;
  verifiedHits: number;
  failedHits: number;
}

export interface BotPathRow { botToken: string; path: string; hits: number }

export interface AccessLogAnalysis {
  format: ParsedAccessLog["format"];
  offsets: string[];
  period: { start: string; end: string };
  totals: { lines: number; parsed: number; skipped: number; aiBot: number; self: number; other: number };
  hits: BotHitRow[];
  paths: BotPathRow[];
}

/** 봇별 고유 IP 목록(검증 입력). 결과에는 IP를 남기지 않는다. 큰 로그에서 O(n)이 되도록 지역 Set에 모은다 */
export function botIpsOf(parsed: ParsedAccessLog): Map<string, string[]> {
  const ips = new Map<string, Set<string>>();
  for (const entry of parsed.entries) {
    const kind = classifyUserAgent(entry.userAgent);
    if (kind.kind !== "ai_bot") continue;
    const set = ips.get(kind.bot.token) ?? new Set<string>();
    set.add(entry.ip);
    ips.set(kind.bot.token, set);
  }
  return new Map([...ips].map(([token, set]) => [token, [...set]]));
}

/** 일자 × 봇 × 상태 대역 집계와 봇별 상위 경로. IP·쿼리스트링은 결과에 담지 않는다 */
export function analyzeAccessLog(parsed: ParsedAccessLog, verification: ReadonlyMap<string, VerificationState>, { topPaths = 20 } = {}): AccessLogAnalysis {
  const hits = new Map<string, BotHitRow>();
  const paths = new Map<string, Map<string, number>>();
  const totals = { ...parsed.counts, aiBot: 0, self: 0, other: 0 };
  const dates: string[] = [];
  for (const entry of parsed.entries) {
    dates.push(entry.date);
    const kind = classifyUserAgent(entry.userAgent);
    if (kind.kind !== "ai_bot") { totals[kind.kind] += 1; continue; }
    totals.aiBot += 1;
    const statusClass = `${Math.floor(entry.status / 100)}xx`;
    const key = `${entry.date}|${kind.bot.token}|${statusClass}`;
    const row = hits.get(key) ?? { date: entry.date, botToken: kind.bot.token, operator: kind.bot.operator, purpose: kind.bot.purpose, statusClass, hits: 0, verifiedHits: 0, failedHits: 0 };
    const state = verification.get(`${kind.bot.token}|${entry.ip}`);
    hits.set(key, { ...row, hits: row.hits + 1, verifiedHits: row.verifiedHits + (state === "verified" ? 1 : 0), failedHits: row.failedHits + (state === "failed" ? 1 : 0) });
    const botPaths = paths.get(kind.bot.token) ?? new Map<string, number>();
    botPaths.set(entry.path, (botPaths.get(entry.path) ?? 0) + 1);
    paths.set(kind.bot.token, botPaths);
  }
  const sortedDates = [...dates].sort();
  return {
    format: parsed.format,
    offsets: parsed.offsets,
    period: { start: sortedDates[0]!, end: sortedDates.at(-1)! },
    totals,
    hits: [...hits.values()].sort((a, b) => a.date.localeCompare(b.date) || a.botToken.localeCompare(b.botToken) || a.statusClass.localeCompare(b.statusClass)),
    paths: [...paths].flatMap(([botToken, counts]) => [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, topPaths)
      .map(([path, count]) => ({ botToken, path, hits: count }))),
  };
}
