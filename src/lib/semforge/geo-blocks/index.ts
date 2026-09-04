import { z } from "zod";
import { listAudits, getAuditResource } from "@/lib/audit";
import {
  contentRequestHash,
  duplicateContent,
  findContentByRequest,
  listContents,
  storeGeneratedContent,
  updateContent,
} from "@/lib/contents";
import { idempotencyKeySchema } from "@/lib/crud";
import { AppError } from "@/lib/errors";
import {
  assembleGeoPageSpec,
  geoPageSpecSchema,
  type GeoBlock,
  type GeoPageSpec,
} from "@/lib/geo-page-spec";
import { getGeoPrompt, listGeoPrompts } from "@/lib/geo-prompt-catalog";
import { generateText } from "@/lib/llm";
import { listMeasureResults, listMeasureRuns, storedMeasureRunById } from "@/lib/measure-runs";
import { requireActiveProject } from "@/lib/projects";
import { requireSemforgeSubscription } from "@/lib/semforge-subscription";
import { getPublicSettings, getServerSettings, providers, type Provider } from "@/lib/settings";
import { listStrategyItems } from "@/lib/strategy";

const TOOL = "geo-blocks";

function lockedPayload(message: string) {
  return {
    locked: true as const,
    message,
    prompts: listGeoPrompts("studio"),
    recent: [] as ReturnType<typeof listContents>["items"],
    strategyOptions: [] as { id: number; type: string; title: string }[],
  };
}

function selectProvider(requested?: Provider) {
  const publicSettings = getPublicSettings();
  const provider = requested ?? providers.find((item) => publicSettings.apiKeys[item].configured && !publicSettings.apiKeys[item].error);
  if (!provider || !publicSettings.apiKeys[provider].configured) {
    throw new AppError("설정에서 사용할 LLM API 키를 먼저 저장해 주세요.", 409, "API_KEY_REQUIRED");
  }
  const settings = getServerSettings([provider]);
  const apiKey = settings.decryptedApiKeys[provider];
  if (!apiKey) throw new AppError("설정에서 사용할 LLM API 키를 먼저 저장해 주세요.", 409, "API_KEY_REQUIRED");
  return { settings, provider, apiKey, model: settings.models[provider] };
}

