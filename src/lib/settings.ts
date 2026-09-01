import { eq } from "drizzle-orm";
import { z } from "zod";
import { decryptSecret, encryptSecret, maskSecret, SecretDecryptionError } from "./crypto";
import { getDatabase } from "./db";
import { projects, settings } from "./db/schema";
import { AppError } from "./errors";

export const providers = ["openai", "anthropic", "gemini", "hyperclova"] as const;
export type Provider = (typeof providers)[number];

export const defaultModels: Record<Provider, string> = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-sonnet-4-5",
  gemini: "gemini-2.5-flash",
  hyperclova: "HCX-DASH-002",
};
export const defaultModelWeights: Record<Provider, number> = {
  openai: 0.3,
  anthropic: 0.25,
  gemini: 0.2,
  hyperclova: 0.25,
};

export const settingsInputSchema = z.object({
  brandName: z.string().trim().max(120),
  category: z.string().trim().max(120),
  competitors: z.array(z.string().trim().min(1).max(120)).max(20),
  models: z.object({
    openai: z.string().trim().min(1).max(120),
    anthropic: z.string().trim().min(1).max(120),
    gemini: z.string().trim().min(1).max(120),
    hyperclova: z.string().trim().min(1).max(120).optional().default(defaultModels.hyperclova),
  }),
  repetitions: z.number().int().min(1).max(5),
  modelWeights: z.object({
    openai: z.number().min(0).max(1),
    anthropic: z.number().min(0).max(1),
    gemini: z.number().min(0).max(1),
    hyperclova: z.number().min(0).max(1).optional().default(defaultModelWeights.hyperclova),
  }).refine((weights) => Object.values(weights).reduce((sum, value) => sum + value, 0) > 0, {
    message: "모델 가중치 합계는 0보다 커야 합니다.",
  }),
  apiKeys: z.object({
    openai: z.string().trim().max(500).optional(),
    anthropic: z.string().trim().max(500).optional(),
    gemini: z.string().trim().max(500).optional(),
    hyperclova: z.string().trim().max(500).optional(),
  }).optional(),
  subscriptionPin: z.string().trim().max(500).refine((value) => !value || value.startsWith("csk_"), {
    message: "구독핀 API 키는 csk_로 시작해야 합니다.",
  }).optional(),
  clearSubscriptionPin: z.boolean().optional(),
  clearApiKeys: z.array(z.enum(providers)).optional(),
});

export type SettingsInput = z.infer<typeof settingsInputSchema>;

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseProviderRecord<T>(value: string, defaults: Record<Provider, T>) {
  const parsed = parseJson<Partial<Record<Provider, T>>>(value, {});
  return Object.fromEntries(providers.map((provider) => [provider, parsed[provider] ?? defaults[provider]])) as Record<Provider, T>;
}

