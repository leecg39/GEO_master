/**
 * FeatGEO 피처 공간 (Liu & Xu, ACL 2026, arXiv 2604.19113) — 13개 해석 가능한 피처, 3개 층.
 *
 * 원본과 다른 점(의도적): 원본 가이드는 통계·출처·인용문을 "가상으로 만들어도 된다"고 지시한다.
 * 실제 브랜드 콘텐츠에서는 허위 정보가 되므로 여기서는
 *  - 수치는 사실 메모의 값만, 출처는 허용 목록의 실제 출처만, 인용문은 제공된 문장만 쓰게 하고
 *  - 근거가 없으면 해당 피처를 높여도 새 사실을 만들지 말고 [자료 요청]으로 남기게 한다.
 */
import { gaussian, type Random } from "./rng";

export type FeatureLayer = "structure" | "content" | "language";

export const FEATURE_KEYS = [
  "has_intro_summary", "headings_level", "list_density", "length_level",
  "statistics_level", "cite_sources_level", "quotation_level", "unique_info_level", "technical_terms_level",
  "authoritative_level", "easy_to_understand_level", "fluency_level", "keyword_focus_level",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type FeatureConfig = Record<FeatureKey, number>;

export interface GuidelineContext {
  /** 검증된 사실 메모가 하나 이상 있는지 */
  hasFacts: boolean;
  /** 인용해도 되는 실제 출처 (URL·기관명) */
  allowedSources: readonly string[];
  /** 사용자가 제공한 실제 인용문 */
  quotes: readonly string[];
}

interface FeatureDefinition {
  label: string;
  layer: FeatureLayer;
  range: readonly [number, number];
  guide: (value: number, context: GuidelineContext) => string;
}

function level<T>(value: number, [lo, hi]: readonly [number, number], low: T, mid: T, high: T) {
  const ratio = (value - lo) / (hi - lo);
  return ratio < 0.35 ? low : ratio < 0.75 ? mid : high;
}

function percent(value: number, [lo, hi]: readonly [number, number]) {
  return Math.round(((value - lo) / (hi - lo)) * 100);
}

const RANGE_01 = [0, 1] as const;
const RANGE_03 = [0, 3] as const;
const RANGE_13 = [1, 3] as const;

export const FEATURES: Record<FeatureKey, FeatureDefinition> = {
  has_intro_summary: {
    label: "도입 요약", layer: "structure", range: RANGE_01,
    guide: (value) => level(value, RANGE_01,
      "도입 요약 없이 바로 본론으로 시작하세요.",
      "첫 1~3문장에 핵심을 짧게 요약하세요.",
      "첫 문단 3~5문장으로 결론과 핵심 근거를 먼저 요약하세요."),
  },
  headings_level: {
    label: "제목 계층", layer: "structure", range: RANGE_13,
    guide: (value) => level(value, RANGE_13,
      "제목 1개와 연속 문단 위주로 단순하게 구성하세요.",
      "제목 1개와 소제목 1~2개로 구분하세요.",
      "제목 1개와 소제목 2개 이상으로 정보 계층을 분명히 하세요."),
  },
  list_density: {
    label: "목록 밀도", layer: "structure", range: RANGE_03,
    guide: (value) => level(value, RANGE_03,
      "목록 없이 문단으로 쓰세요.",
      "핵심 요점 일부(약 30~70%)를 목록으로 정리하세요.",
      "대부분의 요점을 번호·글머리 목록으로 정리하세요."),
  },
  length_level: {
    label: "분량", layer: "structure", range: RANGE_13,
    guide: (value) => level(value, RANGE_13,
      "짧게(약 300~500자 이내 수준) 핵심만 쓰세요.",
      "중간 분량으로 주제를 빠짐없이 다루세요.",
      "충분히 길게, 하위 주제를 나눠 자세히 다루세요."),
  },
  statistics_level: {
    label: "수치·통계", layer: "content", range: RANGE_03,
    guide: (value, context) => {
      if (value / 3 < 0.05) return "수치 없이 정성적으로 설명하세요.";
      if (!context.hasFacts) return "확인된 사실 메모가 없으므로 수치를 새로 만들지 마세요. 수치가 필요한 자리는 [자료 요청]으로 남기세요.";
      return `문장의 약 ${percent(value, RANGE_03)}%에 <사실 메모>의 수치를 자연스럽게 넣으세요. 사실 메모에 없는 수치를 새로 만들지 마세요.`;
    },
  },
  cite_sources_level: {
    label: "출처 언급", layer: "content", range: RANGE_03,
    guide: (value, context) => {
      if (value / 3 < 0.05 || !context.allowedSources.length) return "출처를 언급하지 마세요. 출처가 필요한 주장은 [자료 요청]으로 남기세요.";
      return `문단의 약 ${percent(value, RANGE_03)}%에서 다음 실제 출처만 자연어로 언급하세요: ${context.allowedSources.join(", ")}. 목록에 없는 기관·보고서를 만들지 마세요.`;
    },
  },
  quotation_level: {
    label: "인용문", layer: "content", range: RANGE_03,
    guide: (value, context) => {
      if (value / 3 < 0.2 || !context.quotes.length) return "인용문을 쓰지 마세요.";
      const count = level(value, RANGE_03, 1, 2, Math.min(4, context.quotes.length));
      return `다음 실제 인용문 중 최대 ${count}개를 원문 그대로 쓰세요: ${context.quotes.join(" / ")}. 다른 인용문을 만들지 마세요.`;
    },
  },
  unique_info_level: {
    label: "고유 정보", layer: "content", range: RANGE_03,
    guide: (value) => level(value, RANGE_03,
      "일반적인 설명 위주로 쓰세요.",
      "원문과 사실 메모에 있는 이 브랜드만의 정보를 앞쪽에 배치하세요.",
      "원문과 사실 메모에 있는 고유 정보(조건·차별점)를 문단마다 드러내세요. 새로운 사실은 추가하지 마세요."),
  },
  technical_terms_level: {
    label: "전문 용어", layer: "content", range: RANGE_03,
    guide: (value) => level(value, RANGE_03,
      "전문 용어를 피하고 쉬운 말로 쓰세요.",
      "필요한 곳에 정확한 전문 용어를 쓰고 핵심 정보는 그대로 유지하세요.",
      "전문 독자를 위해 정확한 전문 용어로 서술하되 내용을 추가·삭제하지 마세요."),
  },
  authoritative_level: {
    label: "권위 어조", layer: "language", range: RANGE_03,
    guide: (value) => level(value, RANGE_03,
      "중립적이고 객관적인 어조를 유지하세요.",
      "확신 있는 전문가 어조로 쓰되 내용은 바꾸지 마세요.",
      "단정적인 전문가 어조로 쓰되, '보장', '유일', '최고' 같은 검증할 수 없는 표현은 쓰지 마세요."),
  },
  easy_to_understand_level: {
    label: "난이도", layer: "language", range: RANGE_13,
    guide: (value) => level(value, RANGE_13,
      "짧고 쉬운 문장으로 쓰되 핵심 정보는 모두 유지하세요.",
      "쉬움과 전문성의 균형을 맞추세요.",
      "정확성을 우선해 전문적인 문장을 허용하세요."),
  },
  fluency_level: {
    label: "흐름", layer: "language", range: RANGE_13,
    guide: (value) => level(value, RANGE_13,
      "단순하고 직접적인 문장으로 쓰세요.",
      "문장 사이 흐름이 자연스럽게 이어지도록 다듬으세요.",
      "연결어와 전환을 충분히 써서 매우 매끄럽게 읽히게 하세요."),
  },
  keyword_focus_level: {
    label: "핵심어 집중", layer: "language", range: RANGE_13,
    guide: (value) => {
      const times = Math.round(3 + ((value - 1) / 2) * 12);
      return `질문의 핵심 용어를 핵심 위치(제목·첫 문장·소제목)에 약 ${times}회 자연스럽게 배치하세요. 억지 반복은 피하세요.`;
    },
  },
};

export function clampConfig(config: FeatureConfig): FeatureConfig {
  return Object.fromEntries(FEATURE_KEYS.map((key) => {
    const [lo, hi] = FEATURES[key].range;
    return [key, Math.min(hi, Math.max(lo, config[key]))];
  })) as FeatureConfig;
}

export function randomConfig(random: Random): FeatureConfig {
  return Object.fromEntries(FEATURE_KEYS.map((key) => {
    const [lo, hi] = FEATURES[key].range;
    return [key, lo + random() * (hi - lo)];
  })) as FeatureConfig;
}

/** 산술 교차 — 피처마다 무작위 볼록 가중 */
export function crossover(a: FeatureConfig, b: FeatureConfig, random: Random): FeatureConfig {
  return Object.fromEntries(FEATURE_KEYS.map((key) => {
    const weight = random();
    return [key, weight * a[key] + (1 - weight) * b[key]];
  })) as FeatureConfig;
}

/** 가우시안 변이 — 범위로 자른다 */
export function mutate(config: FeatureConfig, random: Random, probability = 0.15, sigma = 0.2): FeatureConfig {
  return clampConfig(Object.fromEntries(FEATURE_KEYS.map((key) => [
    key,
    random() < probability ? config[key] + gaussian(random, sigma) : config[key],
  ])) as FeatureConfig);
}

const LAYER_TITLES: Record<FeatureLayer, string> = { structure: "구조", content: "내용", language: "언어" };

export function toGuidelines(config: FeatureConfig, context: GuidelineContext) {
  const lines = ["[작성 제약] 각 항목의 목표값과 작성 요구를 지키세요. 어떤 경우에도 새로운 사실·수치·출처·인용문을 만들지 마세요."];
  for (const layer of ["structure", "content", "language"] as const) {
    lines.push(`=== ${LAYER_TITLES[layer]} ===`);
    for (const key of FEATURE_KEYS.filter((item) => FEATURES[item].layer === layer)) {
      const feature = FEATURES[key];
      lines.push(`- ${feature.label} ${config[key].toFixed(2)}/${feature.range[1].toFixed(2)}: ${feature.guide(config[key], context)}`);
    }
  }
  return lines.join("\n");
}
