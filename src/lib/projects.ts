import { z } from "zod";
import {
  assertDeleteAllowed,
  assertExpectedUpdatedAt,
  collectionQuerySchema,
  cursorPage,
  decodeCursor,
  expectFound,
  resourceIdSchema,
  transactionalMutation,
} from "./crud";
import { getDatabase } from "./db";
import { AppError } from "./errors";
import { ensureSettingsRow } from "./settings";

const projectFields = {
  name: z.string().trim().min(1).max(120),
  brandName: z.string().trim().max(120),
  category: z.string().trim().max(120),
  competitors: z.array(z.string().trim().min(1).max(120)).max(20),
};

export const projectCreateSchema = z.object({
  ...projectFields,
  activate: z.boolean().optional().default(false),
}).strict();

export const projectUpdateSchema = z.object({
  name: projectFields.name.optional(),
  brandName: projectFields.brandName.optional(),
  category: projectFields.category.optional(),
  competitors: projectFields.competitors.optional(),
  expectedUpdatedAt: z.string().min(1).max(64),
}).strict().refine(
  (value) => value.name !== undefined || value.brandName !== undefined || value.category !== undefined || value.competitors !== undefined,
  { message: "수정할 프로젝트 필드를 하나 이상 입력해 주세요." },
);

export const projectDeleteSchema = z.object({
  expectedUpdatedAt: z.string().min(1).max(64),
  cascadeConfirmed: z.boolean().default(false),
  replacementProjectId: resourceIdSchema.optional(),
}).strict();

interface ProjectRow {
  id: number;
  name: string;
  brand_name: string;
  domain: string;
  category: string;
  competitors: string;
  created_at: string;
  updated_at: string;
}