function ensureSettings() {
  const { orm } = getDatabase();
  const now = new Date().toISOString();
  orm.insert(settings).values({
    id: 1,
    brandName: "",
    category: "",
    competitors: "[]",
    models: JSON.stringify(defaultModels),
    repetitions: 3,
    modelWeights: JSON.stringify(defaultModelWeights),
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing().run();
  return orm.select().from(settings).where(eq(settings.id, 1)).get()!;
}

function environmentValue(name: string) {
  return process.env[name]?.trim() || null;
}

function gudokpinEnvironmentKey() {
  return environmentValue("GUDOKPIN_API_KEY");
}

function providerEnvironmentKey(provider: Provider) {
  const gudokpin = gudokpinEnvironmentKey();
  if ((provider === "openai" || provider === "anthropic") && gudokpin) return gudokpin;
  const names: Record<Provider, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    gemini: "GEMINI_API_KEY",
    hyperclova: "HYPERCLOVA_API_KEY",
  };
  return environmentValue(names[provider]);
}

function resolvedModels(value: string, gudokpinConfigured: boolean) {
  const models = parseProviderRecord(value, defaultModels);
  if (gudokpinConfigured) {
    models.openai = environmentValue("GUDOKPIN_OPENAI_MODEL") ?? "gpt-5.6-luna";
    models.anthropic = environmentValue("GUDOKPIN_ANTHROPIC_MODEL") ?? "claude-sonnet-5";
  }
  return models;
}

function publicKeyState(encrypted: string | null, environmentKey: string | null = null) {
  if (environmentKey) {
    const invalid = environmentKey === gudokpinEnvironmentKey() && !environmentKey.startsWith("csk_");
    return { configured: true, preview: maskSecret(environmentKey), error: invalid, source: "environment" as const };
  }
  if (!encrypted) return { configured: false, preview: null, error: false, source: null };
  try {
    return { configured: true, preview: maskSecret(decryptSecret(encrypted)), error: false, source: "database" as const };
  } catch (error) {
    if (error instanceof SecretDecryptionError) {
      return { configured: true, preview: null, error: true, source: "database" as const };
    }
    throw error;
  }
}

export function getPublicSettings() {
  const row = ensureSettings();
  return {
    brandName: row.brandName,
    category: row.category,
    competitors: parseJson<string[]>(row.competitors, []),
    models: resolvedModels(row.models, Boolean(gudokpinEnvironmentKey() || row.subscriptionPin)),
    repetitions: row.repetitions,
    modelWeights: parseProviderRecord(row.modelWeights, defaultModelWeights),
    apiKeys: {
      openai: publicKeyState(row.openaiApiKey, providerEnvironmentKey("openai")),
      anthropic: publicKeyState(row.anthropicApiKey, providerEnvironmentKey("anthropic")),
      gemini: publicKeyState(row.geminiApiKey, providerEnvironmentKey("gemini")),
      hyperclova: publicKeyState(row.hyperclovaApiKey, providerEnvironmentKey("hyperclova")),
    },
    subscriptionPin: publicKeyState(row.subscriptionPin, gudokpinEnvironmentKey()),
    updatedAt: row.updatedAt,
  };
}

export function updateSettings(input: unknown) {
  const parsed = settingsInputSchema.parse(input);
  const row = ensureSettings();
  const clear = new Set(parsed.clearApiKeys ?? []);
  const apiKeys = parsed.apiKeys ?? {};
  const encryptedKeys = {
    openaiApiKey: clear.has("openai") ? null : apiKeys.openai ? encryptSecret(apiKeys.openai) : row.openaiApiKey,
    anthropicApiKey: clear.has("anthropic") ? null : apiKeys.anthropic ? encryptSecret(apiKeys.anthropic) : row.anthropicApiKey,
    geminiApiKey: clear.has("gemini") ? null : apiKeys.gemini ? encryptSecret(apiKeys.gemini) : row.geminiApiKey,
    hyperclovaApiKey: clear.has("hyperclova") ? null : apiKeys.hyperclova ? encryptSecret(apiKeys.hyperclova) : row.hyperclovaApiKey,
    subscriptionPin: parsed.clearSubscriptionPin
      ? null
      : parsed.subscriptionPin
        ? encryptSecret(parsed.subscriptionPin)
        : row.subscriptionPin,
  };
  const now = new Date().toISOString();
  const { orm, sqlite } = getDatabase();
  const transaction = sqlite.transaction(() => {
    orm.update(settings).set({
      brandName: parsed.brandName,
      category: parsed.category,
      competitors: JSON.stringify([...new Set(parsed.competitors)]),
      models: JSON.stringify(parsed.models),
      repetitions: parsed.repetitions,
      modelWeights: JSON.stringify(parsed.modelWeights),
      ...encryptedKeys,
      updatedAt: now,
    }).where(eq(settings.id, 1)).run();

    const project = orm.select().from(projects).limit(1).get();
    if (project) {
      orm.update(projects).set({
        name: parsed.brandName || "기본 프로젝트",
        brandName: parsed.brandName,
        category: parsed.category,
        competitors: JSON.stringify([...new Set(parsed.competitors)]),
        updatedAt: now,
      }).where(eq(projects.id, project.id)).run();
    } else {
      orm.insert(projects).values({
        name: parsed.brandName || "기본 프로젝트",
        brandName: parsed.brandName,
        category: parsed.category,
        competitors: JSON.stringify([...new Set(parsed.competitors)]),
        createdAt: now,
        updatedAt: now,
      }).run();
    }
  });
  transaction();
  return getPublicSettings();
}

export function getServerSettings(requiredProviders: readonly Provider[] = []) {
  const row = ensureSettings();
  const required = new Set(requiredProviders);
  const encrypted: Record<Provider, string | null> = {
    openai: row.openaiApiKey,
    anthropic: row.anthropicApiKey,
    gemini: row.geminiApiKey,
    hyperclova: row.hyperclovaApiKey,
  };
  let cachedSubscriptionPin: string | null | undefined;
  const decryptSubscriptionPin = () => {
    if (cachedSubscriptionPin !== undefined) return cachedSubscriptionPin;
    if (!row.subscriptionPin) {
      cachedSubscriptionPin = null;
      return null;
    }
    try {
      const value = decryptSecret(row.subscriptionPin);
      if (value && !value.startsWith("csk_")) {
        throw new AppError("구독핀 API 키는 csk_로 시작해야 합니다.", 409, "INVALID_GUDOKPIN_API_KEY");
      }
      cachedSubscriptionPin = value;
      return value;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("구독핀 API 키를 복호화할 수 없습니다. 설정에서 다시 저장해 주세요.", 409, "INVALID_SUBSCRIPTION_PIN_STORAGE");
    }
  };
  const decrypt = (provider: Provider) => {
    if (!required.has(provider)) return null;
    const environmentKey = providerEnvironmentKey(provider);
    if (environmentKey) {
      if ((provider === "openai" || provider === "anthropic") && environmentKey === gudokpinEnvironmentKey() && !environmentKey.startsWith("csk_")) {
        throw new AppError("구독핀 API 키는 csk_로 시작해야 합니다.", 409, "INVALID_GUDOKPIN_API_KEY");
      }
      return environmentKey;
    }
    if (provider === "openai" || provider === "anthropic") {
      const subscriptionPin = decryptSubscriptionPin();
      if (subscriptionPin) return subscriptionPin;
    }
    try {
      return decryptSecret(encrypted[provider]);
    } catch {
      throw new AppError(`${provider} API 키를 복호화할 수 없습니다. 설정에서 다시 저장해 주세요.`, 409, "INVALID_API_KEY_STORAGE");
    }
  };
  const shouldExposeDecryptedPin = required.size === 0 || required.has("openai") || required.has("anthropic");
  return {
    ...getPublicSettings(),
    decryptedApiKeys: {
      openai: decrypt("openai"),
      anthropic: decrypt("anthropic"),
      gemini: decrypt("gemini"),
      hyperclova: decrypt("hyperclova"),
    },
    decryptedSubscriptionPin: shouldExposeDecryptedPin ? (gudokpinEnvironmentKey() ?? decryptSubscriptionPin()) : null,
  };
}
