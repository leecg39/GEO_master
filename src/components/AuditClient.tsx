"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronRight, History, LoaderCircle, SearchCheck, X } from "lucide-react";
import { Badge, Button, Card, EmptyState, PageHeader, Progress } from "@/components/ui";
import { formatDate } from "@/lib/utils";

interface AuditItem { code: string; category: string; label: string; passed: boolean; manual: boolean; detail: string; recommendation: string }
interface AuditResult { id: number; url: string; score: number; total: number; grade: string; items: AuditItem[]; createdAt: string; metadata: { recommendations?: string[]; finalUrl?: string } }
interface AuditHistory { id: number; url: string; score: number; grade: string; createdAt: string; items: AuditItem[] }

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
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const [history, setHistory] = useState<AuditHistory[]>([]);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { void (async () => {
    try { const data = await responseJson<{ audits: AuditHistory[] }>(await fetch("/api/audits")); setHistory(data.audits); }
    catch { /* 첫 진단 전에는 빈 이력을 표시한다. */ }
  })(); }, []);

  const grouped = useMemo(() => audit ? Object.groupBy(audit.items, (item) => item.category) : {}, [audit]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const data = await responseJson<{ audit: AuditResult }>(await fetch("/api/audits", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, manualOverrides: manual }),
      }));
      setAudit(data.audit);
      setHistory((items) => [data.audit, ...items].slice(0, 20));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "진단에 실패했습니다."); }
    finally { setLoading(false); }
  }

  return <div>
    <PageHeader eyebrow="Site intelligence" title="GEO 진단" description="사이트의 SEO 기반, AI 친화 구조, 신뢰 신호와 크롤러 접근성을 32개 통합 항목으로 점검합니다." />
    <Card className="border-cyan-400/10">
      <form onSubmit={submit} className="flex flex-col gap-3 md:flex-row">
        <label className="sr-only" htmlFor="audit-url">진단 URL</label>
        <input id="audit-url" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/article" className="flex-1" />
        <Button disabled={loading} className="md:min-w-36">{loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />}{loading ? "수집 중" : "진단 시작"}</Button>
      </form>
      <details className="mt-4"><summary className="cursor-pointer text-xs font-semibold text-slate-400">자동 확인할 수 없는 7개 항목 사전 체크</summary><div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{manualRules.map(([code, label]) => <label key={code} className="flex cursor-pointer items-center gap-2 rounded-lg bg-slate-950/40 p-2.5 text-xs"><input type="checkbox" checked={Boolean(manual[code])} onChange={(e) => setManual((state) => ({ ...state, [code]: e.target.checked }))} />{label}</label>)}</div></details>
      <p className="mt-4 flex items-center gap-2 text-xs text-slate-500"><AlertTriangle className="h-3.5 w-3.5 text-amber-400" />외부 사이트에 진단 요청을 보냅니다. 사설망·로컬 주소와 2MB 초과 문서는 차단됩니다.</p>
      {error && <p role="alert" className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-300">{error}</p>}
    </Card>

    {audit && <section className="mt-6 grid gap-5 xl:grid-cols-[0.65fr_1.35fr]">
      <div className="space-y-5"><Card className="text-center"><div className="mx-auto grid h-36 w-36 place-items-center rounded-full border-8 border-cyan-400/20 bg-cyan-400/5"><div><strong className="block text-4xl text-white">{audit.score}</strong><span className="text-xs text-slate-500">/ {audit.total}</span></div></div><Badge tone={audit.score >= 25 ? "good" : audit.score < 20 ? "bad" : "warn"} className="mt-4">{audit.grade}</Badge><Progress value={(audit.score / audit.total) * 100} className="mt-5" /><p className="mt-3 break-all text-xs text-slate-500">{audit.metadata.finalUrl ?? audit.url}</p></Card>
      <Card><h2 className="font-semibold text-white">우선 개선 권고</h2><ol className="mt-4 space-y-3">{(audit.metadata.recommendations ?? []).map((text, index) => <li key={text} className="flex gap-3 text-sm leading-5 text-slate-400"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-violet-400/10 text-[10px] font-bold text-violet-300">{index + 1}</span>{text}</li>)}</ol></Card></div>
      <div className="space-y-4">{Object.entries(grouped).map(([category, items]) => <Card key={category}><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold text-white">{category}</h2><Badge>{items?.filter((item) => item.passed).length}/{items?.length}</Badge></div><div className="divide-y divide-white/5">{items?.map((item) => <div key={item.code} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center"><div className="flex gap-3">{item.passed ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> : <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />}<div><p className="text-sm font-medium text-slate-200">{item.label} {item.manual && <span className="ml-1 text-[10px] text-violet-300">수동</span>}</p><p className="mt-1 text-xs text-slate-500">{item.detail}</p>{!item.passed && <p className="mt-1.5 text-xs text-amber-300/80">{item.recommendation}</p>}</div></div></div>)}</div></Card>)}</div>
    </section>}

    <Card className="mt-6"><div className="mb-4 flex items-center gap-2"><History className="h-4 w-4 text-slate-400" /><h2 className="font-semibold text-white">진단 이력</h2></div>{history.length ? <div className="divide-y divide-white/5">{history.map((item) => <div key={item.id} className="flex items-center gap-3 py-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-800 text-sm font-bold text-white">{item.score}</div><div className="min-w-0 flex-1"><p className="truncate text-sm text-slate-300">{item.url}</p><p className="text-xs text-slate-600">{formatDate(item.createdAt)}</p></div><Badge tone={item.score >= 25 ? "good" : item.score < 20 ? "bad" : "warn"}>{item.grade}</Badge><ChevronRight className="h-4 w-4 text-slate-700" /></div>)}</div> : <EmptyState>아직 저장된 진단이 없습니다.</EmptyState>}</Card>
  </div>;
}
