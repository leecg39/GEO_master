export type GeoPromptCategory =
  | "topical"
  | "content"
  | "entity"
  | "structure"
  | "freshness"
  | "competitor";

export interface GeoPromptTemplate {
  id: string;
  category: GeoPromptCategory;
  title: string;
  summary: string;
  /** strategy | studio | both */
  surface: "strategy" | "studio" | "both";
  strategySeed?: {
    type: "pillar" | "cluster" | "question";
    title: string;
  };
  studioHint: string;
}

/** WP x MCP 21 SEO prompts의 로컬 플레이북 번역 — get_prompt SaaS 연동 없음 */
export const GEO_PROMPT_CATALOG: readonly GeoPromptTemplate[] = [
  {
    id: "topical-map",
    category: "topical",
    title: "Topical Map Creator",
    summary: "카테고리 주제 지도를 pillar–cluster로 스케치합니다.",
    surface: "strategy",
    strategySeed: { type: "pillar", title: "토픽 맵 · 핵심 카테고리" },
    studioHint: "토픽 맵을 바탕으로 HeroAnswer와 EntityDefinition을 작성하세요.",
  },
  {
    id: "topical-audit",
    category: "topical",
    title: "Topical Authority Audit",
    summary: "권위 공백·중복 주제를 점검합니다.",
    surface: "both",
    strategySeed: { type: "cluster", title: "권위 공백 점검" },
    studioHint: "공백 주제에 대한 KeyTakeaways와 FAQ를 채우세요.",
  },
  {
    id: "topical-cluster",
    category: "topical",
    title: "Topical Cluster Builder",
    summary: "pillar 아래 supporting 클러스터를 생성합니다.",
    surface: "strategy",
    strategySeed: { type: "cluster", title: "클러스터 · 하위 주제" },
    studioHint: "클러스터별 CiteBlock과 CTA를 준비하세요.",
  },
  {
    id: "bulk-brief",
    category: "content",
    title: "Bulk SEO Post Generator",
    summary: "여러 초안 주제를 한 번에 스펙으로 뽑습니다.",
    surface: "studio",
    studioHint: "주제 목록을 입력해 GEO Blocks 일괄 초안을 만드세요.",
  },
  {
    id: "semantic-brief",
    category: "content",
    title: "Semantic Content Brief",
    summary: "의도·엔티티·필수 H2를 담은 브리프.",
    surface: "studio",
    studioHint: "브리프를 researchNotes에 넣고 블록 스펙을 생성하세요.",
  },
  {
    id: "serp-intent",
    category: "content",
    title: "SERP Intent Analyzer",
    summary: "정보·비교·구매 의도를 분류합니다.",
    surface: "both",
    strategySeed: { type: "question", title: "의도 분류 질문" },
    studioHint: "의도별 HeroAnswer 톤을 다르게 쓰세요.",
  },
  {
    id: "entity-map",
    category: "entity",
    title: "Entity Connection Mapper",
    summary: "브랜드·제품·표준 관계를 정의합니다.",
    surface: "studio",
    studioHint: "EntityDefinition + Organization JSON-LD를 채우세요.",
  },
  {
    id: "entity-extract",
    category: "entity",
    title: "Entity Extraction",
    summary: "본문에서 인용 가능한 엔티티를 추출합니다.",
    surface: "studio",
    studioHint: "추출 엔티티를 EntityDefinition 블록으로 옮기세요.",
  },
  {
    id: "heading-vectors",
    category: "structure",
    title: "Heading Vectors Generator",
    summary: "H2/H3 벡터를 질문형으로 설계합니다.",
    surface: "studio",
    studioHint: "헤딩을 FAQ 질문과 Speakable로 변환하세요.",
  },
  {
    id: "h2-questions",
    category: "structure",
    title: "H2/H3 Question Builder",
    summary: "고객 질문형 소제목을 만듭니다.",
    surface: "both",
    strategySeed: { type: "question", title: "고객 질문형 H2" },
    studioHint: "질문을 FAQ 블록에 넣고 답변을 쓰세요.",
  },
  {
    id: "snippet-writer",
    category: "structure",
    title: "Featured Snippet Writer",
    summary: "40~60단어 직접 답 + 목록.",
    surface: "studio",
    studioHint: "HeroAnswer와 KeyTakeaways를 필수로 채우세요.",
  },
  {
    id: "content-refresh",
    category: "freshness",
    title: "Content Refresher",
    summary: "오래된 주장에 날짜·출처를 붙입니다.",
    surface: "studio",
    studioHint: "CiteBlock에 sourceDate를 명시하세요.",
  },
  {
    id: "readability",
    category: "freshness",
    title: "Readability Rewrite",
    summary: "쉬운 문장·짧은 단락으로 재작성.",
    surface: "studio",
    studioHint: "Speakable을 한 문장으로 단순화하세요.",
  },
  {
    id: "competitor-gap",
    category: "competitor",
    title: "Competitor Gap Analysis",
    summary: "경쟁 메모·Easy-Win을 갭으로 정리.",
    surface: "both",
    strategySeed: { type: "cluster", title: "경쟁 갭 주제" },
    studioHint: "settings 외부 연구 메모를 researchNotes에 붙여 넣으세요.",
  },
  {
    id: "internal-links",
    category: "competitor",
    title: "Internal Link Planner",
    summary: "내부 링크·페이지랭크 힌트.",
    surface: "studio",
    studioHint: "CTA href에 내부 URL을 넣고 CiteBlock으로 연결하세요.",
  },
] as const;

export function getGeoPrompt(id: string) {
  return GEO_PROMPT_CATALOG.find((item) => item.id === id) ?? null;
}

export function listGeoPrompts(surface?: "strategy" | "studio") {
  if (!surface) return [...GEO_PROMPT_CATALOG];
  return GEO_PROMPT_CATALOG.filter((item) => item.surface === surface || item.surface === "both");
}
