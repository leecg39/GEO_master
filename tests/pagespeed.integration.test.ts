import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/url-security", async () => {
  const actual = await vi.importActual<typeof import("@/lib/url-security")>("@/lib/url-security");
  return { ...actual, fetchPublicText: vi.fn() };
});

import { GET as runRoute } from "@/app/api/pagespeed/route";
import { DELETE as deleteKey, GET as keyStatus, PUT as putKey } from "@/app/api/pagespeed/key/route";
import { closeDatabase, getDatabase, LATEST_SCHEMA_VERSION } from "@/lib/db";
import { parsePageSpeed } from "@/lib/pagespeed";
import { ensureActiveProject } from "@/lib/projects";
import { fetchPublicText } from "@/lib/url-security";

const fixture = (name: string) => fs.readFileSync(path.join(process.cwd(), "tests/fixtures/pagespeed", name), "utf8");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-pagespeed-"));
const databasePath = path.join(dir, "geo.db");
const prevDb = process.env.GEO_DB_PATH;
const prevKey = process.env.GEO_MASTER_KEY;
const KEY = "AIzaSyTEST-pagespeed-key-1234567890abcd";
const run = (query: string) => runRoute(new NextRequest(`http://localhost/api/pagespeed?${query}`));
const put = (body: unknown) => putKey(new NextRequest("http://localhost/api/pagespeed/key", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "pagespeed-integration-master-key-32chars";
  vi.stubEnv("PAGESPEED_API_KEY", "");
  ensureActiveProject();
});
beforeEach(() => { vi.mocked(fetchPublicText).mockReset(); });
afterAll(() => {
  vi.unstubAllEnvs();
  closeDatabase(databasePath);
  fs.rmSync(dir, { recursive: true, force: true });
  if (prevDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = prevDb;
  if (prevKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = prevKey;
});

describe("parsing (A7)", () => {
  it("keeps lab (Lighthouse) and field (real users) data apart", () => {
    const result = parsePageSpeed(JSON.parse(fixture("success-shape.json")), "mobile");
    expect(result.lab).toEqual({ performanceScore: 73, lcpMs: 3120, cls: 0.081, tbtMs: 240, fcpMs: 1501, speedIndexMs: 4100, lighthouseVersion: "12.0.0", fetchTime: "2026-10-13T00:00:00.000Z", finalUrl: "https://shop.example/p" });
    expect(result.field).toMatchObject({ scope: "page", overall: "AVERAGE" });
    expect(result.field?.metrics).toEqual(expect.arrayContaining([
      { key: "LARGEST_CONTENTFUL_PAINT_MS", label: "LCP", p75: "2,900ms", category: "AVERAGE" },
      { key: "INTERACTION_TO_NEXT_PAINT", label: "INP", p75: "180ms", category: "FAST" },
      { key: "CUMULATIVE_LAYOUT_SHIFT_SCORE", label: "CLS", p75: "0.12", category: "AVERAGE" },
      { key: "NEW_METRIC_FROM_CRUX", label: "NEW_METRIC_FROM_CRUX", p75: "7", category: "FAST" },
    ]));
  });

  it("falls back to origin data and says so, or reports no field data", () => {
    const data = JSON.parse(fixture("success-shape.json"));
    expect(parsePageSpeed({ ...data, loadingExperience: undefined }, "mobile").field).toMatchObject({ scope: "origin", overall: "FAST" });
    expect(parsePageSpeed({ ...data, loadingExperience: { origin_fallback: true, ...data.originLoadingExperience } }, "mobile").field?.scope).toBe("origin");
    expect(parsePageSpeed({ lighthouseResult: data.lighthouseResult }, "desktop").field).toBeNull();
  });
});

describe.sequential("API (A7)", () => {
  it("adds the integration_secrets table", () => {
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(31);
    expect((getDatabase().sqlite.pragma("table_info(integration_secrets)") as { name: string }[]).map(({ name }) => name)).toEqual(expect.arrayContaining(["name", "value_encrypted"]));
  });

  it("is disabled without a key and never calls Google", async () => {
    expect(await (await keyStatus()).json()).toEqual({ configured: false, source: null });
    expect(await (await run("url=https%3A%2F%2Fshop.example%2Fp")).json()).toMatchObject({ code: "PAGESPEED_KEY_REQUIRED" });
    expect(fetchPublicText).not.toHaveBeenCalled();
  });

  it("stores the key encrypted and never returns it", async () => {
    const text = await (await put({ apiKey: KEY })).text();
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text)).toEqual({ configured: true, source: "saved" });
    expect(JSON.stringify(getDatabase().sqlite.prepare("SELECT * FROM integration_secrets").all())).not.toContain(KEY);
  });

  it("runs PageSpeed for a public URL with the requested strategy and key", async () => {
    vi.mocked(fetchPublicText).mockResolvedValueOnce({ url: "x", status: 200, text: fixture("success-shape.json"), contentType: "application/json" });
    const response = await run("url=https%3A%2F%2Fshop.example%2Fp&strategy=desktop");
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).not.toContain(KEY);
    expect(JSON.parse(body).result).toMatchObject({ url: "https://shop.example/p", strategy: "desktop", lab: { performanceScore: 73 } });
    const requested = new URL(vi.mocked(fetchPublicText).mock.calls[0]![0]);
    expect(requested.origin + requested.pathname).toBe("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
    expect(requested.searchParams.get("url")).toBe("https://shop.example/p");
    expect(requested.searchParams.get("strategy")).toBe("desktop");
    expect(requested.searchParams.get("key")).toBe(KEY);
    expect(requested.searchParams.get("fields")).toContain("lighthouseResult");
  });

  it("explains quota and key errors without echoing the key", async () => {
    vi.mocked(fetchPublicText).mockResolvedValueOnce({ url: "x", status: 429, text: fixture("error-429-no-key.json"), contentType: "application/json" });
    const quota = await (await run("url=https%3A%2F%2Fshop.example%2Fp")).text();
    expect(JSON.parse(quota)).toMatchObject({ code: "PAGESPEED_QUOTA" });
    expect(quota).not.toContain(KEY);
    vi.mocked(fetchPublicText).mockResolvedValueOnce({ url: "x", status: 400, text: JSON.stringify({ error: { code: 400, message: `API key not valid. key=${KEY}` } }), contentType: "application/json" });
    const invalid = await (await run("url=https%3A%2F%2Fshop.example%2Fp")).text();
    expect(JSON.parse(invalid)).toMatchObject({ code: "PAGESPEED_FAILED" });
    expect(invalid).not.toContain(KEY);
  });

  it("rejects private and non-http targets before calling Google", async () => {
    expect((await run("url=http%3A%2F%2Flocalhost%2F")).status).toBe(403);
    expect((await run("url=ftp%3A%2F%2Fshop.example")).status).toBe(422);
    expect((await run("url=https%3A%2F%2Fshop.example&strategy=tablet")).status).toBe(422);
    expect(fetchPublicText).not.toHaveBeenCalled();
  });

  it("prefers the saved key over the environment and can delete it", async () => {
    vi.stubEnv("PAGESPEED_API_KEY", "env-key");
    expect(await (await keyStatus()).json()).toEqual({ configured: true, source: "saved" });
    await deleteKey();
    expect(await (await keyStatus()).json()).toEqual({ configured: true, source: "environment" });
    vi.stubEnv("PAGESPEED_API_KEY", "");
  });
});
