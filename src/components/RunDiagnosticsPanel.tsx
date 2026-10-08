"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";

type Provider = "openai" | "anthropic" | "gemini" | "grok";
type Verdict = "pass" | "issue" | "insufficient";
type ClaimVerdict = "match" | "conflict" | "insufficient" | "time_unknown" | "needs_review";

interface Diagnostics {
  cards: { card: string; verdict: Verdict; rationale: string }[];
  claims: {
    id: number; claimText: string; attribute: string; value: string; unit: string | null; verdict: ClaimVerdict;
    fact: { attribute: string; value: string; unit: string | null; status: string; sourceUrl: string | null } | null;
  }[];
}

const verdictBadge: Record<Verdict, { label: string; tone: "good" | "bad" | "default" }> = {
  pass: { label: "통과", tone: "good" },
  issue: { label: "문제", tone: "bad" },
  insufficient: { label: "자료 부족", tone: "default" },
};
const claimBadge: Record<ClaimVerdict, { label: string; tone: "good" | "bad" | "warn" | "default" }> = {
  match: { label: "일치", tone: "good" },
  conflict: { label: "충돌", tone: "bad" },
  insufficient: { label: "근거 부족", tone: "default" },
  time_unknown: { label: "시점 불명", tone: "warn" },
  needs_review: { label: "검토 필요", tone: "warn" },
};
const providerLabels: Record<Provider, string> = { openai: "GPT", anthropic: "Claude", gemini: "Gemini", grok: "Grok" };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "요청을 처리하지 못했습니다.");
  return body;
}

export function RunDiagnosticsPanel({ runId, providers, className }: { runId: number; providers: Provider[]; className?: string }) {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [provider, setProvider] = useState<Provider | "">(providers[0] ?? "");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      setData((await request<{ diagnostics: Diagnostics }>(`/api/measure-runs/${runId}/diagnostics`)).diagnostics);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "진단을 불러오지 못했습니다.");
    }
  }, [runId]);

  useEffect(() => {
    const initial = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(initial);
  }, [load]);

  async function runCheck() {
    if (!provider || running) return;
    setRunning(true);
    setError("");
    setNotice("");
    try {
      const { check } = await request<{ check: { checkedResults: number; extractionFailed: number } }>(`/api/measure-runs/${runId}/claims`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      setNotice(`브랜드 언급 답변 ${check.checkedResults}개를 대조했습니다${check.extractionFailed ? ` (추출 실패 ${check.extractionFailed}개)` : ""}.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "사실 대조에 실패했습니다.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card className={className}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-semibold text-white">진단 카드 · 사실 대조</h2>
          <p className="mt-1 text-xs text-slate-500">답변 속 수치·가격·기간 주장을 사실 메모와 비교합니다. 근거가 부족하면 판정하지 않고 &quot;자료 부족&quot;으로 둡니다.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 print:hidden">
          <select aria-label="대조에 사용할 모델" value={provider} onChange={(event) => setProvider(event.target.value as Provider)} disabled={!providers.length}>
            {providers.length ? providers.map((item) => <option key={item} value={item}>{providerLabels[item]}</option>) : <option value="">API 키 없음</option>}
          </select>
          <Button type="button" variant="secondary" disabled={!provider || running} onClick={() => void runCheck()}>
            {running ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}사실 대조 실행
          </Button>
        </div>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
      {notice && <p role="status" className="mt-3 text-sm text-emerald-300">{notice}</p>}
      {data && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {data.cards.map((card) => (
              <div key={card.card} className="rounded-xl bg-slate-950/40 p-3">
                <div className="flex items-center justify-between"><strong className="text-white">{card.card}</strong><Badge tone={verdictBadge[card.verdict].tone}>{verdictBadge[card.verdict].label}</Badge></div>
                <p className="mt-2 text-xs text-slate-500">{card.rationale}</p>
              </div>
            ))}
          </div>
          {data.claims.length > 0 && (
            <ul className="mt-4 divide-y divide-white/5 text-sm">
              {data.claims.map((claim) => (
                <li key={claim.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-slate-300">{claim.claimText || `${claim.attribute} ${claim.value}${claim.unit ? ` ${claim.unit}` : ""}`}</p>
                    <p className="text-xs text-slate-500">
                      주장: {claim.attribute} {claim.value}{claim.unit ? ` ${claim.unit}` : ""}
                      {claim.fact && <> · 사실 메모: {claim.fact.value}{claim.fact.unit ? ` ${claim.fact.unit}` : ""}</>}
                    </p>
                  </div>
                  <Badge tone={claimBadge[claim.verdict].tone} className="shrink-0">{claimBadge[claim.verdict].label}</Badge>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
