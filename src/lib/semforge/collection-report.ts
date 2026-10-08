export interface CollectionOutcome {
  error?: string;
  errorCode?: string;
  skipped?: boolean;
}

export interface CollectionReport {
  collected: number;
  failed: number;
  skipped: number;
  outcomes: CollectionOutcome[];
}

export function collectionCounts(outcomes: CollectionOutcome[]) {
  return {
    collected: outcomes.filter((item) => !item.error && !item.skipped).length,
    failed: outcomes.filter((item) => item.error && !item.skipped).length,
    skipped: outcomes.filter((item) => item.skipped).length,
  };
}

/** Shared with the UI so individual workspaces show the same actionable cause. */
export function formatCollectionReport(report: CollectionReport, label = "수집"): string {
  const counts = `${label} ${report.collected}건 성공 · ${report.failed}건 실패${report.skipped ? ` · ${report.skipped}건 미실행` : ""}`;
  const reasons = [...new Set(report.outcomes.flatMap((item) => item.error ? [item.error] : []))];
  return reasons.length ? `${counts}. ${reasons.slice(0, 2).join(" ")}` : counts;
}
