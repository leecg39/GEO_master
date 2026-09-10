import type { SeoFinding } from "./contracts";
import { createStrategyItem, listStrategyItems } from "@/lib/strategy";

export interface SeoWorkCard {
  id: string;
  findingId: string;
  projectId: number;
  snapshotId: number;
  ruleId: string;
  title: string;
  explanation: string;
  evidenceRefs: string[];
  dependsOnFindingIds: string[];
  verificationSpec: { ruleId: string; expectedStatus: "pass"; requiresFreshCapture: true };
  proposedAction: string;
  sourceUrl: string;
  decision: "confirmed";
}

export interface SeoWorkCardRejection {
  findingId: string;
  decision: "unknown";
  reason: string;
}

export interface WorkCardBuildResult {
  confirmed: SeoWorkCard[];
  rejected: SeoWorkCardRejection[];
}

const EVIDENCE_REQUIRED = "근거 없는 확정 판정은 작업 카드로 등록하지 않습니다.";

function verificationSpec(finding: SeoFinding): SeoWorkCard["verificationSpec"] {
  return finding.verificationSpec ?? {
    ruleId: finding.ruleId,
    expectedStatus: "pass",
    requiresFreshCapture: true,
  };
}

/** Confirmed defects need snapshot evidence. Empty evidence is unknown, never a work item. */
export function buildWorkCards(findings: SeoFinding[]): WorkCardBuildResult {
  const confirmed: SeoWorkCard[] = [];
  const rejected: SeoWorkCardRejection[] = [];
  for (const finding of findings) {
    const hasEvidence = finding.evidenceRefs.length > 0;
    if (finding.status === "fail" && hasEvidence) {
      confirmed.push({
        id: `work:${finding.id}`,
        findingId: finding.id,
        projectId: finding.projectId,
        snapshotId: finding.snapshotId,
        ruleId: finding.ruleId,
        title: (finding.proposedAction || finding.explanation).slice(0, 500),
        explanation: finding.explanation,
        evidenceRefs: [...finding.evidenceRefs],
        dependsOnFindingIds: [...finding.dependsOnFindingIds],
        verificationSpec: verificationSpec(finding),
        proposedAction: finding.proposedAction ?? "원본 근거와 페이지 목적을 확인하고 수정안을 검토하세요.",
        sourceUrl: finding.sourceUrl,
        decision: "confirmed",
      });
      continue;
    }
    if ((finding.status === "pass" || finding.status === "fail") && !hasEvidence) {
      rejected.push({ findingId: finding.id, decision: "unknown", reason: EVIDENCE_REQUIRED });
    }
  }
  return { confirmed, rejected };
}

function existingFindingIds() {
  return new Set(
    listStrategyItems()
      .filter((item) => item.type === "work" && item.data.kind === "seo-work-card")
      .map((item) => String(item.data.findingId)),
  );
}

export function persistWorkCards(findings: SeoFinding[]) {
  const built = buildWorkCards(findings);
  const seen = existingFindingIds();
  const items = built.confirmed
    .filter((card) => !seen.has(card.findingId))
    .map((card) => createStrategyItem({
      type: "work",
      title: card.title,
      status: "계획",
      data: {
        kind: "seo-work-card",
        findingId: card.findingId,
        snapshotId: card.snapshotId,
        ruleId: card.ruleId,
        evidenceRefs: JSON.stringify(card.evidenceRefs),
        dependsOnFindingIds: JSON.stringify(card.dependsOnFindingIds),
        verificationSpec: JSON.stringify(card.verificationSpec),
        sourceUrl: card.sourceUrl,
        decision: "confirmed",
      },
    }));
  return { ...built, items };
}
