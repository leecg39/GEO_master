import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/search-console/imports/route";
import { closeDatabase } from "@/lib/db";
import { ensureActiveProject } from "@/lib/projects";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-gsc-route-"));
const databasePath = path.join(dir, "geo.db");
const prevDb = process.env.GEO_DB_PATH;
const prevKey = process.env.GEO_MASTER_KEY;
const empty = fs.readFileSync(path.join(__dirname, "fixtures/search-console/empty-console-export.xlsx"));
const post = (body: unknown) => POST(new NextRequest("http://localhost/api/search-console/imports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "gsc-route-master-key-with-32-characters-x";
  ensureActiveProject();
});
afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(dir, { recursive: true, force: true });
  if (prevDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = prevDb;
  if (prevKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = prevKey;
});

describe("POST /api/search-console/imports", () => {
  it("imports the real exported file, flags it as no-data, and treats a re-upload as a duplicate", async () => {
    const body = { fileName: "tiktok-performance.xlsx", propertyLabel: "TikTok @userv6z8w49gz5", contentBase64: empty.toString("base64") };
    const first = await post(body);
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ duplicate: false, import: { hasData: false, periodStart: "2026-09-08" }, warning: expect.stringContaining("노출이 0") });
    expect((await post(body)).status).toBe(200);
    const list = await (await GET()).json();
    expect(list.items).toHaveLength(1);
  });

  it("rejects bad base64, non-xlsx bytes, and missing labels with 422", async () => {
    expect((await post({ fileName: "a.xlsx", propertyLabel: "X", contentBase64: "***" })).status).toBe(422);
    const notXlsx = await post({ fileName: "a.xlsx", propertyLabel: "X", contentBase64: Buffer.from("hello world").toString("base64") });
    expect(notXlsx.status).toBe(422);
    expect((await notXlsx.json()).code).toBe("XLSX_INVALID");
    expect((await post({ fileName: "a.xlsx", propertyLabel: "", contentBase64: "AAAA" })).status).toBe(422);
  });
});
