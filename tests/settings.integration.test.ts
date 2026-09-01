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
    const hyperclovaSecret = "nv-hyperclova-secret-4321";
    const request = new NextRequest("http://localhost/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        brandName: "테스트 브랜드", category: "GEO 도구", competitors: ["경쟁사A"],
        models: { openai: "gpt-test", anthropic: "claude-test", gemini: "gemini-test", hyperclova: "HCX-DASH-002" },
        repetitions: 3, modelWeights: { openai: .3, anthropic: .25, gemini: .2, hyperclova: .25 },
        apiKeys: { openai: secret, anthropic: "sk-ant-normal-5555", hyperclova: hyperclovaSecret },
      }),
    });
    const putResponse = await PUT(request);
    expect(putResponse.status).toBe(200);
    const putText = await putResponse.text();
    expect(putText).not.toContain(secret);
    expect(putText).not.toContain(hyperclovaSecret);
    expect(putText).toContain("••••••••9876");
    expect(putText).toContain("••••••••4321");

    const getResponse = GET();
    const getText = await getResponse.text();
    expect(getText).not.toContain(secret);
    expect(getText).not.toContain(hyperclovaSecret);
    expect(JSON.parse(getText).settings.apiKeys.openai.configured).toBe(true);
    expect(JSON.parse(getText).settings.apiKeys.hyperclova.configured).toBe(true);
    const stored = getDatabase().sqlite.prepare("SELECT openai_api_key, hyperclova_api_key FROM settings WHERE id=1").get() as { openai_api_key: string; hyperclova_api_key: string };
    expect(stored.openai_api_key).not.toContain(secret);
    expect(stored.hyperclova_api_key).not.toContain(hyperclovaSecret);
    expect(getServerSettings(["hyperclova"]).decryptedApiKeys.hyperclova).toBe(hyperclovaSecret);
  });

  it("round-trips the subscription pin without exposing plaintext", async () => {
    const pin = "csk_sub-pin-secret-2468";
    const request = new NextRequest("http://localhost/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        brandName: "핀 브랜드", category: "GEO 도구", competitors: [],
        models: { openai: "gpt-test", anthropic: "claude-test", gemini: "gemini-test", hyperclova: "HCX-DASH-002" },
        repetitions: 3, modelWeights: { openai: .3, anthropic: .25, gemini: .2, hyperclova: .25 },
        subscriptionPin: pin,
      }),
    });
    const putResponse = await PUT(request);
    expect(putResponse.status).toBe(200);
    const putText = await putResponse.text();
    expect(putText).not.toContain(pin);
    expect(JSON.parse(putText).settings.subscriptionPin).toMatchObject({ configured: true, error: false });
    expect(putText).toContain("••••••••2468");

    const stored = getDatabase().sqlite.prepare("SELECT subscription_pin FROM settings WHERE id=1").get() as { subscription_pin: string };
    expect(stored.subscription_pin).not.toContain(pin);
    expect(getServerSettings().decryptedSubscriptionPin).toBe(pin);
    const viaSubscription = getServerSettings(["openai", "anthropic"]);
    expect(viaSubscription.decryptedApiKeys.openai).toBe(pin);
    expect(viaSubscription.decryptedApiKeys.anthropic).toBe(pin);
    expect(viaSubscription.models).toMatchObject({ openai: "gpt-5.6-luna", anthropic: "claude-sonnet-5" });

    const clearRequest = new NextRequest("http://localhost/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        brandName: "핀 브랜드", category: "GEO 도구", competitors: [],
        models: { openai: "gpt-test", anthropic: "claude-test", gemini: "gemini-test", hyperclova: "HCX-DASH-002" },
        repetitions: 3, modelWeights: { openai: .3, anthropic: .25, gemini: .2, hyperclova: .25 },
        clearSubscriptionPin: true,
      }),
    });
    const clearResponse = await PUT(clearRequest);
    expect(JSON.parse(await clearResponse.text()).settings.subscriptionPin.configured).toBe(false);
    expect(getServerSettings().decryptedSubscriptionPin).toBeNull();
  });

  it("prefers environment keys and validates the Gudokpin csk_ prefix", () => {
    const names = ["GUDOKPIN_API_KEY", "GUDOKPIN_OPENAI_MODEL", "GUDOKPIN_ANTHROPIC_MODEL", "GEMINI_API_KEY", "HYPERCLOVA_API_KEY"] as const;
    const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    try {
      process.env.GUDOKPIN_API_KEY = "csk_environment-1234";
      process.env.GUDOKPIN_OPENAI_MODEL = "gpt-5.6-luna";
      process.env.GUDOKPIN_ANTHROPIC_MODEL = "claude-sonnet-5";
      process.env.GEMINI_API_KEY = "gemini-environment";
      process.env.HYPERCLOVA_API_KEY = "clova-environment";
      const server = getServerSettings(["openai", "anthropic", "gemini", "hyperclova"]);
      expect(server.decryptedApiKeys).toEqual({
        openai: "csk_environment-1234",
        anthropic: "csk_environment-1234",
        gemini: "gemini-environment",
        hyperclova: "clova-environment",
      });
      expect(server.models).toMatchObject({ openai: "gpt-5.6-luna", anthropic: "claude-sonnet-5" });
      expect(server.apiKeys.openai).toMatchObject({ configured: true, error: false, source: "environment" });

      process.env.GUDOKPIN_API_KEY = "sk-invalid";
      expect(() => getServerSettings(["openai"])).toThrow(/csk_/);
    } finally {
      for (const name of names) {
        const value = previous[name];
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }
  });

  it("accepts legacy three-provider settings payloads", async () => {
    const request = new NextRequest("http://localhost/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        brandName: "레거시 브랜드", category: "GEO 도구", competitors: [],
        models: { openai: "gpt-legacy", anthropic: "claude-legacy", gemini: "gemini-legacy" },
        repetitions: 2, modelWeights: { openai: .4, anthropic: .35, gemini: .25 },
      }),
    });
    const response = await PUT(request);
    expect(response.status).toBe(200);
    const body = JSON.parse(await response.text()).settings;
    expect(body.models.hyperclova).toBe("HCX-DASH-002");
    expect(body.modelWeights.hyperclova).toBe(.25);
    expect(body.apiKeys.hyperclova.configured).toBe(true);
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
