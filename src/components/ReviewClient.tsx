"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, LoaderCircle, X } from "lucide-react";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";

type Mode = "all" | "exceptions";
type Verdict = "match" | "conflict" | "insufficient" | "time_unknown" | "needs_review";
interface Span { alias: string; start: number; end: number; ambiguous?: boolean }
interface Item {
  resultId: number; runId: number; question: string; provider: string; response: string; brandMentioned: boolean;
  matchedSpans: Span[]; reasons: string[]; claims: { id: number; claimText: string; attribute: string; value: string; unit: string | null; verdict: Verdict }[];
}
interface Quality { sampleCount: number; precision: number | null; recall: number | null; exceptionModeEligible: boolean; thresholds: { minSamples: number; minPrecision: number; minRecall: number } }

const verdictLabels: Record<Verdict, string> = { match: "일치", conflict: "충돌", insufficient: "근거 부족", time_unknown: "시점 불명", needs_review: "검토 필요" };
const reasonLabels: Record<string, string> = { ambiguous: "모호 별칭", claim: "주장 확인" };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error || "요청을 처리하지 못했습니다.");
  return body as T;
}

function fetchReview(mode: Mode | null) {
  return request<{ queue: { mode: Mode; total: number; items: Item[] }; quality: Quality }>(`/api/review${mode ? `?mode=${mode}` : ""}`);
}

const postJson = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const pct = (value: number | null) => (value === null ? "N/A" : `${(value * 100).toFixed(1)}%`);

function Highlighted({ text, spans }: { text: string; spans: Span[] }) {
  const ordered = [...spans].filter((span) => span.end <= text.length).sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ordered.forEach((span, index) => {
    if (span.start < cursor) return;
    parts.push(text.slice(cursor, span.start));
    parts.push(<mark key={index} className={span.ambiguous ? "bg-amber-400/30 text-inherit" : "bg-[color:var(--color-accent-lime)]/30 text-inherit"}>{text.slice(span.start, span.end)}</mark>);
    cursor = span.end;
  });
  parts.push(text.slice(cursor));
  return <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">{parts}</p>;
}

export function ReviewClient() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [quality, setQuality] = useState<Quality | null>(null);
  const [verdicts, setVerdicts] = useState<Record<number, Verdict>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async (nextMode: Mode | null) => {
    try {
      let data = await fetchReview(nextMode);
      const resolvedMode = nextMode ?? (data.quality.exceptionModeEligible ? "exceptions" : "all");
      if (resolvedMode !== data.queue.mode) data = await fetchReview(resolvedMode);
      setMode(resolvedMode);
      setItems(data.queue.items);
      setTotal(data.queue.total);
      setQuality(data.quality);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "검수함을 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => { void load(null); }, 0);
    return () => window.clearTimeout(initial);
  }, [load]);

  async function labelMention(item: Item, brandMentioned: boolean) {
    setBusyId(item.resultId);
    setError("");
    try {
      await request("/api/review/mentions", postJson({ resultId: item.resultId, brandMentioned }));
      await load(mode);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "저장하지 못했습니다.");
    } finally {
      setBusyId(null);
    }
  }

  async function saveClaim(claimId: number, fallback: Verdict) {
    try {
      await request("/api/review/claims", postJson({ claimId, verdict: verdicts[claimId] ?? fallback }));
      await load(mode);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "저장하지 못했습니다.");
    }
  }

  if (!mode || !quality) return <div className="grid min-h-96 place-items-center"><LoaderCircle className="h-7 w-7 animate-spin text-cyan-400" /></div>;
  return (
    <div>
      <PageHeader eyebrow="Review inbox" title="검수함" description="자동 브랜드 식별과 사실 대조 결과를 사람이 확정합니다. 사람 판정은 측정 요약에 바로 반영되고, 자동 식별의 정밀도·재현율을 계산하는 근거가 됩니다." />
      {error && <p role="alert" className="mb-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-300">{error}</p>}
      <Card className="mb-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <dl className="grid grid-cols-3 gap-6 text-sm">
            <div><dt className="text-xs text-slate-500">검수 표본</dt><dd className="text-xl text-white">{quality.sampleCount}<span className="text-xs text-slate-500"> / {quality.thresholds.minSamples}</span></dd></div>
            <div><dt className="text-xs text-slate-500">정밀도</dt><dd className="text-xl text-white">{pct(quality.precision)}<span className="text-xs text-slate-500"> ≥ {quality.thresholds.minPrecision * 100}%</span></dd></div>
            <div><dt className="text-xs text-slate-500">재현율</dt><dd className="text-xl text-white">{pct(quality.recall)}<span className="text-xs text-slate-500"> ≥ {quality.thresholds.minRecall * 100}%</span></dd></div>
          </dl>
          <div className="flex items-center gap-2" role="group" aria-label="검수 모드">
            <Button type="button" variant={mode === "all" ? "primary" : "secondary"} onClick={() => void load("all")}>전수 검수</Button>
            <Button type="button" variant={mode === "exceptions" ? "primary" : "secondary"} onClick={() => void load("exceptions")}>예외만</Button>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">{quality.exceptionModeEligible ? "기준을 충족해 예외(모호 별칭·사실 충돌)만 검수해도 됩니다." : "표본·정밀도·재현율 기준을 모두 충족하기 전까지는 전수 검수를 권장합니다. 리포트 근거로 쓰는 답변은 모드와 관계없이 확인하세요."}</p>
      </Card>
      <p className="mb-3 text-sm text-slate-400">대기 {total}건{total > items.length ? ` · 앞쪽 ${items.length}건 표시` : ""}</p>
      {items.length === 0 ? <EmptyState>검수할 항목이 없습니다.</EmptyState> : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.resultId}>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge>{item.provider}</Badge><span className="text-slate-500">측정 #{item.runId}</span>
                {item.reasons.map((reason) => <Badge key={reason} tone="warn">{reasonLabels[reason] ?? reason}</Badge>)}
                <Badge tone={item.brandMentioned ? "good" : "default"}>자동 판정: {item.brandMentioned ? "언급" : "미언급"}</Badge>
              </div>
              <p className="mt-2 text-sm font-medium text-slate-200">{item.question}</p>
              <div className="mt-2 max-h-64 overflow-auto rounded-xl bg-slate-950/40 p-3"><Highlighted text={item.response} spans={item.matchedSpans} /></div>
              {item.claims.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {item.claims.map((claim) => (
                    <li key={claim.id} className="flex flex-col gap-2 rounded-xl border border-white/8 p-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-slate-300">{claim.claimText || `${claim.attribute} ${claim.value}${claim.unit ?? ""}`}</span>
                      <span className="flex items-center gap-2">
                        <select aria-label="주장 판정" value={verdicts[claim.id] ?? claim.verdict} onChange={(event) => setVerdicts({ ...verdicts, [claim.id]: event.target.value as Verdict })}>
                          {(Object.keys(verdictLabels) as Verdict[]).map((verdict) => <option key={verdict} value={verdict}>{verdictLabels[verdict]}</option>)}
                        </select>
                        <Button type="button" variant="secondary" onClick={() => void saveClaim(claim.id, claim.verdict)}>판정 확정</Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" disabled={busyId === item.resultId} onClick={() => void labelMention(item, true)}><Check className="h-4 w-4" />브랜드 언급 맞음</Button>
                <Button type="button" variant="secondary" disabled={busyId === item.resultId} onClick={() => void labelMention(item, false)}><X className="h-4 w-4" />언급 아님</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