function defaultBlocks(input: {
  topic: string;
  brandName: string;
  researchNotes: string;
  altIssues?: string[];
}): GeoBlock[] {
  const noteLine = input.researchNotes.trim().split("\n").find((line) => line.trim()) ?? "";
  const blocks: GeoBlock[] = [
    {
      type: "HeroAnswer",
      id: "hero-1",
      title: "핵심 답변",
      body: `${input.topic}에 대한 직접 답변을 40~60단어로 작성하세요. ${input.brandName}의 조건을 수치·근거와 함께 명시합니다.`,
      items: [],
      faqs: [],
      ctaLabel: "",
      ctaHref: "",
      source: "",
      sourceDate: "",
      altText: "",
      imageUrl: "",
      entityName: "",
      proof: "",
    },
    {
      type: "KeyTakeaways",
      id: "takeaways-1",
      title: "Key Takeaways",
      body: "",
      items: [
        `${input.topic}의 핵심 기준을 한 줄로 요약합니다.`,
        "검증 가능한 수치·기간·조건을 포함합니다.",
        noteLine ? `연구 메모: ${noteLine.slice(0, 180)}` : "외부 연구 메모가 있으면 여기에 반영합니다.",
      ],
      faqs: [],
      ctaLabel: "",
      ctaHref: "",
      source: "",
      sourceDate: "",
      altText: "",
      imageUrl: "",
      entityName: "",
      proof: "",
    },
    {
      type: "FAQ",
      id: "faq-1",
      title: "FAQ",
      body: "",
      items: [],
      faqs: [
        { question: `${input.topic}이란 무엇인가요?`, answer: `${input.brandName} 관점에서 정의와 적용 조건을 설명합니다.` },
        { question: "누구에게 적합한가요?", answer: "대상 세그먼트와 비적합 조건을 구분해 답합니다." },
        { question: "어떻게 검증하나요?", answer: "측정 지표·기간·재현 방법을 구체적으로 적습니다." },
      ],
      ctaLabel: "",
      ctaHref: "",
      source: "",
      sourceDate: "",
      altText: "",
      imageUrl: "",
      entityName: "",
      proof: "",
    },
    {
      type: "Speakable",
      id: "speakable-1",
      title: "Speakable",
      body: `${input.brandName}은(는) ${input.topic}에서 검증 가능한 근거를 공개합니다.`,
      items: [],
      faqs: [],
      ctaLabel: "",
      ctaHref: "",
      source: "",
      sourceDate: "",
      altText: "",
      imageUrl: "",
      entityName: "",
      proof: "",
    },
    {
      type: "EntityDefinition",
      id: "entity-1",
      title: "엔티티 정의",
      body: `${input.brandName}의 한 문장 정의와 관련 표준·제품 관계를 적습니다.`,
      items: [],
      faqs: [],
      ctaLabel: "",
      ctaHref: "",
      source: "",
      sourceDate: "",
      altText: "",
      imageUrl: "",
      entityName: input.brandName,
      proof: "",
    },
    {
      type: "CTA",
      id: "cta-1",
      title: "CTA",
      body: "",
      items: [],
      faqs: [],
      ctaLabel: "자세히 알아보기",
      ctaHref: "/",
      source: "",
      sourceDate: "",
      altText: "",
      imageUrl: "",
      entityName: "",
      proof: "",
    },
    {
      type: "CiteBlock",
      id: "cite-1",
      title: "인용 블록",
      body: "검증 가능한 한 문장 주장을 여기에 둡니다.",
      items: [],
      faqs: [],
      ctaLabel: "",
      ctaHref: "",
      source: "공식 문서",
      sourceDate: new Date().toISOString().slice(0, 10),
      altText: "",
      imageUrl: "",
      entityName: "",
      proof: "",
    },
  ];

  for (const [index, issue] of (input.altIssues ?? []).slice(0, 5).entries()) {
    blocks.push({
      type: "AltSuggestion",
      id: `alt-${index + 1}`,
      title: "이미지 alt 제안",
      body: issue,
      items: [],
      faqs: [],
      ctaLabel: "",
      ctaHref: "",
      source: "audit/multimodal",
      sourceDate: "",
      altText: `${input.topic} 관련 이미지를 설명하는 구체적 alt`,
      imageUrl: "",
      entityName: "",
      proof: "",
    });
  }
  return blocks;
}

async function enrichBlocksWithLlm(input: {
  topic: string;
  researchNotes: string;
  promptHint: string;
  blocks: GeoBlock[];
  provider?: Provider;
}) {
  const { provider, apiKey, model } = selectProvider(input.provider);
  const system = "You are a GEO content planner. Return ONLY valid JSON array of blocks with keys type,id,title,body,items,faqs,ctaLabel,ctaHref,source,sourceDate,altText,imageUrl,entityName,proof. Keep HeroAnswer, KeyTakeaways, FAQ, Speakable required. Korean language.";
  const prompt = [
    `주제: ${input.topic}`,
    `프롬프트 힌트: ${input.promptHint}`,
    `연구 메모: ${input.researchNotes || "(없음)"}`,
    "기존 스케치:",
    JSON.stringify(input.blocks.slice(0, 6)),
    "위 스케치를 보강하되 블록 타입은 유지하고 본문을 구체화하세요.",
  ].join("\n");
  const text = await generateText({ provider, apiKey, model, system, prompt, maxTokens: 2500 });
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced ?? text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || !parsed.length) throw new AppError("LLM이 유효한 블록 배열을 반환하지 않았습니다.", 502, "INVALID_GEO_BLOCKS");
  return { blocks: parsed as GeoBlock[], provider };
}

