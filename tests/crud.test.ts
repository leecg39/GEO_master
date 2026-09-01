import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertDeleteAllowed, assertExpectedUpdatedAt, collectionQuerySchema, cursorPage,
  decodeCursor, encodeCursor, expectFound, resourceIdSchema, transactionalMutation,
} from "@/lib/crud";

const databases: Database.Database[] = [];
afterEach(() => { for (const sqlite of databases.splice(0)) if (sqlite.open) sqlite.close(); });

describe("CRUD primitives", () => {
  it("strictly validates IDs and bounded list queries", () => {
    expect(resourceIdSchema.parse("42")).toBe(42);
    expect(resourceIdSchema.safeParse(0).success).toBe(false);
    expect(collectionQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(collectionQuerySchema.parse({ limit: "100", q: "  brand  " })).toEqual({ limit: 100, q: "brand" });
    expect(collectionQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(collectionQuerySchema.safeParse({ unknown: "field" }).success).toBe(false);
  });

  it("round-trips opaque cursors and rejects malformed input", () => {
    const encoded = encodeCursor({ timestamp: "2026-09-01T00:00:00.000Z", id: 7 });
    expect(decodeCursor(encoded)).toEqual({ timestamp: "2026-09-01T00:00:00.000Z", id: 7 });
    expect(() => decodeCursor("not-a-cursor")).toThrow(/커서/);
  });

  it("builds a stable next cursor from a limit-plus-one query", () => {
    const rows = [
      { id: 3, createdAt: "2026-09-03" },
      { id: 2, createdAt: "2026-09-02" },
      { id: 1, createdAt: "2026-09-01" },
    ];
    const result = cursorPage(rows, 2, (row) => ({ timestamp: row.createdAt, id: row.id }));
    expect(result.items.map((row) => row.id)).toEqual([3, 2]);
    expect(result.page.hasMore).toBe(true);
    expect(decodeCursor(result.page.nextCursor!)).toEqual({ timestamp: "2026-09-02", id: 2 });
  });

  it("normalizes not-found, stale-write, and dependent-delete conflicts", () => {
    expect(() => expectFound(null, "없음", "ITEM_NOT_FOUND")).toThrow(/없음/);
    expect(() => assertExpectedUpdatedAt("new", "old")).toThrow(/최신 데이터를/);
    try { assertDeleteAllowed({ audits: 2, contents: -1 }, false, "PROJECT_HAS_DEPENDENCIES"); }
    catch (error) {
      expect(error).toMatchObject({ status: 409, code: "PROJECT_HAS_DEPENDENCIES", details: { dependencies: { audits: 2, contents: 0 }, total: 2 } });
    }
    expect(() => assertDeleteAllowed({ audits: 2 }, true)).not.toThrow();
  });

  it("rolls back a multi-row mutation when the callback fails", () => {
    const sqlite = new Database(":memory:");
    databases.push(sqlite);
    sqlite.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    expect(() => transactionalMutation(sqlite, () => {
      sqlite.prepare("INSERT INTO items (value) VALUES (?)").run("first");
      throw new Error("stop");
    })).toThrow(/stop/);
    expect((sqlite.prepare("SELECT COUNT(*) AS count FROM items").get() as { count: number }).count).toBe(0);
  });
});
