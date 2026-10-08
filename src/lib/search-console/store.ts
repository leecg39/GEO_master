/** 콘솔 내보내기 가져오기 저장소 — 프로젝트별, 속성 이름은 사용자가 직접 지정(파일 안에는 속성 이름이 없다) */
import { z } from "zod";
import { resourceIdSchema, expectFound, transactionalMutation } from "@/lib/crud";
import { getDatabase } from "@/lib/db";
import { requireActiveProject } from "@/lib/projects";
import { parseConsoleExport, type DimensionKind, type DimensionRow } from "./xlsx-import";

const importSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  propertyLabel: z.string().trim().min(1).max(120),
});

interface ImportRow {
  id: number; project_id: number; source: string; property_label: string; file_name: string; content_hash: string;
  period_start: string | null; period_end: string | null; filters: string; clicks: number; impressions: number;
  ctr: number | null; position: number | null; has_data: number; imported_at: string;
}

function toImport(row: ImportRow) {
  return {
    id: row.id, source: row.source as "console_export", propertyLabel: row.property_label, fileName: row.file_name, contentHash: row.content_hash,
    periodStart: row.period_start, periodEnd: row.period_end, hasData: row.has_data === 1, importedAt: row.imported_at,
    totals: { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position },
  };
}
export type ConsoleImport = ReturnType<typeof toImport>;

const NO_DATA_WARNING = "내보낸 기간의 노출이 0입니다. 성과가 0인지 아직 데이터가 쌓이지 않은 것인지 이 파일만으로는 구분할 수 없습니다. 신규 속성은 데이터가 쌓이기까지 며칠 걸릴 수 있습니다.";

export function importConsoleExport(input: { fileName: string; propertyLabel: string; buffer: Buffer }) {
  const meta = importSchema.parse({ fileName: input.fileName, propertyLabel: input.propertyLabel });
  const parsed = parseConsoleExport(input.buffer);
  const active = requireActiveProject();
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const existing = sqlite.prepare("SELECT * FROM search_console_imports WHERE project_id = ? AND property_label = ? AND content_hash = ?")
      .get(active.id, meta.propertyLabel, parsed.contentHash) as ImportRow | undefined;
    if (existing) return { duplicate: true, import: toImport(existing), warning: existing.has_data ? null : NO_DATA_WARNING };
    const result = sqlite.prepare(`
      INSERT INTO search_console_imports (project_id, property_label, file_name, content_hash, period_start, period_end, filters, clicks, impressions, ctr, position, has_data, imported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(active.id, meta.propertyLabel, meta.fileName, parsed.contentHash, parsed.period?.start ?? null, parsed.period?.end ?? null, JSON.stringify(parsed.filters),
      parsed.totals.clicks, parsed.totals.impressions, parsed.totals.ctr, parsed.totals.position, parsed.hasData ? 1 : 0, new Date().toISOString());
    const id = Number(result.lastInsertRowid);
    const insertDaily = sqlite.prepare("INSERT INTO search_console_daily (import_id, date, clicks, impressions, ctr, position) VALUES (?, ?, ?, ?, ?, ?)");
    for (const row of parsed.daily) insertDaily.run(id, row.date, row.clicks, row.impressions, row.ctr, row.position);
    const insertRow = sqlite.prepare("INSERT INTO search_console_rows (import_id, kind, key, clicks, impressions, ctr, position) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const [kind, rows] of Object.entries(parsed.dimensions) as Array<[DimensionKind, DimensionRow[]]>) {
      for (const row of rows) insertRow.run(id, kind, row.key, row.clicks, row.impressions, row.ctr, row.position);
    }
    return { duplicate: false, import: toImport(sqlite.prepare("SELECT * FROM search_console_imports WHERE id = ?").get(id) as ImportRow), warning: parsed.hasData ? null : NO_DATA_WARNING };
  });
}

export function listConsoleImports(): ConsoleImport[] {
  const rows = getDatabase().sqlite.prepare("SELECT * FROM search_console_imports WHERE project_id = ? ORDER BY imported_at DESC, id DESC").all(requireActiveProject().id) as ImportRow[];
  return rows.map(toImport);
}

function ownedImport(idInput: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const row = expectFound(getDatabase().sqlite.prepare("SELECT * FROM search_console_imports WHERE id = ?").get(id) as ImportRow | undefined, "가져온 보고서를 찾을 수 없습니다.", "SC_IMPORT_NOT_FOUND");
  requireActiveProject(row.project_id);
  return row;
}

export function getConsoleImport(idInput: unknown) {
  const row = ownedImport(idInput);
  const { sqlite } = getDatabase();
  const daily = sqlite.prepare("SELECT date, clicks, impressions, ctr, position FROM search_console_daily WHERE import_id = ? ORDER BY date").all(row.id);
  const dimensions: Record<DimensionKind, DimensionRow[]> = { queries: [], pages: [], countries: [], devices: [], appearances: [] };
  const rows = sqlite.prepare("SELECT kind, key, clicks, impressions, ctr, position FROM search_console_rows WHERE import_id = ? ORDER BY id").all(row.id) as Array<DimensionRow & { kind: DimensionKind }>;
  for (const { kind, ...rest } of rows) dimensions[kind].push(rest);
  return { ...toImport(row), daily, dimensions, filters: JSON.parse(row.filters) as Record<string, string> };
}

export function deleteConsoleImport(idInput: unknown) {
  const row = ownedImport(idInput);
  getDatabase().sqlite.prepare("DELETE FROM search_console_imports WHERE id = ?").run(row.id);
}
