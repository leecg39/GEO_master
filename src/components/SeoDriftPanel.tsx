import type { ChangeSet } from "@/lib/site-ops/types";
import type { DriftClassification } from "@/lib/seo/drift";

const LABELS: Record<DriftClassification, string> = {
  expected: "승인대로 반영", pending: "아직 반영 대기", unexpected: "예상 밖 변경", unknown: "비교 불가",
};
export function SeoDriftPanel({ change }: { change: ChangeSet }) {
  const drift = change.verification.drift;
  if (!drift) return null;
  return <details className="mt-3 rounded-lg border border-white/10 p-3 text-xs">
    <summary className="cursor-pointer text-slate-300">
      변경 감지 · 승인대로 {drift.counts.expected} · 반영 대기 {drift.counts.pending} · 예상 밖 {drift.counts.unexpected} · 비교 불가 {drift.counts.unknown}
    </summary>
    <p className="mt-3 text-slate-400">승인 기준 #{drift.baselineSnapshotId} → 새 수집 #{drift.currentSnapshotId} · {drift.version}</p>
    <p className="mt-2 text-slate-500">재검증해도 승인 기준은 자동으로 바뀌지 않습니다. 아래는 최근 200개 항목입니다.</p>
    <ul className="mt-3 max-h-80 space-y-3 overflow-auto">
      {change.driftEvents.map((event) => <li key={event.id} className="border-t border-white/5 pt-3">
        <p className={event.classification === "unexpected" ? "text-amber-300" : "text-slate-300"}>{LABELS[event.classification]} · {event.detail}</p>
        <p className="mt-1 text-slate-500">수집 #{event.currentSnapshotId} · {new Date(event.createdAt).toLocaleString("ko-KR")}</p>
        {event.before !== null && <pre className="mt-2 overflow-auto whitespace-pre-wrap break-all text-slate-400">{event.before || "(없음)"}{"\n→\n"}{event.after || "(없음)"}</pre>}
      </li>)}
    </ul>
  </details>;
}