interface SettingsProjectRow {
  active_project_id: number | null;
  brand_name: string;
  category: string;
  competitors: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectResource {
  id: number;
  name: string;
  brandName: string;
  domain: string;
  category: string;
  competitors: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDependencies extends Record<string, number> {
  questionSets: number;
  measurementRuns: number;
  measurementSchedules: number;
  measurementJobs: number;
  audits: number;
  contents: number;
  checklistStates: number;
  strategyItems: number;
  llmsDocuments: number;
  reportPresets: number;
}

function parseCompetitors(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function normalizeCompetitors(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function toProject(row: ProjectRow, activeProjectId: number | null): ProjectResource {
  return {
    id: row.id,
    name: row.name,
    brandName: row.brand_name,
    domain: row.domain ?? "",
    category: row.category,
    competitors: parseCompetitors(row.competitors),
    active: row.id === activeProjectId,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function findProjectRow(id: number) {
  const { sqlite } = getDatabase();
  return sqlite.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
}

function nextTimestamp(previous?: string) {
  const now = Date.now();
  const previousTime = previous ? Date.parse(previous) : Number.NaN;
  return new Date(Number.isFinite(previousTime) && previousTime >= now ? previousTime + 1 : now).toISOString();
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function activeId() {
  const { sqlite } = getDatabase();
  return (sqlite.prepare("SELECT active_project_id FROM settings WHERE id = 1").get() as { active_project_id: number | null } | undefined)?.active_project_id ?? null;
}

function countProjectDependencies(projectId: number): ProjectDependencies {
  const { sqlite } = getDatabase();
  const count = (table: string) => (sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE project_id = ?`).get(projectId) as { count: number }).count;
  return {
    questionSets: count("question_sets"),
    measurementRuns: count("measure_runs"),
    measurementSchedules: count("measurement_schedules"),
    measurementJobs: count("measurement_jobs"),
    audits: count("audits"),
    contents: count("contents"),
    checklistStates: count("checklist_states"),
    strategyItems: count("strategy_items"),
    llmsDocuments: count("llms_documents"),
    reportPresets: count("report_presets"),
  };
}

/** Ensures settings and a valid active project exist, including on a brand-new database. */
export function ensureActiveProject(): ProjectResource {
  ensureSettingsRow();
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const settings = expectFound(
      sqlite.prepare("SELECT active_project_id, brand_name, category, competitors, created_at, updated_at FROM settings WHERE id = 1").get() as SettingsProjectRow | undefined,
      "전역 설정을 찾을 수 없습니다.",
      "SETTINGS_NOT_FOUND",
    );
    let project = settings.active_project_id ? findProjectRow(settings.active_project_id) : undefined;
    project ??= sqlite.prepare("SELECT * FROM projects ORDER BY created_at ASC, id ASC LIMIT 1").get() as ProjectRow | undefined;

    if (!project) {
      const now = new Date().toISOString();
      const result = sqlite.prepare(`
        INSERT INTO projects (name, brand_name, category, competitors, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        settings.brand_name || "기본 프로젝트",
        settings.brand_name,
        settings.category,
        settings.competitors,
        now,
        now,
      );
      project = expectFound(findProjectRow(Number(result.lastInsertRowid)), "기본 프로젝트를 만들지 못했습니다.", "PROJECT_CREATE_FAILED");
    }

    if (settings.active_project_id !== project.id) {
      sqlite.prepare("UPDATE settings SET active_project_id = ? WHERE id = 1").run(project.id);
    }
    return toProject(project, project.id);
  });
}

export function listProjects(input: unknown) {
  const query = collectionQuerySchema.parse(input);
  const activeProject = ensureActiveProject();
  const where: string[] = [];
  const parameters: Array<string | number> = [];
  if (query.q) {
    const pattern = `%${escapeLike(query.q)}%`;
    where.push("(name LIKE ? ESCAPE '\\' OR brand_name LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\')");
    parameters.push(pattern, pattern, pattern);
  }
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    where.push("(created_at < ? OR (created_at = ? AND id < ?))");
    parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
  }
  const { sqlite } = getDatabase();
  const rows = sqlite.prepare(`
    SELECT * FROM projects
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(...parameters, query.limit + 1) as ProjectRow[];
  return {
    ...cursorPage(rows.map((row) => toProject(row, activeProject.id)), query.limit, (project) => ({
      timestamp: project.createdAt,
      id: project.id,
    })),
    activeProject,
  };
}

export function getProject(idInput: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const activeProject = ensureActiveProject();
  const row = expectFound(findProjectRow(id), "프로젝트를 찾을 수 없습니다.", "PROJECT_NOT_FOUND");
  return toProject(row, activeProject.id);
}

export function getProjectDetail(idInput: unknown) {
  const project = getProject(idInput);
  return { project, dependencies: countProjectDependencies(project.id) };
}

export function createProject(input: unknown) {
  const parsed = projectCreateSchema.parse(input);
  ensureSettingsRow();
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const settings = expectFound(
      sqlite.prepare("SELECT active_project_id FROM settings WHERE id = 1").get() as { active_project_id: number | null } | undefined,
      "전역 설정을 찾을 수 없습니다.",
      "SETTINGS_NOT_FOUND",
    );
    const currentActive = settings.active_project_id ? findProjectRow(settings.active_project_id) : undefined;
    const now = new Date().toISOString();
    const result = sqlite.prepare(`
      INSERT INTO projects (name, brand_name, category, competitors, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      parsed.name,
      parsed.brandName,
      parsed.category,
      JSON.stringify(normalizeCompetitors(parsed.competitors)),
      now,
      now,
    );
    const row = expectFound(findProjectRow(Number(result.lastInsertRowid)), "프로젝트를 만들지 못했습니다.", "PROJECT_CREATE_FAILED");
    const shouldActivate = parsed.activate || !currentActive;
    if (shouldActivate) {
      sqlite.prepare("UPDATE settings SET active_project_id = ? WHERE id = 1").run(row.id);
    }
    return toProject(row, shouldActivate ? row.id : currentActive!.id);
  });
}

export function updateProject(idInput: unknown, input: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const parsed = projectUpdateSchema.parse(input);
  ensureActiveProject();
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const row = expectFound(findProjectRow(id), "프로젝트를 찾을 수 없습니다.", "PROJECT_NOT_FOUND");
    assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
    const updatedAt = nextTimestamp(row.updated_at);
    sqlite.prepare(`
      UPDATE projects SET name = ?, brand_name = ?, category = ?, competitors = ?, updated_at = ? WHERE id = ?
    `).run(
      parsed.name ?? row.name,
      parsed.brandName ?? row.brand_name,
      parsed.category ?? row.category,
      parsed.competitors === undefined ? row.competitors : JSON.stringify(normalizeCompetitors(parsed.competitors)),
      updatedAt,
      id,
    );
    return toProject(expectFound(findProjectRow(id), "프로젝트를 찾을 수 없습니다.", "PROJECT_NOT_FOUND"), activeId());
  });
}

export function activateProject(idInput: unknown) {
  const id = resourceIdSchema.parse(idInput);
  ensureActiveProject();
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const row = expectFound(findProjectRow(id), "프로젝트를 찾을 수 없습니다.", "PROJECT_NOT_FOUND");
    sqlite.prepare("UPDATE settings SET active_project_id = ? WHERE id = 1").run(id);
    return toProject(row, id);
  });
}