export function getGeoBlocksOverviewPublic() {
  try {
    requireSemforgeSubscription();
  } catch {
    return lockedPayload("SEMForge 구독이 활성화되면 GEO Blocks(스펙 초안·승인)를 사용할 수 있습니다.");
  }
  requireActiveProject();
  const settings = getPublicSettings();
  const strategyItems = listStrategyItems();
  const strategyOptions = strategyItems
    .filter((item) => item.type === "pillar" || item.type === "cluster" || item.type === "question")
    .slice(0, 50)
    .map((item) => ({ id: item.id, type: item.type, title: item.title }));
  const recent = listContents({ limit: 20, tool: TOOL }).items;
  return {
    locked: false as const,
    message: undefined as string | undefined,
    brandName: settings.brandName,
    researchNotes: settings.activeProject.externalResearchNotes ?? "",
    competitorNotes: settings.activeProject.competitorNotes ?? "",
    prompts: listGeoPrompts("studio"),
    strategyOptions,
    recent,
  };
}

export const geoBlocksGenerateSchema = z.object({
  action: z.literal("generate"),
  topic: z.string().trim().min(1).max(300),
  targetAudience: z.string().trim().max(200).optional().default(""),
  researchNotes: z.string().trim().max(10_000).optional().default(""),
  strategyItemIds: z.array(z.number().int().positive()).max(10).optional().default([]),
  promptId: z.string().trim().max(80).optional().nullable().default(null),
  useLlm: z.boolean().optional().default(false),
  provider: z.enum(providers).optional(),
  title: z.string().trim().max(120).optional().default(""),
  notes: z.string().trim().max(5_000).optional().default(""),
  altIssues: z.array(z.string().trim().max(500)).max(10).optional().default([]),
  clientRequestId: idempotencyKeySchema.optional(),
}).strict();

export const geoBlocksStatusSchema = z.object({
  action: z.literal("advanceStatus"),
  contentId: z.number().int().positive(),
  status: z.enum(["generated", "dry_run_preview", "approved", "draft", "review", "archived"]),
  expectedUpdatedAt: z.string().min(1).max(64),
  dryRunConfirmed: z.boolean().optional().default(false),
}).strict();

export const geoBlocksDuplicateSchema = z.object({
  action: z.literal("duplicate"),
  contentId: z.number().int().positive(),
}).strict();

export const geoBlocksSuggestShareSchema = z.object({
  action: z.literal("suggestFromShare"),
  runId: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(10).optional().default(5),
  useLlm: z.boolean().optional().default(false),
  provider: z.enum(providers).optional(),
  clientRequestId: idempotencyKeySchema.optional(),
}).strict();

export const geoBlocksSuggestAuditSchema = z.object({
  action: z.literal("suggestFromAudit"),
  auditId: z.number().int().positive().optional(),
  useLlm: z.boolean().optional().default(false),
  provider: z.enum(providers).optional(),
  clientRequestId: idempotencyKeySchema.optional(),
}).strict();

export const geoBlocksActionSchema = z.discriminatedUnion("action", [
  geoBlocksGenerateSchema,
  geoBlocksStatusSchema,
  geoBlocksDuplicateSchema,
  geoBlocksSuggestShareSchema,
  geoBlocksSuggestAuditSchema,
]);

function strategyRefs(ids: number[]) {
  if (!ids.length) return [];
  const items = listStrategyItems();
  return items.filter((item) => ids.includes(item.id)).map((item) => ({
    id: item.id,
    type: item.type,
    title: item.title,
  }));
}

function persistSpec(input: {
  spec: GeoPageSpec;
  title: string;
  notes: string;
  provider: string | null;
  clientRequestId?: string;
  requestPayload: unknown;
  status?: "generated" | "dry_run_preview";
}) {
  const requestHash = contentRequestHash(input.requestPayload);
  if (input.clientRequestId) {
    const existing = findContentByRequest(input.clientRequestId, requestHash);
    if (existing) return existing;
  }
  return storeGeneratedContent({
    tool: TOOL,
    title: input.title || input.spec.topic.slice(0, 120),
    notes: input.notes,
    status: input.status ?? "generated",
    provider: input.provider,
    clientRequestId: input.clientRequestId ?? null,
    input: input.requestPayload,
    output: input.spec,
    metadata: {
      riskLevel: input.spec.riskLevel,
      promptId: input.spec.promptId,
      blockTypes: input.spec.blocks.map((block) => block.type),
    },
    requestHash,
  });
}

