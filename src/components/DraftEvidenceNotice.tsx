import Link from "next/link";
import { Badge } from "@/components/ui";

interface SentenceAudit { text: string; check: "ok" | "needs_evidence"; factIds: string[]; reason: string | null }

function parse(value: unknown): { needsEvidence: number; sentences: SentenceAudit[] } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { needsEvidence?: unknown; sentences?: unknown };
  if (typeof record.needsEvidence !== "number" || !Array.isArray(record.sentences)) return null;
  const sentences = record.sentences.filter((item): item is SentenceAudit => Boolean(item) && typeof (item as SentenceAudit).text === "string");
  return { needsEvidence: record.needsEvidence, sentences };
}

/** 스튜디오 결과의 문장 단위 근거 감사 — 근거 없는 수치 문장을 "자료 요청"으로 보여 준다 */
export function DraftEvidenceNotice({ evidence }: { evidence: unknown }) {
  const audit = parse(evidence);
  if (!audit) return null;
  const flagged = audit.sentences.filter((sentence) => sentence.check === "needs_evidence");
  if (!flagged.length) {
    return <p className="rounded-xl border border-emerald-400/15 bg-emerald-400/5 p-3 text-xs text-emerald-300">모든 수치 문장이 확인된 사실 메모와 연결되었습니다.</p>;
  }
  return (
    <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
      <div className="flex flex-wrap items-center gap-2"><Badge tone="warn">자료 요청 {flagged.length}</Badge><p className="text-xs text-slate-400">아래 문장은 확인된 사실 메모로 뒷받침되지 않습니다. 근거를 <Link className="text-cyan-300 hover:underline" href="/facts">사실 메모</Link>에 추가하거나 문장을 고친 뒤 게시하세요.</p></div>
      <ul className="mt-3 space-y-2 text-sm">
        {flagged.map((sentence, index) => <li key={`${index}-${sentence.text}`} className="text-slate-300">{sentence.text}<span className="block text-xs text-amber-300">{sentence.reason}</span></li>)}
      </ul>
    </div>
  );
}
