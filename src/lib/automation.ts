import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDatabase } from "./db";
import { AppError } from "./errors";
import { runShareMeasurement, shareRunSchema, type ShareMeasurementOptions } from "./share";
import { type Provider } from "./settings";

export const DEFAULT_PROVIDER_CALL_COSTS: Record<Provider, number> = {
  openai: 0.01,
  anthropic: 0.015,
  gemini: 0.005,
  hyperclova: 0.005,
};

const providerCostSchema = z.object({
  openai: z.number().finite().positive().max(100),
  anthropic: z.number().finite().positive().max(100),
  gemini: z.number().finite().positive().max(100),
  hyperclova: z.number().finite().positive().max(100),
}).strict();

export const automationPolicySchema = z.object({
  monthlyBudgetUsd: z.number().finite().min(0).max(100_000),
  maxRunCostUsd: z.number().finite().min(0).max(10_000),
  providerCallCosts: providerCostSchema,
  alertThreshold: z.number().finite().min(0.5).max(0.99),
}).strict();

export const scheduleInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  questions: shareRunSchema.shape.questions,
  providers: shareRunSchema.shape.providers,
  repetitions: z.number().int().min(1).max(5),
  intervalMinutes: z.number().int().min(60).max(525_600),
  nextRunAt: z.string().datetime({ offset: true }),
  enabled: z.boolean(),
}).strict();

export const automationActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("schedule.create"), schedule: scheduleInputSchema }).strict(),
  z.object({ action: z.literal("schedule.update"), id: z.number().int().positive(), schedule: scheduleInputSchema }).strict(),
  z.object({ action: z.literal("schedule.toggle"), id: z.number().int().positive(), enabled: z.boolean() }).strict(),
  z.object({ action: z.literal("schedule.delete"), id: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("schedule.runNow"), id: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("job.cancel"), id: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("job.retry"), id: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("queue.process") }).strict(),
  z.object({ action: z.literal("policy.update"), policy: automationPolicySchema }).strict(),
]);

export type AutomationPolicy = z.infer<typeof automationPolicySchema>;
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;
export type JobStatus = "queued" | "running" | "completed" | "failed" | "canceled" | "blocked";

type MeasurementPayload = z.infer<typeof shareRunSchema> & { repetitions: number };
type MeasurementExecutor = (
  input: unknown,
  options?: ShareMeasurementOptions,
) => Promise<{ id: number }>;

interface PolicyRow {
  monthly_budget_usd: number;
  max_run_cost_usd: number;
  provider_call_costs: string;
  alert_threshold: number;
}

interface ScheduleRow {
  id: number;
  name: string;
  questions: string;
  providers: string;
  repetitions: number;
  interval_minutes: number;
  next_run_at: string;
  enabled: number;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
}