export async function generateGeoBlocks(input: z.infer<typeof geoBlocksGenerateSchema>) {
  requireSemforgeSubscription();
  const project = requireActiveProject();
  const settings = getPublicSettings();
  const prompt = input.promptId ? getGeoPrompt(input.promptId) : null;
  const researchNotes = [
    input.researchNotes,
    settings.activeProject.competitorNotes,
    settings.activeProject.externalResearchNotes,
  ].filter(Boolean).join("\n\n");
  let blocks = defaultBlocks({
    topic: input.topic,
    brandName: settings.brandName || project.brandName || "브랜드",
    researchNotes,
    altIssues: input.altIssues,
  });
  let provider: string | null = null;
  if (input.useLlm) {
    const enriched = await enrichBlocksWithLlm({
      topic: input.topic,
      researchNotes,
      promptHint: prompt?.studioHint ?? "GEO 인용 블록을 완성하세요.",
      blocks,
      provider: input.provider,
    });
    blocks = enriched.blocks;
    provider = enriched.provider;
  }
  const spec = assembleGeoPageSpec({
    topic: input.topic,
    targetAudience: input.targetAudience,
    researchNotes,
    strategyRefs: strategyRefs(input.strategyItemIds),
    promptId: input.promptId,
    brandName: settings.brandName || project.brandName || "브랜드",
    blocks,
    riskLevel: "write",
    statusHint: "generated",
  });
  const content = persistSpec({
    spec,
    title: input.title,
    notes: input.notes || prompt?.summary || "",
    provider,
    clientRequestId: input.clientRequestId,
    requestPayload: input,
  });
  return { content, spec: geoPageSpecSchema.parse(content.output) };
}

export function advanceGeoBlocksStatus(input: z.infer<typeof geoBlocksStatusSchema>) {
  requireSemforgeSubscription();
  requireActiveProject();
  if (input.status === "approved" && !input.dryRunConfirmed) {
    throw new AppError("승인 전 dry-run 미리보기를 확인해야 합니다.", 422, "GEO_BLOCKS_DRY_RUN_REQUIRED");
  }
  const content = updateContent(input.contentId, {
    status: input.status,
    expectedUpdatedAt: input.expectedUpdatedAt,
  });
  return { content, riskLevel: "write" as const };
}

export function duplicateGeoBlocks(input: z.infer<typeof geoBlocksDuplicateSchema>) {
  requireSemforgeSubscription();
  requireActiveProject();
  return { content: duplicateContent(input.contentId) };
}

function unansweredQuestions(runId?: number, limit = 5) {
  const latest = listMeasureRuns({ limit: 1 }).items[0];
  const id = runId ?? latest?.id;
  if (!id) throw new AppError("완료된 점유율 측정이 없습니다.", 404, "SHARE_RUN_NOT_FOUND");
  const row = storedMeasureRunById(id);
  if (!row || row.status !== "completed") {
    throw new AppError("완료된 점유율 측정이 없습니다.", 404, "SHARE_RUN_NOT_FOUND");
  }
  requireActiveProject(row.project_id);
  const results = listMeasureResults(id, { limit: 500 }).items;
  const byQuestion = new Map<string, { mentioned: number; total: number }>();
  for (const item of results) {
    const entry = byQuestion.get(item.questionText) ?? { mentioned: 0, total: 0 };
    entry.total += 1;
    if (item.brandMentioned) entry.mentioned += 1;
    byQuestion.set(item.questionText, entry);
  }
  const unanswered = [...byQuestion.entries()]
    .filter(([, stats]) => stats.mentioned === 0)
    .map(([question]) => question)
    .slice(0, limit);
  return { runId: row.id, genrank: row.genrank, unanswered };
}

