import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { transactionalMutation } from "./crud";
import { getDatabase } from "./db";
import { AppError } from "./errors";
import { subscriptionRequiredError } from "./semforge/errors";

export const SEMFORGE_MONTHLY_PRICE_KRW = 300_000;
export const SEMFORGE_BILLING_PERIOD_DAYS = 30;
export const SEMFORGE_TRIAL_DAYS = 7;

export type SemforgeSubscriptionStatus = "inactive" | "pending" | "active" | "past_due" | "canceled";
export type PaymentIntentStatus = "pending" | "paid" | "failed" | "expired";

interface SubscriptionRow {
  id: number;
  status: SemforgeSubscriptionStatus;
  amount_krw: number;
  current_period_start: string | null;
  current_period_end: string | null;
  canceled_at: string | null;
  trial_started_at: string | null;
  is_trial: number;
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
  status: SemforgeSubscriptionStatus;
  active: boolean;
  amountKrw: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  daysRemaining: number | null;
  isTrial: boolean;
  trialAvailable: boolean;
  trialDays: number;
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
  return mode === "live" ? "live" : "dev";
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function isCurrentlyActive(row: SubscriptionRow) {
  const end = row.current_period_end ? Date.parse(row.current_period_end) : Number.NaN;
  return row.status === "active" && Number.isFinite(end) && end > Date.now();
}

function ensureSubscriptionRow(sqlite: ReturnType<typeof getDatabase>["sqlite"]): SubscriptionRow {
  const existing = sqlite.prepare("SELECT * FROM semforge_subscriptions WHERE id = 1").get() as SubscriptionRow | undefined;
  if (existing) return existing;
  const now = new Date().toISOString();
  sqlite.prepare(`
    INSERT INTO semforge_subscriptions (id, status, amount_krw, is_trial, created_at, updated_at)
    VALUES (1, 'inactive', ?, 0, ?, ?)
  `).run(SEMFORGE_MONTHLY_PRICE_KRW, now, now);
  return sqlite.prepare("SELECT * FROM semforge_subscriptions WHERE id = 1").get() as SubscriptionRow;
}

function toPublic(row: SubscriptionRow): SemforgeSubscriptionPublic {
  const now = Date.now();
  const end = row.current_period_end ? Date.parse(row.current_period_end) : Number.NaN;
  const active = row.status === "active" && Number.isFinite(end) && end > now;
  const daysRemaining = active && Number.isFinite(end)
    ? Math.max(0, Math.ceil((end - now) / (24 * 60 * 60 * 1000)))
    : null;
  const isTrial = active && Boolean(row.is_trial);
  return {
    status: active ? "active" : row.status,
    active,
    amountKrw: row.amount_krw,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    daysRemaining,
    isTrial,
    trialAvailable: !row.trial_started_at && !active,
    trialDays: SEMFORGE_TRIAL_DAYS,
    features: [
      "Google SERP AI Overview 가시성",
      "Firecrawl 사이트 진단",
      "포지션 추적 · 도메인 개요",
      "GSC · GBP · Map Rank 지역 SEO",
      "GEO Blocks 스펙 초안·승인",
    ],
  };
}

export function getSemforgeSubscription(): SemforgeSubscriptionPublic {
  const { sqlite } = getDatabase();
  return toPublic(ensureSubscriptionRow(sqlite));
}

/** SEMForge API/실행 기능 게이트 */
export function requireSemforgeSubscription(): SemforgeSubscriptionPublic {
  const subscription = getSemforgeSubscription();
  if (!subscription.active) throw subscriptionRequiredError();
  return subscription;
}

function activatePeriod(now: Date, days: number) {
  const start = now.toISOString();
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
  return { start, end };
}

/** 워크스페이스당 1회 · 결제 없이 7일 Pro 활성 */
export function startSemforgeTrial(): SemforgeSubscriptionPublic {
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const subscription = ensureSubscriptionRow(sqlite);
    if (isCurrentlyActive(subscription)) {
      throw new AppError("이미 활성 구독이 있습니다.", 409, "SEMFORGE_ALREADY_ACTIVE");
    }
    if (subscription.trial_started_at) {
      throw new AppError("무료 체험은 워크스페이스당 한 번만 시작할 수 있습니다. 월 구독 결제로 이어가세요.", 409, "SEMFORGE_TRIAL_USED");
    }
    const now = new Date();
    const { start, end } = activatePeriod(now, SEMFORGE_TRIAL_DAYS);
    const iso = now.toISOString();
    sqlite.prepare(`
      UPDATE semforge_subscriptions
      SET status = 'active',
          current_period_start = ?,
          current_period_end = ?,
          canceled_at = NULL,
          trial_started_at = ?,
          is_trial = 1,
          updated_at = ?
      WHERE id = 1
    `).run(start, end, iso, iso);
    return toPublic(ensureSubscriptionRow(sqlite));
  });
}

