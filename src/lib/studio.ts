import { z } from "zod";
import { getDatabase } from "./db";
import { contents } from "./db/schema";
import { AppError } from "./errors";
import { generateText } from "./llm";
import { getPublicSettings, getServerSettings, providers, type Provider } from "./settings";

export const REWRITE_PATTERNS = [
  "형용사→수치",
  "일반→조건부",
  "나열→구조화",
  "대상 명시",
  "결론 선행",
] as const;

export const studioInputSchema = z.object({
  action: z.enum(["rewrite", "intro", "faq", "entity"]),
  text: z.string().trim().max(30_000).optional().default(""),
  topic: z.string().trim().max(300).optional().default(""),
  target: z.string().trim().max(300).optional().default(""),
  value: z.string().trim().max(500).optional().default(""),
  category: z.string().trim().max(200).optional().default(""),
  metric: z.string().trim().max(300).optional().default(""),
  company: z.string().trim().max(200).optional().default(""),
  url: z.string().url().max(2048).optional().or(z.literal("")),
  logo: z.string().url().max(2048).optional().or(z.literal("")),
  sameAs: z.array(z.string().url().max(2048)).max(20).optional().default([]),
  patterns: z.array(z.enum(REWRITE_PATTERNS)).optional().default([]),
  provider: z.enum(providers).optional(),
});

export interface FaqEntry { question: string; answer: string }

export function generateFaqJsonLd(faqs: FaqEntry[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };
}

export function generateOrganizationJsonLd(input: { company: string; url?: string; logo?: string; sameAs?: string[]; description: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: input.company,
    ...(input.url ? { url: input.url } : {}),
    ...(input.logo ? { logo: input.logo } : {}),
    ...(input.sameAs?.length ? { sameAs: input.sameAs } : {}),
    description: input.description,
  };
}

function withParticle(value: string, withBatchim: string, withoutBatchim: string) {
  const trimmed = value.trim();
  const last = trimmed.codePointAt(trimmed.length - 1) ?? 0;
  if (last >= 0xac00 && last <= 0xd7a3) {
    return `${trimmed}${(last - 0xac00) % 28 ? withBatchim : withoutBatchim}`;
  }
  return `${trimmed}${withBatchim}(${withoutBatchim})`;
}

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
  return JSON.parse(candidate);
}

function selectProvider(requested: Provider | undefined) {
  const publicSettings = getPublicSettings();
  const provider = requested ?? providers.find((item) => publicSettings.apiKeys[item].configured && !publicSettings.apiKeys[item].error);
  if (!provider || !publicSettings.apiKeys[provider].configured) {
    throw new AppError("설정에서 사용할 LLM API 키를 먼저 저장해 주세요.", 409, "API_KEY_REQUIRED");
  }
  const settings = getServerSettings([provider]);
  if (!settings.decryptedApiKeys[provider]) {
    throw new AppError("설정에서 사용할 LLM API 키를 먼저 저장해 주세요.", 409, "API_KEY_REQUIRED");
  }
  return {
    settings,
    provider,
    apiKey: settings.decryptedApiKeys[provider],
    model: settings.models[provider],
  };
}

export async function runStudioTool(input: unknown) {
  const parsed = studioInputSchema.parse(input);
  let output: Record<string, unknown>;

  if (parsed.action === "entity") {
    const company = parsed.company || parsed.target;
    if (!company || !parsed.target || !parsed.value || !parsed.category) {
      throw new AppError("회사명, 타깃, 핵심 가치, 카테고리를 모두 입력해 주세요.", 422, "ENTITY_FIELDS_REQUIRED");
    }
    const definition = `${withParticle(company, "은", "는")} ${withParticle(parsed.target, "을", "를")} 위해 ${parsed.metric ? `${parsed.metric}의 ` : ""}${withParticle(parsed.value, "을", "를")} 제공하는 ${parsed.category} 서비스입니다.`;
    output = {
      definition,
      jsonLd: generateOrganizationJsonLd({ company, url: parsed.url || undefined, logo: parsed.logo || undefined, sameAs: parsed.sameAs, description: definition }),
    };
  } else {
    const llm = selectProvider(parsed.provider);
    if (parsed.action === "rewrite") {
      if (!parsed.text || !parsed.patterns.length) throw new AppError("원문과 리라이팅 패턴을 선택해 주세요.", 422, "REWRITE_INPUT_REQUIRED");
      const rewritten = await generateText({
        ...llm,
        system: "당신은 GEO 전문 편집자다. 사실과 고유명사를 보존하고, 제공되지 않은 수치나 출처는 만들지 않는다.",
        prompt: `다음 원문을 패턴 [${parsed.patterns.join(", ")}]에 따라 한국어로 리라이팅하세요. 결론을 먼저 쓰고 변경된 구조가 잘 보이게 하세요.\n\n<원문>\n${parsed.text}\n</원문>`,
      });
      output = { before: parsed.text, after: rewritten, patterns: parsed.patterns };
    } else if (parsed.action === "intro") {
      const source = parsed.topic || parsed.text;
      if (!source) throw new AppError("주제 또는 원문을 입력해 주세요.", 422, "INTRO_INPUT_REQUIRED");
      const intro = await generateText({
        ...llm,
        system: "당신은 GEO 콘텐츠 에디터다. 확인되지 않은 사실을 만들지 않는다.",
        prompt: `주제 ${JSON.stringify(source)}에 대해 ① 독자의 문제 제시 ② 핵심 답변 ③ 이 글에서 얻는 가치의 3개 문단으로 짧은 도입부를 작성하세요. 각 문단 앞에 단계 이름을 붙이세요.`,
      });
      output = { intro };
    } else {
      const source = parsed.topic || parsed.text;
      if (!source) throw new AppError("FAQ 주제 또는 원문을 입력해 주세요.", 422, "FAQ_INPUT_REQUIRED");
      const generated = await generateText({
        ...llm,
        maxTokens: 1400,
        system: "당신은 FAQ 편집자다. 실제 고객 언어를 사용하고 제공되지 않은 사실을 만들지 않는다. JSON 배열만 출력한다.",
        prompt: `다음 자료를 바탕으로 질문과 답변 3~5개를 만드세요. 형식: [{"question":"...","answer":"..."}]\n\n<자료>\n${source}\n</자료>`,
      });
      let faqs: FaqEntry[];
      try {
        faqs = z.array(z.object({ question: z.string().min(1), answer: z.string().min(1) })).min(3).max(5).parse(extractJson(generated));
      } catch {
        throw new AppError("LLM의 FAQ 응답을 구조화하지 못했습니다. 다시 실행해 주세요.", 502, "INVALID_LLM_OUTPUT");
      }
      output = { faqs, jsonLd: generateFaqJsonLd(faqs) };
    }
  }

  const now = new Date().toISOString();
  const saved = getDatabase().orm.insert(contents).values({
    tool: parsed.action,
    input: JSON.stringify(parsed),
    output: JSON.stringify(output),
    createdAt: now,
  }).returning({ id: contents.id }).get();
  return { id: saved.id, action: parsed.action, output, createdAt: now };
}
