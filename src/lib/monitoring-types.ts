/** The monitoring product deliberately supports the existing four AI services only. */
export const MONITORING_PROVIDERS = [
  { id: "openai", name: "ChatGPT" },
  { id: "anthropic", name: "Claude" },
  { id: "gemini", name: "Gemini" },
  { id: "grok", name: "Grok" },
] as const;
export type MonitoringProvider = typeof MONITORING_PROVIDERS[number]["id"];

export interface MonitoringMetric {
  succeeded: number;
  failed: number;
  refused: number;
  mentions: number;
  share: number | null;
  providerCount: number | null;
  averageRank: number | null;
}
export interface MonitoringComparison {
  baseline: MonitoringMetric | null;
  current: MonitoringMetric | null;
  delta: number | null;
}
export interface MonitoringRegistration {
  id: number;
  questionSetId: number;
  setName: string;
  updatedAt: string;
}
export interface MonitoringQuestion extends MonitoringComparison {
  key: string;
  text: string;
  registrations: MonitoringRegistration[];
  measuredRuns: number;
}
export interface MonitoringBrand extends MonitoringComparison {
  id: string;
  name: string;
  own: boolean;
}
export interface MonitoringRun {
  id: number;
  at: string;
}
export interface MonitoringData {
  project: { id: number; name: string; brandName: string };
  range: { start: string; end: string; timezone: "Asia/Seoul" };
  questionSets: { id: number; name: string }[];
  runCount: number;
  conditions: MonitoringConditionComparison;
  endpoints: { baseline: MonitoringRun | null; current: MonitoringRun | null };
  monthlyRuns: { month: string; count: number }[];
  overview: MonitoringComparison & { period: MonitoringMetric };
  providers: (MonitoringComparison & { id: MonitoringProvider; name: string })[];
  weeks: { week: string; runs: number; metric: MonitoringMetric }[];
  questions: MonitoringQuestion[];
  selected: null | {
    question: MonitoringQuestion;
    brands: MonitoringBrand[];
    trends: (MonitoringRun & { brands: Record<string, MonitoringMetric | null> })[];
  };
  selectionMissing: boolean;
}

export interface MonitoringCondition {
  known: boolean;
  signature: string | null;
  questionCount: number;
  questions: string[];
  models: string[];
  searchModes: string[];
  repetitions: string[];
  requestedSearchMode: "off" | "web" | null;
}
export interface MonitoringConditionComparison {
  mode: "all" | "same";
  referenceRun: MonitoringRun | null;
  baseline: MonitoringCondition | null;
  current: MonitoringCondition | null;
  differences: string[];
  excludedRuns: number;
}
export interface MonitoringResponseMention {
  brandId: string; name: string; own: boolean; start: number; end: number;
}
export interface MonitoringResponseSource {
  id: number; url: string; title: string | null; domain: string;
  kind: "cited" | "inline" | "searched";
  storedCategory: string;
}
export type MonitoringSearchMode = "off" | "web" | "unknown";
export interface MonitoringResponseItem {
  id: number; provider: MonitoringProvider; model: string; returnedModel: string | null;
  repetition: number; slotStatus: "succeeded" | "failed" | "refused"; slotError: string | null;
  response: string; searchMode: MonitoringSearchMode; searchPerformed: boolean | null;
  mentions: MonitoringResponseMention[]; sources: MonitoringResponseSource[];
}
export interface MonitoringResponseProvider extends MonitoringMetric {
  id: MonitoringProvider; name: string; resultCount: number;
  mentionedBrands: { id: string; name: string; own: boolean }[];
  groups: { searchMode: MonitoringSearchMode; models: string[]; returnedModels: string[]; resultCount: number }[];
}
export interface MonitoringResponses {
  project: { id: number; name: string };
  question: { key: string; text: string };
  run: MonitoringRun & { requestedSearchMode: "off" | "web" | null; rawAnswerCount: number };
  interpretation: "current_brand_settings";
  summary: MonitoringMetric & { mentionedProviderCount: number; measuredProviderCount: number };
  providers: MonitoringResponseProvider[];
  items: MonitoringResponseItem[];
  page: { nextCursor: string | null; hasMore: boolean };
}
