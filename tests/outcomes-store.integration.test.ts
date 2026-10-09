import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/outcomes/route";
import { DELETE as DELETE_PROJECT } from "@/app/api/projects/[id]/route";
import { DELETE as DELETE_DEFINITION, PUT } from "@/app/api/outcomes/definitions/route";
import { closeDatabase, getDatabase } from "@/lib/db";
import { deleteOutcomeDefinition, deleteOutcomeImport, getOutcomeSummary, importOutcomeCsv, upsertOutcomeDefinition } from "@/lib/outcomes/store";
import { activateProject, createProject, ensureActiveProject, getProjectDetail } from "@/lib/projects";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-outcomes-"));
const databasePath = path.join(dir, "geo.db");
const prevDb = process.env.GEO_DB_PATH;
const prevKey = process.env.GEO_MASTER_KEY;
const csv = (rows: string[]) => Buffer.from(["date,event name,page path,event count", ...rows].join("\n"));

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "outcomes-master-key-with-32-characters-xx";
  ensureActiveProject();
});
afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(dir, { recursive: true, force: true });
  if (prevDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = prevDb;
  if (prevKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = prevKey;
});

describe("outcome store", () => {
  it("requires a source label, stores events and reports unmapped events instead of guessing their meaning", () => {
    expect(() => importOutcomeCsv({ fileName: "a.csv", sourceLabel: "", buffer: csv(["2026-10-01,cta_click,/,1"]) })).toThrow();
    const first = importOutcomeCsv({ fileName: "sep.csv", sourceLabel: "GA4 · 공식몰", buffer: csv(["2026-10-01,cta_click,/p/1,10", "2026-10-01,generate_lead,/contact,2", "2026-10-02,cta_click,/p/1,5"]) });
    expect(first).toMatchObject({ duplicate: false, import: { sourceLabel: "GA4 · 공식몰", periodStart: "2026-10-01", periodEnd: "2026-10-02", rowsUsed: 3 } });
    const summary = getOutcomeSummary();
    expect(summary.sources).toHaveLength(1);
    expect(summary.sources[0]).toMatchObject({ sourceLabel: "GA4 · 공식몰", periodStart: "2026-10-01", periodEnd: "2026-10-02", metrics: [] });
    expect(summary.sources[0]!.unmapped).toEqual([{ eventName: "cta_click", count: 15 }, { eventName: "generate_lead", count: 2 }]);
  });

  it("keeps CTA clicks, form submissions and conversions as separate metrics with their definitions", () => {
    upsertOutcomeDefinition({ eventName: "cta_click", kind: "cta_click", definition: "상품 상세의 '상담 신청' 버튼 클릭" });
    upsertOutcomeDefinition({ eventName: "generate_lead", kind: "form_submit", definition: "상담 폼 제출 완료(서버 응답 200)" });
    const source = getOutcomeSummary().sources[0]!;
    expect(source.metrics).toEqual([
      { kind: "cta_click", count: 15, events: [{ eventName: "cta_click", definition: "상품 상세의 '상담 신청' 버튼 클릭", count: 15 }] },
      { kind: "form_submit", count: 2, events: [{ eventName: "generate_lead", definition: "상담 폼 제출 완료(서버 응답 200)", count: 2 }] },
    ]);
    expect(source.unmapped).toEqual([]);
    expect(() => upsertOutcomeDefinition({ eventName: "x", kind: "revenue", definition: "d" })).toThrow();
    expect(() => upsertOutcomeDefinition({ eventName: "x", kind: "cta_click", definition: "" })).toThrow();
  });

  it("does not double count overlapping imports: the latest import wins per day, event and path", () => {
    importOutcomeCsv({ fileName: "oct.csv", sourceLabel: "GA4 · 공식몰", buffer: csv(["2026-10-02,cta_click,/p/1,7", "2026-10-03,cta_click,/p/1,4"]) });
    const source = getOutcomeSummary().sources[0]!;
    expect(source.metrics.find((metric) => metric.kind === "cta_click")?.count).toBe(10 + 7 + 4);
    expect(source).toMatchObject({ periodStart: "2026-10-01", periodEnd: "2026-10-03", importCount: 2 });
  });

  it("never sums different sources together and treats a re-upload as a duplicate", () => {
    importOutcomeCsv({ fileName: "crm.csv", sourceLabel: "CRM 리드", buffer: csv(["2026-10-01,generate_lead,,9"]) });
    const summary = getOutcomeSummary();
    expect(summary.sources.map((source) => source.sourceLabel)).toEqual(["CRM 리드", "GA4 · 공식몰"]);
    expect(summary.sources.find((source) => source.sourceLabel === "CRM 리드")?.metrics).toEqual([
      { kind: "form_submit", count: 9, events: [{ eventName: "generate_lead", definition: "상담 폼 제출 완료(서버 응답 200)", count: 9 }] },
    ]);
    expect(importOutcomeCsv({ fileName: "crm.csv", sourceLabel: "CRM 리드", buffer: csv(["2026-10-01,generate_lead,,9"]) }).duplicate).toBe(true);
  });

  it("replaces inclusive boundaries, overlapping periods and empty periods, then reactivates a repeated report", () => {
    const sourceLabel = "GA4 boundary regression";
    const upload = (start: string, end: string, rows: string[]) => importOutcomeCsv({ fileName: "range.csv", sourceLabel, buffer: Buffer.from([`# Start date: ${start}`, `# End date: ${end}`, "date,event name,page path,event count", ...rows].join("\n")) });
    const summary = () => getOutcomeSummary().sources.find((source) => source.sourceLabel === sourceLabel)!;
    const total = () => summary().metrics.reduce((sum, metric) => sum + metric.count, 0);
    upload("20261001", "20261101", ["20261001,generate_lead,,10", "20261002,generate_lead,,20", "20261031,generate_lead,,30", "20261101,generate_lead,,40"]);
    upload("20261001", "20261031", ["20261002,generate_lead,,7"]);
    expect(total()).toBe(47); // Both zero-event boundaries are replaced; Nov 1 survives.
    upload("20261002", "20261101", []);
    expect(total()).toBe(0);
    expect(summary().metrics).toMatchObject([{ kind: "form_submit", count: 0 }]);
    expect(summary()).toMatchObject({ periodStart: "2026-10-01", periodEnd: "2026-11-01", importCount: 3 });
    expect(upload("20261001", "20261031", ["20261002,generate_lead,,7"]).duplicate).toBe(true);
    expect(total()).toBe(7);
    expect(summary().importCount).toBe(3);
  });

  it("guards outcome-only project deletion and cascades only after confirmation", async () => {
    const original = ensureActiveProject().id;
    const project = createProject({ name: "Outcome deletion", brandName: "Test", category: "", competitors: [], activate: true });
    const imported = importOutcomeCsv({ fileName: "one.csv", sourceLabel: "GA4", buffer: csv(["20261001,signup,,1"]) });
    upsertOutcomeDefinition({ eventName: "signup", kind: "conversion", definition: "완료" });
    expect(getProjectDetail(project.id).dependencies).toMatchObject({ outcomeImports: 1, outcomeEvents: 1, outcomeDefinitions: 1 });
    const request = (confirmed: boolean) => new NextRequest(`http://localhost/api/projects/${project.id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedUpdatedAt: project.updatedAt, cascadeConfirmed: confirmed, replacementProjectId: original }) });
    const context = { params: Promise.resolve({ id: String(project.id) }) };
    const guarded = await DELETE_PROJECT(request(false), context);
    expect(guarded.status).toBe(409);
    expect((await guarded.json()).code).toBe("PROJECT_HAS_DEPENDENCIES");
    expect(getOutcomeSummary().imports).toHaveLength(1);
    expect((await DELETE_PROJECT(request(true), context)).status).toBe(204);
    const sqlite = getDatabase().sqlite;
    expect(sqlite.prepare("SELECT * FROM outcome_imports WHERE id = ?").get(imported.import.id)).toBeUndefined();
    expect(sqlite.prepare("SELECT * FROM outcome_events WHERE import_id = ?").get(imported.import.id)).toBeUndefined();
    expect(sqlite.prepare("SELECT * FROM outcome_definitions WHERE project_id = ?").get(project.id)).toBeUndefined();
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it("scopes data to the active project and supports deleting imports and definitions", () => {
    const original = ensureActiveProject().id;
    const target = getOutcomeSummary().imports[0]!;
    createProject({ name: "다른 프로젝트", brandName: "다른", category: "", competitors: [], activate: true });
    expect(getOutcomeSummary()).toEqual({ sources: [], imports: [], definitions: [] });
    expect(() => deleteOutcomeImport(target.id)).toThrow();
    activateProject(original);
    deleteOutcomeImport(target.id);
    expect(getOutcomeSummary().imports.some((item) => item.id === target.id)).toBe(false);
    deleteOutcomeDefinition("cta_click");
    expect(getOutcomeSummary().definitions.map((item) => item.eventName)).toEqual(["generate_lead"]);
  });
});

describe("/api/outcomes", () => {
  const json = (url: string, method: string, body: unknown) => new NextRequest(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("imports CSV via base64, upserts and deletes definitions, and validates input", async () => {
    const created = await POST(json("http://localhost/api/outcomes", "POST", { fileName: "r.csv", sourceLabel: "GA4 · 라우트", contentBase64: csv(["2026-10-05,signup,/join,3"]).toString("base64") }));
    expect(created.status).toBe(201);
    const defined = await PUT(json("http://localhost/api/outcomes/definitions", "PUT", { eventName: "signup", kind: "conversion", definition: "회원가입 완료" }));
    expect(defined.status).toBe(200);
    const summary = await GET().json();
    expect(summary.sources.find((source: { sourceLabel: string }) => source.sourceLabel === "GA4 · 라우트").metrics[0]).toMatchObject({ kind: "conversion", count: 3 });
    expect((await DELETE_DEFINITION(json("http://localhost/api/outcomes/definitions", "DELETE", { eventName: "signup" }))).status).toBe(204);
    expect((await POST(json("http://localhost/api/outcomes", "POST", { fileName: "r.csv", contentBase64: "AA==" }))).status).toBe(422);
    const bad = await POST(json("http://localhost/api/outcomes", "POST", { fileName: "r.csv", sourceLabel: "x", contentBase64: Buffer.from("a,b\n1,2").toString("base64") }));
    expect((await bad.json()).code).toBe("OUTCOME_HEADER_NOT_FOUND");
  });
});
