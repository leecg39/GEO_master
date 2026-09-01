import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  brandName: text("brand_name").notNull(),
  category: text("category").notNull().default(""),
  competitors: text("competitors").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  activeProjectId: integer("active_project_id").references(() => projects.id, { onDelete: "set null" }),
  brandName: text("brand_name").notNull().default(""),
  category: text("category").notNull().default(""),
  competitors: text("competitors").notNull().default("[]"),
  openaiApiKey: text("openai_api_key"),
  anthropicApiKey: text("anthropic_api_key"),
  geminiApiKey: text("gemini_api_key"),
  grokApiKey: text("grok_api_key"),
  subscriptionPin: text("subscription_pin"),
  models: text("models").notNull().default("{}"),
  repetitions: integer("repetitions").notNull().default(3),
  modelWeights: text("model_weights").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const questionSets = sqliteTable("question_sets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull().default(""),
});

export const questions = sqliteTable("questions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  questionSetId: integer("question_set_id").references(() => questionSets.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  source: text("source").notNull().default("직접 입력"),
  intent: text("intent").notNull().default("정보 탐색형"),
  segment: text("segment").notNull().default("전체"),
  journeyStage: text("journey_stage").notNull().default("탐색"),
  position: integer("position").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull().default(""),
});

export const measureRuns = sqliteTable("measure_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
  title: text("title").notNull().default(""),
  notes: text("notes").notNull().default(""),
  clientRequestId: text("client_request_id"),
  status: text("status").notNull(),
  models: text("models").notNull(),
  repetitions: integer("repetitions").notNull(),
  totalQueries: integer("total_queries").notNull(),
  answerShare: real("answer_share").notNull().default(0),
  genrank: real("genrank").notNull().default(0),
  funnelStage: text("funnel_stage").notNull().default("존재"),
  summary: text("summary").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull().default(""),
  completedAt: text("completed_at"),
});

export const measureResults = sqliteTable("measure_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id").notNull().references(() => measureRuns.id, { onDelete: "cascade" }),
  questionText: text("question_text").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  repetition: integer("repetition").notNull(),
  response: text("response").notNull(),
  brandMentioned: integer("brand_mentioned", { mode: "boolean" }).notNull(),
  sentiment: text("sentiment").notNull(),
  mentionRank: integer("mention_rank"),
  competitorMentions: text("competitor_mentions").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
});

export const measurementSchedules = sqliteTable("measurement_schedules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  questions: text("questions").notNull(),
  providers: text("providers").notNull(),
  repetitions: integer("repetitions").notNull(),
  intervalMinutes: integer("interval_minutes").notNull(),
  nextRunAt: text("next_run_at").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  lastErrorCode: text("last_error_code"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const automationPolicy = sqliteTable("automation_policy", {
  id: integer("id").primaryKey(),
  monthlyBudgetUsd: real("monthly_budget_usd").notNull().default(0),
  maxRunCostUsd: real("max_run_cost_usd").notNull().default(0),
  providerCallCosts: text("provider_call_costs").notNull().default("{}"),
  alertThreshold: real("alert_threshold").notNull().default(0.8),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const measurementJobs = sqliteTable("measurement_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
  scheduleId: integer("schedule_id").references(() => measurementSchedules.id, { onDelete: "set null" }),
  runId: integer("run_id").references(() => measureRuns.id, { onDelete: "set null" }),
  attemptOfId: integer("attempt_of_id"),
  status: text("status").notNull(),
  payload: text("payload").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  estimatedCostUsd: real("estimated_cost_usd").notNull(),
  incurredCostUsd: real("incurred_cost_usd").notNull().default(0),
  providerCallCosts: text("provider_call_costs").notNull().default("{}"),
  budgetPeriod: text("budget_period").notNull(),
  budgetCharged: integer("budget_charged", { mode: "boolean" }).notNull().default(false),
  errorCode: text("error_code"),
  availableAt: text("available_at").notNull(),
  workerId: text("worker_id"),
  leaseExpiresAt: text("lease_expires_at"),
  cancelRequested: integer("cancel_requested", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  updatedAt: text("updated_at").notNull(),
});

export const audits = sqliteTable("audits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull().default(""),
  notes: text("notes").notNull().default(""),
  clientRequestId: text("client_request_id"),
  url: text("url").notNull(),
  score: integer("score").notNull(),
  grade: text("grade").notNull(),
  items: text("items").notNull(),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull().default(""),
});

export const auditItems = sqliteTable("audit_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  auditId: integer("audit_id").notNull().references(() => audits.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  category: text("category").notNull(),
  passed: integer("passed", { mode: "boolean" }).notNull(),
  manual: integer("manual", { mode: "boolean" }).notNull(),
  detail: text("detail").notNull(),
});

export const contents = sqliteTable("contents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  tool: text("tool").notNull(),
  title: text("title").notNull().default(""),
  notes: text("notes").notNull().default(""),
  status: text("status").notNull().default("generated"),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  provider: text("provider"),
  clientRequestId: text("client_request_id"),
  input: text("input").notNull(),
  output: text("output").notNull(),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull().default(""),
});

export const contentRevisions = sqliteTable("content_revisions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contentId: integer("content_id").notNull().references(() => contents.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  input: text("input").notNull(),
  output: text("output").notNull(),
  origin: text("origin").notNull().default("generated"),
  createdAt: text("created_at").notNull(),
});

export const checklistStates = sqliteTable("checklist_states", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(),
  itemKey: text("item_key").notNull(),
  checked: integer("checked", { mode: "boolean" }).notNull().default(false),
  note: text("note").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

export const strategyItems = sqliteTable("strategy_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  parentId: integer("parent_id"),
  type: text("type").notNull(),
  title: text("title").notNull(),
  data: text("data").notNull().default("{}"),
  status: text("status").notNull().default("계획"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const llmsDocuments = sqliteTable("llms_documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  website: text("website").notNull(),
  brandName: text("brand_name").notNull().default(""),
  summary: text("summary").notNull().default(""),
  details: text("details").notNull().default(""),
  resources: text("resources").notNull().default("[]"),
  document: text("document").notNull().default(""),
  validation: text("validation").notNull().default("{}"),
  status: text("status").notNull().default("draft"),
  remoteUrl: text("remote_url"),
  remoteContentType: text("remote_content_type"),
  remoteCheckedAt: text("remote_checked_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const reportPresets = sqliteTable("report_presets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  auditId: integer("audit_id").references(() => audits.id, { onDelete: "set null" }),
  runId: integer("run_id").references(() => measureRuns.id, { onDelete: "set null" }),
  config: text("config").notNull().default("{}"),
  defaultFormat: text("default_format").notNull().default("pdf"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const workspaceBackups = sqliteTable("workspace_backups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  schemaVersion: integer("schema_version").notNull(),
  snapshot: text("snapshot").notNull(),
  checksum: text("checksum").notNull(),
  bytes: integer("bytes").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
