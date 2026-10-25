"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw, Target } from "lucide-react";
import { Badge, Button, Card, EmptyState, PageHeader } from "./ui";
import { ConfirmDialog } from "./CrudPrimitives";
import { haloApi, safeExternalUrl, formatHaloTime } from "./halo-api";
import type { Opportunity, OpportunityEvidence, getOpportunity } from "@/lib/opportunities";

type Detail = ReturnType<typeof getOpportunity>;
export interface OpportunityOptions { questionSets: { id: number; name: string }[]; runs: { id: number; title: string; at: string }[] }
const kinds = { competitor_gap: "경쟁사 언급 기회", citation_gap: "자사 인용 기회", unmeasured: "측정 필요" };
const statuses = { pending: "검토 대기", dismissed: "보류", accepted: "채택" };
const actions: Record<string, string> = { created: "후보 등록", accepted: "채택", pending: "검토 재개", dismissed: "보류", updated: "기록 수정" };
function percent(n: number, d: number) { return d ? `${Math.round(n / d * 1000) / 10}% (${n}/${d})` : "미측정"; }
function Metric({ evidence }: { evidence: OpportunityEvidence }) {
  return <dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-slate-400">자사 언급률</dt><dd>{percent(evidence.mentions, evidence.succeeded)}</dd></div><div><dt className="text-slate-400">자사 인용률</dt><dd>{percent(evidence.ownCited, evidence.citationEligible)}</dd></div><div><dt className="text-slate-400">정상 / 실패 / 거절</dt><dd>{evidence.succeeded} / {evidence.failed} / {evidence.refused}</dd></div></dl>;
}
export function OpportunitiesClient({ projectId, initialItems, options }: { projectId: number; initialItems: Opportunity[]; options: OpportunityOptions }) {
  const [currentOptions, setOptions] = useState(options);
  const [items, setItems] = useState(initialItems), [detail, setDetail] = useState<Detail | null>(null);
  const [filter, setFilter] = useState("all"), [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [question, setQuestion] = useState(""), [notes, setNotes] = useState("");
  const [questionSetId, setQuestionSetId] = useState(String(options.questionSets[0]?.id ?? ""));
  const [appliedUrl, setAppliedUrl] = useState(""), [appliedAt, setAppliedAt] = useState(""), [followupRunId, setFollowupRunId] = useState("");
  const [deleting, setDeleting] = useState(false);
  const selection = useRef(0);
  function show(item: Detail) { setDetail(item); setNotes(item.notes); setAppliedUrl(item.appliedUrl); setAppliedAt(item.appliedAt); setFollowupRunId(item.followupRunId ? String(item.followupRunId) : item.followupEvidence ? "detached" : ""); }
  async function select(id: number) {
    const request = ++selection.current; setError(""); setBusy(true);
    try { const data = await haloApi<{ item: Detail }>(`/api/opportunities/${id}`, projectId); if (request === selection.current) show(data.item); }
    catch (cause) { if (request === selection.current) setError(cause instanceof Error ? cause.message : "조회 실패"); }
    finally { if (request === selection.current) setBusy(false); }
  }
  async function mutate(path: string, method: string, payload: unknown, selectResult = true) {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await haloApi<{ item?: Detail } | undefined>(path, projectId, method, payload);
      const list = await haloApi<{ items: Opportunity[] } & OpportunityOptions>("/api/opportunities", projectId); setItems(list.items); setOptions(list);
      if (selectResult && result?.item) await select(result.item.id);
      setMessage("저장했습니다."); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "처리 실패"); return false; }
    finally { setBusy(false); }
  }
  const visible = items.filter(item => (filter === "all" || item.status === filter) && item.question.toLowerCase().includes(query.toLowerCase()));
  return <div>
    <PageHeader eyebrow="OPPORTUNITIES" title="기회 발굴" description="저장된 AI 답변에서 개선할 질문을 찾고, 콘텐츠와 후속 측정을 연결합니다. 후보 갱신과 채택에는 외부 API 비용이 발생하지 않습니다." action={<Button disabled={busy} onClick={() => void mutate("/api/opportunities/refresh", "POST", {}, false)}><RefreshCw className="h-4 w-4" />후보 갱신</Button>} />
    {error && <p role="alert" className="mb-4 text-rose-300">{error} {detail && <button className="underline" onClick={() => void select(detail.id)}>최신 항목 다시 읽기</button>}</p>}
    {message && <p role="status" className="mb-4 text-emerald-300">{message}</p>}
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <Card><div className="mb-4 flex flex-wrap gap-2"><input aria-label="기회 질문 검색" placeholder="질문 검색" value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="후보 상태 필터" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">모든 상태</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <p className="mb-3 text-sm text-slate-400">{visible.length}개 · 기록된 시점의 근거를 표시합니다.</p>
        {!visible.length && <EmptyState>저장된 후보가 없습니다. 측정 후 후보를 갱신하거나 질문을 직접 등록하세요.</EmptyState>}
        <ul className="space-y-3">{visible.map(item => <li key={item.id}><button disabled={busy} onClick={() => void select(item.id)} className={`w-full rounded-xl border p-4 text-left ${detail?.id === item.id ? "border-cyan-400/50 bg-cyan-400/5" : "border-white/10"}`}><div className="mb-2 flex flex-wrap gap-2"><Badge>{kinds[item.kind]}</Badge><Badge tone={item.status === "accepted" ? "good" : "default"}>{statuses[item.status]}</Badge></div><span className="block break-words font-medium">{item.question}</span><span className="mt-2 block text-xs text-slate-400">{item.evidence.measuredAt ? formatHaloTime(item.evidence.measuredAt) : "정상 측정 자료 필요"}</span></button></li>)}</ul>
        <form className="mt-6 space-y-3 border-t border-white/10 pt-4" onSubmit={async e => { e.preventDefault(); if (await mutate("/api/opportunities", "POST", { question })) setQuestion(""); }}>
          <label className="block text-sm">질문 직접 등록<textarea rows={3} required minLength={5} maxLength={500} value={question} onChange={e => setQuestion(e.target.value)} className="mt-2" /></label><Button disabled={busy}>측정 필요 후보로 등록</Button>
        </form>
      </Card>
      <Card>{!detail ? <EmptyState><Target className="mr-2 h-5 w-5" />후보를 선택하면 응답 근거와 실행 이력이 표시됩니다.</EmptyState> : <div className="space-y-5">
        <div><Badge tone="cyan">{kinds[detail.kind]}</Badge><h2 className="mt-3 break-words text-xl font-semibold">{detail.question}</h2><p className="mt-2 text-sm text-slate-400">판정 기준 브랜드: {detail.evidence.brand.brandName || "미설정"} · 기준 실행 {detail.baselineRunId ? `#${detail.baselineRunId}` : "없음"}</p></div>
        {detail.sourceMissing && <p role="status" className="text-amber-300">원본 연결이 해제되었습니다. 아래 내용은 후보 생성 당시 보존한 근거입니다.</p>}
        {detail.followupSourceMissing && <p role="status" className="text-amber-300">후속 측정 원본 연결이 해제되었습니다. 마지막으로 연결한 측정 근거는 보존되며 전후 비교는 중단됩니다.</p>}
        <Metric evidence={detail.evidence} />
        <details className="rounded-xl border border-white/10 p-4"><summary className="cursor-pointer font-medium">응답 원문·인용 근거 ({detail.evidence.samples.length})</summary><div className="mt-4 space-y-4">{detail.evidence.samples.map((sample, index) => <article key={index} className="border-t border-white/10 pt-3"><h3 className="break-words text-sm font-semibold">{sample.provider} · {sample.model} · {sample.status}</h3><p className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm">{sample.response || "응답 없음"}</p><ul className="mt-2 space-y-1">{sample.citations.map((citation, i) => <li key={i} className="break-all text-xs">{safeExternalUrl(citation.url) ? <a target="_blank" rel="noopener noreferrer" href={safeExternalUrl(citation.url)} className="underline">{citation.url}</a> : citation.url} · {citation.kind} · {citation.category}</li>)}</ul></article>)}</div></details>
        <fieldset disabled={busy} className="space-y-3"><label className="block text-sm">판단 메모<textarea rows={3} maxLength={5000} value={notes} onChange={e => setNotes(e.target.value)} className="mt-2" /></label><Button variant="secondary" onClick={() => void mutate(`/api/opportunities/${detail.id}`, "PATCH", { expectedUpdatedAt: detail.updatedAt, notes })}>메모 저장</Button>
          {detail.status !== "accepted" && <><label className="block text-sm">새 질문을 등록할 세트<select className="mt-2" value={questionSetId} onChange={e => setQuestionSetId(e.target.value)}><option value="">선택하세요</option>{currentOptions.questionSets.map(set => <option key={set.id} value={set.id}>{set.name}</option>)}</select></label><p className="text-xs text-slate-400">기존 질문이 있으면 해당 질문을 연결합니다. 세트는 <Link href="/monitoring" className="underline">모니터링</Link>에서 관리합니다.</p><div className="flex flex-wrap gap-2"><Button disabled={detail.status !== "pending"} onClick={() => void mutate(`/api/opportunities/${detail.id}/adopt`, "POST", { expectedUpdatedAt: detail.updatedAt, ...(questionSetId ? { questionSetId: Number(questionSetId) } : {}) })}>채택·전략 과제 연결</Button><Button variant="secondary" onClick={() => void mutate(`/api/opportunities/${detail.id}`, "PATCH", { expectedUpdatedAt: detail.updatedAt, status: detail.status === "pending" ? "dismissed" : "pending", notes })}>{detail.status === "pending" ? "보류" : "검토 재개"}</Button></div></>}
        </fieldset>
        {detail.status === "accepted" && <section className="space-y-4 border-t border-white/10 pt-4">
          <div className="flex flex-wrap gap-4 text-sm"><Link className="underline" href={`/studio?opportunityId=${detail.id}`}>이 기회로 콘텐츠 작성</Link><Link className="underline" href="/strategy">전략 과제 {detail.strategyId ? `#${detail.strategyId}` : "연결 해제"}</Link><Link className="underline" href="/share">재측정 실행</Link></div>
          <div><h3 className="mb-2 font-semibold">연결된 콘텐츠</h3>{!detail.contents.length && <p className="text-sm text-slate-400">아직 생성된 콘텐츠가 없습니다.</p>}<ul className="space-y-2">{detail.contents.map(content => <li key={content.id} className="text-sm"><Link className="underline" href={`/studio?contentId=${content.id}`}>{content.title || `콘텐츠 #${content.id}`}</Link> · {content.status}</li>)}</ul></div>
          <form onSubmit={e => { e.preventDefault(); void mutate(`/api/opportunities/${detail.id}`, "PATCH", { expectedUpdatedAt: detail.updatedAt, appliedUrl, appliedAt, ...(followupRunId === "detached" ? {} : { followupRunId: followupRunId ? Number(followupRunId) : null }) }); }}><fieldset disabled={busy} className="space-y-3">
            <h3 className="font-semibold">수동 반영·후속 측정</h3><p className="text-sm text-slate-400">본문 반영 후 URL과 날짜를 기록하세요. 저장은 외부 사이트를 변경하지 않습니다.</p>
            <label className="block text-sm">반영 URL<input type="url" className="mt-2" value={appliedUrl} onChange={e => setAppliedUrl(e.target.value)} /></label><label className="block text-sm">반영일<input type="date" className="mt-2" value={appliedAt} onChange={e => setAppliedAt(e.target.value)} /></label>
            <label className="block text-sm">후속 측정<select className="mt-2" value={followupRunId} onChange={e => setFollowupRunId(e.target.value)}><option value="">연결 없음</option>{detail.followupSourceMissing && <option value="detached">삭제된 후속 측정 · 보존한 근거 유지</option>}{currentOptions.runs.filter(run => run.id !== detail.baselineRunId).map(run => <option key={run.id} value={run.id}>#{run.id} {run.title} · {run.at.slice(0, 10)}</option>)}</select></label><Button type="submit">반영·측정 기록 저장</Button>
          </fieldset></form>
          {detail.followup && <div className="rounded-xl border border-white/10 p-4"><h3 className="mb-3 font-semibold">후속 측정 결과</h3><Metric evidence={detail.followup} />{detail.comparison?.comparable && <p className="mt-3 text-sm">언급률 변화: {detail.comparison.mentionDelta === null ? "미측정" : `${detail.comparison.mentionDelta} %p`} · 인용률 변화: {detail.comparison.citationDelta === null ? "미측정" : `${detail.comparison.citationDelta} %p`}</p>}<p className="mt-3 text-sm">{detail.comparison?.comparable ? "기준 실행과 같은 측정 조건입니다." : "측정 조건이 같다고 확인할 수 없습니다."}</p>{detail.comparison?.differences.map(text => <p key={text} className="text-sm text-amber-300">{text}</p>)}<p className="mt-2 text-xs text-slate-400">전후 변화만으로 콘텐츠 수정의 효과를 단정할 수 없습니다.</p></div>}
        </section>}
        <details><summary className="cursor-pointer text-sm">판단 이력 ({detail.decisions.length})</summary><ul className="mt-3 space-y-2 text-xs text-slate-400">{detail.decisions.map(item => <li key={item.id}>{formatHaloTime(item.createdAt)} · {actions[item.action] ?? item.action} {item.notes}</li>)}</ul></details>
        <Button variant="danger" disabled={busy} onClick={() => setDeleting(true)}>기회 삭제</Button>
      </div>}</Card>
    </div>
    <ConfirmDialog open={deleting} title="기회 삭제" description="후보와 판단 이력을 삭제합니다. 이미 등록된 질문·전략 과제·콘텐츠는 유지됩니다." busy={busy} destructive onClose={() => setDeleting(false)} onConfirm={async () => { if (detail && await mutate(`/api/opportunities/${detail.id}`, "DELETE", { expectedUpdatedAt: detail.updatedAt }, false)) { setDeleting(false); setDetail(null); } else setDeleting(false); }} />
  </div>;
}
