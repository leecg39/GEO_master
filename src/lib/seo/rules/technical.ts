import type { PageSnapshot } from "@/lib/site-ops/types";
import type { FindingStatus, SeoFinding } from "../contracts";

export const TECHNICAL_VERSION = "technical/1";
export type RuleObservation = Pick<SeoFinding, "ruleId" | "status" | "method" | "category" | "severity" | "explanation"> & { evidence: string[] };
export function technicalRules(snapshot: PageSnapshot): RuleObservation[] {
  const observed = snapshot.dataState === "live" && snapshot.statusCode !== null;
  const html = snapshot.dataState === "live" && snapshot.fetchState === "fetched" && snapshot.metadata !== null;
  const status = (passed: boolean): FindingStatus => html ? passed ? "pass" : "fail" : "unknown";
  return [
    {
      ruleId: "http-status", category: "technical", severity: "high", method: "http_observation",
      status: observed ? snapshot.statusCode! >= 200 && snapshot.statusCode! < 300 ? "pass" : "fail" : "unknown",
      evidence: observed ? ["statusCode", "finalUrl"] : [],
      explanation: observed ? `실제 HTTP ${snapshot.statusCode} 응답입니다.` : "HTTP 응답을 확인하지 못했습니다. 발견 URL이나 샘플을 성공으로 간주하지 않습니다.",
    },
    {
      ruleId: "title", category: "technical", severity: "medium", method: "parser_rule",
      status: status(Boolean(snapshot.metadata?.title)), evidence: html ? ["metadata.title"] : [],
      explanation: html ? snapshot.metadata!.title ? "수집한 HTML에 제목이 있습니다." : "수집한 HTML에 title이 없습니다." : "HTML 수집 근거가 없어 제목 유무를 판단할 수 없습니다.",
    },
    ...["description", "canonical", "index-policy"].map((code): RuleObservation => {
      const original = snapshot.rules.find((rule) => rule.code === code);
      return {
        ruleId: code, category: "recommendation", severity: "info", method: "parser_rule",
        status: html && original ? original.passed ? "pass" : "unknown" : "unknown",
        evidence: html ? [code === "index-policy" ? "metadata.robots" : `metadata.${code}`] : [],
        explanation: html && original ? original.detail : "수집 근거가 없어 판단을 보류합니다.",
      };
    }),
  ];
}
