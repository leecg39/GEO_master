import { createHash } from "node:crypto";
import { z } from "zod";
import { getDatabase } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { requireActiveProject } from "@/lib/projects";
import { getRequestAccount } from "@/lib/request-account";
import { parseGscExcel } from "./excel";
import { MAX_GSC_FILE_BYTES, type SearchPerformanceImport, type SearchPerformanceReport } from "./types";

const importSchema = z.object({
  projectId: z.number().int().positive(),
  propertyUrl: z.string().trim().url().max(500),
  filename: z.string().trim().min(1).max(240).regex(/\.xlsx$/i),
  base64: z.string().min(4).max(Math.ceil(MAX_GSC_FILE_BYTES / 3) * 4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
}).strict();

interface ImportRow {
  id: number; property_url: string; platform: string; filename: string; report: string; imported_at: string;
}

function context() {
  const account = getRequestAccount();
  if (account.role === "guest") throw new AppError("게스트 계정은 검색 성과에 접근할 수 없습니다.", 403, "FORBIDDEN");
  return { account, project: requireActiveProject() };
}

export function normalizeSocialProperty(value: string) {
  const url = new URL(value);
  const host = url.hostname.replace(/^www\./, "");
  const path = url.pathname.replace(/\/$/, "");
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) {
    throw new AppError("SNS 프로필의 https 주소만 입력해 주세요.", 422, "INVALID_PROPERTY_URL");
  }
  if (host === "instagram.com" && /^\/[\w.]{1,30}$/.test(path)) return { platform: "Instagram", url: `https://instagram.com${path.toLowerCase()}` };
  if (["twitter.com", "x.com"].includes(host) && /^\/\w{1,15}$/.test(path)) return { platform: "X", url: `https://x.com${path.toLowerCase()}` };
  if (host === "tiktok.com" && /^\/@[\w.]{1,64}$/.test(path)) return { platform: "TikTok", url: `https://www.tiktok.com${path}` };
  throw new AppError("Instagram·X·TikTok의 계정 프로필 URL을 입력해 주세요. 게시물 주소는 지원하지 않습니다.", 422, "INVALID_PROPERTY_URL");
}

function publicImport(row: ImportRow): SearchPerformanceImport {
  const report = JSON.parse(row.report) as SearchPerformanceReport;
  return { id: row.id, platform: row.platform, propertyUrl: row.property_url, filename: row.filename,
    importedAt: row.imported_at, periodStart: report.periodStart, periodEnd: report.periodEnd,
    source: "gsc_excel", dataState: report.dataState, totals: report.totals };
}

export function listSearchPerformanceImports() {
  const { account, project } = context();
  const rows = getDatabase().sqlite.prepare("SELECT * FROM gsc_imports WHERE project_id = ? AND account_id = ? ORDER BY id DESC").all(project.id, account.id) as ImportRow[];
  return { project: { id: project.id, name: project.name }, imports: rows.map(publicImport) };
}

export function getSearchPerformanceImport(id: unknown) {
  const { account, project } = context();
  const parsedId = z.coerce.number().int().positive().parse(id);
  const row = getDatabase().sqlite.prepare("SELECT * FROM gsc_imports WHERE id = ? AND project_id = ? AND account_id = ?").get(parsedId, project.id, account.id) as ImportRow | undefined;
  if (!row) throw new AppError("가져온 보고서를 찾을 수 없습니다.", 404, "GSC_IMPORT_NOT_FOUND");
  return { ...publicImport(row), report: JSON.parse(row.report) as SearchPerformanceReport };
}

export function importSearchPerformance(input: unknown) {
  const { account, project } = context();
  const parsed = importSchema.parse(input);
  if (parsed.projectId !== project.id) throw new AppError("활성 프로젝트가 변경되었습니다. 화면을 새로고침한 뒤 다시 가져와 주세요.", 409, "PROJECT_CHANGED");
  const property = normalizeSocialProperty(parsed.propertyUrl);
  const buffer = Buffer.from(parsed.base64, "base64");
  const report = parseGscExcel(buffer);
  const hash = createHash("sha256").update(buffer).digest("hex");
  const { sqlite } = getDatabase();
  return sqlite.transaction(() => {
    const existing = sqlite.prepare("SELECT * FROM gsc_imports WHERE project_id = ? AND account_id = ? AND property_url = ? AND content_hash = ?").get(project.id, account.id, property.url, hash) as ImportRow | undefined;
    if (existing) return { duplicate: true, imported: publicImport(existing) };
    const count = sqlite.prepare("SELECT COUNT(*) AS count FROM gsc_imports WHERE project_id = ? AND account_id = ?").get(project.id, account.id) as { count: number };
    if (count.count >= 200) throw new AppError("프로젝트당 보고서는 최대 200개입니다. 이전 보고서를 삭제한 뒤 가져와 주세요.", 409, "GSC_IMPORT_LIMIT");
    const importedAt = new Date().toISOString();
    const filename = parsed.filename.replace(/^.*[/\\]/, "").replace(/[\u0000-\u001f\u007f]/g, "");
    const result = sqlite.prepare(`INSERT INTO gsc_imports (project_id, account_id, property_url, platform, filename, content_hash, report, imported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(project.id, account.id, property.url, property.platform, filename, hash, JSON.stringify(report), importedAt);
    return { duplicate: false, imported: publicImport({ id: Number(result.lastInsertRowid), property_url: property.url,
      platform: property.platform, filename, report: JSON.stringify(report), imported_at: importedAt }) };
  })();
}

export function deleteSearchPerformanceImport(id: unknown) {
  const item = getSearchPerformanceImport(id);
  const { account, project } = context();
  getDatabase().sqlite.prepare("DELETE FROM gsc_imports WHERE id = ? AND project_id = ? AND account_id = ?").run(item.id, project.id, account.id);
}
