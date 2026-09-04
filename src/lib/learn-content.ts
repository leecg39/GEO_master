export interface ChecklistItem {
  id: string;
  category: string;
  label: string;
}

const checklistGroups: Record<string, string[]> = {
  "기반 SEO": [
    "검색 의도에 맞는 고유 title을 작성했다",
    "meta description에 핵심 답변을 요약했다",
    "H1 하나와 논리적인 H2·H3 계층을 사용했다",
    "canonical URL을 설정했다",
    "Open Graph 핵심 태그를 설정했다",
    "관련 콘텐츠를 설명형 내부 링크로 연결했다",
    "정보성 이미지에 의미 있는 alt를 작성했다",
  ],
  "GEO 콘텐츠 구조": [
    "고객의 실제 질문을 소제목으로 사용했다",
    "도입부를 문제→핵심 답변→가치 순서로 썼다",
    "절차와 조건을 목록으로 구조화했다",
    "비교·평가 정보를 표로 제공했다",
    "실제 고객 언어의 FAQ를 3개 이상 제공했다",
    "정보·비교·구매·문제 해결 의도를 명시했다",
    "탐색→비교→구매 결정 여정을 반영했다",
  ],
  "신뢰도·E-E-A-T": [
    "작성자와 검수자의 전문성을 표시했다",
    "주장마다 원문 출처와 기준일을 표시했다",
    "형용사를 표본·기간·조건이 있는 수치로 바꿨다",
    "발행일을 표시했다",
    "최종 수정일을 표시하고 최신성을 검토했다",
    "회사 소개·연락처·편집 정책을 공개했다",
  ],
  "기술적 GEO": [
    "페이지 유형에 맞는 JSON-LD를 추가했다",
    "FAQPage 스키마가 화면의 FAQ와 일치한다",
    "Organization 또는 Article 엔티티를 정의했다",
    "주요 AI 크롤러 차단 여부를 검토했다",
    "핵심 문서를 설명하는 llms.txt를 제공했다",
    "최신 URL과 수정일을 담은 sitemap을 제공했다",
  ],
  "브랜드 노출": [
    "모든 채널에서 브랜드 정의 한 문장을 통일했다",
    "sameAs·공식 URL·로고로 엔티티를 연결했다",
    "표준·인증·전문기관과의 관계를 근거와 함께 설명했다",
    "영문 브랜드 정의와 핵심 자료를 공개했다",
    "추천 조건·1위 표현에 검증 가능한 근거를 붙였다",
    "공식·언론·학술·커뮤니티 소스를 다각화했다",
  ],
  "운영·검증": [
    "브랜드 없는 핵심 질문 20~30개를 관리한다",
    "여러 AI 모델에서 질문별 반복 측정한다",
    "언급 여부·순위·긍부정 문맥을 기록한다",
    "월별 응답 점유율과 경쟁사 변화를 비교한다",
    "4주 모니터링 사이클을 실행한다",
    "오해를 발견하면 열린 웹 데이터를 수정하고 재검증한다",
  ],
};

export const LEARN_CHECKLIST: ChecklistItem[] = Object.entries(checklistGroups).flatMap(([category, labels], groupIndex) =>
  labels.map((label, itemIndex) => ({
    id: `g${groupIndex + 1}-${itemIndex + 1}`,
    category,
    label,
  })),
);

export const LEARN_CONCEPTS = [
  {
    title: "제로클릭과 AEO·GEO",
    summary: "AI 요약에서 탐색이 끝나는 환경에서는 클릭 순위뿐 아니라 답변 안의 발견·인용·추천을 관리해야 합니다. AEO는 직접 답변 최적화, GEO는 생성형 AI가 브랜드의 맥락을 선택하도록 만드는 더 넓은 실행 체계입니다.",
  },
  {
    title: "키워드에서 엔티티로",
    summary: "AI는 단어의 반복보다 회사·제품·사람·표준 사이의 관계와 의미적 거리를 해석합니다. 일관된 정의, 구조화 데이터, 검증 가능한 외부 소스가 엔티티를 선명하게 만듭니다.",
  },
  {
    title: "팁 메모리와 워킹 메모리",
    summary: "학습 데이터에 각인된 장기 기억은 빠르게 바꾸기 어렵지만, 검색·RAG가 참조하는 열린 웹 데이터는 개선할 수 있습니다. GEO는 통제 가능한 외부 데이터의 품질과 합의를 높이는 작업입니다.",
  },
  {
    title: "GEO 퍼널",
    summary: "존재(알고 있는가)→맥락(무엇으로 이해하는가)→시의성(최신 정보인가)→추천(조건에 맞게 권하는가)의 순서로 진행하며 앞 단계를 건너뛰지 않습니다.",
  },
];

