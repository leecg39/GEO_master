import { eq } from "drizzle-orm";
import { z } from "zod";
import { decryptSecret, encryptSecret, maskSecret, SecretDecryptionError } from "./crypto";
import { getDatabase } from "./db";
import { projects, settings } from "./db/schema";
import { AppError } from "./errors";

export const providers = ["openai", "anthropic", "gemini"] as const;
export type Provider = (typeof providers)[number];

export const defaultModels: Record<Provider, string> = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-sonnet-4-5",
  gemini: "gemini-2.5-flash",
};

export const settingsInputSchema = z.object({
  brandName: z.string().trim().max(120),
  category: z.string().trim().max(120),
  competitors: z.array(z.string().trim().min(1).max(120)).max(20),
  models: z.object({
    openai: z.string().trim().min(1).max(120),
    anthropic: z.string().trim().min(1).max(120),
    gemini: z.string().trim().min(1).max(120),
  }),
  repetitions: z.number().int().min(1).max(5),
  modelWeights: z.object({
    openai: z.number().min(0).max(1),
    anthropic: z.number().min(0).max(1),
    gemini: z.number().min(0).max(1),
  }).refine((weights) => Object.values(weights).reduce((sum, value) => sum + value, 0) > 0, {
    message: "모델 가중치 합계는 0보다 커야 합니다.",
  }),
  apiKeys: z.object({
    openai: z.string().trim().max(500).optional(),
    anthropic: z.string().trim().max(500).optional(),
    gemini: z.string().trim().max(500).optional(),
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
    modelWeights: JSON.stringify({ openai: 0.4, anthropic: 0.35, gemini: 0.25 }),
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
    models: parseJson<Record<Provider, string>>(row.models, defaultModels),
    repetitions: row.repetitions,
    modelWeights: parseJson<Record<Provider, number>>(row.modelWeights, {
      openai: 0.4,
      anthropic: 0.35,
      gemini: 0.25,
    }),
    apiKeys: {
      openai: publicKeyState(row.openaiApiKey),
      anthropic: publicKeyState(row.anthropicApiKey),
      gemini: publicKeyState(row.geminiApiKey),
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
    },
  };
}
