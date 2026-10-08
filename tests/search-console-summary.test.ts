import { describe, expect, it } from "vitest";
import { summarizeConsoleImports } from "@/lib/search-console/summary";
import type { ConsoleImport } from "@/lib/search-console/store";

function imported(overrides: Partial<ConsoleImport> & Pick<ConsoleImport, "id" | "propertyLabel">): ConsoleImport {
  return {
    source: "console_export",
    fileName: "export.xlsx",
    contentHash: `hash-${overrides.id}`,
    periodStart: "2026-09-08",
    periodEnd: "2026-10-05",
    hasData: false,
    importedAt: "2026-10-08T06:00:00.000Z",
    totals: { clicks: 0, impressions: 0, ctr: null, position: null },
    ...overrides,
  };
}

describe("summarizeConsoleImports", () => {
  it("returns an empty summary when nothing was imported", () => {
    expect(summarizeConsoleImports([])).toEqual({ properties: [], importCount: 0, withData: 0 });
  });

  it("keeps the latest period per property and counts imports per property", () => {
    const summary = summarizeConsoleImports([
      imported({ id: 1, propertyLabel: "TikTok @a", periodEnd: "2026-10-05" }),
      imported({ id: 2, propertyLabel: "TikTok @a", periodStart: "2026-09-15", periodEnd: "2026-10-12", hasData: true, totals: { clicks: 3, impressions: 40, ctr: 0.075, position: 8.2 } }),
      imported({ id: 3, propertyLabel: "X @a" }),
    ]);
    expect(summary.importCount).toBe(3);
    expect(summary.withData).toBe(1);
    expect(summary.properties.map((item) => [item.propertyLabel, item.latest.id, item.importCount])).toEqual([
      ["TikTok @a", 2, 2],
      ["X @a", 3, 1],
    ]);
  });

  it("breaks ties on the same period by the most recent import", () => {
    const summary = summarizeConsoleImports([
      imported({ id: 1, propertyLabel: "IG", importedAt: "2026-10-08T06:00:00.000Z" }),
      imported({ id: 2, propertyLabel: "IG", importedAt: "2026-10-09T06:00:00.000Z" }),
    ]);
    expect(summary.properties[0].latest.id).toBe(2);
  });

  it("sorts properties with data first, then by label, and never sums across properties", () => {
    const summary = summarizeConsoleImports([
      imported({ id: 1, propertyLabel: "B" }),
      imported({ id: 2, propertyLabel: "C", hasData: true, totals: { clicks: 1, impressions: 10, ctr: 0.1, position: 3 } }),
      imported({ id: 3, propertyLabel: "A" }),
    ]);
    expect(summary.properties.map((item) => item.propertyLabel)).toEqual(["C", "A", "B"]);
    expect(summary).not.toHaveProperty("totals");
  });

  it("treats a missing period end as older than any dated period", () => {
    const summary = summarizeConsoleImports([
      imported({ id: 1, propertyLabel: "IG", periodEnd: null, importedAt: "2026-10-10T00:00:00.000Z" }),
      imported({ id: 2, propertyLabel: "IG", periodEnd: "2026-10-05", importedAt: "2026-10-08T00:00:00.000Z" }),
    ]);
    expect(summary.properties[0].latest.id).toBe(2);
  });
});
