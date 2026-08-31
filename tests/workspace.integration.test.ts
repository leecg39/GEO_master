import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getLearnChecklist, updateLearnChecklist } from "@/lib/checklist";
import { getDashboardData } from "@/lib/dashboard";
import { closeDatabase, getDatabase } from "@/lib/db";
import { createStrategyItem, deleteStrategyItem, listStrategyItems, updateStrategyItem } from "@/lib/strategy";
import { runStudioTool } from "@/lib/studio";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-workspace-test-"));
const databasePath = path.join(tempDir, "geo.db");
const previousDb = process.env.GEO_DB_PATH;

beforeAll(() => { process.env.GEO_DB_PATH = databasePath; });
afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb;
});

describe.sequential("workspace persistence", () => {
  it("persists one of exactly 38 checklist items", () => {
    expect(getLearnChecklist()).toMatchObject({ completed: 0, total: 38 });
    expect(updateLearnChecklist({ itemKey: "g1-1", checked: true })).toMatchObject({ completed: 1, total: 38 });
    expect(getLearnChecklist().items.find((item) => item.id === "g1-1")?.checked).toBe(true);
  });

  it("creates, updates, lists and deletes strategy items", () => {
    const item = createStrategyItem({ type: "question", title: "어떤 GEO 도구가 좋은가요?", data: { source: "고객 상담", intent: "비교·평가형" } });
    expect(updateStrategyItem({ id: item.id, status: "완료" }).status).toBe("완료");
    expect(listStrategyItems().some((entry) => entry.id === item.id)).toBe(true);
    deleteStrategyItem(item.id);
    expect(listStrategyItems().some((entry) => entry.id === item.id)).toBe(false);
  });

  it("stores deterministic entity output with Korean particles and sameAs", async () => {
    const result = await runStudioTool({ action: "entity", company: "기록", target: "마케터", value: "통찰", category: "분석", sameAs: ["https://example.com/profile"] });
    expect(result.output.definition).toBe("기록은 마케터를 위해 통찰을 제공하는 분석 서비스입니다.");
    expect(result.output.jsonLd).toMatchObject({ "@type": "Organization", sameAs: ["https://example.com/profile"] });
    const count = getDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM contents").get() as { count: number };
    expect(count.count).toBe(1);
  });

  it("reflects completed cycle state and checklist progress on dashboard", () => {
    const cycle = createStrategyItem({ type: "cycle", title: "질문 측정", data: { week: 1 } });
    updateStrategyItem({ id: cycle.id, status: "완료" });
    const dashboard = getDashboardData();
    expect(dashboard.checklist).toEqual({ completed: 1, total: 38, percent: 3 });
    expect(dashboard.cycle[0].done).toBe(true);
  });
});