export function createSemforgeCheckout(): CheckoutResult {
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const subscription = ensureSubscriptionRow(sqlite);
    if (isCurrentlyActive(subscription)) {
      throw new AppError("이미 활성 구독이 있습니다.", 409, "SEMFORGE_ALREADY_ACTIVE");
    }
    const now = new Date().toISOString();
    const orderId = `sf-${Date.now()}-${randomBytes(4).toString("hex")}`;
    const devToken = billingMode() === "dev" ? randomBytes(24).toString("hex") : null;
    const result = sqlite.prepare(`
      INSERT INTO semforge_payment_intents
        (amount_krw, status, provider, provider_order_id, confirm_token_hash, checkout_url, created_at, updated_at)
      VALUES (?, 'pending', 'toss', ?, ?, ?, ?, ?)
    `).run(
      SEMFORGE_MONTHLY_PRICE_KRW,
      orderId,
      devToken ? hashToken(devToken) : null,
      billingMode() === "live" ? `https://pay.tosspayments.com/v1/checkout?orderId=${encodeURIComponent(orderId)}` : null,
      now,
      now,
    );
    sqlite.prepare("UPDATE semforge_subscriptions SET status = 'pending', updated_at = ? WHERE id = 1").run(now);
    return {
      intentId: Number(result.lastInsertRowid),
      orderId,
      amountKrw: SEMFORGE_MONTHLY_PRICE_KRW,
      checkoutUrl: billingMode() === "live" ? `https://pay.tosspayments.com/v1/checkout?orderId=${encodeURIComponent(orderId)}` : null,
      ...(devToken ? { devConfirmToken: devToken } : {}),
    };
  });
}

const confirmSchema = z.object({
  orderId: z.string().trim().min(1).max(120),
  confirmToken: z.string().trim().min(16).max(128).optional(),
}).strict();

export function confirmSemforgePayment(input: unknown): SemforgeSubscriptionPublic {
  const parsed = confirmSchema.parse(input);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const intent = sqlite.prepare(`
      SELECT * FROM semforge_payment_intents WHERE provider_order_id = ?
    `).get(parsed.orderId) as PaymentIntentRow | undefined;
    if (!intent) {
      throw new AppError("결제 요청을 찾을 수 없습니다.", 404, "PAYMENT_INTENT_NOT_FOUND");
    }
    if (intent.status === "paid") return getSemforgeSubscription();
    if (intent.status !== "pending") {
      throw new AppError("만료되었거나 처리할 수 없는 결제입니다.", 409, "PAYMENT_INTENT_INVALID");
    }

    if (billingMode() === "dev") {
      if (!parsed.confirmToken || !intent.confirm_token_hash || hashToken(parsed.confirmToken) !== intent.confirm_token_hash) {
        throw new AppError("개발 모드 결제 확인 토큰이 올바르지 않습니다.", 403, "PAYMENT_CONFIRM_DENIED");
      }
    } else {
      const webhookSecret = process.env.SEMFORGE_TOSS_WEBHOOK_SECRET?.trim();
      if (!webhookSecret || parsed.confirmToken !== webhookSecret) {
        throw new AppError("운영 결제는 Toss webhook 또는 관리자 확인이 필요합니다.", 403, "PAYMENT_CONFIRM_DENIED");
      }
    }

    const now = new Date();
    const { start, end } = activatePeriod(now, SEMFORGE_BILLING_PERIOD_DAYS);
    const iso = now.toISOString();
    sqlite.prepare(`
      UPDATE semforge_payment_intents SET status = 'paid', paid_at = ?, updated_at = ? WHERE id = ?
    `).run(iso, iso, intent.id);
    sqlite.prepare(`
      UPDATE semforge_subscriptions
      SET status = 'active', current_period_start = ?, current_period_end = ?, canceled_at = NULL, is_trial = 0, updated_at = ?
      WHERE id = 1
    `).run(start, end, iso);
    return toPublic(ensureSubscriptionRow(sqlite));
  });
}

export function cancelSemforgeSubscription(): SemforgeSubscriptionPublic {
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const now = new Date().toISOString();
    sqlite.prepare(`
      UPDATE semforge_subscriptions SET status = 'canceled', canceled_at = ?, is_trial = 0, updated_at = ? WHERE id = 1
    `).run(now, now);
    return toPublic(ensureSubscriptionRow(sqlite));
  });
}
