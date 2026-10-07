import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase } from "@/lib/db";
import { createFact, deleteFact, draftFactsForActiveProject, factsForCompare, listFacts, updateFact } from "@/lib/facts";
import { createProject, deleteProject, ensureActiveProject, listProjects } from "@/lib/projects";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-facts-test-"));
const databasePath = path.join(tempDir, "geo.db");
const previousDb = process.env.GEO_DB_PATH;
const previousKey = process.env.GEO_MASTER_KEY;

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "facts-integration-master-key-with-32-characters";
  ensureActiveProject();
});

afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb;
  if (previousKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = previousKey;
});

describe("fact memos", () => {
  it("creates, lists and derives verified / unverified / expired status", () => {
    const verified = createFact({ attribute: "가격", value: "12,000", unit: "원", sourceUrl: "https://brand.example/price", checkedAt: "2026-10-01", verified: true });
    createFact({ attribute: "설립연도", value: "2015", unit: "년", verified: false });
    createFact({ attribute: "배송", value: "2", unit: "일", verified: true, validUntil: "2020-01-01" });
    expect(verified).toMatchObject({ attribute: "가격", status: "verified", sourceUrl: "https://brand.example/price" });
    expect(listFacts().map((fact) => [fact.attribute, fact.status])).toEqual([
      ["배송", "expired"], ["설립연도", "unverified"], ["가격", "verified"],
    ]);
  });

  it("exposes only verified, unexpired facts as usable draft evidence", () => {
    expect(draftFactsForActiveProject().filter((fact) => fact.usable).map((fact) => fact.attribute)).toEqual(["가격"]);
    expect(factsForCompare().map((fact) => fact.status).sort()).toEqual(["expired", "unverified", "verified"]);
  });

  it("updates with optimistic locking and deletes", () => {
    const fact = listFacts().find((item) => item.attribute === "설립연도")!;
    const updated = updateFact(fact.id, { verified: true, expectedUpdatedAt: fact.updatedAt });
    expect(updated.status).toBe("verified");
    expect(() => updateFact(fact.id, { value: "2016", expectedUpdatedAt: fact.updatedAt })).toThrow();
    deleteFact(fact.id, { expectedUpdatedAt: updated.updatedAt });
    expect(listFacts().some((item) => item.id === fact.id)).toBe(false);
  });

  it("rejects non-http source URLs and keeps facts scoped to the active project", () => {
    expect(() => createFact({ attribute: "가격", value: "1", sourceUrl: "javascript:alert(1)" })).toThrow();
    createProject({ name: "다른 프로젝트", brandName: "다른", category: "", competitors: [], activate: true });
    expect(listFacts()).toEqual([]);
  });

  it("counts fact memos as project dependencies before a cascading delete", () => {
    const original = listProjects({}).items.find((project) => project.name !== "다른 프로젝트")!;
    expect(() => deleteProject(original.id, { expectedUpdatedAt: original.updatedAt })).toThrow(expect.objectContaining({
      details: expect.objectContaining({ dependencies: expect.objectContaining({ facts: 2 }) }),
    }));
  });
});
