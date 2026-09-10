export type FindingStatus = "pass" | "fail" | "unknown" | "not_applicable";
export type FindingMethod = "http_observation" | "parser_rule" | "llm_judgment" | "external_api";
export interface SeoFinding {
  id: string;
  projectId: number;
  snapshotId: number;
  ruleId: string;
  ruleVersion: string;
  analyzerVersion: string;
  analyzer: "technical" | "schema";
  category: "technical" | "recommendation";
  status: FindingStatus;
  method: FindingMethod;
  severity: "critical" | "high" | "medium" | "low" | "info";
  sourceUrl: string;
  evidenceRefs: string[];
  explanation: string;
  proposedAction?: string;
  dependsOnFindingIds: string[];
  verificationSpec?: { ruleId: string; expectedStatus: "pass"; requiresFreshCapture: true };
  falsificationCheck?: string;
}
export interface SeoScore {
  value: number | null;
  passed: number;
  failed: number;
  unknown: number;
  notApplicable: number;
  coverage: number | null;
}
export interface SeoAnalysis {
  version: string;
  configHash: string;
  key: string;
  source: "live" | "mock" | "error";
  findings: SeoFinding[];
  score: SeoScore;
}
