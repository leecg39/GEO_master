import { z } from "zod";
import type { CitationSummary, CollectionQuality, QuestionCell, Ratio } from "./geo-core";

const ratioSchema = z.object({
  numerator: z.number(),
  denominator: z.number(),
  value: z.number().nullable(),
});

const qualitySchema = z.object({
  planned: z.number(),
  succeeded: z.number(),
  refused: z.number(),
  failed: z.number(),
  completionRate: ratioSchema,
  refusalRate: ratioSchema,
});

const cellSchema = z.object({
  question: z.string(),
  provider: z.string(),
  mentioned: z.number(),
  valid: z.number(),
  refused: z.number(),
  failed: z.number(),
  planned: z.number(),
  label: z.string(),
});

const citationSummarySchema = z.object({
  ownCitationCoverage: ratioSchema,
  perProvider: z.record(z.string(), ratioSchema),
  citedByCategory: z.record(z.string(), z.number()),
  searchedCount: z.number(),
  topDomains: z.array(z.object({ domain: z.string(), category: z.string(), count: z.number() })),
  pagesCitedWithoutBrand: z.array(z.object({ url: z.string(), domain: z.string(), category: z.string(), count: z.number() })),
});

export interface MeasurementEvidence {
  /** 슬롯 상태·분모 기록 이전 산식으로 저장된 실행 */
  legacy: boolean;
  metricVersion: string;
  quality: CollectionQuality | null;
  questionMatrix: QuestionCell[];
  questions: string[];
  providers: string[];
  searchMode: "off" | "web";
  citations: CitationSummary | null;
}

/** 저장된 실행 summary(신뢰할 수 없는 JSON)에서 분모 근거를 안전하게 꺼낸다 */
export function parseMeasurementEvidence(summary: Record<string, unknown>): MeasurementEvidence {
  const metricVersion = typeof summary.metricVersion === "string" ? summary.metricVersion : "legacy";
  const quality = qualitySchema.safeParse(summary.quality);
  const citationSummary = citationSummarySchema.safeParse(summary.citations);
  const rawCells = Array.isArray(summary.questionMatrix) ? summary.questionMatrix : [];
  const questionMatrix = rawCells.flatMap((cell) => {
    const parsed = cellSchema.safeParse(cell);
    return parsed.success ? [parsed.data] : [];
  });
  return {
    legacy: metricVersion === "legacy",
    metricVersion,
    quality: quality.success ? quality.data : null,
    questionMatrix,
    questions: [...new Set(questionMatrix.map((cell) => cell.question))],
    providers: [...new Set(questionMatrix.map((cell) => cell.provider))],
    searchMode: summary.searchMode === "web" ? "web" : "off",
    citations: citationSummary.success ? citationSummary.data : null,
  };
}

export function formatRatio(ratio: Ratio) {
  return `${ratio.value === null ? "N/A" : `${ratio.value}%`} (${ratio.numerator}/${ratio.denominator})`;
}
