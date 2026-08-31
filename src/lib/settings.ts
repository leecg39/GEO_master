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

function publicKeyState(encrypted: string | null) {
  if (!encrypted) return { configured: false, preview: null, error: false };
  try {
    return { configured: true, preview: maskSecret(decryptSecret(encrypted)), error: false };
  } catch (error) {
    if (error instanceof SecretDecryptionError) {
      return { configured: true, preview: null, error: true };
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
    models: parseProviderRecord(row.models, defaultModels),
    repetitions: row.repetitions,
    modelWeights: parseProviderRecord(row.modelWeights, defaultModelWeights),
    apiKeys: {
      openai: publicKeyState(row.openaiApiKey),
      anthropic: publicKeyState(row.anthropicApiKey),
      gemini: publicKeyState(row.geminiApiKey),
      hyperclova: publicKeyState(row.hyperclovaApiKey),
    },
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
  const decrypt = (provider: Provider) => {
    if (!required.has(provider)) return null;
    try {
      return decryptSecret(encrypted[provider]);
    } catch {
      throw new AppError(`${provider} API 키를 복호화할 수 없습니다. 설정에서 다시 저장해 주세요.`, 409, "INVALID_API_KEY_STORAGE");
    }
  };
  return {
    ...getPublicSettings(),
    decryptedApiKeys: {
      openai: decrypt("openai"),
      anthropic: decrypt("anthropic"),
      gemini: decrypt("gemini"),
      hyperclova: decrypt("hyperclova"),
    },
  };
}
