import bcrypt from "bcryptjs";
import { z } from "zod";
import { AppError } from "@/lib/errors";
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

/** 화면에 나오는 순서. 첫 오류 필드에 포커스를 줄 때 쓴다. */
export const SIGNUP_FIELD_ORDER = ["plan", "email", "displayName", "password", "passwordConfirm", "consent"] as const;
export type SignupField = (typeof SIGNUP_FIELD_ORDER)[number];
export type SignupFieldErrors = Partial<Record<SignupField, string>>;

export type SignupResult =
  | { ok: true; account: AccountRecord; mode: SignupMode }
  | { ok: false; status: number; message: string; messages: string[]; fieldErrors: SignupFieldErrors; values: SignupValues };

const UNAVAILABLE_EMAIL = "이미 가입되었거나 사용할 수 없는 이메일입니다. 가입한 적이 있다면 로그인해 주세요.";
/** 제어 문자와 보이지 않거나 글자 방향을 바꾸는 서식 문자(RLO·ZWSP·BOM 등). 관리자 화면에서 이름을 위장하는 데 쓰일 수 있다. */
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const WEAK_PASSWORD = "추측하기 쉬운 비밀번호입니다. 흔한 단어·서비스 이름·연속되거나 반복되는 문자를 피해 주세요.";
const EMAIL_PASSWORD = "이메일 아이디가 들어간 비밀번호는 사용할 수 없습니다.";
/** 알파벳·숫자·키보드 배열. 이 순서(또는 역순)를 3자 이상 그대로 따라가면 추측하기 쉬운 구간이다. */
const SEQUENCES = ["abcdefghijklmnopqrstuvwxyz", "01234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm"].flatMap((sequence) => [sequence, [...sequence].reverse().join("")]);
/** 흔히 쓰이는 비밀번호와 그 어근. 끝에 숫자만 붙인 변형도 막는다. */
const COMMON_PASSWORDS = new Set([
  "password", "passw0rd", "qwerty", "qwertyuiop", "asdf", "asdfgh", "zxcvbn", "iloveyou", "letmein", "welcome", "admin",
  "administrator", "login", "master", "dragon", "monkey", "sunshine", "princess", "football", "baseball", "soccer", "superman",
  "batman", "trustno1", "abc", "abcd", "1q2w3e4r", "1q2w3e4r5t", "1q2w3e", "q1w2e3r4", "1qaz2wsx", "zaq12wsx", "qazwsx", "123qwe",
  "qwe123", "qweasd", "qweasdzxc", "a1b2c3d4", "love", "loveyou", "korea", "seoul", "sarang", "saranghae", "hello", "secret",
  "test", "guest", "user", "changeme", "default", "google", "naver", "kakao", "samsung", "computer", "internet", "freedom",
  "whatever", "shadow", "michael", "jordan",
]);
/** 서비스를 떠올리게 하는 단어 */
const SERVICE_WORDS = ["geomaster", "semforge", "soverin"];

/** start에서 시작해 같은 문자가 반복되거나 배열 순서를 따라가는 가장 긴 구간의 길이 */
function patternRunLength(text: string, start: number): number {
  let repeat = 1;
  while (text[start + repeat] === text[start]) repeat += 1;
  const sequential = SEQUENCES.flatMap((sequence) => [...sequence].flatMap((character, position) => {
    if (character !== text[start]) return [];
    let length = 1;
    while (start + length < text.length && sequence[position + length] === text[start + length]) length += 1;
    return [length];
  }));
  return Math.max(repeat, ...sequential);
}

/** 반복·연속 구간(3자 이상)을 빼고 남는 글자 수. 2자 이하면 패턴만으로 만든 비밀번호다. */
function patternRemainder(password: string): number {
  const text = password.toLowerCase();
  let remaining = 0;
  for (let index = 0; index < text.length;) {
    const run = patternRunLength(text, index);
    if (run >= 3) index += run;
    else { remaining += 1; index += 1; }
  }
  return remaining;
}

