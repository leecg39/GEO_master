/**
 * Qshop P13 사업 성과 저장소.
 * - 원천(sourceLabel)마다 따로 집계하고 서로 합치지 않는다
 * - 같은 원천에서 기간이 겹치면 그 날짜를 포함하는 가장 최근 가져오기가 그 날짜 전체를 맡는다
 *   (GA4는 0회 이벤트 행을 생략하므로 행 단위로 덮어쓰면 옛 값이 남는다)
 * - 이벤트의 의미는 사용자가 정의한다. 정의되지 않은 이벤트는 "미분류"로 두고 지표에 넣지 않는다
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { expectFound, resourceIdSchema, transactionalMutation } from "@/lib/crud";
import { getDatabase } from "@/lib/db";
import { requireActiveProject } from "@/lib/projects";
import { parseOutcomeCsv } from "./csv";

export const OUTCOME_KINDS = ["cta_click", "form_submit", "conversion"] as const;
export type OutcomeKind = (typeof OUTCOME_KINDS)[number];

const importSchema = z.object({ fileName: z.string().trim().min(1).max(255), sourceLabel: z.string().trim().min(1).max(80) });
const definitionSchema = z.object({
  eventName: z.string().trim().min(1).max(120),
  kind: z.enum(OUTCOME_KINDS),
  definition: z.string().trim().min(1).max(300),
}).strict();
const eventNameSchema = z.string().trim().min(1).max(120);

interface ImportRow { id: number; project_id: number; source_label: string; file_name: string; content_hash: string; period_start: string; period_end: string; rows_used: number; rows_skipped: number; imported_at: string }

function toImport(row: ImportRow) {
  return { id: row.id, sourceLabel: row.source_label, fileName: row.file_name, periodStart: row.period_start, periodEnd: row.period_end, rowsUsed: row.rows_used, rowsSkipped: row.rows_skipped, importedAt: row.imported_at };
}
export type OutcomeImport = ReturnType<typeof toImport>;

export function importOutcomeCsv(input: { fileName: string; sourceLabel: string; buffer: Buffer }) {
  const meta = importSchema.parse({ fileName: input.fileName, sourceLabel: input.sourceLabel });
  const active = requireActiveProject();
  const contentHash = createHash("sha256").update(input.buffer).digest("hex");
  const parsed = parseOutcomeCsv(input.buffer);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const existing = sqlite.prepare("SELECT * FROM outcome_imports WHERE project_id = ? AND source_label = ? AND content_hash = ?").get(active.id, meta.sourceLabel, contentHash) as ImportRow | undefined;
    const latest = sqlite.prepare("SELECT MAX(imported_at) AS timestamp FROM outcome_imports WHERE project_id = ? AND source_label = ?").get(active.id, meta.sourceLabel) as { timestamp: string | null };
    const importedAt = new Date(Math.max(Date.now(), latest.timestamp ? Date.parse(latest.timestamp) + 1 : 0)).toISOString();
    if (existing) {
      // A repeated upload is the latest report, even after an intervening import.
      sqlite.prepare("UPDATE outcome_imports SET imported_at = ?, file_name = ?, period_start = ?, period_end = ? WHERE id = ?")
        .run(importedAt, meta.fileName, parsed.period.start, parsed.period.end, existing.id);
      return { duplicate: true, import: toImport({ ...existing, imported_at: importedAt, file_name: meta.fileName, period_start: parsed.period.start, period_end: parsed.period.end }) };
    }
    const result = sqlite.prepare(`
      INSERT INTO outcome_imports (project_id, source_label, file_name, content_hash, period_start, period_end, rows_used, rows_skipped, imported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(active.id, meta.sourceLabel, meta.fileName, contentHash, parsed.period.start, parsed.period.end, parsed.counts.used, parsed.counts.skipped, importedAt);
    const id = Number(result.lastInsertRowid);
    const insert = sqlite.prepare("INSERT INTO outcome_events (import_id, date, event_name, path, count) VALUES (?, ?, ?, ?, ?)");
    for (const event of parsed.events) insert.run(id, event.date, event.eventName, event.path, event.count);
    return { duplicate: false, import: toImport(sqlite.prepare("SELECT * FROM outcome_imports WHERE id = ?").get(id) as ImportRow) };
  });
}

export function upsertOutcomeDefinition(input: unknown) {
  const parsed = definitionSchema.parse(input);
  const active = requireActiveProject();
  const updatedAt = new Date().toISOString();
  getDatabase().sqlite.prepare(`
    INSERT INTO outcome_definitions (project_id, event_name, kind, definition, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(project_id, event_name) DO UPDATE SET kind = excluded.kind, definition = excluded.definition, updated_at = excluded.updated_at
  `).run(active.id, parsed.eventName, parsed.kind, parsed.definition, updatedAt);
  return { ...parsed, updatedAt };
}

export function deleteOutcomeDefinition(eventNameInput: unknown) {
  const eventName = eventNameSchema.parse(eventNameInput);
  const result = getDatabase().sqlite.prepare("DELETE FROM outcome_definitions WHERE project_id = ? AND event_name = ?").run(requireActiveProject().id, eventName);
  expectFound(result.changes > 0 ? true : undefined, "지표 정의를 찾을 수 없습니다.", "OUTCOME_DEFINITION_NOT_FOUND");
}

export function deleteOutcomeImport(idInput: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const { sqlite } = getDatabase();
  const row = expectFound(sqlite.prepare("SELECT * FROM outcome_imports WHERE id = ?").get(id) as ImportRow | undefined, "가져온 파일을 찾을 수 없습니다.", "OUTCOME_IMPORT_NOT_FOUND");
  requireActiveProject(row.project_id);
  sqlite.prepare("DELETE FROM outcome_imports WHERE id = ?").run(row.id);
}

interface EffectiveRow { source_label: string; event_name: string; count: number }
interface DefinitionRow { event_name: string; kind: OutcomeKind; definition: string; updated_at: string }

export function getOutcomeSummary() {
  const active = requireActiveProject();
  const { sqlite } = getDatabase();
  const imports = (sqlite.prepare("SELECT * FROM outcome_imports WHERE project_id = ? ORDER BY imported_at DESC, id DESC").all(active.id) as ImportRow[]).map(toImport);
  const definitions = (sqlite.prepare("SELECT * FROM outcome_definitions WHERE project_id = ? ORDER BY event_name").all(active.id) as DefinitionRow[])
    .map((row) => ({ eventName: row.event_name, kind: row.kind, definition: row.definition, updatedAt: row.updated_at }));
  // 날짜별 담당 가져오기: 그 날짜를 기간에 포함하는 가장 최근 가져오기
  const effective = sqlite.prepare(`
    WITH project_imports AS (
      SELECT id, source_label, period_start, period_end, imported_at FROM outcome_imports WHERE project_id = ?
    ), days AS (
      SELECT DISTINCT i.source_label, e.date FROM outcome_events e JOIN project_imports i ON i.id = e.import_id
    ), owners AS (
      SELECT d.source_label, d.date, (
        SELECT i.id FROM project_imports i
        WHERE i.source_label = d.source_label AND d.date BETWEEN i.period_start AND i.period_end
        ORDER BY i.imported_at DESC, i.id DESC LIMIT 1
      ) AS import_id FROM days d
    )
    SELECT o.source_label, e.event_name, SUM(e.count) AS count
    FROM owners o JOIN outcome_events e ON e.import_id = o.import_id AND e.date = o.date
    GROUP BY o.source_label, e.event_name ORDER BY o.source_label, e.event_name
  `).all(active.id) as EffectiveRow[];

  // Keep previously observed, defined events visible as zero after an empty replacement.
  const observed = sqlite.prepare(`
    SELECT DISTINCT i.source_label, e.event_name FROM outcome_events e
    JOIN outcome_imports i ON i.id = e.import_id WHERE i.project_id = ? ORDER BY i.source_label, e.event_name
  `).all(active.id) as Array<{ source_label: string; event_name: string }>;
  const definitionOf = new Map(definitions.map((item) => [item.eventName, item]));
  const labels = [...new Set(imports.map((item) => item.sourceLabel))].sort((a, b) => a.localeCompare(b, "ko"));
  const sources = labels.map((sourceLabel) => {
    const own = imports.filter((item) => item.sourceLabel === sourceLabel);
    const rows = effective.filter((row) => row.source_label === sourceLabel);
    const metrics = OUTCOME_KINDS.map((kind) => {
      const events = observed.filter((row) => row.source_label === sourceLabel && definitionOf.get(row.event_name)?.kind === kind)
        .map((row) => ({ eventName: row.event_name, definition: definitionOf.get(row.event_name)!.definition, count: rows.find((effective) => effective.event_name === row.event_name)?.count ?? 0 }));
      return { kind, count: events.reduce((sum, event) => sum + event.count, 0), events };
    }).filter((metric) => metric.events.length > 0);
    return {
      sourceLabel,
      periodStart: own.map((item) => item.periodStart).sort()[0]!,
      periodEnd: own.map((item) => item.periodEnd).sort().at(-1)!,
      importCount: own.length,
      lastImportedAt: own[0]!.importedAt,
      metrics,
      unmapped: rows.filter((row) => !definitionOf.has(row.event_name)).map((row) => ({ eventName: row.event_name, count: row.count })),
    };
  });
  return { sources, imports, definitions };
}
export type OutcomeSummary = ReturnType<typeof getOutcomeSummary>;
