import { AsyncLocalStorage } from "node:async_hooks";
import { timingSafeEqual } from "node:crypto";
import { AppError } from "./errors";
import { accountRole, type AccountRole } from "./account-policy";
import { authMode } from "./auth-mode";
import { authSecret } from "./login-session";

export interface RequestAccount {
  id: string;
  role: AccountRole;
}

const accounts = new AsyncLocalStorage<RequestAccount>();
const localAccount: RequestAccount = { id: "local", role: "member" };

/** proxy·app 모드는 신뢰 경계(Traefik 또는 Next 프록시)가 주입한 비밀 헤더와 사용자 헤더로만 계정을 정한다. */
function proxyMode() {
  const mode = authMode();
  if (!mode) {
    throw new AppError("로그인 설정을 확인해 주세요.", 503, "AUTH_CONFIGURATION_INVALID");
  }
  return mode !== "local";
}

function configuredSecret() {
  try {
    return authSecret();
  } catch {
    throw new AppError("로그인 설정을 확인해 주세요.", 503, "AUTH_CONFIGURATION_INVALID");
  }
}

function authenticatedAccount(headers: Headers): RequestAccount {
  if (!proxyMode()) return localAccount;
  const secret = configuredSecret();
  const supplied = headers.get("x-geo-auth-secret") ?? "";
  const user = headers.get("x-geo-auth-user") ?? "";
  const expectedBytes = Buffer.from(secret);
  const suppliedBytes = Buffer.from(supplied);
  if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)
    || !/^[a-zA-Z0-9][a-zA-Z0-9@._+-]{0,127}$/.test(user)) {
    throw new AppError("로그인이 필요합니다.", 401, "AUTH_REQUIRED");
  }
  return { id: user, role: accountRole(user) };
}

/** Only the trusted proxy may assert a username; never infer roles from request bodies. */
export function withRequestAccount<T>(headers: Headers, operation: () => T): T {
  return accounts.run(authenticatedAccount(headers), operation);
}

export function getRequestAccount(): RequestAccount {
  const account = accounts.getStore();
  if (account) return account;
  if (proxyMode()) throw new AppError("로그인이 필요합니다.", 401, "AUTH_REQUIRED");
  return localAccount;
}
