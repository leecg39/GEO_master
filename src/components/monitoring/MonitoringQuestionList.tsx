"use client";
import { useState } from "react";
import { ChevronDown, Pencil, Plus, TrendingUp } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { MonitoringQuestion } from "@/lib/monitoring-types";
import { percent, rank } from "./MonitoringCharts";
import { fieldClass } from "./MonitoringQuestionEditor";

export function MonitoringQuestionList({ questions, selected, open, onToggle, onSelect, onAdd, onEdit }: {
  questions: MonitoringQuestion[]; selected: string | null; open: boolean;
  onToggle: () => void; onSelect: (key: string | null) => void; onAdd: () => void; onEdit: (question: MonitoringQuestion) => void;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("registered");
  const [page, setPage] = useState(0);
  const filtered = questions.filter((item) => item.text.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  if (sort !== "registered") filtered.sort((a, b) => {
    const left = sort === "current" ? a.current?.share : a.delta;
    const right = sort === "current" ? b.current?.share : b.delta;
    return left == null ? (right == null ? 0 : 1) : right == null ? -1 : right - left;
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / 25));
  const currentPage = Math.min(page, pageCount - 1);
  const shown = filtered.slice(currentPage * 25, (currentPage + 1) * 25);
  const hiddenSelection = selected && !filtered.some((item) => item.key === selected);
  return <aside aria-label="모니터링 질문" className="min-w-0">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold">모니터링 질문 <span className="ml-1 text-xs font-normal text-[color:var(--app-text-muted)]">{questions.length}개</span></h2><Button type="button" variant="secondary" className="px-3 py-2 text-xs" onClick={onAdd}><Plus className="h-4 w-4" />새 질문 추가</Button></div>
    <button type="button" className="mb-3 flex min-h-11 w-full items-center justify-between rounded-xl border border-[color:var(--app-card-border)] px-4 text-sm xl:hidden" aria-expanded={open} aria-controls="monitoring-question-list" onClick={onToggle}>질문 목록 {open ? "접기" : "펼치기"}<ChevronDown className={cn("h-4 w-4", open && "rotate-180")} /></button>
    <div id="monitoring-question-list" className={cn("space-y-2", !open && "hidden xl:block")}>
      <label className="block text-xs text-[color:var(--app-text-muted)]">질문 검색 · 목록만 검색<input type="search" maxLength={200} value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="질문 내용을 검색하세요" className={`${fieldClass} mt-1`} /></label>
      <label className="block text-xs text-[color:var(--app-text-muted)]">질문 정렬<select value={sort} onChange={(event) => { setSort(event.target.value); setPage(0); }} className={`${fieldClass} mb-2 mt-1`}><option value="registered">등록 순</option><option value="current">현재 언급률순</option><option value="delta">증감순</option></select></label>
      {search && <p className="text-xs text-[color:var(--app-text-muted)]">{filtered.length}개 검색됨 · 전체 집계는 유지됩니다.</p>}
      {hiddenSelection && <p role="status" className="text-xs text-[color:var(--app-text-muted)]">선택한 질문이 목록 필터에 숨겨져 있습니다. 상세는 유지됩니다.</p>}
      <button type="button" aria-pressed={!selected} onClick={() => onSelect(null)} className={cn("flex min-h-11 w-full items-center gap-2 rounded-xl border px-4 text-sm", !selected ? "border-[color:var(--app-chart-current)] bg-[color:var(--app-badge-bg)]" : "border-[color:var(--app-card-border)]")}><TrendingUp className="h-4 w-4" />전체 성과</button>
      {!shown.length ? <EmptyState>{questions.length ? "검색된 질문이 없습니다." : "첫 모니터링 질문을 추가해 주세요."}</EmptyState> : shown.map((item) => {
        const direction = item.delta == null ? "비교 없음" : item.delta > 0 ? "증가" : item.delta < 0 ? "감소" : "변화 없음";
        const color = item.delta == null || item.delta === 0 ? "var(--app-text-muted)" : item.delta > 0 ? "var(--app-status-good)" : "var(--app-status-danger)";
        return <div key={item.key} className={cn("relative rounded-xl border bg-[color:var(--app-card-bg)]", selected === item.key ? "border-[color:var(--app-chart-current)]" : "border-[color:var(--app-card-border)]")}>
          <button type="button" aria-pressed={selected === item.key} aria-label={`질문 보기: ${item.text}`} onClick={() => onSelect(item.key)} className="w-full rounded-xl px-4 py-4 text-left focus-visible:outline-2 focus-visible:outline-[color:var(--color-ring-focus)]"><span className={cn("block break-words text-sm leading-6", item.registrations.length > 0 && "pr-9")}>{item.text}</span><span className="mt-3 flex flex-wrap items-center gap-2 text-xs tabular-nums"><span className="text-[color:var(--app-text-muted)]">{percent(item.baseline?.share)} →</span><strong style={{ color }}>{percent(item.current?.share)}</strong><span style={{ color }}>{direction}{item.delta != null && item.delta !== 0 ? ` ${item.delta > 0 ? "+" : ""}${item.delta.toFixed(1)}%p` : ""}</span></span><span className="mt-1 block text-xs text-[color:var(--app-text-muted)]">{item.baseline?.providerCount ?? "—"} → {item.current?.providerCount ?? "—"} / 4 모델 · 평균 {rank(item.baseline?.averageRank)} → {rank(item.current?.averageRank)}</span>{(!item.registrations.length || !item.measuredRuns) && <span className="mt-2 inline-block text-xs text-[color:var(--app-text-subtle)]">{!item.registrations.length ? "과거 질문 · 이력 보존" : "기간 내 미측정"}</span>}</button>
          {item.registrations.length > 0 && <button type="button" aria-label={`질문 수정: ${item.text}`} onClick={() => onEdit(item)} className="absolute right-1 top-1 grid h-11 w-11 place-items-center rounded-lg text-[color:var(--app-text-muted)] hover:text-[color:var(--app-text)] focus-visible:outline-2"><Pencil className="h-4 w-4" /></button>}
        </div>;
      })}
      {pageCount > 1 && <div className="flex items-center justify-between gap-2 py-2"><Button variant="secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>이전 질문</Button><span className="text-xs">{currentPage + 1} / {pageCount}</span><Button variant="secondary" disabled={currentPage === pageCount - 1} onClick={() => setPage(currentPage + 1)}>다음 질문</Button></div>}
    </div>
  </aside>;
}
