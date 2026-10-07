/**
 * 콘텐츠 최적화 랩 실행 관리 — FeatGEO 최적화를 백그라운드로 돌리고 진행률·결과를 저장한다.
 * - 실행 입력(사실 메모, API 키, 모델)은 시작 시점에 고정한다. 실행 중 프로젝트를 바꿔도 섞이지 않는다.
 * - 서버가 재시작되면 실행 중이던 작업은 사라지므로, 오래 갱신되지 않은 running 행은 STALE_RUN 실패로 바꾼다.
 */
import * as cheerio from "cheerio";
import { z } from "zod";
import { expectFound, resourceIdSchema } from "./crud";
import { getDatabase } from "./db";
import { AppError } from "./errors";
import { draftFactsForActiveProject } from "./facts";
import { estimateOptimizationCalls, runFeatureOptimization, type OptimizationResult } from "./featgeo";
import { generateText } from "./llm";
import { requireActiveProject } from "./projects";
import { getServerSettings, providers } from "./settings";
import { fetchPublicText } from "./url-security";

const STALE_AFTER_MS = 20 * 60 * 1_000;
const MAX_SOURCE_TEXT = 12_000;

const httpUrl = z.string().trim().max(2048).url().refine((value) => /^https?:\/\//i.test(value), { message: "http 또는 https URL만 허용합니다." });

export const optimizationRequestSchema = z.object({
  title: z.string().trim().max(120).optional().default(""),
  query: z.string().trim().min(5).max(500),
  original: z.string().trim().min(30).max(20_000),
  competitorSources: z.array(z.object({
    label: z.string().trim().max(120),
    url: httpUrl.nullable(),
    text: z.string().trim().min(30).max(MAX_SOURCE_TEXT),
  }).strict()).min(1).max(5),
  allowedSources: z.array(z.string().trim().min(2).max(300)).max(10).optional().default([]),
  quotes: z.array(z.string().trim().min(2).max(300)).max(5).optional().default([]),
  provider: z.enum(providers),
  popsize: z.number().int().min(2).max(8),
  generations: z.number().int().min(0).max(4),
  completions: z.number().int().min(1).max(3),
  seed: z.number().int().min(0).max(2_147_483_647).optional().default(42),
  /** 사용자가 화면에서 확인한 예상 호출 수 — 서버 계산과 다르면 거부한다 */
  confirmedCalls: z.number().int().positive(),
}).strict();

export type OptimizationRequest = z.infer<typeof optimizationRequestSchema>;
type RunStatus = "running" | "completed" | "failed" | "canceled";

interface RunRow {
  id: number; project_id: number; title: string; query: string; input: string; status: RunStatus; progress: string;
  result: string | null; error_code: string | null; cancel_requested: number; created_at: string; updated_at: string; completed_at: string | null;
}

const runningStore = globalThis as typeof globalThis & { __geoOptimizationRuns?: Map<number, Promise<void>> };
function running() {
  runningStore.__geoOptimizationRuns ??= new Map();
  return runningStore.__geoOptimizationRuns;
}

function parse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toRun(row: RunRow) {
  return {
    id: row.id,
    title: row.title,
    query: row.query,
    input: parse<Omit<OptimizationRequest, "confirmedCalls"> | null>(row.input, null),
    status: row.status,
    progress: parse<{ evaluated?: number; total?: number; callsUsed?: number }>(row.progress, {}),
    result: parse<OptimizationResult | null>(row.result, null),
    errorCode: row.error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export type OptimizationRunResource = ReturnType<typeof toRun>;

function markStale(rows: RunRow[]) {
  const { sqlite } = getDatabase();
  const cutoff = Date.now() - STALE_AFTER_MS;
  return rows.map((row) => {
    if (row.status !== "running" || running().has(row.id) || Date.parse(row.updated_at) > cutoff) return row;
    const now = new Date().toISOString();
    sqlite.prepare("UPDATE optimization_runs SET status = 'failed', error_code = 'STALE_RUN', updated_at = ?, completed_at = ? WHERE id = ? AND status = 'running'").run(now, now, row.id);
    return { ...row, status: "failed" as const, error_code: "STALE_RUN", updated_at: now, completed_at: now };
  });
}

function ownedRow(id: number) {
  const row = expectFound(
    getDatabase().sqlite.prepare("SELECT * FROM optimization_runs WHERE id = ?").get(id) as RunRow | undefined,
    "최적화 실행을 찾을 수 없습니다.",
    "OPTIMIZATION_RUN_NOT_FOUND",
  );
  requireActiveProject(row.project_id);
  return markStale([row])[0]!;
}

function update(id: number, fields: Partial<Pick<RunRow, "status" | "progress" | "result" | "error_code" | "completed_at">>) {
  const entries = Object.entries(fields);
  const assignments = [...entries.map(([key]) => `${key} = ?`), "updated_at = ?"].join(", ");
  getDatabase().sqlite.prepare(`UPDATE optimization_runs SET ${assignments} WHERE id = ?`).run(...entries.map(([, value]) => value), new Date().toISOString(), id);
}

function cancelRequested(id: number) {
  const row = getDatabase().sqlite.prepare("SELECT cancel_requested FROM optimization_runs WHERE id = ?").get(id) as { cancel_requested: number } | undefined;
  return !row || row.cancel_requested === 1;
}

async function execute(id: number, request: OptimizationRequest, context: { apiKey: string; model: string; facts: ReturnType<typeof draftFactsForActiveProject>; competitorNames: string[] }) {
  try {
    const result = await runFeatureOptimization({
      query: request.query,
      original: request.original,
      competitorSources: request.competitorSources.map((source) => source.text),
      facts: context.facts,
      allowedSources: request.allowedSources,
      quotes: request.quotes,
      competitorNames: context.competitorNames,
      popsize: request.popsize,
      generations: request.generations,
      completions: request.completions,
      seed: request.seed,
      maxCalls: request.confirmedCalls,
    }, {
      complete: ({ system, prompt, maxTokens }) => generateText({ provider: request.provider, apiKey: context.apiKey, model: context.model, system, prompt, maxTokens }),
      shouldCancel: () => cancelRequested(id),
      onProgress: (progress) => update(id, { progress: JSON.stringify(progress) }),
    });
    const now = new Date().toISOString();
    update(id, {
      status: result.stoppedReason === "canceled" ? "canceled" : "completed",
      result: JSON.stringify(result),
      error_code: result.stoppedReason === "budget" ? "BUDGET_REACHED" : null,
      completed_at: now,
    });
  } catch (error) {
    update(id, { status: "failed", error_code: error instanceof AppError ? error.code : "OPTIMIZATION_FAILED", completed_at: new Date().toISOString() });
  }
}

export function startOptimizationRun(input: unknown): OptimizationRunResource {
  const request = optimizationRequestSchema.parse(input);
  const estimate = estimateOptimizationCalls(request);
  if (request.confirmedCalls !== estimate) {
    throw new AppError(`예상 호출 수(${estimate}회)를 다시 확인해 주세요.`, 422, "CALL_ESTIMATE_MISMATCH", { estimate });
  }
  const active = requireActiveProject();
  const { sqlite } = getDatabase();
  const busy = markStale(sqlite.prepare("SELECT * FROM optimization_runs WHERE project_id = ? AND status = 'running'").all(active.id) as RunRow[]);
  if (busy.some((row) => row.status === "running")) {
    throw new AppError("이 프로젝트에서 최적화가 이미 실행 중입니다. 끝난 뒤 다시 시도해 주세요.", 409, "OPTIMIZATION_ALREADY_RUNNING");
  }
  const settings = getServerSettings([request.provider]);
  const apiKey = settings.decryptedApiKeys[request.provider];
  if (!apiKey) throw new AppError(`${request.provider} API 키를 설정한 뒤 실행해 주세요.`, 409, "API_KEY_REQUIRED");
  const now = new Date().toISOString();
  const id = Number(sqlite.prepare(`
    INSERT INTO optimization_runs (project_id, title, query, input, status, progress, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'running', ?, ?, ?)
  `).run(active.id, request.title || request.query.slice(0, 60), request.query, JSON.stringify(request), JSON.stringify({ evaluated: 0, total: request.popsize * (1 + request.generations), callsUsed: 0 }), now, now).lastInsertRowid);
  const task = execute(id, request, {
    apiKey,
    model: settings.models[request.provider],
    facts: draftFactsForActiveProject(),
    competitorNames: settings.competitors,
  }).finally(() => running().delete(id));
  running().set(id, task);
  return toRun(ownedRow(id));
}

/** 테스트·운영 도구용 — 백그라운드 실행이 끝날 때까지 기다린다 */
export async function waitForOptimizationRun(id: number) {
  await running().get(id);
}

export function listOptimizationRuns(): OptimizationRunResource[] {
  const active = requireActiveProject();
  const rows = getDatabase().sqlite.prepare("SELECT * FROM optimization_runs WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT 50").all(active.id) as RunRow[];
  return markStale(rows).map(toRun);
}

export function getOptimizationRun(idInput: unknown): OptimizationRunResource {
  return toRun(ownedRow(resourceIdSchema.parse(idInput)));
}

export function cancelOptimizationRun(idInput: unknown): OptimizationRunResource {
  const row = ownedRow(resourceIdSchema.parse(idInput));
  if (row.status !== "running") throw new AppError("실행 중인 최적화만 취소할 수 있습니다.", 409, "OPTIMIZATION_NOT_RUNNING");
  getDatabase().sqlite.prepare("UPDATE optimization_runs SET cancel_requested = 1, updated_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
  return toRun(ownedRow(row.id));
}

export function deleteOptimizationRun(idInput: unknown) {
  const row = ownedRow(resourceIdSchema.parse(idInput));
  if (row.status === "running") throw new AppError("실행 중인 최적화는 먼저 취소해 주세요.", 409, "OPTIMIZATION_RUNNING");
  getDatabase().sqlite.prepare("DELETE FROM optimization_runs WHERE id = ?").run(row.id);
}

/** 최근 웹검색 측정에서 브랜드 대신 인용된 페이지 — 경쟁 출처 후보 */
export function suggestedCompetitorPages() {
  const active = requireActiveProject();
  const rows = getDatabase().sqlite.prepare(`
    SELECT id, summary FROM measure_runs WHERE project_id = ? AND status = 'completed' ORDER BY created_at DESC, id DESC LIMIT 20
  `).all(active.id) as { id: number; summary: string }[];
  for (const row of rows) {
    const summary = parse<{ searchMode?: string; citations?: { pagesCitedWithoutBrand?: Array<{ url: string; domain: string; category: string; count: number }> } }>(row.summary, {});
    if (summary.searchMode === "web" && Array.isArray(summary.citations?.pagesCitedWithoutBrand)) {
      return { runId: row.id, pages: summary.citations.pagesCitedWithoutBrand };
    }
  }
  return { runId: null, pages: [] };
}

/** HTML에서 본문 텍스트만 추린다 (스크립트·내비게이션 제거) */
export function extractReadableText(html: string) {
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, header, footer, aside, form, iframe, svg").remove();
  const root = $("main").length ? $("main") : $("article").length ? $("article") : $("body");
  const blocks = root.find("h1, h2, h3, h4, p, li").toArray().map((element) => {
    const text = $(element).text().replace(/\s+/g, " ").trim();
    const tag = element.tagName.toLowerCase();
    if (!text) return "";
    if (/^h[1-4]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${text}`;
    return tag === "li" ? `- ${text}` : text;
  }).filter(Boolean);
  const text = blocks.length ? blocks.join("\n") : root.text().replace(/\s+/g, " ").trim();
  return text.slice(0, MAX_SOURCE_TEXT);
}

export async function fetchSourceText(urlInput: unknown) {
  const url = httpUrl.parse(urlInput);
  const fetched = await fetchPublicText(url);
  if (fetched.status < 200 || fetched.status >= 300) {
    throw new AppError(`페이지를 가져오지 못했습니다 (HTTP ${fetched.status}).`, 502, "SOURCE_FETCH_FAILED");
  }
  const text = /html/i.test(fetched.contentType) || /<\w+[\s>]/.test(fetched.text) ? extractReadableText(fetched.text) : fetched.text.slice(0, MAX_SOURCE_TEXT);
  if (text.length < 30) throw new AppError("페이지에서 본문을 찾지 못했습니다.", 422, "SOURCE_TEXT_EMPTY");
  return { url: fetched.url, title: cheerio.load(fetched.text)("title").first().text().trim() || fetched.url, text };
}
