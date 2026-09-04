import { z } from "zod";

/** GEO page/post block types — WP builders의 올바른 번역 (CMS HTML이 아님) */
export const geoBlockTypes = [
  "HeroAnswer",
  "KeyTakeaways",
  "FAQ",
  "Speakable",
  "EntityDefinition",
  "CTA",
  "CiteBlock",
  "AltSuggestion",
] as const;

export type GeoBlockType = (typeof geoBlockTypes)[number];

export const geoBlockSchema = z.object({
  type: z.enum(geoBlockTypes),
  id: z.string().trim().min(1).max(64),
  title: z.string().trim().max(200).optional().default(""),
  body: z.string().trim().max(8_000).optional().default(""),
  items: z.array(z.string().trim().max(1_000)).max(20).optional().default([]),
  faqs: z.array(z.object({
    question: z.string().trim().min(1).max(500),
    answer: z.string().trim().min(1).max(2_000),
  })).max(20).optional().default([]),
  ctaLabel: z.string().trim().max(120).optional().default(""),
  ctaHref: z.string().trim().max(2_048).optional().default(""),
  source: z.string().trim().max(500).optional().default(""),
  sourceDate: z.string().trim().max(40).optional().default(""),
  altText: z.string().trim().max(500).optional().default(""),
  imageUrl: z.string().trim().max(2_048).optional().default(""),
  entityName: z.string().trim().max(200).optional().default(""),
  proof: z.string().trim().max(1_000).optional().default(""),
}).strict();

export type GeoBlock = z.infer<typeof geoBlockSchema>;

export const geoPageSpecSchema = z.object({
  version: z.literal(1),
  topic: z.string().trim().min(1).max(300),
  targetAudience: z.string().trim().max(200).optional().default(""),
  researchNotes: z.string().trim().max(10_000).optional().default(""),
  strategyRefs: z.array(z.object({
    id: z.number().int().positive(),
    type: z.string().max(40),
    title: z.string().max(500),
  })).max(20).optional().default([]),
  promptId: z.string().trim().max(80).optional().nullable().default(null),
  blocks: z.array(geoBlockSchema).min(1).max(40),
  markdown: z.string().trim().max(100_000),
  jsonLd: z.object({
    blogPosting: z.record(z.string(), z.unknown()),
    faqPage: z.record(z.string(), z.unknown()).nullable(),
    speakable: z.record(z.string(), z.unknown()).nullable(),
  }).strict(),
  riskLevel: z.enum(["read", "write", "destructive"]).default("write"),
  statusHint: z.enum(["generated", "dry_run_preview", "approved"]).default("generated"),
}).strict();

export type GeoPageSpec = z.infer<typeof geoPageSpecSchema>;

export function renderGeoMarkdown(spec: Omit<GeoPageSpec, "markdown" | "jsonLd" | "riskLevel" | "statusHint" | "version"> & {
  blocks: GeoBlock[];
}): string {
  const lines: string[] = [`# ${spec.topic}`, ""];
  if (spec.targetAudience) lines.push(`> 대상: ${spec.targetAudience}`, "");
  for (const block of spec.blocks) {
    switch (block.type) {
      case "HeroAnswer":
        lines.push(`## ${block.title || "핵심 답변"}`, "", block.body, "");
        break;
      case "KeyTakeaways":
        lines.push(`## ${block.title || "Key Takeaways"}`, "");
        for (const item of block.items) lines.push(`- ${item}`);
        lines.push("");
        break;
      case "FAQ":
        lines.push(`## ${block.title || "FAQ"}`, "");
        for (const faq of block.faqs) {
          lines.push(`### ${faq.question}`, "", faq.answer, "");
        }
        break;
      case "Speakable":
        lines.push(`## ${block.title || "Speakable (인용용 한 문장)"}`, "", block.body, "");
        break;
      case "EntityDefinition":
        lines.push(`## ${block.title || "엔티티 정의"}`, "", `**${block.entityName || spec.topic}** — ${block.body}`);
        if (block.proof) lines.push("", `근거: ${block.proof}`);
        lines.push("");
        break;
      case "CTA":
        lines.push(`## ${block.title || "CTA"}`, "", `[${block.ctaLabel || "자세히 보기"}](${block.ctaHref || "#"})`, "");
        break;
      case "CiteBlock":
        lines.push(`## ${block.title || "인용 블록"}`, "", `> ${block.body}`);
        if (block.source) lines.push("", `출처: ${block.source}${block.sourceDate ? ` (${block.sourceDate})` : ""}`);
        lines.push("");
        break;
      case "AltSuggestion":
        lines.push(`## ${block.title || "이미지 alt 제안"}`, "");
        if (block.imageUrl) lines.push(`- URL: ${block.imageUrl}`);
        lines.push(`- alt: ${block.altText || block.body}`, "");
        break;
      default:
        break;
    }
  }
  return lines.join("\n").trim() + "\n";
}

export function buildGeoJsonLd(input: {
  topic: string;
  brandName: string;
  url?: string;
  blocks: GeoBlock[];
}) {
  const hero = input.blocks.find((block) => block.type === "HeroAnswer");
  const takeaways = input.blocks.find((block) => block.type === "KeyTakeaways");
  const speakable = input.blocks.find((block) => block.type === "Speakable");
  const faqs = input.blocks.filter((block) => block.type === "FAQ").flatMap((block) => block.faqs);
  const description = hero?.body || takeaways?.items.slice(0, 3).join(" ") || input.topic;

  const blogPosting: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: input.topic,
    description,
    author: { "@type": "Organization", name: input.brandName },
  };
  if (input.url) blogPosting.mainEntityOfPage = input.url;

  const faqPage = faqs.length
    ? {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    }
    : null;

  const speakableJson = speakable?.body
    ? {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: input.topic,
      speakable: {
        "@type": "SpeakableSpecification",
        cssSelector: [".geo-speakable", ".geo-key-takeaways"],
      },
      description: speakable.body,
    }
    : null;

  return { blogPosting, faqPage, speakable: speakableJson };
}

export function assembleGeoPageSpec(input: {
  topic: string;
  targetAudience?: string;
  researchNotes?: string;
  strategyRefs?: GeoPageSpec["strategyRefs"];
  promptId?: string | null;
  brandName: string;
  url?: string;
  blocks: GeoBlock[];
  riskLevel?: GeoPageSpec["riskLevel"];
  statusHint?: GeoPageSpec["statusHint"];
}): GeoPageSpec {
  const blocks = input.blocks.map((block, index) => geoBlockSchema.parse({
    ...block,
    id: block.id || `${block.type.toLowerCase()}-${index + 1}`,
  }));
  const base = {
    topic: input.topic,
    targetAudience: input.targetAudience ?? "",
    researchNotes: input.researchNotes ?? "",
    strategyRefs: input.strategyRefs ?? [],
    promptId: input.promptId ?? null,
    blocks,
  };
  return geoPageSpecSchema.parse({
    version: 1,
    ...base,
    markdown: renderGeoMarkdown(base),
    jsonLd: buildGeoJsonLd({
      topic: input.topic,
      brandName: input.brandName,
      url: input.url,
      blocks,
    }),
    riskLevel: input.riskLevel ?? "write",
    statusHint: input.statusHint ?? "generated",
  });
}