interface JobRow {
  id: number;
  schedule_id: number | null;
  run_id: number | null;
  attempt_of_id: number | null;
  status: JobStatus;
  payload: string;
  idempotency_key: string;
  estimated_cost_usd: number;
  incurred_cost_usd: number;
  provider_call_costs: string;
  budget_period: string;
  budget_charged: number;
  error_code: string | null;
  available_at: string;
  worker_id: string | null;
  lease_expires_at: string | null;
  cancel_requested: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function roundMoney(value: number) {
  return Number(value.toFixed(6));
}

function budgetPeriod(date: Date) {
  return date.toISOString().slice(0, 7);
}

function payloadFromSchedule(input: Pick<ScheduleInput, "questions" | "providers" | "repetitions">): MeasurementPayload {
  const parsed = shareRunSchema.parse(input);
  return { ...parsed, repetitions: input.repetitions };
}

function ensurePolicy(now = new Date()) {
  const sqlite = getDatabase().sqlite;
  sqlite.prepare(`
    INSERT OR IGNORE INTO automation_policy (
      id, monthly_budget_usd, max_run_cost_usd, provider_call_costs, alert_threshold, created_at, updated_at
    ) VALUES (1, 0, 0, ?, 0.8, ?, ?)
  `).run(JSON.stringify(DEFAULT_PROVIDER_CALL_COSTS), now.toISOString(), now.toISOString());
}

export function getAutomationPolicy(): AutomationPolicy {
  ensurePolicy();
  const row = getDatabase().sqlite.prepare(`
    SELECT monthly_budget_usd, max_run_cost_usd, provider_call_costs, alert_threshold
    FROM automation_policy WHERE id = 1
  `).get() as PolicyRow;
  const rawCosts = parseJson<Record<string, unknown>>(row.provider_call_costs, {});
  const parsedCosts = providerCostSchema.safeParse({
    openai: rawCosts.openai ?? DEFAULT_PROVIDER_CALL_COSTS.openai,
    anthropic: rawCosts.anthropic ?? DEFAULT_PROVIDER_CALL_COSTS.anthropic,
    gemini: rawCosts.gemini ?? DEFAULT_PROVIDER_CALL_COSTS.gemini,
    hyperclova: rawCosts.hyperclova ?? DEFAULT_PROVIDER_CALL_COSTS.hyperclova,
  });
  return automationPolicySchema.parse({
    monthlyBudgetUsd: row.monthly_budget_usd,
    maxRunCostUsd: row.max_run_cost_usd,
    providerCallCosts: parsedCosts.success ? parsedCosts.data : DEFAULT_PROVIDER_CALL_COSTS,
    alertThreshold: row.alert_threshold,
  });
}

export function updateAutomationPolicy(input: unknown) {
  const policy = automationPolicySchema.parse(input);
  ensurePolicy();
  getDatabase().sqlite.prepare(`
    UPDATE automation_policy SET monthly_budget_usd = ?, max_run_cost_usd = ?,
      provider_call_costs = ?, alert_threshold = ?, updated_at = ? WHERE id = 1
  `).run(
    policy.monthlyBudgetUsd,
    policy.maxRunCostUsd,
    JSON.stringify(policy.providerCallCosts),
    policy.alertThreshold,
    new Date().toISOString(),
  );
  return getAutomationPolicy();
}

export function estimateMeasurementCost(
  input: Pick<MeasurementPayload, "questions" | "providers" | "repetitions">,
  providerCallCosts: Record<Provider, number>,
) {
  const repetitions = input.repetitions;
  const baseCalls = input.questions.length * repetitions * input.providers.length;
  const maximumCalls = baseCalls * 2;
  const estimatedCostUsd = roundMoney(input.providers.reduce((sum, provider) => (
    sum + input.questions.length * repetitions * 2 * (providerCallCosts[provider] ?? 0)
  ), 0));
  return { baseCalls, maximumCalls, estimatedCostUsd };
}

export function nextScheduleTime(slot: string, intervalMinutes: number, now: Date) {
  const slotMs = new Date(slot).getTime();
  const stepMs = intervalMinutes * 60_000;
  if (!Number.isFinite(slotMs) || !Number.isFinite(stepMs) || stepMs <= 0) {
    throw new AppError("예약 시각이나 반복 간격이 올바르지 않습니다.", 422, "INVALID_SCHEDULE_TIME");
  }
  if (slotMs > now.getTime()) return new Date(slotMs).toISOString();
  const jumps = Math.floor((now.getTime() - slotMs) / stepMs) + 1;
  return new Date(slotMs + jumps * stepMs).toISOString();
}

function jobById(id: number) {
  return getDatabase().sqlite.prepare("SELECT * FROM measurement_jobs WHERE id = ?").get(id) as JobRow | undefined;
}

function publicJob(row: JobRow) {
  const payload = shareRunSchema.safeParse(parseJson(row.payload, null));
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    runId: row.run_id,
    attemptOfId: row.attempt_of_id,
    status: row.status,
    providers: payload.success ? payload.data.providers : [],
    questionCount: payload.success ? payload.data.questions.length : 0,
    repetitions: payload.success ? payload.data.repetitions ?? 0 : 0,
    estimatedCostUsd: row.estimated_cost_usd,
    incurredCostUsd: row.incurred_cost_usd,
    budgetPeriod: row.budget_period,
    errorCode: row.error_code,
    cancelRequested: Boolean(row.cancel_requested),
    availableAt: row.available_at,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function usedBudget(period: string) {
  const row = getDatabase().sqlite.prepare(`
    SELECT COALESCE(SUM(
      CASE WHEN status IN ('queued','running') THEN estimated_cost_usd ELSE incurred_cost_usd END
    ), 0) AS total
    FROM measurement_jobs WHERE budget_period = ? AND budget_charged = 1
  `).get(period) as { total: number };
  return roundMoney(row.total);
}

function enqueueMeasurementJob({
  payload: rawPayload,
  scheduleId = null,
  attemptOfId = null,
  idempotencyKey,
  availableAt = new Date(),
  now = new Date(),
  onReserved,
}: {
  payload: unknown;
  scheduleId?: number | null;
  attemptOfId?: number | null;
  idempotencyKey: string;
  availableAt?: Date;
  now?: Date;
  onReserved?: () => void;
}) {
  const parsed = shareRunSchema.parse(rawPayload);
  const payload: MeasurementPayload = { ...parsed, repetitions: parsed.repetitions ?? 1 };
  const policy = getAutomationPolicy();
  const estimate = estimateMeasurementCost(payload, policy.providerCallCosts);
  const period = budgetPeriod(now);
  const sqlite = getDatabase().sqlite;

  const reserve = sqlite.transaction(() => {
    const existing = sqlite.prepare("SELECT * FROM measurement_jobs WHERE idempotency_key = ?").get(idempotencyKey) as JobRow | undefined;
    if (existing) {
      onReserved?.();
      return existing;
    }

    const currentUsage = usedBudget(period);
    let errorCode: string | null = null;
    if (policy.monthlyBudgetUsd <= 0 || policy.maxRunCostUsd <= 0) errorCode = "COST_POLICY_DISABLED";
    else if (estimate.estimatedCostUsd > policy.maxRunCostUsd) errorCode = "RUN_COST_LIMIT_EXCEEDED";
    else if (currentUsage + estimate.estimatedCostUsd > policy.monthlyBudgetUsd) errorCode = "MONTHLY_BUDGET_EXCEEDED";
    const status: JobStatus = errorCode ? "blocked" : "queued";
    const timestamp = now.toISOString();
    const result = sqlite.prepare(`
      INSERT INTO measurement_jobs (
        schedule_id, attempt_of_id, status, payload, idempotency_key, estimated_cost_usd,
        incurred_cost_usd, provider_call_costs, budget_period, budget_charged, error_code,
        available_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      scheduleId,
      attemptOfId,
      status,
      JSON.stringify(payload),
      idempotencyKey,
      estimate.estimatedCostUsd,
      0,
      JSON.stringify(policy.providerCallCosts),
      period,
      status === "queued" ? 1 : 0,
      errorCode,
      availableAt.toISOString(),
      timestamp,
      timestamp,
    );
    onReserved?.();
    return jobById(Number(result.lastInsertRowid))!;
  });
  return publicJob(reserve.immediate());
}

function scheduleFromRow(row: ScheduleRow) {
  const input = scheduleInputSchema.parse({
    name: row.name,
    questions: parseJson(row.questions, []),
    providers: parseJson(row.providers, []),
    repetitions: row.repetitions,
    intervalMinutes: row.interval_minutes,
    nextRunAt: row.next_run_at,
    enabled: Boolean(row.enabled),
  });
  return { id: row.id, ...input, lastErrorCode: row.last_error_code, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function createSchedule(input: unknown) {
  const schedule = scheduleInputSchema.parse(input);
  const now = new Date().toISOString();
  const result = getDatabase().sqlite.prepare(`
    INSERT INTO measurement_schedules (
      name, questions, providers, repetitions, interval_minutes, next_run_at, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    schedule.name,
    JSON.stringify(schedule.questions),
    JSON.stringify(schedule.providers),
    schedule.repetitions,
    schedule.intervalMinutes,
    new Date(schedule.nextRunAt).toISOString(),
    schedule.enabled ? 1 : 0,
    now,
    now,
  );
  return getSchedule(Number(result.lastInsertRowid));
}

export function getSchedule(id: number) {
  const row = getDatabase().sqlite.prepare("SELECT * FROM measurement_schedules WHERE id = ?").get(id) as ScheduleRow | undefined;
  if (!row) throw new AppError("예약을 찾을 수 없습니다.", 404, "SCHEDULE_NOT_FOUND");
  return scheduleFromRow(row);
}

export function updateSchedule(id: number, input: unknown) {
  getSchedule(id);
  const schedule = scheduleInputSchema.parse(input);
  getDatabase().sqlite.prepare(`
    UPDATE measurement_schedules SET name = ?, questions = ?, providers = ?, repetitions = ?,
      interval_minutes = ?, next_run_at = ?, enabled = ?, last_error_code = NULL, updated_at = ? WHERE id = ?
  `).run(
    schedule.name,
    JSON.stringify(schedule.questions),
    JSON.stringify(schedule.providers),
    schedule.repetitions,
    schedule.intervalMinutes,
    new Date(schedule.nextRunAt).toISOString(),
    schedule.enabled ? 1 : 0,
    new Date().toISOString(),
    id,
  );
  return getSchedule(id);
}

export function toggleSchedule(id: number, enabled: boolean) {
  getSchedule(id);
  getDatabase().sqlite.prepare("UPDATE measurement_schedules SET enabled = ?, last_error_code = NULL, updated_at = ? WHERE id = ?")
    .run(enabled ? 1 : 0, new Date().toISOString(), id);
  return getSchedule(id);
}

export function deleteSchedule(id: number) {
  const result = getDatabase().sqlite.prepare("DELETE FROM measurement_schedules WHERE id = ?").run(id);
  if (!result.changes) throw new AppError("예약을 찾을 수 없습니다.", 404, "SCHEDULE_NOT_FOUND");
  return { id };
}

export function runScheduleNow(id: number) {
  const schedule = getSchedule(id);
  return enqueueMeasurementJob({
    payload: payloadFromSchedule(schedule),
    scheduleId: id,
    idempotencyKey: `manual:${id}:${randomUUID()}`,
  });
}

export function enqueueDueSchedules(now = new Date()) {
  const sqlite = getDatabase().sqlite;
  const rows = sqlite.prepare(`
    SELECT * FROM measurement_schedules
    WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at ASC LIMIT 100
  `).all(now.toISOString()) as ScheduleRow[];
  const jobs: ReturnType<typeof publicJob>[] = [];
  for (const row of rows) {
    let schedule: ReturnType<typeof scheduleFromRow>;
    try {
      schedule = scheduleFromRow(row);
    } catch {
      sqlite.prepare(`
        UPDATE measurement_schedules SET enabled = 0, last_error_code = 'INVALID_SCHEDULE_DATA', updated_at = ? WHERE id = ?
      `).run(now.toISOString(), row.id);
      console.error("Automation schedule disabled", "INVALID_SCHEDULE_DATA");
      continue;
    }
    const slot = schedule.nextRunAt;
    const followingSlot = nextScheduleTime(slot, schedule.intervalMinutes, now);
    try {
      jobs.push(enqueueMeasurementJob({
        payload: payloadFromSchedule(schedule),
        scheduleId: schedule.id,
        idempotencyKey: `schedule:${schedule.id}:${slot}`,
        now,
        onReserved: () => {
          sqlite.prepare(`
            UPDATE measurement_schedules SET next_run_at = ?, last_error_code = NULL, updated_at = ?
            WHERE id = ? AND next_run_at = ?
          `).run(followingSlot, now.toISOString(), schedule.id, slot);
        },
      }));
    } catch {
      sqlite.prepare("UPDATE measurement_schedules SET last_error_code = 'SCHEDULE_ENQUEUE_FAILED', updated_at = ? WHERE id = ?")
        .run(now.toISOString(), row.id);
      console.error("Automation schedule enqueue failed", "SCHEDULE_ENQUEUE_FAILED");
    }
  }
  return jobs;
}

export function recoverStaleJobs(now = new Date()) {
  const sqlite = getDatabase().sqlite;
  const stale = sqlite.prepare(`
    SELECT id, run_id FROM measurement_jobs
    WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?
  `).all(now.toISOString()) as { id: number; run_id: number | null }[];
  const recover = sqlite.transaction(() => {
    for (const job of stale) {
      sqlite.prepare(`
        UPDATE measurement_jobs SET status = 'failed', error_code = 'STALE_LEASE', worker_id = NULL,
          lease_expires_at = NULL, completed_at = ?, updated_at = ? WHERE id = ? AND status = 'running'
      `).run(now.toISOString(), now.toISOString(), job.id);
      if (job.run_id) {
        sqlite.prepare(`
          UPDATE measure_runs SET status = 'failed', summary = ?, completed_at = ?
          WHERE id = ? AND status = 'running'
        `).run(JSON.stringify({ error: "STALE_LEASE" }), now.toISOString(), job.run_id);
      }
    }
  });
  recover.immediate();
  return stale.length;
}

export function claimNextJob(workerId: string, now = new Date()) {
  const leaseExpiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
  const row = getDatabase().sqlite.prepare(`
    UPDATE measurement_jobs SET status = 'running', worker_id = ?, started_at = ?,
      lease_expires_at = ?, updated_at = ?
    WHERE id = (
      SELECT id FROM measurement_jobs
      WHERE status = 'queued' AND available_at <= ?
      ORDER BY available_at ASC, id ASC LIMIT 1
    ) AND status = 'queued'
    RETURNING *
  `).get(workerId, now.toISOString(), leaseExpiresAt, now.toISOString(), now.toISOString()) as JobRow | undefined;
  return row ? publicJob(row) : null;
}

export async function processNextJob({
  workerId = `worker:${process.pid}:${randomUUID()}`,
  execute = runShareMeasurement as MeasurementExecutor,
  now = new Date(),
}: {
  workerId?: string;
  execute?: MeasurementExecutor;
  now?: Date;
} = {}) {
  recoverStaleJobs(now);
  const claimed = claimNextJob(workerId, now);
  if (!claimed) return null;
  const sqlite = getDatabase().sqlite;
  const row = jobById(claimed.id)!;
  const payload = shareRunSchema.safeParse(parseJson(row.payload, null));
  if (!payload.success) {
    sqlite.prepare(`
      UPDATE measurement_jobs SET status = 'failed', error_code = 'INVALID_JOB_PAYLOAD',
        completed_at = ?, lease_expires_at = NULL, worker_id = NULL, updated_at = ? WHERE id = ?
    `).run(new Date().toISOString(), new Date().toISOString(), row.id);
    return publicJob(jobById(row.id)!);
  }

  const heartbeat = setInterval(() => {
    const timestamp = new Date();
    sqlite.prepare(`
      UPDATE measurement_jobs SET lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND status = 'running' AND worker_id = ?
    `).run(new Date(timestamp.getTime() + 10 * 60_000).toISOString(), timestamp.toISOString(), row.id, workerId);
  }, 30_000);
  heartbeat.unref?.();

  const storedCosts = providerCostSchema.safeParse(parseJson(row.provider_call_costs, null));
  const callCosts = storedCosts.success ? storedCosts.data : getAutomationPolicy().providerCallCosts;
  try {
    const result = await execute(payload.data, {
      shouldCancel: () => Boolean((sqlite.prepare("SELECT cancel_requested FROM measurement_jobs WHERE id = ?").get(row.id) as { cancel_requested: number } | undefined)?.cancel_requested),
      onRunCreated: (runId) => {
        sqlite.prepare(`
          UPDATE measurement_jobs SET run_id = ?, updated_at = ?
          WHERE id = ? AND status = 'running' AND worker_id = ?
        `).run(runId, new Date().toISOString(), row.id, workerId);
      },
      onBillableCall: (provider) => {
        sqlite.prepare(`
          UPDATE measurement_jobs SET incurred_cost_usd = incurred_cost_usd + ?, updated_at = ? WHERE id = ?
        `).run(callCosts[provider], new Date().toISOString(), row.id);
      },
    });
    const timestamp = new Date().toISOString();
    const completed = sqlite.prepare(`
      UPDATE measurement_jobs SET status = 'completed', run_id = ?, error_code = NULL,
        completed_at = ?, lease_expires_at = NULL, worker_id = NULL, updated_at = ?
      WHERE id = ? AND status = 'running' AND worker_id = ?
    `).run(result.id, timestamp, timestamp, row.id, workerId);
    if (!completed.changes) {
      const current = jobById(row.id);
      const run = sqlite.prepare("SELECT status FROM measure_runs WHERE id = ?").get(result.id) as { status: string } | undefined;
      if (current?.status === "failed" && current.error_code === "STALE_LEASE" && run?.status === "completed") {
        sqlite.prepare(`
          UPDATE measurement_jobs SET status = 'completed', run_id = ?, error_code = NULL,
            completed_at = ?, lease_expires_at = NULL, worker_id = NULL, updated_at = ?
          WHERE id = ? AND status = 'failed' AND error_code = 'STALE_LEASE'
        `).run(result.id, timestamp, timestamp, row.id);
      }
    }
  } catch (error) {
    const code = error instanceof AppError ? error.code : "JOB_EXECUTION_FAILED";
    const status: JobStatus = code === "JOB_CANCELED" ? "canceled" : "failed";
    const timestamp = new Date().toISOString();
    sqlite.prepare(`
      UPDATE measurement_jobs SET status = ?, error_code = ?, completed_at = ?,
        lease_expires_at = NULL, worker_id = NULL, updated_at = ?
      WHERE id = ? AND status = 'running' AND worker_id = ?
    `).run(status, code, timestamp, timestamp, row.id, workerId);
  } finally {
    clearInterval(heartbeat);
  }
  return publicJob(jobById(row.id)!);
}

export function cancelJob(id: number) {
  const row = jobById(id);
  if (!row) throw new AppError("작업을 찾을 수 없습니다.", 404, "JOB_NOT_FOUND");
  const now = new Date().toISOString();
  if (row.status === "queued") {
    getDatabase().sqlite.prepare(`
      UPDATE measurement_jobs SET status = 'canceled', budget_charged = 0, error_code = 'USER_CANCELED',
        completed_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'
    `).run(now, now, id);
  } else if (row.status === "running") {
    getDatabase().sqlite.prepare("UPDATE measurement_jobs SET cancel_requested = 1, updated_at = ? WHERE id = ? AND status = 'running'")
      .run(now, id);
  } else {
    throw new AppError("대기 또는 실행 중인 작업만 취소할 수 있습니다.", 409, "JOB_NOT_CANCELABLE");
  }
  return publicJob(jobById(id)!);
}

export function retryJob(id: number) {
  const row = jobById(id);
  if (!row) throw new AppError("작업을 찾을 수 없습니다.", 404, "JOB_NOT_FOUND");
  if (!(["failed", "blocked", "canceled"] as JobStatus[]).includes(row.status)) {
    throw new AppError("실패·차단·취소된 작업만 다시 시도할 수 있습니다.", 409, "JOB_NOT_RETRYABLE");
  }
  return enqueueMeasurementJob({
    payload: parseJson(row.payload, null),
    scheduleId: row.schedule_id,
    attemptOfId: row.id,
    idempotencyKey: `retry:${row.id}:${randomUUID()}`,
  });
}

export function getAutomationState(now = new Date()) {
  const sqlite = getDatabase().sqlite;
  const policy = getAutomationPolicy();
  const period = budgetPeriod(now);
  const usedUsd = usedBudget(period);
  const reservedRow = sqlite.prepare(`
    SELECT COALESCE(SUM(estimated_cost_usd), 0) AS total FROM measurement_jobs
    WHERE budget_period = ? AND budget_charged = 1 AND status IN ('queued','running')
  `).get(period) as { total: number };
  const consumedRow = sqlite.prepare(`
    SELECT COALESCE(SUM(incurred_cost_usd), 0) AS total FROM measurement_jobs
    WHERE budget_period = ? AND budget_charged = 1 AND status IN ('completed','failed','canceled')
  `).get(period) as { total: number };
  const schedules = (sqlite.prepare("SELECT * FROM measurement_schedules ORDER BY created_at DESC").all() as ScheduleRow[])
    .map((row) => {
      try {
        const schedule = scheduleFromRow(row);
        return { ...schedule, estimate: estimateMeasurementCost(payloadFromSchedule(schedule), policy.providerCallCosts) };
      } catch {
        return {
          id: row.id,
          name: row.name,
          questions: [],
          providers: [] as Provider[],
          repetitions: row.repetitions,
          intervalMinutes: row.interval_minutes,
          nextRunAt: Number.isFinite(new Date(row.next_run_at).getTime()) ? row.next_run_at : row.created_at,
          enabled: false,
          lastErrorCode: row.last_error_code ?? "INVALID_SCHEDULE_DATA",
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          estimate: { baseCalls: 0, maximumCalls: 0, estimatedCostUsd: 0 },
        };
      }
    });
  const jobs = (sqlite.prepare("SELECT * FROM measurement_jobs ORDER BY id DESC LIMIT 50").all() as JobRow[]).map(publicJob);
  const usagePercent = policy.monthlyBudgetUsd > 0 ? (usedUsd / policy.monthlyBudgetUsd) * 100 : 0;
  return {
    policy,
    budget: {
      period,
      usedUsd,
      reservedUsd: roundMoney(reservedRow.total),
      consumedUsd: roundMoney(consumedRow.total),
      remainingUsd: roundMoney(Math.max(0, policy.monthlyBudgetUsd - usedUsd)),
      usagePercent: Number(usagePercent.toFixed(1)),
      alert: policy.monthlyBudgetUsd > 0 && usagePercent >= policy.alertThreshold * 100,
    },
    schedules,
    jobs,
  };
}

interface WorkerState {
  workerId: string;
  timer: ReturnType<typeof setInterval>;
}

interface QueueExecutionState { busy: boolean }

const globalWorker = globalThis as typeof globalThis & {
  __geoAutomationWorker?: WorkerState;
  __geoAutomationQueue?: QueueExecutionState;
};

export async function processAutomationQueue(options: Parameters<typeof processNextJob>[0] = {}) {
  globalWorker.__geoAutomationQueue ??= { busy: false };
  if (globalWorker.__geoAutomationQueue.busy) return null;
  globalWorker.__geoAutomationQueue.busy = true;
  try {
    enqueueDueSchedules();
    return await processNextJob(options);
  } finally {
    globalWorker.__geoAutomationQueue.busy = false;
  }
}

export function startAutomationWorker() {
  if (
    process.env.NODE_ENV === "test" ||
    process.env.GEO_DISABLE_AUTOMATION_WORKER === "1" ||
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.npm_lifecycle_event === "build"
  ) return null;
  if (globalWorker.__geoAutomationWorker) return globalWorker.__geoAutomationWorker.workerId;
  const state: WorkerState = {
    workerId: `worker:${process.pid}:${randomUUID()}`,
    timer: undefined as unknown as ReturnType<typeof setInterval>,
  };
  const tick = async () => {
    try {
      await processAutomationQueue({ workerId: state.workerId });
    } catch (error) {
      console.error("Automation worker tick failed", error instanceof AppError ? error.code : "INTERNAL_ERROR");
    }
  };
  state.timer = setInterval(() => { void tick(); }, 30_000);
  state.timer.unref?.();
  globalWorker.__geoAutomationWorker = state;
  void tick();
  return state.workerId;
}
