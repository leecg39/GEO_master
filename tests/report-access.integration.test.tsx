/** @vitest-environment jsdom */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getReport } from "@/app/api/reports/route";
import { ReportsClient } from "@/components/ReportsClient";
import { importBotLog } from "@/lib/bot-logs/store";
import { closeDatabase, getDatabase } from "@/lib/db";
import { audits, measureRuns } from "@/lib/db/schema";
import { createSession, SESSION_COOKIE } from "@/lib/login-session";
import * as appendixStore from "@/lib/observation-appendix";
import { importOutcomeCsv, upsertOutcomeDefinition } from "@/lib/outcomes/store";
import { ensureActiveProject } from "@/lib/projects";
import { buildAuditReport, buildShareReport } from "@/lib/reports";
import { withRequestAccount } from "@/lib/request-account";
import { importConsoleExport } from "@/lib/search-console/store";
import { proxy } from "@/proxy";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-report-access-"));
const databasePath = path.join(dir, "geo.db");
const secret = "report-access-proxy-secret-".repeat(3);
const hash = bcrypt.hashSync("demo", 4);
const privateMarkers = ["private-console", "private-bots.log", "private-outcomes", "private-definition"];
const ids = { audit: 0, share: 0 };
type Kind = keyof typeof ids;

beforeAll(async () => {
  vi.stubEnv("GEO_DB_PATH", databasePath);
  vi.stubEnv("GEO_AUTH_MODE", "local");
  vi.stubEnv("GEO_MASTER_KEY", "report-access-master-key-".repeat(3));
  const projectId = ensureActiveProject().id;
  const { orm } = getDatabase();
  const createdAt = "2026-10-08T00:00:00.000Z";
  ids.audit = orm.insert(audits).values({ projectId, url: "https://example.com", score: 0, grade: "개선 필요", items: "[]", createdAt }).returning({ id: audits.id }).get().id;
  ids.share = orm.insert(measureRuns).values({ projectId, status: "completed", models: "[]", repetitions: 1, totalQueries: 0, answerShare: 0, genrank: 0, funnelStage: "존재", summary: "{}", createdAt, completedAt: createdAt }).returning({ id: measureRuns.id }).get().id;
  importConsoleExport({ fileName: "console.xlsx", propertyLabel: privateMarkers[0], buffer: fs.readFileSync(path.join(__dirname, "fixtures/search-console/empty-console-export.xlsx")) });
  await importBotLog({ fileName: privateMarkers[1], buffer: Buffer.from('20.15.240.1 - - [08/Oct/2026:10:00:00 +0900] "GET / HTTP/1.1" 200 1 "-" "GPTBot/1.2"'), verifyDns: false });
  importOutcomeCsv({ fileName: "events.csv", sourceLabel: privateMarkers[2], buffer: Buffer.from("date,event name,event count\n2026-10-08,generate_lead,3") });
  upsertOutcomeDefinition({ eventName: "generate_lead", kind: "form_submit", definition: privateMarkers[3] });
});
beforeEach(() => {
  vi.stubEnv("GEO_AUTH_MODE", "proxy");
  vi.stubEnv("GEO_AUTH_PROXY_SECRET", secret);
  vi.stubEnv("GEO_HTTP_AUTH", `admin:${hash},member:${hash},guest:${hash}`);
  vi.stubEnv("GEO_ADMIN_USERS", "admin");
  vi.stubEnv("GEO_GUEST_USERS", "guest");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
afterAll(() => { closeDatabase(databasePath); fs.rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

function request(url: string, user?: string, extra: Record<string, string> = {}) {
  return new NextRequest(`https://geo.example${url}`, { headers: {
    "x-geo-auth-secret": secret,
    ...(user ? { cookie: `${SESSION_COOKIE}=${createSession(user)}` } : {}),
    ...extra,
  } });
}

/** Apply the actual proxy's forwarded request headers, including overwritten user identity. */
async function throughProxy(incoming: NextRequest) {
  const response = await proxy(incoming);
  if (response.headers.get("x-middleware-next") !== "1") return response;
  const headers = new Headers();
  for (const name of (response.headers.get("x-middleware-override-headers") ?? "").split(",")) {
    if (name) headers.set(name, response.headers.get(`x-middleware-request-${name}`) ?? "");
  }
  return getReport(new NextRequest(incoming.url, { headers }));
}

function pdfText(bytes: ArrayBuffer) {
  return [...Buffer.from(bytes).toString("latin1").matchAll(/<([0-9A-F]+)> Tj/g)]
    .map((match) => Buffer.from(match[1], "hex").swap16().toString("utf16le")).join("\n");
}

describe.each(["audit", "share"] as const)("%s report observation access", (kind: Kind) => {
  it.each(["guest", "member", "admin"])("uses the authenticated %s role for JSON and PDF", async (user) => {
    for (const format of ["json", "pdf"] as const) {
      // A guest cookie must win over both a forged username and a cached admin Basic header.
      const response = await throughProxy(request(`/api/reports?type=${kind}&id=${ids[kind]}&format=${format}&includeObservations=true&role=admin`, user, {
        "x-geo-auth-user": "admin", authorization: `Basic ${Buffer.from("admin:demo").toString("base64")}`,
      }));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const text = format === "pdf" ? pdfText(await response.arrayBuffer()) : await response.text();
      if (format === "json") expect(JSON.parse(text).observations !== undefined).toBe(user !== "guest");
      for (const marker of privateMarkers) expect(text.includes(marker)).toBe(user !== "guest");
      if (format === "pdf") expect(text.includes("관측 지표 부록")).toBe(user !== "guest");
    }
  });

  it("keeps latest-report and Basic-auth access subject to guest restrictions", async () => {
    const response = await throughProxy(request(`/api/reports?type=${kind}`, undefined, {
      authorization: `Basic ${Buffer.from("guest:demo").toString("base64")}`,
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty("observations");
  });

  it("guards the builder even when an internal caller explicitly requests observations", () => {
    const loadObservations = vi.spyOn(appendixStore, "buildObservationAppendix");
    const report = withRequestAccount(new Headers({ "x-geo-auth-secret": secret, "x-geo-auth-user": "guest" }), () =>
      kind === "audit" ? buildAuditReport(ids.audit, { includeObservations: true }) : buildShareReport(ids.share, undefined, { includeObservations: true }));
    expect(report.observations).toBeUndefined();
    expect(loadObservations).not.toHaveBeenCalled();
  });

  it.each(["guest", "member"])("renders the real API payload in the %s preview", async (user) => {
    expect((await proxy(request("/reports", user))).status).toBe(200);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("/api/reports?")) return throughProxy(request(url, user, { "x-geo-auth-user": "admin" }));
      if (url === "/api/audits") return Response.json({ audits: kind === "audit" ? [{ id: ids.audit }] : [] });
      if (url === "/api/share") return Response.json({ runs: kind === "share" ? [{ id: ids.share, status: "completed" }] : [] });
      if (url.startsWith("/api/report-presets?") || url.startsWith("/api/report-shares?")) return Response.json({ items: [] });
      throw new Error(`Unexpected preview request: ${url}`);
    }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<ReportsClient />));
      expect(container.querySelector("article")).not.toBeNull();
      expect(container.textContent?.includes("관측 지표 부록")).toBe(user !== "guest");
      for (const marker of privateMarkers) expect(container.textContent?.includes(marker)).toBe(user !== "guest");
    } finally { await act(async () => root.unmount()); }
  });
});

describe("report authentication boundary", () => {
  it("rejects missing or forged proxy credentials on the report route itself", async () => {
    const invalidHeaders: Record<string, string>[] = [{}, { "x-geo-auth-user": "admin" }, { "x-geo-auth-secret": "forged", "x-geo-auth-user": "admin" }, { "x-geo-auth-secret": secret }];
    for (const headers of invalidHeaders) {
      const response = getReport(new NextRequest(`https://geo.example/api/reports?type=audit&id=${ids.audit}`, { headers }));
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "AUTH_REQUIRED" });
    }
  });
  it("rejects anonymous and tampered sessions even with a forged admin header", async () => {
    for (const cookie of ["", `${SESSION_COOKIE}=${createSession("admin")}tampered`]) {
      const response = await throughProxy(request("/api/reports?type=audit", undefined, { cookie, "x-geo-auth-user": "admin" }));
      expect(response.status).toBe(401);
    }
  });
  it("fails closed on invalid authentication configuration", () => {
    vi.stubEnv("GEO_AUTH_MODE", "invalid");
    expect(getReport(request("/api/reports?type=audit", "member")).status).toBe(503);
  });
  it("keeps guest precedence when account role lists overlap", async () => {
    vi.stubEnv("GEO_ADMIN_USERS", "admin,guest");
    const response = await throughProxy(request("/api/reports?type=audit", "guest"));
    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty("observations");
  });
  it("preserves local reports and does not add observations to CSV", async () => {
    vi.stubEnv("GEO_AUTH_MODE", "local");
    const json = getReport(new NextRequest("http://localhost/api/reports?type=audit"));
    expect((await json.json()).observations).toBeDefined();
    const csv = getReport(new NextRequest("http://localhost/api/reports?type=audit&format=csv"));
    expect(csv.status).toBe(200);
    for (const marker of privateMarkers) expect(await csv.clone().text()).not.toContain(marker);
  });
});
