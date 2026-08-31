import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  brandName: text("brand_name").notNull().default(""),
  category: text("category").notNull().default(""),
  competitors: text("competitors").notNull().default("[]"),
  openaiApiKey: text("openai_api_key"),
  anthropicApiKey: text("anthropic_api_key"),
  geminiApiKey: text("gemini_api_key"),
  models: text("models").notNull().default("{}"),
  repetitions: integer("repetitions").notNull().default(3),
  modelWeights: text("model_weights").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  brandName: text("brand_name").notNull(),
  category: text("category").notNull().default(""),
  competitors: text("competitors").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const questionSets = sqliteTable("question_sets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const questions = sqliteTable("questions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  questionSetId: integer("question_set_id").references(() => questionSets.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  source: text("source").notNull().default("직접 입력"),
  intent: text("intent").notNull().default("정보 탐색형"),
  segment: text("segment").notNull().default("전체"),
  journeyStage: text("journey_stage").notNull().default("탐색"),
  createdAt: text("created_at").notNull(),
});

export const measureRuns = sqliteTable("measure_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
  status: text("status").notNull(),
  models: text("models").notNull(),
  repetitions: integer("repetitions").notNull(),
  totalQueries: integer("total_queries").notNull(),
  answerShare: real("answer_share").notNull().default(0),
  genrank: real("genrank").notNull().default(0),
  funnelStage: text("funnel_stage").notNull().default("존재"),
  summary: text("summary").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
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

export const audits = sqliteTable("audits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  url: text("url").notNull(),
  score: integer("score").notNull(),
  grade: text("grade").notNull(),
  items: text("items").notNull(),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
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
  tool: text("tool").notNull(),
  input: text("input").notNull(),
  output: text("output").notNull(),
  createdAt: text("created_at").notNull(),
});

export const checklistStates = sqliteTable("checklist_states", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scope: text("scope").notNull(),
  itemKey: text("item_key").notNull(),
  checked: integer("checked", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull(),
});

export const strategyItems = sqliteTable("strategy_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  data: text("data").notNull().default("{}"),
  status: text("status").notNull().default("계획"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
