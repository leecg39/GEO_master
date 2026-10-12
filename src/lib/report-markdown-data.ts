/**
 * 진단 Markdown 보고서의 입력을 DB에서 모은다 (R01).
 * 허용된 필드만 골라 담는다. audits.metadata(엔진 설정 등)는 finalUrl 외에는 읽지 않는다.
 */
import { getDatabase } from "./db";
import type { AuditMarkdownFinding, AuditMarkdownInput } from "./report-markdown";
import type { AuditReport } from "./reports";

const TIERS = new Set(["technical", "recommendation", "hypothesis"]);
const SEVERITIES = new Set(["error", "warning", "notice"]);

function parseFindings(json: string): AuditMarkdownFinding[] {
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const record = item as Record<string, unknown>;
      if (typeof record.code !== "string" || !TIERS.has(String(record.tier)) || !SEVERITIES.has(String(record.severity))) return [];
      return [{
        code: record.code, tier: record.tier as AuditMarkdownFinding["tier"], severity: record.severity as AuditMarkdownFinding["severity"],
        passed: record.passed === true, label: String(record.label ?? ""), detail: String(record.detail ?? ""),
        evidence: typeof record.evidence === "string" ? record.evidence : null,
      }];
    });
  } catch {
    return [];
  }
}

interface SnapshotRow { captured_at: string; render_mode: string; parser_version: string; rules_version: string; skipped_reason: string | null; findings: string }
interface ChangeRow { id: number; field: string; status: string; proposed_value: string; updated_at: string }

export function buildAuditMarkdownInput(report: AuditReport): AuditMarkdownInput {
  const { sqlite } = getDatabase();
  const { audit } = report;
  const finalUrl = typeof audit.metadata.finalUrl === "string" ? audit.metadata.finalUrl : null;
  const urls = [...new Set([audit.url, finalUrl].filter((url): url is string => Boolean(url)))];
  const marks = urls.map(() => "?").join(", ");
  const projectId = (sqlite.prepare("SELECT project_id FROM audits WHERE id = ?").get(audit.id) as { project_id: number | null } | undefined)?.project_id ?? null;
  const snapshot = projectId === null ? undefined : sqlite.prepare(`
    SELECT captured_at, render_mode, parser_version, rules_version, skipped_reason, findings FROM page_snapshots
    WHERE project_id = ? AND url IN (${marks}) ORDER BY captured_at DESC, id DESC LIMIT 1
  `).get(projectId, ...urls) as SnapshotRow | undefined;
  const changes = projectId === null ? [] : sqlite.prepare(`
    SELECT id, field, status, proposed_value, updated_at FROM change_items WHERE project_id = ? AND url IN (${marks}) ORDER BY id
  `).all(projectId, ...urls) as ChangeRow[];
  return {
    generatedAt: report.generatedAt,
    audit: {
      id: audit.id, url: audit.url, finalUrl, score: audit.score, total: audit.total, grade: audit.grade, createdAt: audit.createdAt,
      categories: audit.categories,
      items: audit.items.map(({ code, category, label, passed, manual, detail, recommendation }) => ({ code, category, label, passed, manual, detail, recommendation })),
    },
    snapshot: snapshot ? {
      capturedAt: snapshot.captured_at, renderMode: snapshot.render_mode, parserVersion: snapshot.parser_version,
      rulesVersion: snapshot.rules_version, skipped: snapshot.skipped_reason, findings: parseFindings(snapshot.findings),
    } : null,
    changes: changes.map((row) => ({ id: row.id, field: row.field, status: row.status, proposedValue: row.proposed_value, updatedAt: row.updated_at })),
  };
}
