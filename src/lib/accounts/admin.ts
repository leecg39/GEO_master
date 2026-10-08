import { AppError } from "@/lib/errors";
import { getRequestAccount, type RequestAccount } from "@/lib/request-account";
import { peekSemforgeAccess } from "@/lib/semforge-subscription";
import { listAccounts, updateAccountStatus, type AccountRecord, type AccountStatus } from "./store";

export interface AdminAccountView extends AccountRecord {
  /** 가입 유형과 별개로, 결제가 확인되어 SEMForge가 실제로 열려 있는지 */
  semforge: { active: boolean; status: string };
}

export function requireAdminAccount(): RequestAccount {
  const account = getRequestAccount();
  if (account.role !== "admin") throw new AppError("관리자만 회원을 관리할 수 있습니다.", 403, "FORBIDDEN");
  return account;
}

function withSemforge(account: AccountRecord): AdminAccountView {
  return { ...account, semforge: peekSemforgeAccess(account.loginId) };
}

export function listAdminAccounts(): AdminAccountView[] {
  requireAdminAccount();
  return listAccounts().map(withSemforge);
}

export function setAccountStatus(id: number | string, status: AccountStatus): AdminAccountView {
  const admin = requireAdminAccount();
  return withSemforge(updateAccountStatus(id, status, admin.id));
}
