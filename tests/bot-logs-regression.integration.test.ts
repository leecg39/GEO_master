import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as deleteProjectRoute, GET as getProjectRoute } from "@/app/api/projects/[id]/route";
import { deleteBotLogImport, getBotLogImport, importBotLog, listBotLogImports } from "@/lib/bot-logs/store";
import type { DnsResolver } from "@/lib/bot-logs/verify";
import { closeDatabase, getDatabase } from "@/lib/db";
import { activateProject, createProject, deleteProject, ensureActiveProject } from "@/lib/projects";

// All addresses, tokens and request data below are synthetic. Never use real access logs here.
const TOKEN = "AbCdEf0123456789-long_secret";
const ENCODED = "%2541bCdEf0123456789%252Dlong_secret";
const LOG = Buffer.from([
  `192.0.2.1 - - [08/Oct/2026:10:00:00 +0900] "GET /reset/${TOKEN}?private=synthetic-query HTTP/1.1" 200 10 "https://example.test/private-referrer" "Googlebot/2.1"`,
  `192.0.2.2 - - [08/Oct/2026:10:00:00 +0900] "GET /reset/${ENCODED} HTTP/1.1" 200 10 "-" "Googlebot/2.1"`,
  '192.0.2.3 - - [09/Oct/2026:10:00:00 +0900] "GET /llms.txt HTTP/1.1" 404 10 "-" "bingbot/2.0"',
].join("\n"));
const resolver: DnsResolver = {
  reverse: async (ip) => ip === "192.0.2.1" ? ["synthetic.googlebot.com"] : ip === "192.0.2.3" ? ["synthetic.search.msn.com"] : ["spoof.example.test"],
  lookup: async (host) => host === "synthetic.googlebot.com" ? ["192.0.2.1"] : ["192.0.2.3"],
};
const upload = (verifyDns = false, dns = resolver) => importBotLog({ fileName: "synthetic.log", buffer: LOG, verifyDns, resolver: dns });
let dir: string;
let databasePath: string;
const previousDb = process.env.GEO_DB_PATH;
const previousKey = process.env.GEO_MASTER_KEY;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-bot-regression-"));
  databasePath = path.join(dir, "test.db");
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "synthetic-regression-master-key-32-characters";
  ensureActiveProject();
});
afterEach(() => {
  closeDatabase(databasePath);
  fs.rmSync(dir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb;
  if (previousKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = previousKey;
});

function snapshot() {
  const { sqlite } = getDatabase();
  return ["bot_log_imports", "bot_log_hits", "bot_log_paths"].map((table) => sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
}

function pendingResolver() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return { release, resolver: { ...resolver, reverse: async (ip: string) => { await gate; return resolver.reverse(ip); } } };
}

describe("bot log privacy and DNS upgrade regressions", () => {
  it("persists only masked aggregates, including in SQLite and its journal", async () => {
    const result = await upload(true);
    expect(getBotLogImport(result.import.id).paths).toContainEqual({ botToken: "Googlebot", path: "/reset/:id", hits: 2 });
    const content = JSON.stringify(snapshot());
    for (const privateValue of [TOKEN, ENCODED, "192.0.2.", "synthetic-query", "private-referrer", "synthetic.googlebot.com"]) {
      expect(content.includes(privateValue)).toBe(false);
      for (const suffix of ["", "-wal", "-journal"]) {
        if (fs.existsSync(databasePath + suffix)) expect(fs.readFileSync(databasePath + suffix).includes(Buffer.from(privateValue))).toBe(false);
      }
    }
  });

  it("upgrades an unchecked duplicate in place without changing identity, metadata or totals", async () => {
    const first = await upload();
    const oldDetail = getBotLogImport(first.import.id);
    const dns = { reverse: vi.fn(resolver.reverse), lookup: vi.fn(resolver.lookup) };
    const result = await importBotLog({ fileName: "renamed.log", buffer: LOG, verifyDns: true, resolver: dns });
    expect(dns.reverse).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ duplicate: true, dnsUpdated: true, import: { ...first.import, dnsChecked: true } });
    expect(listBotLogImports()).toHaveLength(1);
    const detail = getBotLogImport(first.import.id);
    expect(detail.daily).toEqual(oldDetail.daily);
    expect(detail.paths).toEqual(oldDetail.paths);
    expect(detail.bots.find((bot) => bot.botToken === "Googlebot")).toMatchObject({ hits: 2, verifiedHits: 1, failedHits: 1, uncheckedHits: 0 });
    expect(detail.bots.find((bot) => bot.botToken === "Bingbot")).toMatchObject({ hits: 1, verifiedHits: 1, failedHits: 0 });
    const checked = snapshot();
    await upload(false, dns);
    await upload(true, dns);
    expect(dns.reverse).toHaveBeenCalledTimes(3);
    expect(snapshot()[0]).toEqual(checked[0]);
    expect(snapshot()[1]).toEqual(checked[1]);
    expect(getBotLogImport(first.import.id)).toEqual(detail);
  });

  it("resanitizes legacy paths on duplicate uploads without discarding verification", async () => {
    const first = await upload(true);
    getDatabase().sqlite.prepare("UPDATE bot_log_paths SET path = ? WHERE import_id = ? AND bot_token = 'Googlebot'").run(`/reset/${TOKEN}`, first.import.id);
    await upload();
    const detail = getBotLogImport(first.import.id);
    expect(detail.paths).toContainEqual({ botToken: "Googlebot", path: "/reset/:id", hits: 2 });
    expect(detail.bots.find((bot) => bot.botToken === "Googlebot")?.verifiedHits).toBe(1);
  });

  it("does not double count competing DNS upgrades or downgrade the winner", async () => {
    const first = await upload();
    const slow = pendingResolver();
    const waiting = upload(true, slow.resolver);
    const winner = await upload(true);
    await upload(false);
    slow.release();
    const second = await waiting;
    expect([winner.import.id, second.import.id]).toEqual([first.import.id, first.import.id]);
    expect(winner).toMatchObject({ dnsUpdated: true });
    expect(second).toMatchObject({ dnsUpdated: false });
    expect(listBotLogImports()).toHaveLength(1);
    expect(getBotLogImport(first.import.id).bots.find((bot) => bot.botToken === "Googlebot")).toMatchObject({ hits: 2, verifiedHits: 1, failedHits: 1 });
  });

  it("upgrades an unchecked import created while a first verified upload waits on DNS", async () => {
    const slow = pendingResolver();
    const waiting = upload(true, slow.resolver);
    const first = await upload();
    slow.release();
    const result = await waiting;
    expect(result).toMatchObject({ duplicate: true, dnsUpdated: true, import: { id: first.import.id, dnsChecked: true } });
    expect(listBotLogImports()).toHaveLength(1);
  });

  it("rolls back verification, hits and paths together if storing the replacement fails", async () => {
    await upload();
    const before = snapshot();
    const { sqlite } = getDatabase();
    sqlite.exec("CREATE TRIGGER reject_paths BEFORE INSERT ON bot_log_paths BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END");
    try { await expect(upload(true)).rejects.toThrow(); }
    finally { sqlite.exec("DROP TRIGGER reject_paths"); }
    expect(snapshot()).toEqual(before);
  });

  it("keeps DNS errors unchecked and preserves visits and paths", async () => {
    const first = await upload();
    const original = getBotLogImport(first.import.id);
    const unavailable: DnsResolver = { reverse: async () => { throw new Error("synthetic DNS outage"); }, lookup: async () => [] };
    await upload(true, unavailable);
    const detail = getBotLogImport(first.import.id);
    expect(detail.dnsChecked).toBe(true);
    expect(detail.daily).toEqual(original.daily);
    expect(detail.paths).toEqual(original.paths);
    expect(detail.bots.every((bot) => bot.verifiedHits === 0 && bot.failedHits === 0 && bot.uncheckedHits === bot.hits)).toBe(true);
  });

  it("does not resurrect an import deleted during DNS verification", async () => {
    const first = await upload();
    const slow = pendingResolver();
    const waiting = upload(true, slow.resolver);
    deleteBotLogImport(first.import.id);
    slow.release();
    await expect(waiting).rejects.toMatchObject({ code: "BOT_LOG_NOT_FOUND" });
    expect(listBotLogImports()).toHaveLength(0);
  });

  it("rejects a project switch during verification and leaves both projects intact", async () => {
    const original = ensureActiveProject();
    const first = await upload();
    const before = snapshot();
    const slow = pendingResolver();
    const waiting = upload(true, slow.resolver);
    createProject({ name: "다른 프로젝트", brandName: "", category: "", competitors: [], activate: true });
    slow.release();
    await expect(waiting).rejects.toMatchObject({ code: "PROJECT_SCOPE_MISMATCH" });
    expect(snapshot()).toEqual(before);
    expect(listBotLogImports()).toHaveLength(0);
    activateProject(original.id);
    expect(getBotLogImport(first.import.id).dnsChecked).toBe(false);
  });

  it("never recreates a project or its logs after a confirmed deletion during DNS", async () => {
    const project = ensureActiveProject();
    const replacement = createProject({ name: "남길 프로젝트", brandName: "", category: "", competitors: [] });
    await upload();
    const slow = pendingResolver();
    const waiting = upload(true, slow.resolver);
    deleteProject(project.id, { expectedUpdatedAt: project.updatedAt, cascadeConfirmed: true, replacementProjectId: replacement.id });
    slow.release();
    await expect(waiting).rejects.toMatchObject({ code: "PROJECT_SCOPE_MISMATCH" });
    expect(snapshot()).toEqual([[], [], []]);
    expect(getDatabase().sqlite.prepare("SELECT id FROM projects WHERE id = ?").get(project.id)).toBeUndefined();
  });
});

