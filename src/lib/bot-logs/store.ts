/**
 * Qshop P11 봇 관측 저장소 — 프로젝트별 접근 로그 가져오기.
 * 로그를 올리지 않은 상태는 "연결 안 됨"이며 방문 0회가 아니다(화면에서 구분).
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { expectFound, resourceIdSchema, transactionalMutation } from "@/lib/crud";
import { getDatabase } from "@/lib/db";
import { requireActiveProject } from "@/lib/projects";
import { analyzeAccessLog, botIpsOf } from "./analyze";
import { parseAccessLog } from "./parse";
import { DNS_VERIFIABLE, verifyBotIps, type DnsResolver } from "./verify";

const fileNameSchema = z.string().trim().min(1).max(255);

interface ImportRow {
  id: number; project_id: number; source: string; format: string; file_name: string; content_hash: string;
  period_start: string; period_end: string; offsets: string; lines_total: number; lines_parsed: number; lines_skipped: number;
  ai_bot_hits: number; self_hits: number; other_hits: number; dns_checked: number; imported_at: string;
}

function toImport(row: ImportRow) {
  return {
    id: row.id, source: row.source as "access_log", format: row.format as "combined" | "common", fileName: row.file_name, contentHash: row.content_hash,
    periodStart: row.period_start, periodEnd: row.period_end, offsets: JSON.parse(row.offsets) as string[], dnsChecked: row.dns_checked === 1, importedAt: row.imported_at,
    totals: { lines: row.lines_total, parsed: row.lines_parsed, skipped: row.lines_skipped, aiBot: row.ai_bot_hits, self: row.self_hits, other: row.other_hits },
  };
}
export type BotLogImport = ReturnType<typeof toImport>;

export async function importBotLog(input: { fileName: string; buffer: Buffer; verifyDns?: boolean; resolver?: DnsResolver }) {
  const fileName = fileNameSchema.parse(input.fileName);
  const active = requireActiveProject();
  const contentHash = createHash("sha256").update(input.buffer).digest("hex");
  const { sqlite } = getDatabase();
  const existing = sqlite.prepare("SELECT * FROM bot_log_imports WHERE project_id = ? AND content_hash = ?").get(active.id, contentHash) as ImportRow | undefined;
  if (existing) return { duplicate: true, import: toImport(existing) };

  const parsed = parseAccessLog(input.buffer);
  // DNS 확인은 트랜잭션 밖에서 끝낸다(비동기). 결과는 집계에만 반영하고 IP는 저장하지 않는다
  const verification = input.verifyDns ? await verifyBotIps(botIpsOf(parsed), { resolver: input.resolver }) : new Map();
  const analysis = analyzeAccessLog(parsed, verification);
  return transactionalMutation(sqlite, () => {
    const raced = sqlite.prepare("SELECT * FROM bot_log_imports WHERE project_id = ? AND content_hash = ?").get(active.id, contentHash) as ImportRow | undefined;
    if (raced) return { duplicate: true, import: toImport(raced) };
    const result = sqlite.prepare(`
      INSERT INTO bot_log_imports (project_id, format, file_name, content_hash, period_start, period_end, offsets, lines_total, lines_parsed, lines_skipped, ai_bot_hits, self_hits, other_hits, dns_checked, imported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(active.id, analysis.format, fileName, contentHash, analysis.period.start, analysis.period.end, JSON.stringify(analysis.offsets),
      analysis.totals.lines, analysis.totals.parsed, analysis.totals.skipped, analysis.totals.aiBot, analysis.totals.self, analysis.totals.other,
      input.verifyDns ? 1 : 0, new Date().toISOString());
    const id = Number(result.lastInsertRowid);
    const insertHit = sqlite.prepare("INSERT INTO bot_log_hits (import_id, date, bot_token, operator, purpose, status_class, hits, verified_hits, failed_hits) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const row of analysis.hits) insertHit.run(id, row.date, row.botToken, row.operator, row.purpose, row.statusClass, row.hits, row.verifiedHits, row.failedHits);
    const insertPath = sqlite.prepare("INSERT INTO bot_log_paths (import_id, bot_token, path, hits) VALUES (?, ?, ?, ?)");
    for (const row of analysis.paths) insertPath.run(id, row.botToken, row.path, row.hits);
    return { duplicate: false, import: toImport(sqlite.prepare("SELECT * FROM bot_log_imports WHERE id = ?").get(id) as ImportRow) };
  });
}

export function listBotLogImports(): BotLogImport[] {
  const rows = getDatabase().sqlite.prepare("SELECT * FROM bot_log_imports WHERE project_id = ? ORDER BY imported_at DESC, id DESC").all(requireActiveProject().id) as ImportRow[];
  return rows.map(toImport);
}

function ownedImport(idInput: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const row = expectFound(getDatabase().sqlite.prepare("SELECT * FROM bot_log_imports WHERE id = ?").get(id) as ImportRow | undefined, "가져온 로그를 찾을 수 없습니다.", "BOT_LOG_NOT_FOUND");
  requireActiveProject(row.project_id);
  return row;
}

interface HitRow { date: string; bot_token: string; operator: string; purpose: "search" | "training" | "user"; status_class: string; hits: number; verified_hits: number; failed_hits: number }

export function getBotLogImport(idInput: unknown) {
  const row = ownedImport(idInput);
  const { sqlite } = getDatabase();
  const hits = sqlite.prepare("SELECT * FROM bot_log_hits WHERE import_id = ? ORDER BY date, bot_token, status_class").all(row.id) as HitRow[];
  const bots = new Map<string, { botToken: string; operator: string; purpose: HitRow["purpose"]; dnsVerifiable: boolean; hits: number; verifiedHits: number; failedHits: number; uncheckedHits: number; statusClasses: Record<string, number> }>();
  for (const hit of hits) {
    // DNS 확인 방법이 공식 안내되지 않은 봇은 "미확인"이 아니라 "UA 자기 신고"로 표시하기 위한 구분
    const current = bots.get(hit.bot_token) ?? { botToken: hit.bot_token, operator: hit.operator, purpose: hit.purpose, dnsVerifiable: hit.bot_token in DNS_VERIFIABLE, hits: 0, verifiedHits: 0, failedHits: 0, uncheckedHits: 0, statusClasses: {} };
    bots.set(hit.bot_token, {
      ...current,
      hits: current.hits + hit.hits,
      verifiedHits: current.verifiedHits + hit.verified_hits,
      failedHits: current.failedHits + hit.failed_hits,
      uncheckedHits: current.uncheckedHits + hit.hits - hit.verified_hits - hit.failed_hits,
      statusClasses: { ...current.statusClasses, [hit.status_class]: (current.statusClasses[hit.status_class] ?? 0) + hit.hits },
    });
  }
  const daily = hits.map((hit) => ({ date: hit.date, botToken: hit.bot_token, purpose: hit.purpose, statusClass: hit.status_class, hits: hit.hits }));
  const paths = sqlite.prepare("SELECT bot_token AS botToken, path, hits FROM bot_log_paths WHERE import_id = ? ORDER BY bot_token, hits DESC, path").all(row.id) as Array<{ botToken: string; path: string; hits: number }>;
  return { ...toImport(row), bots: [...bots.values()].sort((a, b) => b.hits - a.hits || a.botToken.localeCompare(b.botToken)), daily, paths };
}

export function deleteBotLogImport(idInput: unknown) {
  const row = ownedImport(idInput);
  getDatabase().sqlite.prepare("DELETE FROM bot_log_imports WHERE id = ?").run(row.id);
}
