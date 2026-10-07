import { AsyncLocalStorage } from "node:async_hooks";
import { timingSafeEqual } from "node:crypto";
import { AppError } from "./errors";
import { accountRole, type AccountRole } from "./account-policy";

export interface RequestAccount {
  id: string;
  role: AccountRole;
}

const accounts = new AsyncLocalStorage<RequestAccount>();
const localAccount: RequestAccount = { id: "local", role: "member" };

function proxyMode() {
  const mode = process.env.GEO_AUTH_MODE?.trim() || "local";
  if (mode !== "local" && mode !== "proxy") {
    throw new AppError("로그인 설정을 확인해 주세요.", 503, "AUTH_CONFIGURATION_INVALID");
  }
  return mode === "proxy";
}

function authenticatedAccount(headers: Headers): RequestAccount {
  if (!proxyMode()) return localAccount;
  const secret = process.env.GEO_AUTH_PROXY_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new AppError("로그인 설정을 확인해 주세요.", 503, "AUTH_CONFIGURATION_INVALID");
  }
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