export const GEO_TOOLS = [
  ["엔티티 매핑", "정의 템플릿과 JSON-LD로 브랜드 관계를 명확히 합니다."],
  ["소스 다각화", "공식·언론·학술·커뮤니티의 4중창을 만듭니다."],
  ["권위 밀도", "검증 가능한 권위 엔티티와 가까운 맥락을 확보합니다."],
  ["의미적 연결", "고객 고통→표준·인증→브랜드의 관계를 설명합니다."],
  ["응답 조건화", "추천 조건과 트리거 표현을 근거와 함께 반복합니다."],
  ["다국어 확장", "영문을 포함한 다국어 데이터로 맥락 범위를 넓힙니다."],
  ["AI 검증 루프", "정기 질의로 오해를 찾고 데이터를 고친 뒤 다시 측정합니다."],
] as const;

export const GEO_PRINCIPLES = [
  "제품·SEO 기본기 위에 GEO를 쌓는다",
  "채널마다 같은 엔티티 정의를 사용한다",
  "주장보다 수치·조건·원문 출처를 우선한다",
  "한 곳의 반복보다 독립적인 소스의 합의를 만든다",
  "최신 날짜와 변경 근거를 공개한다",
  "즉시 효과를 기대하지 않고 측정→수정→재검증을 누적한다",
];

export const PARADIGM_SHIFTS = [
  "노출 → 발견", "키워드 → 맥락", "클릭 → 인용", "콘텐츠 양 → 생태계 깊이",
  "경쟁 → 신뢰", "마케팅과 콘텐츠 분리 → 콘텐츠가 브랜드 자산", "즉시 효과 → 누적 효과",
];

export const TERM_MAP = [
  ["키워드", "검색 의도·엔티티"], ["검색 순위", "답변 내 언급 순위"], ["CTR", "인용 빈도"],
  ["백링크", "신뢰 언급·소스 합의"], ["도메인 점수", "E-E-A-T 신호"], ["트래픽", "브랜드 발견"],
] as const;

export const CASE_STUDIES = [
  ["김캐디", "구조화된 열린 데이터가 글로벌 파트너가 이해할 수 있는 엔티티 기반을 만들었습니다."],
  ["모두싸인", "카테고리 선두도 정의·근거·소스 합의를 지속적으로 관리해야 함을 보여줍니다."],
  ["노션", "PLG와 사용자 생성 콘텐츠가 다양한 사용 맥락을 축적했습니다."],
  ["허브스팟", "장기간 누적한 교육 콘텐츠와 도구가 주제 권위를 형성했습니다."],
] as const;

/** RankSEO·Glippy는 연구 보조, 인용 진실은 /share — 제품에 이식하지 않음 */
export const EXTERNAL_TOOL_WORKFLOW =
  "RankSEO(경쟁·Easy-Win) → settings → Glippy(준비도) → audit → share(실인용)";

export const CITATION_TRUTH_NOTE =
  "외부 툴(RankSEO·Glippy)은 연구 보조로만 사용합니다. DA/DR·GEO 배지·준비도 점수는 GenRank와 합산·동일 척도로 비교하지 않으며, 인용·점유율의 진실은 /share 실측정과 GenRank에만 둡니다.";

/** CMS 운영이 아닌 인용 측정·준비 — WP x MCP는 블록 스펙·승인 UX만 참고 */
export const PRODUCT_BOUNDARY_NOTE =
  "GEO Master는 CMS 운영자가 아니라 인용 측정·준비 워크스페이스입니다. WP x MCP류 패턴은 GEO 블록 스펙·dry-run·승인 UX만 참고하며, 라이브 사이트 조작은 SEMForge GEO Blocks에서도 하지 않습니다.";

if (LEARN_CHECKLIST.length !== 38) {
  throw new Error(`Learn checklist invariant failed: ${LEARN_CHECKLIST.length}`);
}