export async function suggestGeoBlocksFromShare(input: z.infer<typeof geoBlocksSuggestShareSchema>) {
  requireSemforgeSubscription();
  const { runId, genrank, unanswered } = unansweredQuestions(input.runId, input.limit);
  if (!unanswered.length) {
    return { created: [] as Awaited<ReturnType<typeof generateGeoBlocks>>[], unanswered: [], runId };
  }
  const created = [];
  for (const question of unanswered) {
    const result = await generateGeoBlocks({
      action: "generate",
      topic: question,
      targetAudience: "",
      researchNotes: `share run #${runId} · GenRank ${genrank} · 미인용 질문`,
      strategyItemIds: [],
      promptId: "snippet-writer",
      useLlm: input.useLlm,
      provider: input.provider,
      title: `미인용 · ${question}`.slice(0, 120),
      notes: "suggest_content_from_share",
      altIssues: [],
      clientRequestId: undefined,
    });
    created.push(result);
  }
  return { created, unanswered, runId };
}

export async function suggestGeoBlocksFromAudit(input: z.infer<typeof geoBlocksSuggestAuditSchema>) {
  requireSemforgeSubscription();
  requireActiveProject();
  const audit = input.auditId
    ? getAuditResource(input.auditId)
    : listAudits({ limit: 1 }).items[0];
  if (!audit) throw new AppError("진단 결과가 없습니다.", 404, "AUDIT_NOT_FOUND");
  const full = input.auditId ? audit : getAuditResource(audit.id);
  const failed = full.items.filter((item) => !item.passed);
  const schemaFaq = failed.filter((item) =>
    /schema|faq|llms|json-ld|speakable|alt/i.test(`${item.code} ${item.category} ${item.detail}`));
  const altIssues = failed
    .filter((item) => /alt|image/i.test(`${item.code} ${item.detail}`))
    .map((item) => item.detail || "이미지 alt 보완 필요");
  const topic = full.title || full.url || "감사 실패 항목 보완";
  const result = await generateGeoBlocks({
    action: "generate",
    topic,
    targetAudience: "",
    researchNotes: schemaFaq.map((item) => `- ${item.code}: ${item.detail}`).join("\n"),
    strategyItemIds: [],
    promptId: "semantic-brief",
    useLlm: input.useLlm,
    provider: input.provider,
    title: `감사 보완 · ${topic}`.slice(0, 120),
    notes: `audit #${full.id}`,
    altIssues,
    clientRequestId: input.clientRequestId,
  });
  return { ...result, auditId: full.id, failedCount: failed.length };
}

export async function runGeoBlocksAction(input: unknown) {
  const parsed = geoBlocksActionSchema.parse(input);
  switch (parsed.action) {
    case "generate":
      return { action: parsed.action, ...(await generateGeoBlocks(parsed)) };
    case "advanceStatus":
      return { action: parsed.action, ...advanceGeoBlocksStatus(parsed) };
    case "duplicate":
      return { action: parsed.action, ...duplicateGeoBlocks(parsed) };
    case "suggestFromShare":
      return { action: parsed.action, ...(await suggestGeoBlocksFromShare(parsed)) };
    case "suggestFromAudit":
      return { action: parsed.action, ...(await suggestGeoBlocksFromAudit(parsed)) };
    default:
      throw new AppError("지원하지 않는 GEO Blocks 액션입니다.", 422, "GEO_BLOCKS_UNKNOWN_ACTION");
  }
}

/** Automation: 로컬 초안만 생성 (원격 게시 없음) */
export async function suggestContentFromShareJob(options?: { runId?: number; limit?: number }) {
  requireSemforgeSubscription();
  return suggestGeoBlocksFromShare({
    action: "suggestFromShare",
    runId: options?.runId,
    limit: options?.limit ?? 5,
    useLlm: false,
  });
}
