import bcrypt from "bcryptjs";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { hasConfiguredAdministrator } from "@/lib/account-policy";
import { configuredAccountIds } from "@/lib/login-session";
import { envAdmin, MIN_PASSWORD_LENGTH } from "./env-admin";
import { exceedsBcryptLimit, USERNAME_PATTERN } from "./identity";
import { ACCOUNT_PLANS, insertAccount, type AccountPlan, type AccountRecord } from "./store";

/**
 * GEO_SIGNUP_MODE
 * - approval: 가입 신청 후 관리자 승인을 받아야 로그인(기본값)
 * - auto:     가입 즉시 로그인
 * - closed:   신규 가입 중단. 알 수 없는 값도 안전하게 중단으로 본다.
 */
export type SignupMode = "approval" | "auto" | "closed";
export const SIGNUP_BCRYPT_COST = 10;

/**
 * 가입 시도 제한(단일 프로세스 메모리 기준). 주소별 제한에 더해 전체 상한을 둔다.
 * 앞단 프록시가 없는 app 모드에서는 X-Forwarded-For를 클라이언트가 바꿀 수 있으므로 전체 상한이 마지막 방어선이다.
 */
export const SIGNUP_RATE_LIMITS = { windowMs: 10 * 60 * 1000, perAddress: 10, global: 100 } as const;

export interface SignupValues {
  email: string;
  displayName: string;
  plan: AccountPlan;
  consent: boolean;
}

export type SignupResult =
  | { ok: true; account: AccountRecord; mode: SignupMode }
  | { ok: false; status: number; message: string; messages: string[]; values: SignupValues };

const UNAVAILABLE_EMAIL = "이미 가입되었거나 사용할 수 없는 이메일입니다. 가입한 적이 있다면 로그인해 주세요.";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function signupMode(): SignupMode {
  const value = (process.env.GEO_SIGNUP_MODE ?? "").trim().toLowerCase();
  // Fail closed for both approval and auto: a usable operator must be able to
  // approve/suspend accounts. All public pages and the POST handler use this gate.
  if (!hasConfiguredAdministrator()) return "closed";
  if (!value || value === "approval") return "approval";
  return value === "auto" ? "auto" : "closed";
}

export function parsePlan(value: unknown): AccountPlan {
  return value === "semforge" ? "semforge" : "free";
}

const signupSchema = z.object({
  email: z.string().trim().toLowerCase()
    .max(128, "이메일은 128자 이하로 입력해 주세요.")
    .pipe(z.email("올바른 이메일 주소를 입력해 주세요."))
    .refine((value) => USERNAME_PATTERN.test(value), "이메일에는 영문·숫자와 @ . _ + - 기호만 사용할 수 있습니다."),
  displayName: z.string().trim()
    .min(1, "이름을 입력해 주세요.")
    .max(50, "이름은 50자 이하로 입력해 주세요.")
    .refine((value) => !CONTROL_CHARACTERS.test(value), "이름에 사용할 수 없는 문자가 있습니다."),
  password: z.string()
    .min(MIN_PASSWORD_LENGTH, `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`)
    .refine((value) => !exceedsBcryptLimit(value), "비밀번호가 너무 깁니다. 72바이트 이하로 입력해 주세요."),
  passwordConfirm: z.string(),
  plan: z.enum(ACCOUNT_PLANS, "가입 유형을 선택해 주세요."),
  consent: z.literal("on", "개인정보 수집·이용에 동의해 주세요."),
}).superRefine((value, context) => {
  if (value.password !== value.passwordConfirm) {
    context.addIssue({ code: "custom", path: ["passwordConfirm"], message: "비밀번호 확인이 일치하지 않습니다." });
  }
  if (value.password.trim().toLowerCase() === value.email) {
    context.addIssue({ code: "custom", path: ["password"], message: "이메일과 같은 비밀번호는 사용할 수 없습니다." });
  }
});

/** 관리자·게스트·운영 계정으로 지정된 아이디는 가입으로 선점할 수 없다. 비밀번호를 아직 넣지 않은 관리자 아이디도 막는다. */
function reservedLoginIds(): Set<string> {
  const lists = [process.env.GEO_ADMIN_USERS ?? "", process.env.GEO_GUEST_USERS ?? "guest"].flatMap((list) => list.split(","));
  const ids = [envAdmin()?.id, process.env.GEO_ADMIN_ID, ...configuredAccountIds(), ...lists, "local"];
  return new Set(ids.map((id) => (id ?? "").trim().toLowerCase()).filter(Boolean));
}

function failure(status: number, messages: string[], values: SignupValues): SignupResult {
  const unique = [...new Set(messages)];
  return { ok: false, status, message: unique[0] ?? "입력값을 확인해 주세요.", messages: unique, values };
}

export async function registerAccount(fields: URLSearchParams, now = new Date()): Promise<SignupResult> {
  const field = (name: string) => fields.get(name) ?? "";
  const values: SignupValues = {
    email: field("email").trim(),
    displayName: field("displayName").trim(),
    plan: parsePlan(field("plan")),
    consent: field("consent") === "on",
  };
  const mode = signupMode();
  if (mode === "closed") return failure(403, ["현재 신규 회원가입을 받지 않습니다."], values);
  const parsed = signupSchema.safeParse({
    email: field("email"),
    displayName: field("displayName"),
    password: field("password"),
    passwordConfirm: field("passwordConfirm"),
    plan: field("plan"),
    consent: field("consent"),
  });
  if (!parsed.success) return failure(422, parsed.error.issues.map((issue) => issue.message), values);
  const { email, displayName, password, plan } = parsed.data;
  if (reservedLoginIds().has(email)) return failure(409, [UNAVAILABLE_EMAIL], values);
  const passwordHash = await bcrypt.hash(password, SIGNUP_BCRYPT_COST);
  try {
    const status = mode === "auto" ? "active" : "pending";
    const account = insertAccount({ loginId: email, displayName, passwordHash, plan, status, consentedAt: now.toISOString() }, now);
    return { ok: true, account, mode };
  } catch (error) {
    if (error instanceof AppError && error.code === "ACCOUNT_EXISTS") return failure(409, [UNAVAILABLE_EMAIL], values);
    throw error;
  }
}
