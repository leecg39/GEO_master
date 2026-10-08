import { describe, expect, it } from "vitest";
import { parseOutcomeCsv } from "@/lib/outcomes/csv";
import { sanitizePath } from "@/lib/path-privacy";

describe("parseOutcomeCsv", () => {
  it("masks URL-safe and encoded paths without losing event totals", () => {
    const csv = [
      "date,event name,page path,event count",
      "2026-10-01,cta_click,/reset/AbCdEf0123456789-long_secret,3",
      "2026-10-01,cta_click,/reset/%2541bCdEf0123456789%252Dlong_secret,4",
      "2026-10-01,cta_click,/blog/deaf-cafe-bead-face-fade-dead-beef-abba,5",
    ].join("\n");
    expect(parseOutcomeCsv(Buffer.from(csv)).events).toEqual([
      { date: "2026-10-01", eventName: "cta_click", path: "/blog/deaf-cafe-bead-face-fade-dead-beef-abba", count: 5 },
      { date: "2026-10-01", eventName: "cta_click", path: "/reset/:id", count: 7 },
    ]);
  });

  it("reads a GA4-style export: skips # metadata, totals rows and BOM; parses YYYYMMDD dates and comma counts", () => {
    const csv = [
      "﻿# ----------------------------------------",
      "# 이벤트",
      "# 시작 날짜: 20261001",
      "# 종료 날짜: 20261002",
      "",
      "날짜,이벤트 이름,페이지 경로,이벤트 수",
      ",총계,,\"1,250\"",
      "20261001,cta_click,/products/1?utm=x,\"1,200\"",
      "20261001,generate_lead,/contact,30",
      "20261002,cta_click,/products/1,20",
      "20261002,cta_click,/products/1,5",
    ].join("\n");
    const parsed = parseOutcomeCsv(Buffer.from(csv));
    expect(parsed.period).toEqual({ start: "2026-10-01", end: "2026-10-02" });
    expect(parsed.counts).toEqual({ rows: 5, used: 4, skipped: 1 });
    expect(parsed.events).toEqual([
      { date: "2026-10-01", eventName: "cta_click", path: "/products/1", count: 1200 },
      { date: "2026-10-01", eventName: "generate_lead", path: "/contact", count: 30 },
      { date: "2026-10-02", eventName: "cta_click", path: "/products/1", count: 25 },
    ]);
  });

  it("preserves zero-event boundaries and accepts an empty exported period", () => {
    const header = "# Start date: 20261001\n# End date: 20261031\nDate,Event name,Event count\n";
    expect(parseOutcomeCsv(Buffer.from(header + "20261002,x,3")).period).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(parseOutcomeCsv(Buffer.from(header))).toMatchObject({ events: [], period: { start: "2026-10-01", end: "2026-10-31" } });
    expect(parseOutcomeCsv(Buffer.from(header + ",Total,0")).counts).toEqual({ rows: 1, used: 0, skipped: 1 });
  });

  it("rejects invalid, incomplete, conflicting ranges and out-of-range events", () => {
    for (const metadata of ["# Start date: 20261001", "# Start date: 20260230\n# End date: 20261031", "# Start date: 20261101\n# End date: 20261031", "# Start date: 20261001\n# Start date: 20261002\n# End date: 20261031", "# Start date: 20261002\n# End date: 20261031"]) {
      expect(() => parseOutcomeCsv(Buffer.from(metadata + "\nDate,Event name,Event count\n20261001,x,1"))).toThrow(expect.objectContaining({ code: "OUTCOME_INVALID_PERIOD" }));
    }
  });

  it("accepts English headers, ISO dates and a file without a page column", () => {
    const parsed = parseOutcomeCsv(Buffer.from("Date,Event name,Event count\n2026-10-03,form_submit,4\n"));
    expect(parsed.events).toEqual([{ date: "2026-10-03", eventName: "form_submit", path: "", count: 4 }]);
  });

  it("rejects missing columns, bad dates, negative or fractional counts with the line number", () => {
    expect(() => parseOutcomeCsv(Buffer.from("a,b\n1,2"))).toThrow(expect.objectContaining({ code: "OUTCOME_HEADER_NOT_FOUND" }));
    expect(() => parseOutcomeCsv(Buffer.from("date,event name,event count\n2026-02-30,x,1"))).toThrow(expect.objectContaining({ code: "OUTCOME_INVALID_ROW", message: expect.stringContaining("2행") }));
    expect(() => parseOutcomeCsv(Buffer.from("date,event name,event count\n2026-10-01,x,-1"))).toThrow(expect.objectContaining({ code: "OUTCOME_INVALID_ROW" }));
    expect(() => parseOutcomeCsv(Buffer.from("date,event name,event count\n2026-10-01,x,1.5"))).toThrow(expect.objectContaining({ code: "OUTCOME_INVALID_ROW" }));
    expect(() => parseOutcomeCsv(Buffer.from("date,event name,event count\n"))).toThrow(expect.objectContaining({ code: "OUTCOME_EMPTY" }));
    expect(() => parseOutcomeCsv(Buffer.alloc(6 * 1024 * 1024, 0x61))).toThrow(expect.objectContaining({ code: "OUTCOME_TOO_LARGE" }));
  });

  it("handles quoted fields containing commas, quotes and newlines", () => {
    const parsed = parseOutcomeCsv(Buffer.from('date,event name,event count\n2026-10-01,"cta ""hero"", top",3\n'));
    expect(parsed.events[0]?.eventName).toBe('cta "hero", top');
  });
});

describe("sanitizePath", () => {
  it("drops query strings, keeps slugs and masks token-like segments", () => {
    expect(sanitizePath("/a?b=c#d")).toBe("/a");
    expect(sanitizePath("https://example.com/blog/how-to-write?x=1")).toBe("/blog/how-to-write");
    expect(sanitizePath("/reset/3f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c")).toBe("/reset/:id");
    expect(sanitizePath(`/blog/${"read-more/".repeat(50)}`)).toHaveLength(300);
    expect(sanitizePath("x".repeat(400))).toBe(":id");
    expect(sanitizePath("/orders/123e4567-e89b-12d3-a456-426614174000/receipt")).toBe("/orders/:id/receipt");
    expect(sanitizePath("/blog/deaf-cafe-bead-face-fade-dead-beef-abba")).toBe("/blog/deaf-cafe-bead-face-fade-dead-beef-abba");
  });
});
