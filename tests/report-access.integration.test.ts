import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as reportGET } from "@/app/api/reports/route";
import { GET as changeReportGET } from "@/app/api/change-items/report/route";
import { closeDatabase, getDatabase } from "@/lib/db";
import { ensureActiveProject } from "@/lib/projects";
import { buildAuditReport, buildShareReport } from "@/lib/reports";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "geo-report-access-"));
const dbPath = path.join(directory, "test.db");
const secret = "report-access-test-proxy-secret-32-bytes";
const request = (query: string, headers?: HeadersInit) => new NextRequest(`http://localhost/api/reports?${query}`, { headers });
let projectId: number;

function seed(project: number | null, at: string) {
  const { sqlite } = getDatabase();
  const audit = Number(sqlite.prepare("INSERT INTO audits (project_id, url, score, grade, items, metadata, created_at) VALUES (?, ?, 1, '테스트', '[]', '{}', ?)").run(project, `https://example.com/${project}`, at).lastInsertRowid);
  const run = Number(sqlite.prepare("INSERT INTO measure_runs (project_id, status, models, repetitions, total_queries, created_at) VALUES (?, 'completed', '[]', 1, 0, ?)").run(project, at).lastInsertRowid);
  return { audit, run };
}

beforeEach(() => {
  vi.stubEnv("GEO_DB_PATH", dbPath);
  vi.stubEnv("GEO_AUTH_MODE", "local");
  projectId = ensureActiveProject().id;
  getDatabase().sqlite.exec("DELETE FROM audits; DELETE FROM measure_runs;");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => { closeDatabase(dbPath); fs.rmSync(directory, { recursive: true, force: true }); });

describe("report project boundaries", () => {
  it("does not export another project's report in any format", async () => {
    const { sqlite } = getDatabase();
    const other = Number(sqlite.prepare("INSERT INTO projects (name, brand_name, created_at, updated_at) VALUES ('다른 프로젝트', '다른 브랜드', '2026-01-01', '2026-01-01')").run().lastInsertRowid);
    const foreign = seed(other, "2026-10-19");
    for (const [type, id, formats] of [["audit", foreign.audit, ["json", "csv", "pdf", "md"]], ["share", foreign.run, ["json", "csv", "pdf"]]] as const) {
      for (const format of formats) {
        const response = reportGET(request(`type=${type}&id=${id}&format=${format}`));
        expect(response.status, `${type}/${format}`).toBe(404);
        expect(await response.json()).toMatchObject({ code: "REPORT_NOT_FOUND" });
      }
    }
  });

  it("selects the latest report only inside the active project, with a stable ID tiebreaker", () => {
    seed(projectId, "2026-10-01");
    const current = seed(projectId, "2026-10-01");
    seed(null, "2026-10-19");
    expect(buildAuditReport().audit.id).toBe(current.audit);
    expect(buildShareReport().run.id).toBe(current.run);
  });

  it("never falls back to an unassigned legacy report", () => {
    const legacy = seed(null, "2026-10-19");
    for (const type of ["audit", "share"]) {
      const id = type === "audit" ? legacy.audit : legacy.run;
      expect(reportGET(request(`type=${type}&id=${id}`)).status).toBe(404);
      expect(reportGET(request(`type=${type}`)).status).toBe(404);
    }
  });

  it("preserves the not-ready error only for the active project's run", () => {
    const current = seed(projectId, "2026-10-19");
    getDatabase().sqlite.prepare("UPDATE measure_runs SET status = 'running' WHERE id = ?").run(current.run);
    expect(reportGET(request(`type=share&id=${current.run}`)).status).toBe(409);
  });
});

describe("report authentication", () => {
  it.each(["app", "proxy"])("authenticates both report routes before input parsing in %s mode", async (mode) => {
    vi.stubEnv("GEO_AUTH_MODE", mode);
    vi.stubEnv("GEO_AUTH_PROXY_SECRET", secret);
    for (const handler of [reportGET, changeReportGET]) {
      for (const headers of [new Headers(), new Headers({ "x-geo-auth-user": "alice" }), new Headers({ "x-geo-auth-user": "alice", "x-geo-auth-secret": "forged" })]) {
        const response = handler(request("format=invalid", headers));
        expect(response.status).toBe(401);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(await response.json()).toMatchObject({ code: "AUTH_REQUIRED" });
      }
    }
  });

  it("allows authenticated reports and marks both success and failure private", () => {
    const current = seed(projectId, "2026-10-19");
    vi.stubEnv("GEO_AUTH_MODE", "proxy");
    vi.stubEnv("GEO_AUTH_PROXY_SECRET", secret);
    const headers = { "x-geo-auth-user": "alice", "x-geo-auth-secret": secret };
    for (const format of ["json", "csv", "pdf", "md"]) {
      const response = reportGET(request(`type=audit&id=${current.audit}&format=${format}`, headers));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    const changes = changeReportGET(new NextRequest("http://localhost/api/change-items/report?url=https%3A%2F%2Fexample.com", { headers }));
    expect(changes.status).toBe(200);
    expect(changes.headers.get("cache-control")).toBe("private, no-store");
    const missing = reportGET(request("type=audit&id=9999999", headers));
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("private, no-store");
  });
});
