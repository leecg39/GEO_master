import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, getDatabase } from "@/lib/db";
import { getPublicSettings } from "@/lib/settings";
import { GET as listProjects, POST as createProject } from "@/app/api/projects/route";
import { DELETE as deleteProject, GET as getProject, PATCH as updateProject } from "@/app/api/projects/[id]/route";
import { POST as activateProject } from "@/app/api/projects/[id]/activate/route";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-master-projects-"));
const databasePath = path.join(tempDir, "data", "projects.db");
const previousDb = process.env.GEO_DB_PATH;
const previousKey = process.env.GEO_MASTER_KEY;

interface ProjectBody {
  id: number;
  name: string;
  brandName: string;
  category: string;
  competitors: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

let defaultProject: ProjectBody;
let alphaProject: ProjectBody;
let betaProject: ProjectBody;

const context = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const jsonRequest = (url: string, method: string, body: unknown) => new NextRequest(url, {
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "project-integration-master-key-32-characters";
});

afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb;
  if (previousKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = previousKey;
});

describe.sequential("projects CRUD API", () => {
  it("creates one valid active project on a cold-start list", async () => {
    const response = listProjects(new NextRequest("http://localhost/api/projects"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.page).toEqual({ nextCursor: null, hasMore: false });
    expect(body.items).toHaveLength(1);
    expect(body.activeProject).toMatchObject({ name: "기본 프로젝트", active: true });
    defaultProject = body.activeProject;
    const settings = getDatabase().sqlite.prepare("SELECT active_project_id FROM settings WHERE id = 1").get() as { active_project_id: number };
    expect(settings.active_project_id).toBe(defaultProject.id);
  });

  it("strictly validates create and creates active/non-active projects", async () => {
    const invalid = await createProject(jsonRequest("http://localhost/api/projects", "POST", {
      name: "잘못된 프로젝트", brandName: "", category: "", competitors: [], unknown: true,
    }));
    expect(invalid.status).toBe(422);
    expect((await invalid.json()).code).toBe("VALIDATION_ERROR");

    const alphaResponse = await createProject(jsonRequest("http://localhost/api/projects", "POST", {
      name: "알파 프로젝트", brandName: "알파", category: "SaaS", competitors: ["경쟁 A", "경쟁 A"], activate: true,
    }));
    expect(alphaResponse.status).toBe(201);
    alphaProject = (await alphaResponse.json()).project;
    expect(alphaProject).toMatchObject({ name: "알파 프로젝트", competitors: ["경쟁 A"], active: true });

    const betaResponse = await createProject(jsonRequest("http://localhost/api/projects", "POST", {
      name: "베타 프로젝트", brandName: "베타", category: "커머스", competitors: [], activate: false,
    }));
    expect(betaResponse.status).toBe(201);
    betaProject = (await betaResponse.json()).project;
    expect(betaProject.active).toBe(false);
  });

  it("supports stable cursor pagination, search, detail, and rejects unknown query keys", async () => {
    const firstResponse = listProjects(new NextRequest("http://localhost/api/projects?limit=1"));
    const first = await firstResponse.json();
    expect(first.items).toHaveLength(1);
    expect(first.page.hasMore).toBe(true);
    expect(first.page.nextCursor).toEqual(expect.any(String));

    const secondResponse = listProjects(new NextRequest(`http://localhost/api/projects?limit=1&cursor=${encodeURIComponent(first.page.nextCursor)}`));
    const second = await secondResponse.json();
    expect(second.items).toHaveLength(1);
    expect(second.items[0].id).not.toBe(first.items[0].id);

    const searched = await listProjects(new NextRequest(`http://localhost/api/projects?q=${encodeURIComponent("알파")}`)).json();
    expect(searched.items.map((project: ProjectBody) => project.id)).toEqual([alphaProject.id]);

    const detailResponse = await getProject(new NextRequest(`http://localhost/api/projects/${alphaProject.id}`), context(alphaProject.id));
    expect(detailResponse.status).toBe(200);
    expect((await detailResponse.json()).project).toMatchObject({ id: alphaProject.id, name: "알파 프로젝트" });

    const invalidQuery = listProjects(new NextRequest("http://localhost/api/projects?sort=name"));
    expect(invalidQuery.status).toBe(422);
    expect((await invalidQuery.json()).code).toBe("VALIDATION_ERROR");
  });

  it("enforces expectedUpdatedAt and persists a full allowed update", async () => {
    const staleResponse = await updateProject(jsonRequest(`http://localhost/api/projects/${alphaProject.id}`, "PATCH", {
      name: "오래된 수정", expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    }), context(alphaProject.id));
    expect(staleResponse.status).toBe(409);
    expect((await staleResponse.json()).code).toBe("STALE_WRITE");

    const response = await updateProject(jsonRequest(`http://localhost/api/projects/${alphaProject.id}`, "PATCH", {
      name: "알파 리뉴얼",
      brandName: "알파 브랜드",
      category: "AI SaaS",
      competitors: ["경쟁 B", "경쟁 B", "경쟁 C"],
      expectedUpdatedAt: alphaProject.updatedAt,
    }), context(alphaProject.id));
    expect(response.status).toBe(200);
    alphaProject = (await response.json()).project;
    expect(alphaProject).toMatchObject({
      name: "알파 리뉴얼", brandName: "알파 브랜드", category: "AI SaaS", competitors: ["경쟁 B", "경쟁 C"],
    });
    expect(alphaProject.updatedAt).not.toBe("2000-01-01T00:00:00.000Z");

    const stored = getDatabase().sqlite.prepare("SELECT name, competitors FROM projects WHERE id = ?").get(alphaProject.id) as { name: string; competitors: string };
    expect(stored.name).toBe("알파 리뉴얼");
    expect(JSON.parse(stored.competitors)).toEqual(["경쟁 B", "경쟁 C"]);
  });

  it("activates a project and returns not-found safely", async () => {
    const globalUpdatedAt = getPublicSettings().updatedAt;
    const response = await activateProject(jsonRequest(`http://localhost/api/projects/${betaProject.id}/activate`, "POST", {}), context(betaProject.id));
    expect(response.status).toBe(200);
    betaProject = (await response.json()).project;
    expect(betaProject.active).toBe(true);
    const active = getDatabase().sqlite.prepare("SELECT active_project_id FROM settings WHERE id = 1").get() as { active_project_id: number };
    expect(active.active_project_id).toBe(betaProject.id);
    expect(getPublicSettings()).toMatchObject({ brandName: "베타", category: "커머스", updatedAt: globalUpdatedAt });

    const missing = await getProject(new NextRequest("http://localhost/api/projects/999999"), context(999999));
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe("PROJECT_NOT_FOUND");
  });

  it("reports dependency counts, requires explicit cascade, replaces active, and preserves detached backups", async () => {
    const sqlite = getDatabase().sqlite;
    const now = new Date().toISOString();
    sqlite.prepare("INSERT INTO question_sets (project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(betaProject.id, "삭제 정책 질문", now, now);
    sqlite.prepare(`
      INSERT INTO workspace_backups (project_id, name, schema_version, snapshot, checksum, bytes, created_at, updated_at)
      VALUES (?, '삭제 전 백업', 1, '{}', 'checksum', 2, ?, ?)
    `).run(betaProject.id, now, now);

    const detailResponse = await getProject(new NextRequest(`http://localhost/api/projects/${betaProject.id}`), context(betaProject.id));
    const detail = await detailResponse.json();
    expect(detail.dependencies).toMatchObject({ questionSets: 1 });

    const guarded = await deleteProject(jsonRequest(`http://localhost/api/projects/${betaProject.id}`, "DELETE", {
      expectedUpdatedAt: betaProject.updatedAt,
      cascadeConfirmed: false,
      replacementProjectId: alphaProject.id,
    }), context(betaProject.id));
    expect(guarded.status).toBe(409);
    const guardedBody = await guarded.json();
    expect(guardedBody.code).toBe("PROJECT_HAS_DEPENDENCIES");
    expect(guardedBody.details).toMatchObject({ dependencies: { questionSets: 1 }, total: 1 });

    const deleted = await deleteProject(jsonRequest(`http://localhost/api/projects/${betaProject.id}`, "DELETE", {
      expectedUpdatedAt: betaProject.updatedAt,
      cascadeConfirmed: true,
      replacementProjectId: alphaProject.id,
    }), context(betaProject.id));
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
    expect(sqlite.prepare("SELECT id FROM projects WHERE id = ?").get(betaProject.id)).toBeUndefined();
    expect(sqlite.prepare("SELECT id FROM question_sets WHERE project_id = ?").get(betaProject.id)).toBeUndefined();
    expect((sqlite.prepare("SELECT project_id FROM workspace_backups WHERE name = '삭제 전 백업'").get() as { project_id: number | null }).project_id).toBeNull();
    expect((sqlite.prepare("SELECT active_project_id FROM settings WHERE id = 1").get() as { active_project_id: number }).active_project_id).toBe(alphaProject.id);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it("does not delete the last remaining project", async () => {
    const removeDefault = await deleteProject(jsonRequest(`http://localhost/api/projects/${defaultProject.id}`, "DELETE", {
      expectedUpdatedAt: defaultProject.updatedAt,
      cascadeConfirmed: false,
    }), context(defaultProject.id));
    expect(removeDefault.status).toBe(204);

    const last = await deleteProject(jsonRequest(`http://localhost/api/projects/${alphaProject.id}`, "DELETE", {
      expectedUpdatedAt: alphaProject.updatedAt,
      cascadeConfirmed: true,
    }), context(alphaProject.id));
    expect(last.status).toBe(409);
    expect((await last.json()).code).toBe("LAST_PROJECT_REQUIRED");
    expect(getDatabase().sqlite.prepare("SELECT id FROM projects WHERE id = ?").get(alphaProject.id)).toBeTruthy();
  });
});
