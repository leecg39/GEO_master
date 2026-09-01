import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedAnnatarMock } from "../scripts/seed-annatar-mock";
import { closeDatabase } from "@/lib/db";
import { getDashboardData } from "@/lib/dashboard";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-annatar-mock-"));
const databasePath = path.join(tempDir, "annatar.db");
const previousDb = process.env.GEO_DB_PATH;

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  seedAnnatarMock();
});

afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH;
  else process.env.GEO_DB_PATH = previousDb;
});

describe("annatar mock dashboard seed", () => {
  it("activates 안나타르 and exposes rich dashboard metrics", () => {
    const dashboard = getDashboardData();

    expect(dashboard.project.name).toBe("안나타르");
    expect(dashboard.project.brandName).toBe("ANNATAR");
    expect(dashboard.project.questionCount).toBe(6);
    expect(dashboard.project.recentRunCount).toBe(10);
    expect(dashboard.funnel.answerShare).toBeGreaterThan(60);
    expect(dashboard.funnel.genrank).toBeGreaterThan(70);
    expect(dashboard.funnel.stage).toBe("추천");
    expect(dashboard.questions).toHaveLength(6);
    expect(dashboard.runTrends.length).toBeGreaterThanOrEqual(5);
    expect(dashboard.overview.competitors.length).toBeGreaterThan(0);
    expect(dashboard.overview.positiveRate).toBeGreaterThan(50);
    expect(dashboard.checklist.completed).toBe(27);
    expect(dashboard.checklist.percent).toBe(71);
    expect(dashboard.cycle.filter((item) => item.done)).toHaveLength(3);
    expect(dashboard.latestAudit?.grade).toBe("양호");
    expect(dashboard.latestAudit?.score).toBe(25);
  });
});
