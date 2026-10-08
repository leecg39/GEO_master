"use client";
import { useId, useState, type ReactNode } from "react";
import { ChevronDown, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui";
import type { MonitoringResponseItem, MonitoringResponseProvider, MonitoringSearchMode } from "@/lib/monitoring-types";
import { percent } from "./MonitoringCharts";
import { fieldClass } from "./MonitoringQuestionEditor";
import { useMonitoringResponses } from "./useMonitoringResponses";

const modes: Record<MonitoringSearchMode, string> = { off: "일반 응답", web: "웹검색 요청", unknown: "검색 조건 기록 없음" };
const kinds = { cited: "명시 인용", inline: "본문 URL", searched: "검색 결과" };
const categories: Record<string, string> = { own: "자사", competitor: "경쟁사", media: "미디어", community: "커뮤니티", marketplace: "플랫폼", public: "공공", other: "기타", unknown: "미분류" };
export function responseSearchLabel(item: MonitoringResponseItem, requested: "off" | "web" | null) {
  if (item.searchMode === "unknown") return "검색 조건 확인 불가";
  if (item.searchMode === "off") return requested === "web" ? "웹검색 요청 → 일반 응답으로 수집" : "일반 응답";
  if (item.searchPerformed === true) return "웹검색 수행 확인";
  return item.searchPerformed === false ? "웹검색 요청 · 수행 미확인" : "웹검색 요청 · 수행 여부 기록 없음";
}
export function HighlightedResponse({ item }: { item: MonitoringResponseItem }) {
  const content: ReactNode[] = [];
  let offset = 0;
  for (const mention of [...item.mentions].sort((a, b) => a.start - b.start)) {
    if (!Number.isInteger(mention.start) || !Number.isInteger(mention.end) || mention.start < offset || mention.end <= mention.start || mention.end > item.response.length) continue;
    content.push(item.response.slice(offset, mention.start));
    content.push(<mark key={`${mention.start}:${mention.end}`} title={`${mention.own ? "자사" : "등록 경쟁사"}: ${mention.name}`} className="rounded px-0.5" style={{ color: mention.own ? "var(--app-chart-current)" : "var(--app-chart-previous)", background: `color-mix(in srgb, ${mention.own ? "var(--app-chart-current)" : "var(--app-chart-previous)"} 14%, transparent)` }}>{item.response.slice(mention.start, mention.end)}</mark>);
    offset = mention.end;
  }
  content.push(item.response.slice(offset));
  return <p className="whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">{content}</p>;
}
function ResponseBody({ query, provider, requested }: { query: string; provider: MonitoringResponseProvider; requested: "off" | "web" | null }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([]);
  const [group, setGroup] = useState<MonitoringSearchMode>(provider.groups[0]?.searchMode ?? "unknown");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const params = new URLSearchParams(query);
  params.set("provider", provider.id); params.set("limit", "20");
  if (cursor) params.set("cursor", cursor);
  const { data, error, loading, retry } = useMonitoringResponses(params.toString());
  const items = data?.items.filter((item) => item.searchMode === group) ?? [];
  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  async function copy() {
    if (!selected) return;
    try { await navigator.clipboard.writeText(selected.response); setCopyMessage("원문을 복사했습니다."); }
    catch { setCopyMessage("복사하지 못했습니다. 원문을 선택해 복사해 주세요."); }
  }
  return <div className="border-t border-[color:var(--app-card-border)] p-4">
    {provider.groups.length > 1 && <label className="mb-3 block text-xs text-[color:var(--app-text-muted)]">응답 조건<select aria-label={`${provider.name} 응답 조건`} className={`${fieldClass} mt-1`} value={group} onChange={(event) => { setGroup(event.target.value as MonitoringSearchMode); setSelectedId(null); setCopyMessage(""); }}>
      {provider.groups.map((item) => <option key={item.searchMode} value={item.searchMode}>{modes[item.searchMode]} · {item.resultCount}개 응답</option>)}
    </select></label>}
    {loading ? <p role="status" className="py-5 text-sm text-[color:var(--app-text-muted)]">응답 원문을 불러오는 중입니다.</p> : error ? <div><p role="alert" className="mb-3 text-sm text-[color:var(--app-status-danger)]">{error}</p><Button variant="secondary" onClick={retry}>원문 다시 불러오기</Button></div> : <>
      {items.length > 1 && <label className="mb-3 block text-xs text-[color:var(--app-text-muted)]">반복 응답<select aria-label={`${provider.name} 반복 응답`} className={`${fieldClass} mt-1`} value={selected?.id ?? ""} onChange={(event) => { setSelectedId(Number(event.target.value)); setCopyMessage(""); }}>{items.map((item) => <option key={item.id} value={item.id}>반복 {item.repetition} · {item.model} · #{item.id}</option>)}</select></label>}
      {!selected ? <p className="text-sm text-[color:var(--app-text-muted)]">이 페이지에는 해당 조건의 원문이 없습니다. 다른 페이지를 확인해 주세요.</p> : <>
        <div className="mb-3 flex flex-wrap gap-2 text-xs text-[color:var(--app-text-muted)]"><span>반복 {selected.repetition}</span><span>{selected.slotStatus === "failed" ? "수집 실패" : selected.slotStatus === "refused" ? "응답 거절 · 집계 제외" : selected.mentions.some((item) => item.own) ? "자사 언급" : "자사 미언급"}</span></div>
        <p className="mb-3 break-words text-xs leading-6 text-[color:var(--app-text-muted)]">요청 모델: {selected.model}{selected.returnedModel && <><br />실제 응답 모델: {selected.returnedModel}</>}<br />{responseSearchLabel(selected, requested)}</p>
        {selected.response ? <HighlightedResponse item={selected} /> : <p className="rounded-lg bg-[color:var(--app-badge-bg)] p-3 text-sm text-[color:var(--app-text-muted)]">{selected.slotStatus === "failed" ? "수집에 실패해 저장된 원문이 없습니다." : "저장된 원문이 없습니다."}</p>}
        <div className="my-3 flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-[color:var(--app-text-muted)]">현재 브랜드 설정 기준 표시</span><Button variant="secondary" disabled={!selected.response} onClick={copy} aria-label={`${provider.name} 원문 복사`}><Copy className="h-3.5 w-3.5" />원문 복사</Button></div>
        {copyMessage && <p role="status" className="mb-3 text-xs text-[color:var(--app-text-muted)]">{copyMessage}</p>}
        <h4 className="mb-2 text-xs font-semibold">출처</h4>
        {selected.sources.length ? <ul className="space-y-3">{selected.sources.map((source) => <li key={source.id} className="min-w-0 border-t border-[color:var(--app-card-border)] pt-2 text-xs"><span className="text-[color:var(--app-text-muted)]">{kinds[source.kind]} · 저장 당시 분류: {categories[source.storedCategory] ?? "미분류"}</span><a href={source.url} target="_blank" rel="noopener noreferrer" className="mt-1 block break-words leading-6 text-[color:var(--app-chart-blue)] [overflow-wrap:anywhere]">{source.title || source.domain} <ExternalLink className="inline h-3 w-3" /><span className="sr-only"> (새 창)</span><span className="block text-[color:var(--app-text-muted)]">{source.url}</span></a></li>)}</ul> : <p className="text-xs text-[color:var(--app-text-muted)]">저장된 출처가 없습니다.</p>}
      </>}
      {(history.length > 0 || data?.page.hasMore) && <div className="mt-4 flex items-center justify-between gap-2"><Button variant="secondary" disabled={!history.length} onClick={() => { const previous = [...history]; setCursor(previous.pop() ?? null); setHistory(previous); setSelectedId(null); setCopyMessage(""); }}>이전 응답</Button><span className="text-xs">{history.length + 1}페이지</span><Button variant="secondary" disabled={!data?.page.hasMore} onClick={() => { setHistory([...history, cursor]); setCursor(data!.page.nextCursor); setSelectedId(null); setCopyMessage(""); }}>다음 응답</Button></div>}
    </>}
  </div>;
}
export function MonitoringModelResponseCard({ provider, query, requested, rawAnswerCount }: { provider: MonitoringResponseProvider; query: string; requested: "off" | "web" | null; rawAnswerCount: number }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const status = !provider.resultCount ? rawAnswerCount ? "미측정" : "원문 없음" : !provider.succeeded ? "성공 응답 없음" : !provider.mentions ? "자사 미언급" : provider.mentions < provider.succeeded ? "일부 응답 언급" : "자사 언급";
  return <article aria-label={`${provider.name} 응답`} className="min-w-0 overflow-hidden rounded-xl border border-[color:var(--app-card-border)]">
    <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="flex min-h-20 w-full items-start justify-between gap-3 p-4 text-left focus-visible:outline-2 focus-visible:outline-[color:var(--color-ring-focus)]"><span className="min-w-0"><strong className="block text-base">{provider.name}</strong><span className="mt-1 block break-words text-xs leading-5 text-[color:var(--app-text-muted)]">{provider.groups.flatMap((group) => group.models).filter((model, index, models) => models.indexOf(model) === index).join(" / ") || "모델 기록 없음"}</span></span><span className="shrink-0 text-right text-xs"><span style={{ color: provider.mentions ? "var(--app-status-good)" : "var(--app-text-muted)" }}>{provider.mentions ? "✓ " : "○ "}{status}</span><span className="mt-2 block text-[color:var(--app-text-muted)]">원문 {open ? "접기" : "펼치기"} <ChevronDown className={`inline h-3 w-3 ${open ? "rotate-180" : ""}`} /></span></span></button>
    <div className="space-y-1 px-4 pb-4 text-xs leading-6 text-[color:var(--app-text-muted)]"><p>자사 언급 <strong className="text-[color:var(--app-text)]">{provider.mentions} / 성공 응답 {provider.succeeded} · {percent(provider.share)}</strong></p><p>실패 {provider.failed} · 거절 {provider.refused}</p><p>{provider.groups.map((group) => `${modes[group.searchMode]} ${group.resultCount}개`).join(" · ") || status}</p>{provider.mentionedBrands.length > 0 && <p className="break-words">언급 브랜드: {provider.mentionedBrands.map((brand) => `${brand.name}${brand.own ? " (자사)" : ""}`).join(", ")}</p>}</div>
    {open && <div id={id}>{provider.resultCount ? <ResponseBody key={query} query={query} provider={provider} requested={requested} /> : <p className="border-t border-[color:var(--app-card-border)] p-4 text-sm text-[color:var(--app-text-muted)]">{rawAnswerCount ? "선택한 질문·실행에서 이 서비스는 측정되지 않았습니다." : "이 실행에는 저장된 응답 원문이 없습니다."}</p>}</div>}
  </article>;
}
