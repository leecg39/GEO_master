import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, getDatabase } from "@/lib/db";
import { getServerSettings } from "@/lib/settings";
import { GET, PUT } from "@/app/api/settings/route";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-master-test-"));
const databasePath = path.join(tempDir, "cold", "geo.db");
const previousDb = process.env.GEO_DB_PATH;
const previousKey = process.env.GEO_MASTER_KEY;

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "integration-test-master-key-32-characters-minimum";
});
afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb;
  if (previousKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = previousKey;
});

describe.sequential("settings API and cold-start database", () => {
  it("creates the parent directory, database and schema on the first GET", async () => {
    expect(fs.existsSync(path.dirname(databasePath))).toBe(false);
    const response = GET();
    expect(response.status).toBe(200);
    expect(fs.existsSync(databasePath)).toBe(true);
    const table = getDatabase().sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='measure_results'").get();
    expect(table).toBeTruthy();
  });

  it("round-trips settings without exposing plaintext API keys", async () => {
    const secret = "sk-integration-secret-9876";
    const request = new NextRequest("http://localhost/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        brandName: "테스트 브랜드", category: "GEO 도구", competitors: ["경쟁사A"],
        models: { openai: "gpt-test", anthropic: "claude-test", gemini: "gemini-test" },
        repetitions: 3, modelWeights: { openai: .4, anthropic: .35, gemini: .25 },
        apiKeys: { openai: secret, anthropic: "sk-ant-normal-5555" },
      }),
    });
    const putResponse = await PUT(request);
    expect(putResponse.status).toBe(200);
    const putText = await putResponse.text();
    expect(putText).not.toContain(secret);
    expect(putText).toContain("••••••••9876");

    const getResponse = GET();
    const getText = await getResponse.text();
    expect(getText).not.toContain(secret);
    expect(JSON.parse(getText).settings.apiKeys.openai.configured).toBe(true);
    const stored = getDatabase().sqlite.prepare("SELECT openai_api_key FROM settings WHERE id=1").get() as { openai_api_key: string };
    expect(stored.openai_api_key).not.toContain(secret);
  });

  it("reports corrupted encrypted data safely instead of returning it or crashing", async () => {
    getDatabase().sqlite.prepare("UPDATE settings SET openai_api_key = ? WHERE id=1").run("not-valid-ciphertext");
    const response = GET();
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("not-valid-ciphertext");
    expect(JSON.parse(text).settings.apiKeys.openai).toMatchObject({ configured: true, preview: null, error: true });
    expect(getServerSettings(["anthropic"]).decryptedApiKeys.anthropic).toBe("sk-ant-normal-5555");
    expect(() => getServerSettings(["openai"])).toThrow(/openai API 키를 복호화/);
  });
});
