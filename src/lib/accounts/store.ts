import { z } from "zod";
import { resourceIdSchema } from "@/lib/crud";
import { getDatabase } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { normalizeLoginId } from "./identity";

export const ACCOUNT_PLANS = ["free", "semforge"] as const;
export const ACCOUNT_STATUSES = ["pending", "active", "disabled"] as const;
export type AccountPlan = (typeof ACCOUNT_PLANS)[number];
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export interface AccountRecord {
  id: number;
  loginId: string;
  displayName: string;
  plan: AccountPlan;
  status: AccountStatus;
  consentedAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountCredential {
  loginId: string;
  passwordHash: string;
  status: AccountStatus;
}

export interface NewAccount {
  loginId: string;
  displayName: string;
  passwordHash: string;
  plan: AccountPlan;
  status: AccountStatus;
  consentedAt: string;
}

interface AccountRow {
  id: number;
  login_id: string;
  display_name: string;
  password_hash: string;
  plan: AccountPlan;
  status: AccountStatus;
  consented_at: string;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

const statusSchema = z.enum(ACCOUNT_STATUSES);

function toRecord(row: AccountRow): AccountRecord {
  return {
    id: row.id,
    loginId: row.login_id,
    displayName: row.display_name,
    plan: row.plan,
    status: row.status,
    consentedAt: row.consented_at,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function selectByLoginId(loginId: string): AccountRow | undefined {
  return getDatabase().sqlite
    .prepare("SELECT * FROM accounts WHERE login_id = ?")
    .get(normalizeLoginId(loginId)) as AccountRow | undefined;
}

export function findAccount(loginId: string): AccountRecord | null {
  const row = selectByLoginId(loginId);
  return row ? toRecord(row) : null;
}

/** 로그인 검증 전용. 해시는 이 함수 밖의 공개 응답으로 내보내지 않는다. */
export function findAccountCredential(loginId: string): AccountCredential | null {
  const row = selectByLoginId(loginId);
  return row ? { loginId: row.login_id, passwordHash: row.password_hash, status: row.status } : null;
}

export function insertAccount(input: NewAccount, now = new Date()): AccountRecord {
  const { sqlite } = getDatabase();
  const timestamp = now.toISOString();
  try {
    const result = sqlite.prepare(`
      INSERT INTO accounts (login_id, display_name, password_hash, plan, status, consented_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(normalizeLoginId(input.loginId), input.displayName, input.passwordHash, input.plan, input.status, input.consentedAt, timestamp, timestamp);
    return toRecord(sqlite.prepare("SELECT * FROM accounts WHERE id = ?").get(result.lastInsertRowid) as AccountRow);
  } catch (error) {
    if ((error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
      throw new AppError("이미 가입된 이메일입니다. 로그인해 주세요.", 409, "ACCOUNT_EXISTS");
    }
    throw error;
  }
}

export function listAccounts(): AccountRecord[] {
  const rows = getDatabase().sqlite
    .prepare("SELECT * FROM accounts ORDER BY created_at DESC, id DESC")
    .all() as AccountRow[];
  return rows.map(toRecord);
}

export function updateAccountStatus(id: number | string, status: AccountStatus, actor: string, now = new Date()): AccountRecord {
  const accountId = resourceIdSchema.parse(id);
  const nextStatus = statusSchema.parse(status);
  const { sqlite } = getDatabase();
  const timestamp = now.toISOString();
  // 최초 승인 시각과 승인자는 한 번만 기록한다. 이후 중지·재활성화는 상태만 바꾼다.
  const result = sqlite.prepare(`
    UPDATE accounts
    SET status = ?,
      approved_at = CASE WHEN ? = 'active' AND approved_at IS NULL THEN ? ELSE approved_at END,
      approved_by = CASE WHEN ? = 'active' AND approved_by IS NULL THEN ? ELSE approved_by END,
      updated_at = ?
    WHERE id = ?
  `).run(nextStatus, nextStatus, timestamp, nextStatus, actor, timestamp, accountId);
  if (result.changes === 0) throw new AppError("계정을 찾을 수 없습니다.", 404, "ACCOUNT_NOT_FOUND");
  return toRecord(sqlite.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId) as AccountRow);
}
