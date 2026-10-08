import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { transactionalMutation } from "./crud";
import { getDatabase } from "./db";
import { AppError } from "./errors";
import { subscriptionRequiredError } from "./semforge/errors";
import { getRequestAccount } from "./request-account";

export const SEMFORGE_MONTHLY_PRICE_KRW = 300_000;
export const SEMFORGE_BILLING_PERIOD_DAYS = 30;

export type SemforgeSubscriptionStatus = "inactive" | "pending" | "active" | "past_due" | "canceled";
export type PaymentIntentStatus = "pending" | "paid" | "failed" | "expired";

interface SubscriptionRow {
  id: number;
  account_id: string;
  billing_mode: string;
  payment_intent_id: number | null;
  status: SemforgeSubscriptionStatus;
  amount_krw: number;
  current_period_start: string | null;
  current_period_end: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PaymentIntentRow {
  id: number;
  amount_krw: number;
  status: PaymentIntentStatus;
  provider: string;
  provider_order_id: string;
  confirm_token_hash: string | null;
  checkout_url: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SemforgeSubscriptionPublic {
  accountId: string;
  role: "admin" | "member" | "guest";
  accessSource: "admin" | "paid" | "none";
  billingAvailable: boolean;
  status: SemforgeSubscriptionStatus;
  active: boolean;
  amountKrw: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  daysRemaining: number | null;
  features: string[];
}

export interface CheckoutResult {
  intentId: number;
  orderId: string;
  amountKrw: number;
  checkoutUrl: string | null;
  /** dev 모드에서만 반환 — 운영에서는 결제 페이지로 이동 */
  devConfirmToken?: string;
}

function billingMode(): "dev" | "live" {
  const mode = process.env.SEMFORGE_BILLING_MODE?.trim().toLowerCase();
  return mode === "dev" && process.env.NODE_ENV !== "production" ? "dev" : "live";
}

function requireDevelopmentBilling() {
  if (billingMode() !== "dev") {
    throw new AppError("운영 결제 연동이 아직 준비되지 않았습니다. 결제 제공자의 승인 검증을 연결한 뒤 이용해 주세요.", 503, "PAYMENT_PROVIDER_UNAVAILABLE");
  }
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function ensureSubscriptionRow(sqlite: ReturnType<typeof getDatabase>["sqlite"]): SubscriptionRow {
  const accountId = getRequestAccount().id;
  const existing = sqlite.prepare("SELECT * FROM semforge_subscriptions WHERE account_id = ?").get(accountId) as SubscriptionRow | undefined;
  if (existing) return existing;
  const now = new Date().toISOString();
  sqlite.prepare(`
    INSERT OR IGNORE INTO semforge_subscriptions (account_id, status, amount_krw, created_at, updated_at)
    VALUES (?, 'inactive', ?, ?, ?)
  `).run(accountId, SEMFORGE_MONTHLY_PRICE_KRW, now, now);
  return sqlite.prepare("SELECT * FROM semforge_subscriptions WHERE account_id = ?").get(accountId) as SubscriptionRow;
}

const features = [
  "Google SERP AI Overview 가시성",
  "Firecrawl 사이트 진단",
  "포지션 추적 · 도메인 개요",
  "GSC · GBP · Map Rank 지역 SEO",
];

function toPublic(row: SubscriptionRow): SemforgeSubscriptionPublic {
  const now = Date.now();
  const end = row.current_period_end ? Date.parse(row.current_period_end) : Number.NaN;
  const paid = row.billing_mode === billingMode() && row.payment_intent_id !== null
    && Boolean(getDatabase().sqlite.prepare(`
      SELECT id FROM semforge_payment_intents
      WHERE id = ? AND account_id = ? AND billing_mode = ? AND status = 'paid'
        AND amount_krw = ? AND paid_at IS NOT NULL
    `).get(row.payment_intent_id, row.account_id, billingMode(), SEMFORGE_MONTHLY_PRICE_KRW));
  const active = row.status === "active" && paid && Number.isFinite(end) && end > now;
  const daysRemaining = active && Number.isFinite(end)
    ? Math.max(0, Math.ceil((end - now) / (24 * 60 * 60 * 1000)))
    : null;
  return {
    accountId: row.account_id,
    role: "member",
    accessSource: active ? "paid" : "none",
    billingAvailable: billingMode() === "dev",
    status: row.status === "active" && !active ? "past_due" : row.status,
    active,
    amountKrw: row.amount_krw,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    daysRemaining,
    features: [...features],
  };
}

export function getSemforgeSubscription(): SemforgeSubscriptionPublic {
  const account = getRequestAccount();
  if (account.role === "guest") {
    return { accountId: account.id, role: "guest", accessSource: "none", billingAvailable: false,
      status: "inactive", active: false, amountKrw: 0, currentPeriodStart: null, currentPeriodEnd: null, daysRemaining: null, features: [] };
  }
  if (account.role === "admin") {
    return {
      accountId: account.id, role: "admin", accessSource: "admin", billingAvailable: false,
      status: "active", active: true, amountKrw: 0,
      currentPeriodStart: null, currentPeriodEnd: null, daysRemaining: null, features: [...features],
    };
  }
  const { sqlite } = getDatabase();
  return toPublic(ensureSubscriptionRow(sqlite));
}

/** SEMForge API/실행 기능 게이트 */
export function requireSemforgeSubscription(): SemforgeSubscriptionPublic {
  const subscription = getSemforgeSubscription();
  if (!subscription.active) throw subscriptionRequiredError();
  return subscription;
}

export function createSemforgeCheckout(): CheckoutResult {
  const account = getRequestAccount();
  if (account.role === "guest") throw new AppError("게스트 계정은 결제에 접근할 수 없습니다.", 403, "FORBIDDEN");
  if (account.role === "admin") throw new AppError("관리자는 결제 없이 SEMForge를 이용할 수 있습니다.", 409, "ADMIN_BILLING_NOT_REQUIRED");
  requireDevelopmentBilling();
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const subscription = ensureSubscriptionRow(sqlite);
    if (toPublic(subscription).active && subscription.current_period_end) {
      const end = Date.parse(subscription.current_period_end);
      if (Number.isFinite(end) && end > Date.now()) {
        throw new AppError("이미 활성 구독이 있습니다.", 409, "SEMFORGE_ALREADY_ACTIVE");
      }
    }
    const now = new Date().toISOString();
    const orderId = `sf-${Date.now()}-${randomBytes(4).toString("hex")}`;
    const devToken = randomBytes(24).toString("hex");
    const result = sqlite.prepare(`
      INSERT INTO semforge_payment_intents
        (account_id, billing_mode, amount_krw, status, provider, provider_order_id, confirm_token_hash, checkout_url, created_at, updated_at)
      VALUES (?, 'dev', ?, 'pending', 'dev', ?, ?, ?, ?, ?)
    `).run(
      account.id,
      SEMFORGE_MONTHLY_PRICE_KRW,
      orderId,
      hashToken(devToken),
      null,
      now,
      now,
    );
    sqlite.prepare("UPDATE semforge_subscriptions SET status = 'pending', updated_at = ? WHERE account_id = ?").run(now, account.id);
    return {
      intentId: Number(result.lastInsertRowid),
      orderId,
      amountKrw: SEMFORGE_MONTHLY_PRICE_KRW,
      checkoutUrl: null,
      devConfirmToken: devToken,
    };
  });
}

const confirmSchema = z.object({
  orderId: z.string().trim().min(1).max(120),
  confirmToken: z.string().trim().min(16).max(128).optional(),
}).strict();

function activatePeriod(now: Date) {
  const start = now.toISOString();
  const end = new Date(now.getTime() + SEMFORGE_BILLING_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return { start, end };
}

export function confirmSemforgePayment(input: unknown): SemforgeSubscriptionPublic {
  const account = getRequestAccount();
  if (account.role === "guest") throw new AppError("게스트 계정은 결제에 접근할 수 없습니다.", 403, "FORBIDDEN");
  if (account.role === "admin") throw new AppError("관리자는 결제 없이 SEMForge를 이용할 수 있습니다.", 409, "ADMIN_BILLING_NOT_REQUIRED");
  requireDevelopmentBilling();
  const parsed = confirmSchema.parse(input);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const intent = sqlite.prepare(`
      SELECT * FROM semforge_payment_intents WHERE provider_order_id = ? AND account_id = ? AND billing_mode = 'dev'
    `).get(parsed.orderId, account.id) as PaymentIntentRow | undefined;
    if (!intent) {
      throw new AppError("결제 요청을 찾을 수 없습니다.", 404, "PAYMENT_INTENT_NOT_FOUND");
    }
    if (intent.status === "paid") return getSemforgeSubscription();
    if (intent.status !== "pending") {
      throw new AppError("만료되었거나 처리할 수 없는 결제입니다.", 409, "PAYMENT_INTENT_INVALID");
    }

    if (!parsed.confirmToken || !intent.confirm_token_hash || hashToken(parsed.confirmToken) !== intent.confirm_token_hash) {
      throw new AppError("개발 모드 결제 확인 토큰이 올바르지 않습니다.", 403, "PAYMENT_CONFIRM_DENIED");
    }

    const now = new Date();
    const { start, end } = activatePeriod(now);
    const iso = now.toISOString();
    sqlite.prepare(`
      UPDATE semforge_payment_intents SET status = 'paid', paid_at = ?, updated_at = ? WHERE id = ?
    `).run(iso, iso, intent.id);
    sqlite.prepare(`
      UPDATE semforge_subscriptions
      SET status = 'active', current_period_start = ?, current_period_end = ?, canceled_at = NULL,
        billing_mode = 'dev', payment_intent_id = ?, updated_at = ?
      WHERE account_id = ?
    `).run(start, end, intent.id, iso, account.id);
    return toPublic(ensureSubscriptionRow(sqlite));
  });
}

export function cancelSemforgeSubscription(): SemforgeSubscriptionPublic {
  const account = getRequestAccount();
  if (account.role === "guest") throw new AppError("게스트 계정은 결제에 접근할 수 없습니다.", 403, "FORBIDDEN");
  if (account.role === "admin") throw new AppError("관리자 이용 권한은 구독 취소로 변경할 수 없습니다.", 409, "ADMIN_ACCESS_PERMANENT");
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const now = new Date().toISOString();
    sqlite.prepare(`
      UPDATE semforge_subscriptions SET status = 'canceled', canceled_at = ?, updated_at = ? WHERE account_id = ?
    `).run(now, now, account.id);
    return toPublic(ensureSubscriptionRow(sqlite));
  });
}
