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

  return <div>
    <PageHeader eyebrow="Site intelligence" title="GEO 진단" description="사이트의 SEO 기반, AI 친화 구조, 신뢰 신호와 크롤러 접근성을 32개 통합 항목으로 점검합니다." />
    <Card className="border-cyan-400/10">
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-[0.7fr_1.3fr_auto]">
        <label className="sr-only" htmlFor="audit-title">진단 제목</label>
        <input id="audit-title" maxLength={120} value={title} onChange={(event) => { setTitle(event.target.value); requestId.current = null; }} placeholder="진단 제목 (선택)" />
        <label className="sr-only" htmlFor="audit-url">진단 URL</label>
        <input id="audit-url" type="url" required value={url} onChange={(event) => { setUrl(event.target.value); requestId.current = null; }} placeholder="https://example.com/article" />
        <Button disabled={loading} className="md:min-w-36">{loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />}{loading ? "수집 중" : "진단 시작"}</Button>
      </form>
      <details className="mt-4"><summary className="cursor-pointer text-xs font-semibold text-slate-400">자동 확인할 수 없는 7개 항목 사전 체크</summary><div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{manualRules.map(([code, label]) => <label key={code} className="flex cursor-pointer items-center gap-2 rounded-lg bg-slate-950/40 p-2.5 text-xs"><input type="checkbox" checked={Boolean(manual[code])} onChange={(e) => { setManual((state) => ({ ...state, [code]: e.target.checked })); requestId.current = null; }} />{label}</label>)}</div></details>
      <p className="mt-4 flex items-center gap-2 text-xs text-slate-500"><AlertTriangle className="h-3.5 w-3.5 text-amber-400" />외부 사이트에 진단 요청을 보냅니다. 사설망·로컬 주소와 2MB 초과 문서는 차단됩니다.</p>
      {error && <p role="alert" className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-300">{error}</p>}
    </Card>

    {audit && <section className="mt-6 grid gap-5 xl:grid-cols-[0.65fr_1.35fr]">
      <div className="space-y-5"><Card className="text-center"><h2 className="mb-4 truncate font-semibold text-white">{audit.title || "진단 결과"}</h2><div className="mx-auto grid h-36 w-36 place-items-center rounded-full border-8 border-cyan-400/20 bg-cyan-400/5"><div><strong className="block text-4xl text-white">{audit.score}</strong><span className="text-xs text-slate-500">/ {audit.total}</span></div></div><Badge tone={audit.score >= 25 ? "good" : audit.score < 20 ? "bad" : "warn"} className="mt-4">{audit.grade}</Badge><Progress value={(audit.score / audit.total) * 100} className="mt-5" /><p className="mt-3 break-all text-xs text-slate-500">{audit.metadata.finalUrl ?? audit.url}</p>{audit.notes && <p className="mt-3 rounded-xl bg-slate-950/40 p-3 text-left text-xs leading-5 text-slate-400">{audit.notes}</p>}</Card>
      <Card><h2 className="font-semibold text-white">우선 개선 권고</h2><ol className="mt-4 space-y-3">{(audit.metadata.recommendations ?? []).map((text, index) => <li key={text} className="flex gap-3 text-sm leading-5 text-slate-400"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-violet-400/10 text-[10px] font-bold text-violet-300">{index + 1}</span>{text}</li>)}</ol></Card></div>
      <div className="space-y-4">{Object.entries(grouped).map(([category, items]) => <Card key={category}><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold text-white">{category}</h2><Badge>{items?.filter((item) => item.passed).length}/{items?.length}</Badge></div><div className="divide-y divide-white/5">{items?.map((item) => <div key={item.code} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center"><div className="flex gap-3">{item.passed ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> : <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />}<div><p className="text-sm font-medium text-slate-200">{item.label} {item.manual && <span className="ml-1 text-[10px] text-violet-300">수동</span>}</p><p className="mt-1 text-xs text-slate-500">{item.detail}</p>{!item.passed && <p className="mt-1.5 text-xs text-amber-300/80">{item.recommendation}</p>}</div></div></div>)}</div></Card>)}</div>
    </section>}

    <AuditHistoryPanel onSelect={setAudit} />
  </div>;
}
