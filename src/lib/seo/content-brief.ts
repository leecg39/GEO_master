import { storeGeneratedContent, type ContentResource } from "@/lib/contents";

export interface BriefLink {
  href: string;
  text: string;
}

export interface BriefSource {
  url: string;
  title: string;
  heading: string;
  bodyText: string;
  questions?: string[];
  answers?: string[];
  internalLinks?: BriefLink[];
}

export interface BriefDocument {
  url: string;
  excerpt: string;
}

export interface ContentBriefDraft {
  add?: string[];
  keep?: string[];
  reinforce?: string[];
  targetQuestions?: string[];
}

export interface ContentBriefInput {
  mode: "improve" | "new";
  source: BriefSource;
  competitorSources?: BriefDocument[];
  citationSources?: BriefDocument[];
  draft?: ContentBriefDraft;
}

export interface ContentBrief {
  mode: "improve" | "new";
  targetQuestions: string[];
  currentAnswers: string[];
  gaps: string[];
  keep: string[];
  reinforce: string[];
  add: string[];
  internalLinks: BriefLink[];
  changeScope: { type: "partial" | "new-page"; replaceWholePage: false };
  sources: { competitor: BriefDocument[]; citation: BriefDocument[] };
}

const OFFERING = /구독|당일\s*배송|멤버십|패키지|렌탈|매출/;
const NUMBER = /\d+(?:[.,]\d+)?/g;
const HANGUL = /[가-힣]{2,}/g;

function unique(values: string[]) {
  const seen = new Set<string>();
  return values.map((value) => value.trim()).filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function sourceCorpus(source: BriefSource) {
  return [source.title, source.heading, source.bodyText, ...(source.answers ?? [])].join("\n");
}

function splitSentences(text: string) {
  return unique(text.split(/(?<=다\.|요\.|니다\.|[.!?])\s+/).filter((item) => item.replace(/\s+/g, "").length >= 8));
}

function tokens(text: string) {
  return text.match(HANGUL) ?? [];
}

function answeredBy(question: string, corpus: string) {
  const significant = tokens(question).filter((token) => token.length >= 2 && !/어떻게|무엇|왜|인가요|할까요/.test(token));
  if (!significant.length) return corpus.includes(question.replace(/[?？]/g, "").trim());
  return significant.filter((token) => corpus.includes(token)).length >= Math.min(2, significant.length);
}

function isGroundedItem(item: string, sourceText: string, competitorText: string) {
  const numbers = item.match(NUMBER) ?? [];
  if (numbers.some((value) => !sourceText.includes(value))) return false;
  const offering = item.match(OFFERING) ?? [];
  if (offering.some((term) => !sourceText.includes(term.replace(/\s+/g, "")))) return false;
  const distinctive = tokens(item).filter((token) => token.length >= 3 && !/하세요|보강하세요|추가하세요|강조하세요|본문에|방법에/.test(token));
  const competitorOnly = distinctive.filter((token) => competitorText.includes(token) && !sourceText.includes(token));
  if (competitorOnly.length > 0 && distinctive.every((token) => !sourceText.includes(token))) return false;
  if (competitorOnly.some((token) => /구독|배송|매출|인증|패키지|멤버십/.test(token))) return false;
  return true;
}

function groundItems(items: string[], sourceText: string, competitorText: string) {
  return unique(items.filter((item) => isGroundedItem(item, sourceText, competitorText)));
}

export function groundContentBrief(brief: ContentBrief, sourceText: string, competitorText: string): ContentBrief {
  return {
    ...brief,
    keep: groundItems(brief.keep, sourceText, competitorText),
    reinforce: groundItems(brief.reinforce, sourceText, competitorText),
    add: groundItems(brief.add, sourceText, competitorText),
    currentAnswers: groundItems(brief.currentAnswers, sourceText, competitorText),
    targetQuestions: unique(brief.targetQuestions),
    gaps: unique(brief.gaps),
  };
}

/** Deterministic Improve/New brief. Invented competitor products and numbers are dropped. */
export function buildContentBrief(input: ContentBriefInput): ContentBrief {
  const sourceText = sourceCorpus(input.source);
  const competitorText = (input.competitorSources ?? []).map((item) => item.excerpt).join("\n");
  const paragraphs = splitSentences(input.source.bodyText);
  const headingQuestion = input.source.heading ? `${input.source.heading}은 무엇인가요?` : "";
  const targetQuestions = unique([
    ...(input.source.questions ?? []),
    ...groundItems(input.draft?.targetQuestions ?? [], sourceText, competitorText),
    headingQuestion,
  ]);
  const currentAnswers = unique([...(input.source.answers ?? []), ...paragraphs]);
  const gaps = targetQuestions.filter((question) => !answeredBy(question, sourceText));
  const keep = input.mode === "improve"
    ? groundItems(input.draft?.keep?.length ? input.draft.keep : paragraphs, sourceText, competitorText)
    : [];
  const reinforce = input.mode === "improve"
    ? groundItems(input.draft?.reinforce?.length ? input.draft.reinforce : currentAnswers.slice(0, 4), sourceText, competitorText)
    : [];
  const citationAdds = gaps.flatMap((gap) => {
    const citation = (input.citationSources ?? []).find((item) => answeredBy(gap, item.excerpt) || tokens(gap).some((token) => item.excerpt.includes(token) && token.length >= 2));
    return citation ? [`${gap}에 대해 원문·인용 출처의 표현을 보강하세요.`] : [];
  });
  const add = groundItems([...(input.draft?.add ?? []), ...citationAdds], sourceText, competitorText);
  const brief: ContentBrief = {
    mode: input.mode,
    targetQuestions,
    currentAnswers,
    gaps,
    keep,
    reinforce,
    add,
    internalLinks: [...(input.source.internalLinks ?? [])],
    changeScope: input.mode === "improve"
      ? { type: "partial", replaceWholePage: false }
      : { type: "new-page", replaceWholePage: false },
    sources: {
      competitor: [...(input.competitorSources ?? [])],
      citation: [...(input.citationSources ?? [])],
    },
  };
  return groundContentBrief(brief, sourceText, competitorText);
}

export function persistContentBrief(input: ContentBriefInput): { brief: ContentBrief; content: ContentResource } {
  const brief = buildContentBrief(input);
  const label = input.mode === "improve" ? "개선" : "신규";
  const content = storeGeneratedContent({
    tool: "brief",
    title: `${label} 브리프 · ${input.source.title || input.source.heading || input.source.url}`.slice(0, 120),
    notes: "",
    status: "generated",
    provider: null,
    input: { mode: input.mode, url: input.source.url },
    output: brief,
    metadata: { action: "brief", mode: input.mode },
    origin: "generated",
  });
  return { brief, content };
}
