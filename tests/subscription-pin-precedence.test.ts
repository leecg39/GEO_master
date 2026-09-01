import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { applyDatabaseMigrations, closeDatabase, getDatabase } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { ensureSettingsRow, getServerSettings } from "@/lib/settings";

// Track C: 구독핀 키의 우선순위(precedence)와 마이그레이션 보존을 검증한다.
// 기존 settings.integration.test.ts 가 환경 키 우선/저장 핀 왕복을 각각 다루지만,
// 아래 조합(직접 키 vs 저장 핀, 환경 키 vs 저장 핀, 환경 구독핀 vs 저장 핀)의 순서는 다루지 않는다.

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-pin-precedence-"));
const databasePath = path.join(tempDir, "pin.db");
const previousDb = process.env.GEO_DB_PATH;
const previousKey = process.env.GEO_MASTER_KEY;

// 이 스위트가 조작하는 모든 환경 변수는 각 테스트 후 원복한다.
const managedEnv = [
  "GUDOKPIN_API_KEY",
  "GUDOKPIN_OPENAI_MODEL",
  "GUDOKPIN_ANTHROPIC_MODEL",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GROK_API_KEY",
  "XAI_API_KEY",
] as const;
const savedEnv = Object.fromEntries(managedEnv.map((name) => [name, process.env[name]]));

function clearManagedEnv() {
  for (const name of managedEnv) delete process.env[name];
}

function setStoredPin(value: string) {
  getDatabase().sqlite.prepare("UPDATE settings SET subscription_pin = ? WHERE id = 1").run(encryptSecret(value));
}

function setStoredProviderKey(column: "openai_api_key" | "anthropic_api_key" | "gemini_api_key" | "grok_api_key", value: string | null) {
  getDatabase().sqlite.prepare(`UPDATE settings SET ${column} = ? WHERE id = 1`).run(value === null ? null : encryptSecret(value));
}

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "precedence-test-master-key-32-characters-minimum";
  clearManagedEnv();
  // 콜드 스타트로 스키마와 마이그레이션을 적용하고, id=1 설정 행을 생성한다.
  getDatabase();
  ensureSettingsRow();
});

afterEach(() => {
  clearManagedEnv();
  // 각 테스트가 저장 컬럼을 원상 복구한다. (행이 반드시 존재하도록 보장)
  ensureSettingsRow();
  getDatabase().sqlite.prepare(
    "UPDATE settings SET subscription_pin = NULL, openai_api_key = NULL, anthropic_api_key = NULL, gemini_api_key = NULL, grok_api_key = NULL WHERE id = 1",
  ).run();
});

afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb;
  if (previousKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = previousKey;
  for (const name of managedEnv) {
    const value = savedEnv[name];
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

describe.sequential("구독핀 키 우선순위", () => {
  it("저장된 구독핀은 OpenAI/Anthropic 직접 키(DB)보다 우선한다", () => {
    setStoredProviderKey("openai_api_key", "sk-direct-openai");
    setStoredProviderKey("anthropic_api_key", "sk-ant-direct");
    setStoredPin("csk_stored-pin-1111");

    const server = getServerSettings(["openai", "anthropic"]);
    expect(server.decryptedApiKeys.openai).toBe("csk_stored-pin-1111");
    expect(server.decryptedApiKeys.anthropic).toBe("csk_stored-pin-1111");
    // gudokpin 이 활성화되면 모델도 gudokpin 기본값으로 강제된다.
    expect(server.models).toMatchObject({ openai: "gpt-5.6-luna", anthropic: "claude-sonnet-5" });
  });

  it("직접 OpenAI 환경 키는 저장된 구독핀보다 우선한다", () => {
    setStoredPin("csk_stored-pin-2222");
    process.env.OPENAI_API_KEY = "sk-env-openai-direct";

    const server = getServerSettings(["openai"]);
    // 환경 provider 키가 최우선이다.
    expect(server.decryptedApiKeys.openai).toBe("sk-env-openai-direct");
    expect(server.apiKeys.openai).toMatchObject({ source: "environment", error: false });
  });

  it("환경 구독핀(GUDOKPIN_API_KEY)은 저장된 구독핀보다 우선한다", () => {
    setStoredPin("csk_stored-pin-3333");
    process.env.GUDOKPIN_API_KEY = "csk_env-pin-9999";

    const server = getServerSettings(["openai", "anthropic"]);
    expect(server.decryptedApiKeys.openai).toBe("csk_env-pin-9999");
    expect(server.decryptedApiKeys.anthropic).toBe("csk_env-pin-9999");
    expect(server.decryptedSubscriptionPin).toBe("csk_env-pin-9999");
    // 저장 핀은 노출되지 않는다.
    expect(server.decryptedSubscriptionPin).not.toBe("csk_stored-pin-3333");
  });

  it("구독핀은 gemini/grok 에는 영향을 주지 않는다", () => {
    setStoredPin("csk_stored-pin-4444");
    setStoredProviderKey("gemini_api_key", "gemini-direct");
    setStoredProviderKey("grok_api_key", "grok-direct");

    const server = getServerSettings(["gemini", "grok"]);
    expect(server.decryptedApiKeys.gemini).toBe("gemini-direct");
    expect(server.decryptedApiKeys.grok).toBe("grok-direct");
    // 모델 강제는 openai/anthropic 로 한정된다. grok 은 기본값 유지.
    expect(server.models.grok).toBe("grok-4.6");
  });

  it("gemini/grok 만 요구하면 decryptedSubscriptionPin 을 노출하지 않는다", () => {
    setStoredPin("csk_stored-pin-5555");
    const server = getServerSettings(["gemini"]);
    expect(server.decryptedSubscriptionPin).toBeNull();
  });

  it("잘못된 접두사의 저장 구독핀은 openai 요청 시 명확한 오류를 던진다", () => {
    // csk_ 로 시작하지 않는 값이 복호화되면 우선순위 로직에서 거부되어야 한다.
    getDatabase().sqlite.prepare("UPDATE settings SET subscription_pin = ? WHERE id = 1").run(encryptSecret("sk-not-a-pin"));
    expect(() => getServerSettings(["openai"])).toThrow(/csk_/);
  });
});

describe("구독핀 컬럼 마이그레이션 보존", () => {
  const migrationDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-pin-migration-"));
  const migrationDbPath = path.join(migrationDir, "existing-pin.db");

  afterAll(() => {
    closeDatabase(migrationDbPath);
    fs.rmSync(migrationDir, { recursive: true, force: true });
  });

  it("subscription_pin 값이 있는 DB에 마이그레이션을 재적용해도 값이 보존된다", () => {
    // 실제 부트스트랩 경로로 완전한 최신 스키마를 만든 뒤 값을 심는다.
    const previousPath = process.env.GEO_DB_PATH;
    process.env.GEO_DB_PATH = migrationDbPath;
    try {
      const { sqlite } = getDatabase();
      ensureSettingsRow();
      const ciphertext = encryptSecret("csk_preexisting-pin-7777")!;
      sqlite.prepare("UPDATE settings SET subscription_pin = ? WHERE id = 1").run(ciphertext);

      // 이미 최신 버전이 기록된 상태에서 재적용은 멱등해야 한다.
      const before = (sqlite.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as { version: number }[]).map((r) => r.version);
      applyDatabaseMigrations(sqlite);
      applyDatabaseMigrations(sqlite);
      const after = (sqlite.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as { version: number }[]).map((r) => r.version);
      expect(after).toEqual(before);

      const columns = (sqlite.pragma("table_info(settings)") as { name: string }[]).map((column) => column.name);
      expect(columns).toEqual(expect.arrayContaining(["subscription_pin", "grok_api_key", "active_project_id"]));

      // 재적용 후에도 암호문이 그대로 보존되어야 한다.
      const stored = (sqlite.prepare("SELECT subscription_pin FROM settings WHERE id = 1").get() as { subscription_pin: string }).subscription_pin;
      expect(stored).toBe(ciphertext);
      expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      if (previousPath === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousPath;
    }
  });
});
