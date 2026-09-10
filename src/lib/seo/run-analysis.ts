import type { PageSnapshot } from "@/lib/site-ops/types";
import type { SeoAnalysis, SeoFinding } from "./contracts";
import { hashText, stableJson } from "./normalize";
import { SEO_ANALYZERS, SEO_ANALYSIS_VERSION } from "./registry";
import { scoreFindings } from "./scoring";

export const SEO_CONFIG_HASH = hashText(stableJson(SEO_ANALYZERS.map(({ id, version }) => ({ id, version }))));

/** Pure, offline analysis. The capture is shared; no additional fetch or model call. */
export function runSeoAnalysis(snapshot: PageSnapshot): SeoAnalysis {
  const key = `${snapshot.projectId}:${snapshot.id}:${SEO_ANALYSIS_VERSION}:${SEO_CONFIG_HASH}`;
  const findings = SEO_ANALYZERS.flatMap((analyzer) => analyzer.run(snapshot).map((result): SeoFinding => {
    const { evidence, ...observation } = result;
    // A confirmed result always points at a persisted snapshot field, never a model assertion.
    const status = ["pass", "fail"].includes(result.status) && !evidence.length ? "unknown" : result.status;
    return {
      ...observation, status, id: hashText(`${key}:${analyzer.id}:${result.ruleId}`),
      projectId: snapshot.projectId, snapshotId: snapshot.id, analyzer: analyzer.id,
      ruleVersion: analyzer.version, analyzerVersion: analyzer.version,
      sourceUrl: snapshot.finalUrl ?? snapshot.url,
      evidenceRefs: evidence.map((field) => `page_snapshots/${snapshot.id}#${field}`),
      dependsOnFindingIds: [],
      ...(status === "fail" ? {
        proposedAction: "원본 근거와 페이지 목적을 확인하고 수정안을 검토하세요.",
        verificationSpec: { ruleId: result.ruleId, expectedStatus: "pass" as const, requiresFreshCapture: true as const },
        falsificationCheck: "새 공개 페이지 수집에서도 같은 검사에 실패하면 개선 완료로 보지 않습니다.",
      } : {}),
    };
  }));
  return { key, version: SEO_ANALYSIS_VERSION, configHash: SEO_CONFIG_HASH, source: snapshot.dataState,
    findings, score: scoreFindings(findings) };
}