/** 추측하기 쉬운 비밀번호면 이유를, 아니면 null을 돌려준다. */
export function passwordWeakness(password: string, email: string): string | null {
  const compact = password.toLowerCase().replace(/[^a-z0-9]/g, "");
  const root = compact.replace(/\d+$/, "");
  if (COMMON_PASSWORDS.has(compact) || COMMON_PASSWORDS.has(root) || SERVICE_WORDS.some((word) => compact.includes(word)) || patternRemainder(password) <= 2) {
    return WEAK_PASSWORD;
  }
  const local = email.split("@")[0] ?? "";
  const tokens = [local.replace(/[^a-z0-9]/g, ""), ...local.split(/[._+-]+/)].filter((token) => token.length >= 4);
  return tokens.some((token) => compact.includes(token)) ? EMAIL_PASSWORD : null;
}

export function signupMode(): SignupMode {
  const value = (process.env.GEO_SIGNUP_MODE ?? "").trim().toLowerCase();
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
  // trim이 지우는 BOM 같은 보이지 않는 문자도 거르도록 앞뒤 공백을 지우기 전에 검사한다.
  displayName: z.string()
    .refine((value) => !CONTROL_CHARACTERS.test(value), "이름에 보이지 않는 문자나 제어 문자는 사용할 수 없습니다.")
    .trim()
    .min(1, "이름을 입력해 주세요.")
    .max(50, "이름은 50자 이하로 입력해 주세요."),
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
    return;
  }
  const weakness = passwordWeakness(value.password, value.email);
  if (weakness) context.addIssue({ code: "custom", path: ["password"], message: weakness });
});

/** 관리자·게스트·운영 계정으로 지정된 아이디는 가입으로 선점할 수 없다. 비밀번호를 아직 넣지 않은 관리자 아이디도 막는다. */
function reservedLoginIds(): Set<string> {
  const lists = [process.env.GEO_ADMIN_USERS ?? "", process.env.GEO_GUEST_USERS ?? "guest"].flatMap((list) => list.split(","));
  const ids = [envAdmin()?.id, process.env.GEO_ADMIN_ID, ...configuredAccountIds(), ...lists, "local"];
  return new Set(ids.map((id) => (id ?? "").trim().toLowerCase()).filter(Boolean));
}

function isSignupField(value: unknown): value is SignupField {
  return typeof value === "string" && (SIGNUP_FIELD_ORDER as readonly string[]).includes(value);
}

/** 필드마다 첫 번째 오류만 남긴다. 화면이 입력란과 오류 문구를 연결하는 데 쓴다. */
function fieldErrorsFrom(issues: readonly { path: readonly PropertyKey[]; message: string }[]): SignupFieldErrors {
  return issues.reduce<SignupFieldErrors>((errors, issue) => {
    const field = issue.path[0];
    return isSignupField(field) && !errors[field] ? { ...errors, [field]: issue.message } : errors;
  }, {});
}

function failure(status: number, messages: string[], values: SignupValues, fieldErrors: SignupFieldErrors = {}): SignupResult {
  const unique = [...new Set(messages)];
  return { ok: false, status, message: unique[0] ?? "입력값을 확인해 주세요.", messages: unique, fieldErrors, values };
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
  if (!parsed.success) return failure(422, parsed.error.issues.map((issue) => issue.message), values, fieldErrorsFrom(parsed.error.issues));
  const { email, displayName, password, plan } = parsed.data;
  if (reservedLoginIds().has(email)) return failure(409, [UNAVAILABLE_EMAIL], values, { email: UNAVAILABLE_EMAIL });
  const passwordHash = await bcrypt.hash(password, SIGNUP_BCRYPT_COST);
  try {
    const status = mode === "auto" ? "active" : "pending";
    const account = insertAccount({ loginId: email, displayName, passwordHash, plan, status, consentedAt: now.toISOString() }, now);
    return { ok: true, account, mode };
  } catch (error) {
    if (error instanceof AppError && error.code === "ACCOUNT_EXISTS") return failure(409, [UNAVAILABLE_EMAIL], values, { email: UNAVAILABLE_EMAIL });
    throw error;
  }
}