describe("bot log project deletion protection", () => {
  it.each([undefined, false])("requires explicit cascade confirmation (%#) and preserves another project's logs", async (cascadeConfirmed) => {
    const project = ensureActiveProject();
    const own = await upload();
    const other = createProject({ name: "남길 프로젝트", brandName: "", category: "", competitors: [], activate: true });
    const retained = await upload(true);
    const retainedDetail = getBotLogImport(retained.import.id);
    const context = { params: Promise.resolve({ id: String(project.id) }) };
    const url = `http://localhost/api/projects/${project.id}`;
    const detail = await getProjectRoute(new NextRequest(url), context);
    expect((await detail.json()).dependencies).toMatchObject({ botLogImports: 1 });
    const request = (confirmed: boolean | undefined) => new NextRequest(url, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedUpdatedAt: project.updatedAt, cascadeConfirmed: confirmed }) });
    const before = snapshot();
    const blocked = await deleteProjectRoute(request(cascadeConfirmed), context);
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ code: "PROJECT_HAS_DEPENDENCIES", details: { dependencies: { botLogImports: 1 }, total: 1 } });
    expect(snapshot()).toEqual(before);
    const deleted = await deleteProjectRoute(request(true), context);
    expect(deleted.status).toBe(204);
    const { sqlite } = getDatabase();
    expect(sqlite.prepare("SELECT id FROM bot_log_imports WHERE id = ?").get(own.import.id)).toBeUndefined();
    for (const table of ["bot_log_hits", "bot_log_paths"]) expect(sqlite.prepare(`SELECT * FROM ${table} WHERE import_id = ?`).all(own.import.id)).toEqual([]);
    expect(ensureActiveProject().id).toBe(other.id);
    expect(getBotLogImport(retained.import.id)).toEqual(retainedDetail);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  });
});
