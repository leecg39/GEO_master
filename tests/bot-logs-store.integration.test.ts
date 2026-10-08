import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/bot-logs/route";
import { DELETE } from "@/app/api/bot-logs/[id]/route";
import { deleteBotLogImport, getBotLogImport, importBotLog, listBotLogImports } from "@/lib/bot-logs/store";
import type { DnsResolver } from "@/lib/bot-logs/verify";
import { closeDatabase } from "@/lib/db";
import { activateProject, createProject, ensureActiveProject } from "@/lib/projects";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-bot-logs-"));
const databasePath = path.join(dir, "geo.db");
const prevDb = process.env.GEO_DB_PATH;
const prevKey = process.env.GEO_MASTER_KEY;

const line = (ip: string, date: string, pathName: string, status: number, ua: string) =>
  `${ip} - - [${date}:10:00:00 +0900] "GET ${pathName} HTTP/1.1" ${status} 10 "-" "${ua}"`;
const LOG = [
  line("66.249.66.1", "08/Oct/2026", "/a?secret=1", 200, "Mozilla/5.0 (compatible; Googlebot/2.1)"),
  line("203.0.113.9", "08/Oct/2026", "/a", 200, "Mozilla/5.0 (compatible; Googlebot/2.1)"),
  line("20.15.240.1", "09/Oct/2026", "/llms.txt", 404, "GPTBot/1.2"),
  line("127.0.0.1", "09/Oct/2026", "/", 200, "GEO-Master-Audit/1.0 (+local diagnostic tool)"),
  line("198.51.100.4", "09/Oct/2026", "/", 200, "Mozilla/5.0 Chrome/141.0"),
].join("\n");

const resolver: DnsResolver = {
  reverse: async (ip) => (ip === "66.249.66.1" ? ["crawl-66-249-66-1.googlebot.com"] : ["spoof.example.net"]),
  lookup: async (host) => (host === "crawl-66-249-66-1.googlebot.com" ? ["66.249.66.1"] : []),
};

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "bot-logs-master-key-with-32-characters-x";
  ensureActiveProject();
});
afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(dir, { recursive: true, force: true });
  if (prevDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = prevDb;
  if (prevKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = prevKey;
});

describe("bot log store", () => {
  it("stores only aggregates with trust levels, never IPs or query strings", async () => {
    const result = await importBotLog({ fileName: "access.log", buffer: Buffer.from(LOG), verifyDns: true, resolver });
    expect(result.duplicate).toBe(false);
    expect(result.import).toMatchObject({
      source: "access_log", format: "combined", fileName: "access.log", periodStart: "2026-10-08", periodEnd: "2026-10-09",
      offsets: ["+0900"], dnsChecked: true, totals: { lines: 5, parsed: 5, skipped: 0, aiBot: 3, self: 1, other: 1 },
    });
    const detail = getBotLogImport(result.import.id);
    expect(detail.bots).toContainEqual({ botToken: "Googlebot", operator: "Google", purpose: "search", dnsVerifiable: true, hits: 2, verifiedHits: 1, failedHits: 1, uncheckedHits: 0, statusClasses: { "2xx": 2 } });
    expect(detail.bots).toContainEqual({ botToken: "GPTBot", operator: "OpenAI", purpose: "training", dnsVerifiable: false, hits: 1, verifiedHits: 0, failedHits: 0, uncheckedHits: 1, statusClasses: { "4xx": 1 } });
    expect(detail.paths).toContainEqual({ botToken: "Googlebot", path: "/a", hits: 2 });
    const dump = JSON.stringify(fs.readFileSync(databasePath));
    expect(JSON.stringify(detail)).not.toMatch(/66\.249|203\.0\.113|secret=/);
    expect(dump).not.toMatch(/203\.0\.113\.9/);
  });

  it("treats the same file as a duplicate and records 'unchecked' when DNS verification is off", async () => {
    expect((await importBotLog({ fileName: "access.log", buffer: Buffer.from(LOG), verifyDns: true, resolver })).duplicate).toBe(true);
    const other = await importBotLog({ fileName: "b.log", buffer: Buffer.from(`${LOG}\n`), verifyDns: false });
    expect(other.import.dnsChecked).toBe(false);
    expect(getBotLogImport(other.import.id).bots.find((bot) => bot.botToken === "Googlebot")).toMatchObject({ verifiedHits: 0, failedHits: 0, uncheckedHits: 2 });
  });

  it("scopes imports to the active project and deletes them", async () => {
    const original = ensureActiveProject().id;
    const before = listBotLogImports().length;
    const target = listBotLogImports()[0]!;
    const project = createProject({ name: "다른 프로젝트", brandName: "다른", category: "", competitors: [], activate: true });
    expect(listBotLogImports()).toHaveLength(0);
    expect(() => deleteBotLogImport(target.id)).toThrow();
    expect(() => getBotLogImport(target.id)).toThrow();
    activateProject(original);
    expect(project.id).not.toBe(original);
    expect(listBotLogImports()).toHaveLength(before);
    deleteBotLogImport(target.id);
    expect(listBotLogImports()).toHaveLength(before - 1);
  });
});

describe("/api/bot-logs", () => {
  const post = (body: unknown) => POST(new NextRequest("http://localhost/api/bot-logs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

  it("imports a base64 log without DNS lookups by default and lists it", async () => {
    const created = await post({ fileName: "route.log", contentBase64: Buffer.from(`${LOG}\n\n`).toString("base64") });
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.import).toMatchObject({ dnsChecked: false, totals: { aiBot: 3 } });
    const list = await GET().json();
    expect(list.items.some((item: { id: number }) => item.id === body.import.id)).toBe(true);
    const removed = await DELETE(new NextRequest(`http://localhost/api/bot-logs/${body.import.id}`, { method: "DELETE" }), { params: Promise.resolve({ id: String(body.import.id) }) });
    expect(removed.status).toBe(204);
  });

  it("rejects malformed bodies and unrecognised logs with clear codes", async () => {
    expect((await post({ fileName: "x.log" })).status).toBe(422);
    expect((await post({ fileName: "x.log", contentBase64: "!!!" })).status).toBe(422);
    const unrecognised = await post({ fileName: "x.log", contentBase64: Buffer.from("hello world").toString("base64") });
    expect(unrecognised.status).toBe(422);
    expect((await unrecognised.json()).code).toBe("LOG_UNRECOGNIZED");
  });
});