export function deleteProject(idInput: unknown, input: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const parsed = projectDeleteSchema.parse(input);
  ensureActiveProject();
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const row = expectFound(findProjectRow(id), "프로젝트를 찾을 수 없습니다.", "PROJECT_NOT_FOUND");
    assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
    const settings = expectFound(
      sqlite.prepare("SELECT active_project_id FROM settings WHERE id = 1").get() as { active_project_id: number | null } | undefined,
      "전역 설정을 찾을 수 없습니다.",
      "SETTINGS_NOT_FOUND",
    );
    const projectCount = (sqlite.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number }).count;
    if (projectCount <= 1) {
      throw new AppError("마지막 프로젝트는 삭제할 수 없습니다.", 409, "LAST_PROJECT_REQUIRED");
    }

    let replacement: ProjectRow | undefined;
    if (settings.active_project_id === id) {
      if (!parsed.replacementProjectId || parsed.replacementProjectId === id) {
        throw new AppError("활성 프로젝트를 삭제하려면 대체 프로젝트를 선택해 주세요.", 409, "PROJECT_REPLACEMENT_REQUIRED");
      }
      replacement = findProjectRow(parsed.replacementProjectId);
      if (!replacement) {
        throw new AppError("대체 프로젝트를 찾을 수 없습니다.", 409, "PROJECT_REPLACEMENT_NOT_FOUND");
      }
    }

    const dependencies = countProjectDependencies(id);
    assertDeleteAllowed(dependencies, parsed.cascadeConfirmed, "PROJECT_HAS_DEPENDENCIES");

    if (replacement) {
      sqlite.prepare("UPDATE settings SET active_project_id = ? WHERE id = 1").run(replacement.id);
    }
    if (parsed.cascadeConfirmed) {
      sqlite.prepare("DELETE FROM measurement_jobs WHERE project_id = ?").run(id);
      sqlite.prepare("DELETE FROM measure_runs WHERE project_id = ?").run(id);
    }
    sqlite.prepare("DELETE FROM projects WHERE id = ?").run(id);
  });
}

/** Rejects cross-project access while project-owned APIs are migrated incrementally. */
export function requireActiveProject(projectId?: number | null) {
  const activeProject = ensureActiveProject();
  if (projectId !== undefined && projectId !== null && projectId !== activeProject.id) {
    throw new AppError("활성 프로젝트에 속하지 않은 리소스입니다.", 409, "PROJECT_SCOPE_MISMATCH");
  }
  return activeProject;
}
