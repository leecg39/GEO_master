/**
 * 공개 리포트 링크 — 로그인 없이 볼 수 있는 만료형 링크 (leecg39/GEO_master2 S-12 공개 리포트).
 * - 토큰(32바이트)은 응답에 한 번만 주고, DB에는 SHA-256 해시만 저장한다
 * - 링크를 만든 시점의 리포트를 스냅샷으로 고정한다 (이후 측정·검수 변경이 공개 내용에 섞이지 않는다)
 * - 만료·폐기된 링크는 내용 없이 안내만 보여 준다
 */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { resourceIdSchema } from "./crud";
import { getDatabase } from "./db";
import { AppError } from "./errors";
import { requireActiveProject } from "./projects";
import { buildShareReport, type ShareReport } from "./reports";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const SNAPSHOT_RESULT_LIMIT = 200;
const DAY_MS = 86_400_000;

export const reportShareCreateSchema = z.object({
  runId: resourceIdSchema,
  expiresInDays: z.number().int().min(1).max(30),
}).strict();

export type PublicReport = ShareReport & { run: ShareReport["run"] & { title: string } };

interface ShareRow {
  id: number; project_id: number; run_id: number; token_hash: string; snapshot: string; expires_at: string;
  revoked_at: string | null; view_count: number; last_viewed_at: string | null; created_at: string;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function toShare(row: ShareRow) {
  return {
    id: row.id,
    runId: row.run_id,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    viewCount: row.view_count,
    lastViewedAt: row.last_viewed_at,
    createdAt: row.created_at,
    active: !row.revoked_at && Date.parse(row.expires_at) > Date.now(),
  };
}

function ownedCompletedRun(runId: number) {
  const run = getDatabase().sqlite.prepare("SELECT id, project_id, status, title FROM measure_runs WHERE id = ?").get(runId) as
    { id: number; project_id: number | null; status: string; title: string } | undefined;
  if (!run) throw new AppError("측정 실행 이력을 찾을 수 없습니다.", 404, "MEASURE_RUN_NOT_FOUND");
  const active = requireActiveProject();
  if (run.project_id !== active.id) throw new AppError("활성 프로젝트의 측정 실행이 아닙니다.", 409, "PROJECT_SCOPE_MISMATCH");
  if (run.status !== "completed") throw new AppError("완료된 측정만 공유할 수 있습니다.", 409, "REPORT_NOT_READY");
  return { ...run, projectId: active.id };
}

export function createReportShare(input: unknown) {
  const { runId, expiresInDays } = reportShareCreateSchema.parse(input);
  const run = ownedCompletedRun(runId);
  const report = buildShareReport(runId, SNAPSHOT_RESULT_LIMIT);
  const snapshot: PublicReport = { ...report, run: { ...report.run, title: run.title } };
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInDays * DAY_MS).toISOString();
  const { sqlite } = getDatabase();
  const id = Number(sqlite.prepare(`
    INSERT INTO report_shares (project_id, run_id, token_hash, snapshot, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)
  `).run(run.projectId, runId, hashToken(token), JSON.stringify(snapshot), expiresAt, now.toISOString()).lastInsertRowid);
  const row = sqlite.prepare("SELECT * FROM report_shares WHERE id = ?").get(id) as ShareRow;
  return { share: toShare(row), url: `/r/${token}` };
}

export function listReportShares(runIdInput: unknown) {
  const runId = resourceIdSchema.parse(runIdInput);
  ownedCompletedRun(runId);
  const rows = getDatabase().sqlite.prepare("SELECT * FROM report_shares WHERE run_id = ? ORDER BY created_at DESC, id DESC").all(runId) as ShareRow[];
  return rows.map(toShare);
}

export function revokeReportShare(idInput: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const { sqlite } = getDatabase();
  const row = sqlite.prepare("SELECT * FROM report_shares WHERE id = ?").get(id) as ShareRow | undefined;
  if (!row) throw new AppError("공유 링크를 찾을 수 없습니다.", 404, "REPORT_SHARE_NOT_FOUND");
  requireActiveProject(row.project_id);
  sqlite.prepare("UPDATE report_shares SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?").run(new Date().toISOString(), id);
  return toShare(sqlite.prepare("SELECT * FROM report_shares WHERE id = ?").get(id) as ShareRow);
}

/** 공개 조회 — 유효하지 않으면 null (존재 여부를 구분해 알려 주지 않는다) */
export function resolvePublicReport(token: string): { report: PublicReport; expiresAt: string } | null {
  if (!TOKEN_RE.test(token)) return null;
  const { sqlite } = getDatabase();
  const row = sqlite.prepare("SELECT * FROM report_shares WHERE token_hash = ?").get(hashToken(token)) as ShareRow | undefined;
  if (!row || row.revoked_at || Date.parse(row.expires_at) <= Date.now()) return null;
  try {
    const report = JSON.parse(row.snapshot) as PublicReport;
    sqlite.prepare("UPDATE report_shares SET view_count = view_count + 1, last_viewed_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
    return { report, expiresAt: row.expires_at };
  } catch {
    return null;
  }
}
