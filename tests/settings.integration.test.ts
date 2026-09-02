import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, getDatabase } from "@/lib/db";
import { getPublicSettings, getServerSettings, getFirecrawlApiKey, getTalordataApiToken } from "@/lib/settings";
import { GET, PUT } from "@/app/api/settings/route";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-master-test-"));
const databasePath = path.join(tempDir, "cold", "geo.db");
const previousDb = process.env.GEO_DB_PATH;
const previousKey = process.env.GEO_MASTER_KEY;
const previousGrokKey = process.env.GROK_API_KEY;
const previousXaiKey = process.env.XAI_API_KEY;
const previousTalordataToken = process.env.TALORDATA_API_TOKEN;
const previousFirecrawlKey = process.env.FIRECRAWL_API_KEY;

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "integration-test-master-key-32-characters-minimum";
  delete process.env.GROK_API_KEY;
  delete process.env.XAI_API_KEY;
  delete process.env.TALORDATA_API_TOKEN;
  delete process.env.FIRECRAWL_API_KEY;
});
afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb;
  if (previousKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = previousKey;
  if (previousGrokKey === undefined) delete process.env.GROK_API_KEY; else process.env.GROK_API_KEY = previousGrokKey;
  if (previousXaiKey === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = previousXaiKey;
  if (previousTalordataToken === undefined) delete process.env.TALORDATA_API_TOKEN; else process.env.TALORDATA_API_TOKEN = previousTalordataToken;
  if (previousFirecrawlKey === undefined) delete process.env.FIRECRAWL_API_KEY; else process.env.FIRECRAWL_API_KEY = previousFirecrawlKey;
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
    const grokSecret = "xai-grok-secret-4321";
    const request = new NextRequest("http://localhost/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedUpdatedAt: getPublicSettings().updatedAt,
        models: { openai: "gpt-test", anthropic: "claude-test", gemini: "gemini-test", grok: "grok-4.6" },
        repetitions: 3, modelWeights: { openai: .3, anthropic: .25, gemini: .2, grok: .25 },
        apiKeys: { openai: secret, anthropic: "sk-ant-normal-5555", grok: grokSecret },
      }),
    });
    const putResponse = await PUT(request);
    expect(putResponse.status).toBe(200);
    const putText = await putResponse.text();
    expect(putText).not.toContain(secret);
    expect(putText).not.toContain(grokSecret);
    expect(putText).toContain("••••••••9876");
    expect(putText).toContain("••••••••4321");

    const getResponse = GET();
    const getText = await getResponse.text();
    expect(getText).not.toContain(secret);
    expect(getText).not.toContain(grokSecret);
    expect(JSON.parse(getText).settings.apiKeys.openai.configured).toBe(true);
    expect(JSON.parse(getText).settings.apiKeys.grok.configured).toBe(true);
    const stored = getDatabase().sqlite.prepare("SELECT openai_api_key, grok_api_key FROM settings WHERE id=1").get() as { openai_api_key: string; grok_api_key: string };
    expect(stored.openai_api_key).not.toContain(secret);
    expect(stored.grok_api_key).not.toContain(grokSecret);
    expect(getServerSettings(["grok"]).decryptedApiKeys.grok).toBe(grokSecret);
  });

  it("keeps project profiles canonical and rejects stale or project fields in global settings", async () => {
    const before = getPublicSettings();
    const projectBefore = getDatabase().sqlite.prepare("SELECT updated_at FROM projects WHERE id = ?").get(before.activeProject.id) as { updated_at: string };
    getDatabase().sqlite.prepare("UPDATE projects SET name = ?, brand_name = ?, category = ?, competitors = ? WHERE id = ?")
      .run("정식 프로젝트", "정식 브랜드", "정식 카테고리", JSON.stringify(["경쟁사 X"]), before.activeProject.id);

    const publicResponse = GET();
    const publicBody = (await publicResponse.json()).settings;
    expect(publicBody).toMatchObject({
      brandName: "정식 브랜드",
      category: "정식 카테고리",
      competitors: ["경쟁사 X"],
      activeProject: { id: before.activeProject.id, name: "정식 프로젝트" },
    });

    const invalid = await PUT(new NextRequest("http://localhost/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        models: before.models, repetitions: 2, modelWeights: before.modelWeights,
        expectedUpdatedAt: before.updatedAt, brandName: "설정에서 덮어쓰기",
      }),
    }));
    expect(invalid.status).toBe(422);
    expect((await invalid.json()).code).toBe("VALIDATION_ERROR");

    const valid = await PUT(new NextRequest("http://localhost/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        models: before.models, repetitions: 2, modelWeights: before.modelWeights,
        expectedUpdatedAt: before.updatedAt,
      }),
    }));
    expect(valid.status).toBe(200);
    expect((await valid.json()).settings.repetitions).toBe(2);

    const stale = await PUT(new NextRequest("http://localhost/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        models: before.models, repetitions: 4, modelWeights: before.modelWeights,
        expectedUpdatedAt: before.updatedAt,
      }),
    }));
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe("STALE_WRITE");
    expect((getDatabase().sqlite.prepare("SELECT updated_at FROM projects WHERE id = ?").get(before.activeProject.id) as { updated_at: string }).updated_at)
      .toBe(projectBefore.updated_at);
  });

  it("round-trips the subscription pin without exposing plaintext", async () => {
    const pin = "csk_sub-pin-secret-2468";
    const request = new NextRequest("http://localhost/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedUpdatedAt: getPublicSettings().updatedAt,
        models: { openai: "gpt-test", anthropic: "claude-test", gemini: "gemini-test", grok: "grok-4.6" },
        repetitions: 3, modelWeights: { openai: .3, anthropic: .25, gemini: .2, grok: .25 },
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
        expectedUpdatedAt: getPublicSettings().updatedAt,
        models: { openai: "gpt-test", anthropic: "claude-test", gemini: "gemini-test", grok: "grok-4.6" },
        repetitions: 3, modelWeights: { openai: .3, anthropic: .25, gemini: .2, grok: .25 },
        clearSubscriptionPin: true,
      }),
    });
    const clearResponse = await PUT(clearRequest);
    expect(JSON.parse(await clearResponse.text()).settings.subscriptionPin.configured).toBe(false);
    expect(getServerSettings().decryptedSubscriptionPin).toBeNull();
  });

  it("round-trips the TalorData API token without exposing plaintext", async () => {
    const token = "td_serp-integration-token-1357";
    const request = new NextRequest("http://localhost/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedUpdatedAt: getPublicSettings().updatedAt,
        models: { openai: "gpt-test", anthropic: "claude-test", gemini: "gemini-test", grok: "grok-4.6" },
        repetitions: 3, modelWeights: { openai: .3, anthropic: .25, gemini: .2, grok: .25 },
        talordataApiToken: token,
      }),
    });
    const putResponse = await PUT(request);
    expect(putResponse.status).toBe(200);
    const putText = await putResponse.text();
    expect(putText).not.toContain(token);
    expect(JSON.parse(putText).settings.talordataApiToken).toMatchObject({ configured: true, error: false });
    expect(putText).toContain("••••••••1357");

    const stored = getDatabase().sqlite.prepare("SELECT talordata_api_token FROM settings WHERE id=1").get() as { talordata_api_token: string };
    expect(stored.talordata_api_token).not.toContain(token);
    expect(getTalordataApiToken()).toBe(token);

    const clearRequest = new NextRequest("http://localhost/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedUpdatedAt: getPublicSettings().updatedAt,
        models: { openai: "gpt-test", anthropic: "claude-test", gemini: "gemini-test", grok: "grok-4.6" },
        repetitions: 3, modelWeights: { openai: .3, anthropic: .25, gemini: .2, grok: .25 },
        clearTalordataApiToken: true,
      }),
    });
    const clearResponse = await PUT(clearRequest);
    expect(JSON.parse(await clearResponse.text()).settings.talordataApiToken.configured).toBe(false);
    expect(getTalordataApiToken()).toBeNull();
  });

  it("prefers the TalorData environment token over the stored token", async () => {
    const request = new NextRequest("http://localhost/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedUpdatedAt: getPublicSettings().updatedAt,
        models: { openai: "gpt-test", anthropic: "claude-test", gemini: "gemini-test", grok: "grok-4.6" },
        repetitions: 3, modelWeights: { openai: .3, anthropic: .25, gemini: .2, grok: .25 },
        talordataApiToken: "td_stored-token-9999",
      }),
    });
    await PUT(request);
    process.env.TALORDATA_API_TOKEN = "td_environment-token-8888";
    expect(getTalordataApiToken()).toBe("td_environment-token-8888");
    expect(getPublicSettings().talordataApiToken).toMatchObject({ configured: true, source: "environment" });
    delete process.env.TALORDATA_API_TOKEN;
    expect(getTalordataApiToken()).toBe("td_stored-token-9999");
  });

  it("round-trips the Firecrawl API key without exposing plaintext", async () => {
    const key = "fc_integration-firecrawl-key-2468";
    const request = new NextRequest("http://localhost/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedUpdatedAt: getPublicSettings().updatedAt,
        models: { openai: "gpt-test", anthropic: "claude-test", gemini: "gemini-test", grok: "grok-4.6" },
        repetitions: 3, modelWeights: { openai: .3, anthropic: .25, gemini: .2, grok: .25 },
        firecrawlApiKey: key,
      }),
    });
    const putResponse = await PUT(request);
    expect(putResponse.status).toBe(200);
    const putText = await putResponse.text();
    expect(putText).not.toContain(key);
    expect(JSON.parse(putText).settings.firecrawlApiKey).toMatchObject({ configured: true, error: false });
    expect(putText).toContain("••••••••2468");
    expect(getFirecrawlApiKey()).toBe(key);

    const clearRequest = new NextRequest("http://localhost/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedUpdatedAt: getPublicSettings().updatedAt,
        models: { openai: "gpt-test", anthropic: "claude-test", gemini: "gemini-test", grok: "grok-4.6" },
        repetitions: 3, modelWeights: { openai: .3, anthropic: .25, gemini: .2, grok: .25 },
        clearFirecrawlApiKey: true,
      }),
    });
    const clearResponse = await PUT(clearRequest);
    expect(JSON.parse(await clearResponse.text()).settings.firecrawlApiKey.configured).toBe(false);
    expect(getFirecrawlApiKey()).toBeNull();
  });

  it("prefers environment keys and validates the Gudokpin csk_ prefix", () => {
    const names = ["GUDOKPIN_API_KEY", "GUDOKPIN_OPENAI_MODEL", "GUDOKPIN_ANTHROPIC_MODEL", "GEMINI_API_KEY", "GROK_API_KEY", "XAI_API_KEY"] as const;
    const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    try {
      process.env.GUDOKPIN_API_KEY = "csk_environment-1234";
      process.env.GUDOKPIN_OPENAI_MODEL = "gpt-5.6-luna";
      process.env.GUDOKPIN_ANTHROPIC_MODEL = "claude-sonnet-5";
      process.env.GEMINI_API_KEY = "gemini-environment";
      process.env.GROK_API_KEY = "grok-environment";
      const server = getServerSettings(["openai", "anthropic", "gemini", "grok"]);
      expect(server.decryptedApiKeys).toEqual({
        openai: "csk_environment-1234",
        anthropic: "csk_environment-1234",
        gemini: "gemini-environment",
        grok: "grok-environment",
      });
      expect(server.models).toMatchObject({ openai: "gpt-5.6-luna", anthropic: "claude-sonnet-5" });
      expect(server.apiKeys.openai).toMatchObject({ configured: true, error: false, source: "environment" });

      delete process.env.GROK_API_KEY;
      process.env.XAI_API_KEY = "xai-standard-environment";
      expect(getServerSettings(["grok"]).decryptedApiKeys.grok).toBe("xai-standard-environment");

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
        expectedUpdatedAt: getPublicSettings().updatedAt,
        models: { openai: "gpt-legacy", anthropic: "claude-legacy", gemini: "gemini-legacy" },
        repetitions: 2, modelWeights: { openai: .4, anthropic: .35, gemini: .25 },
      }),
    });
    const response = await PUT(request);
    expect(response.status).toBe(200);
    const body = JSON.parse(await response.text()).settings;
    expect(body.models.grok).toBe("grok-4.6");
    expect(body.modelWeights.grok).toBe(.25);
    expect(body.apiKeys.grok.configured).toBe(true);
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
