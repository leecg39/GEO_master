"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, LoaderCircle, SearchCheck, X } from "lucide-react";
import { AuditHistoryPanel, notifyAuditChanged, type AuditResource } from "@/components/AuditHistoryPanel";
import { Badge, Button, Card, PageHeader, Progress } from "@/components/ui";

const manualRules = [
  ["geo-search-intent", "검색 의도가 명확하다"], ["geo-journey", "구매 여정을 반영했다"],
  ["brand-definition", "채널별 브랜드 정의가 일치한다"], ["brand-authority", "권위 엔티티 연결 근거가 있다"],
  ["brand-multilingual", "영문 맥락 자료가 있다"], ["brand-triggers", "추천 조건에 근거가 있다"],
  ["brand-source-diversity", "공식·언론·학술·커뮤니티 소스를 확보했다"],
] as const;

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "요청에 실패했습니다.");
  return body;
}

export function AuditClient() {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const [audit, setAudit] = useState<AuditResource | null>(null);
  const requestId = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const grouped = useMemo(() => audit ? Object.groupBy(audit.items, (item) => item.category) : {}, [audit]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      requestId.current ??= crypto.randomUUID();
      const data = await responseJson<{ audit: AuditResource }>(await fetch("/api/audits", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, title, manualOverrides: manual, clientRequestId: requestId.current }),
      }));
      setAudit(data.audit);
      requestId.current = null;
      notifyAuditChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "진단에 실패했습니다."); }
    finally { setLoading(false); }
  }

  const executiveSummary = (audit?.metadata.executiveSummary as string) || audit?.notes || "";
  const engineMode = (audit?.metadata.engineMode as string) || "ai-engine";

  return <div className="space-y-6">
    <PageHeader eyebrow="Site intelligence" title="GEO 진단" description="사이트의 SEO 기반, AI 친화 구조, 신뢰 신호와 크롤러 접근성을 32개 통합 항목과 AI 엔진으로 정밀 분석합니다." />
    <Card className="border-cyan-400/20 bg-slate-900/80 p-6 sm:p-7">
      <form onSubmit={submit} className="grid gap-3.5 md:grid-cols-[0.8fr_1.4fr_auto]">
        <label className="sr-only" htmlFor="audit-title">진단 제목</label>
        <input id="audit-title" maxLength={120} value={title} onChange={(event) => { setTitle(event.target.value); requestId.current = null; }} placeholder="진단 제목 (선택, 미입력 시 페이지 제목 자동 적용)" className="min-h-12 rounded-xl border border-white/10 bg-slate-950/60 px-4 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none" />
        <label className="sr-only" htmlFor="audit-url">진단 URL</label>
        <input id="audit-url" type="url" required value={url} onChange={(event) => { setUrl(event.target.value); requestId.current = null; }} placeholder="https://example.com/article" className="min-h-12 rounded-xl border border-white/10 bg-slate-950/60 px-4 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none" />
        <Button disabled={loading} className="min-h-12 px-6 text-sm font-bold md:min-w-40">{loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />}{loading ? "GEO 엔진 분석 중…" : "진단 시작"}</Button>
      </form>
      <details className="mt-4"><summary className="cursor-pointer text-xs font-semibold text-slate-400 hover:text-slate-200">수동 사전 체크 (선택 사항 · 미체크 시 GEO 엔진이 본문 기반으로 자동 분석합니다)</summary><div className="mt-3.5 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">{manualRules.map(([code, label]) => <label key={code} className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-white/5 bg-slate-950/50 p-3 text-xs text-slate-300 transition hover:bg-slate-950/80"><input type="checkbox" checked={Boolean(manual[code])} onChange={(e) => { setManual((state) => ({ ...state, [code]: e.target.checked })); requestId.current = null; }} className="rounded" />{label}</label>)}</div></details>
      <p className="mt-4 flex items-center gap-2 text-xs text-slate-500"><AlertTriangle className="h-3.5 w-3.5 text-amber-400" />외부 사이트에 실시간 진단 요청을 보냅니다. 사설망·로컬 주소와 2MB 초과 문서는 차단됩니다.</p>
      {error && <p role="alert" className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-300">{error}</p>}
    </Card>

    {audit && <section className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <Card className="flex flex-col justify-between text-center p-6 sm:p-7">
          <div>
            <div className="flex items-center justify-between gap-2 border-b border-white/5 pb-4">
              <Badge tone={audit.score >= 25 ? "good" : audit.score < 20 ? "bad" : "warn"}>{audit.grade}</Badge>
              <span className="text-xs text-slate-400">{engineMode === "ai-engine" ? "🤖 AI 엔진 정밀 분석" : "⚡ GEO 시맨틱 분석"}</span>
            </div>
            <h2 className="mt-4 truncate text-lg sm:text-xl font-bold text-white">{audit.title || "진단 결과"}</h2>
            <div className="mx-auto my-6 grid h-40 w-40 place-items-center rounded-full border-8 border-cyan-400/20 bg-cyan-400/5 shadow-inner">
              <div><strong className="block text-5xl font-black text-white">{audit.score}</strong><span className="text-xs font-semibold text-slate-500">/ {audit.total}</span></div>
            </div>
            <Progress value={(audit.score / audit.total) * 100} className="h-2.5" />
          </div>
          <p className="mt-4 break-all text-xs font-mono text-slate-500">{audit.metadata.finalUrl ?? audit.url}</p>
        </Card>

        <Card className="flex flex-col justify-between p-6 sm:p-7">
          <div>
            <div className="flex items-center justify-between gap-2 border-b border-white/5 pb-3.5">
              <h2 className="text-base sm:text-lg font-bold text-white">AI GEO 종합 진단 & 인사이트</h2>
              <Badge tone="cyan">Executive Summary</Badge>
            </div>
            {executiveSummary ? (
              <div className="mt-4 rounded-xl border border-cyan-400/15 bg-cyan-400/[0.04] p-4 text-xs sm:text-sm leading-relaxed text-slate-200">
                {executiveSummary}
              </div>
            ) : null}
            <div className="mt-5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">맞춤형 우선 개선 권고</h3>
              <ol className="mt-3 space-y-2.5">
                {(audit.metadata.recommendations ?? []).map((text, index) => (
                  <li key={text} className="flex items-start gap-3 text-xs sm:text-sm leading-relaxed text-slate-300">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-violet-400/20 text-xs font-bold text-violet-300">{index + 1}</span>
                    <span className="flex-1">{text}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
          {Array.isArray(audit.metadata.schemas) && audit.metadata.schemas.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-white/5 pt-3.5">
              <span className="text-xs text-slate-500">감지된 스키마:</span>
              {audit.metadata.schemas.map((s) => (
                <span key={String(s)} className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-cyan-300 font-mono">{String(s)}</span>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="space-y-5">
        <h2 className="text-lg font-bold text-white">32개 GEO 세부 평가 항목</h2>
        <div className="grid gap-5 xl:grid-cols-2">
          {Object.entries(grouped).map(([category, items]) => (
            <Card key={category} className="p-6">
              <div className="mb-4 flex items-center justify-between border-b border-white/5 pb-3">
                <h3 className="font-bold text-white text-base">{category}</h3>
                <Badge tone={items?.every(i => i.passed) ? "good" : "default"}>
                  {items?.filter((item) => item.passed).length} / {items?.length} 통과
                </Badge>
              </div>
              <div className="divide-y divide-white/5">
                {items?.map((item) => (
                  <div key={item.code} className="py-3.5">
                    <div className="flex items-start gap-3">
                      {item.passed ? (
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      ) : (
                        <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-slate-200">{item.label}</p>
                          {item.manual ? (
                            <span className="rounded bg-violet-400/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-300">GEO 엔진 분석</span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-slate-400">{item.detail}</p>
                        {!item.passed && (
                          <p className="mt-1.5 rounded-lg bg-amber-400/[0.06] p-2 text-xs leading-relaxed text-amber-300/90">
                            💡 {item.recommendation}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </section>}

    <AuditHistoryPanel onSelect={setAudit} />
  </div>;
}
