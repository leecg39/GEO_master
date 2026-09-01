"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Eye, History, LoaderCircle, Pencil, Trash2 } from "lucide-react";
import { ConfirmDialog, CrudListToolbar, CursorPagination, DetailDrawer } from "@/components/CrudPrimitives";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/utils";

export interface MeasureRunResource {
  id: number;
  projectId: number;
  title: string;
  notes: string;
  clientRequestId: string | null;
  status: string;
  models: Array<{ provider: string; model: string }>;
  repetitions: number;
  totalQueries: number;
  answerShare: number;
  genrank: number;
  funnelStage: string;
  summary: Record<string, unknown>;
  resultCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface MeasureResult {
  id: number;
  runId: number;
  questionText: string;
  provider: string;
  model: string;
  repetition: number;
  response: string;
  brandMentioned: boolean;
  sentiment: string;
  mentionRank: number | null;
  competitorMentions: string[];
  createdAt: string;
}

interface CursorPage<T> {
  items: T[];
  page: { nextCursor: string | null; hasMore: boolean };
}

interface ApiFailure extends Error { code?: string }

const changedEvent = "geo-master:measure-run-changed";
const projectChangedEvent = "geo-master:project-changed";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; code?: string };
    const error = new Error(body.error || "요청을 처리하지 못했습니다.") as ApiFailure;
    error.code = body.code;
    throw error;
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export function notifyMeasureRunChanged() {
  window.dispatchEvent(new Event(changedEvent));
}

function statusTone(status: string): "good" | "bad" | "warn" | "cyan" | "default" {
  if (status === "completed") return "good";
  if (status === "failed" || status === "canceled") return "bad";
  if (status === "running") return "cyan";
  if (status === "blocked") return "warn";
  return "default";
}

export function MeasureRunHistoryPanel({ onSelect }: { onSelect: (run: MeasureRunResource | null) => void }) {
  const [items, setItems] = useState<MeasureRunResource[]>([]);
  const [page, setPage] = useState<CursorPage<MeasureRunResource>["page"]>({ nextCursor: null, hasMore: false });
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [backStack, setBackStack] = useState<Array<string | null>>([]);
  const [detail, setDetail] = useState<MeasureRunResource | null>(null);
  const [results, setResults] = useState<MeasureResult[]>([]);
  const [resultPage, setResultPage] = useState<CursorPage<MeasureResult>["page"]>({ nextCursor: null, hasMore: false });
  const [resultCursor, setResultCursor] = useState<string | null>(null);
  const [resultBackStack, setResultBackStack] = useState<Array<string | null>>([]);
  const [editing, setEditing] = useState<MeasureRunResource | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<MeasureRunResource | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (nextCursor: string | null, search: string) => {
    try {
      setLoading(true);
      const parameters = new URLSearchParams({ limit: "20" });
      if (nextCursor) parameters.set("cursor", nextCursor);
      if (search) parameters.set("q", search);
      const data = await api<CursorPage<MeasureRunResource>>(`/api/measure-runs?${parameters}`);
      setItems(data.items);
      setPage(data.page);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "측정 이력을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadResults = useCallback(async (runId: number, nextCursor: string | null) => {
    const parameters = new URLSearchParams({ limit: "10" });
    if (nextCursor) parameters.set("cursor", nextCursor);
    const data = await api<CursorPage<MeasureResult>>(`/api/measure-runs/${runId}/results?${parameters}`);
    setResults(data.items);
    setResultPage(data.page);
  }, []);

  useEffect(() => {
    const debounce = window.setTimeout(() => {
      setAppliedQuery(query.trim());
      setCursor(null);
      setBackStack([]);
    }, 250);
    return () => window.clearTimeout(debounce);
  }, [query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(cursor, appliedQuery), 0);
    return () => window.clearTimeout(timer);
  }, [appliedQuery, cursor, load]);

  useEffect(() => {
    if (!detail) return;
    const timer = window.setTimeout(() => void loadResults(detail.id, resultCursor).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "측정 결과를 불러오지 못했습니다.")), 0);
    return () => window.clearTimeout(timer);
  }, [detail, loadResults, resultCursor]);

  useEffect(() => {
    const changed = () => void load(cursor, appliedQuery);
    const projectChanged = () => {
      setCursor(null);
      setBackStack([]);
      setDetail(null);
      onSelect(null);
      void load(null, appliedQuery);
    };
    window.addEventListener(changedEvent, changed);
    window.addEventListener(projectChangedEvent, projectChanged);
    return () => {
      window.removeEventListener(changedEvent, changed);
      window.removeEventListener(projectChangedEvent, projectChanged);
    };
  }, [appliedQuery, cursor, load, onSelect]);

  const openDetail = async (id: number) => {
    try {
      setBusy(true);
      const data = await api<{ run: MeasureRunResource }>(`/api/measure-runs/${id}`);
      setDetail(data.run);
      setResultCursor(null);
      setResultBackStack([]);
      onSelect(data.run);
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : "측정 상세를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const beginEdit = (run: MeasureRunResource) => {
    setEditing(run);
    setEditTitle(run.title);
    setEditNotes(run.notes);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || busy) return;
    try {
      setBusy(true);
      const data = await api<{ run: MeasureRunResource }>(`/api/measure-runs/${editing.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: editTitle, notes: editNotes, expectedUpdatedAt: editing.updatedAt }),
      });
      setItems((current) => current.map((run) => run.id === data.run.id ? data.run : run));
      setDetail((current) => current?.id === data.run.id ? data.run : current);
      setEditing(null);
      onSelect(data.run);
    } catch (saveError) {
      const failure = saveError as ApiFailure;
      setEditing(null);
      setError(failure.code === "STALE_WRITE" ? "측정 메타데이터가 변경되어 최신 목록을 불러왔습니다." : failure.message);
      await load(cursor, appliedQuery);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget || busy) return;
    try {
      setBusy(true);
      await api<void>(`/api/measure-runs/${deleteTarget.id}`, {
        method: "DELETE", headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: deleteTarget.updatedAt, cascadeConfirmed: true }),
      });
      setDeleteTarget(null);
      setDetail(null);
      onSelect(null);
      await load(cursor, appliedQuery);
    } catch (deleteError) {
      const failure = deleteError as ApiFailure;
      setDeleteTarget(null);
      setError(failure.code === "STALE_WRITE" ? "측정 이력이 변경되어 삭제하지 않았습니다." : failure.message);
      await load(cursor, appliedQuery);
    } finally {
      setBusy(false);
    }
  };

  return <>
    <Card className="mt-6">
      <div className="mb-4 flex items-center gap-2"><History className="h-4 w-4 text-slate-400" /><h2 className="font-semibold text-white">측정 실행 이력</h2></div>
      <CrudListToolbar query={query} onQueryChange={setQuery} placeholder="제목, 메모 또는 상태 검색" />
      {error && <p role="alert" className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/8 px-3 py-2 text-sm text-rose-300">{error}</p>}
      {loading ? <div className="grid min-h-36 place-items-center"><LoaderCircle className="h-5 w-5 animate-spin text-cyan-400" /></div> : items.length ? <div className="mt-3 divide-y divide-white/5">{items.map((run) => <article key={run.id} className="grid grid-cols-[1fr_auto] items-center gap-3 py-3 sm:grid-cols-[1fr_auto_auto_auto]">
        <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-300">{run.title || `측정 #${run.id}`}</p><p className="mt-0.5 truncate text-xs text-slate-600">{formatDate(run.createdAt)} · 결과 {run.resultCount}건 · 질문 {run.totalQueries}회</p></div>
        <div className="text-right"><Badge tone={statusTone(run.status)}>{run.status}</Badge><p className="mt-1 text-[10px] text-slate-600">점유율 {run.answerShare.toFixed(1)}% · G {run.genrank.toFixed(1)}</p></div>
        <button type="button" disabled={busy} onClick={() => void openDetail(run.id)} className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-cyan-300" aria-label={`${run.title} 상세 보기`}><Eye className="h-4 w-4" /></button>
        <div className="flex"><button type="button" disabled={busy} onClick={() => beginEdit(run)} className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-cyan-300" aria-label={`${run.title} 메타데이터 수정`}><Pencil className="h-4 w-4" /></button><button type="button" disabled={busy || run.status === "running"} onClick={() => setDeleteTarget(run)} className="rounded-lg p-2 text-slate-600 hover:bg-rose-400/10 hover:text-rose-300 disabled:opacity-30" aria-label={`${run.title} 삭제`}><Trash2 className="h-4 w-4" /></button></div>
      </article>)}</div> : <div className="mt-4"><EmptyState>{appliedQuery ? "검색된 측정 이력이 없습니다." : "첫 측정을 실행하면 이력이 쌓입니다."}</EmptyState></div>}
      <div className="mt-4"><CursorPagination canPrevious={backStack.length > 0} hasMore={page.hasMore} busy={loading || busy} onPrevious={() => { const stack = [...backStack]; setCursor(stack.pop() ?? null); setBackStack(stack); }} onNext={() => { if (!page.nextCursor) return; setBackStack((stack) => [...stack, cursor]); setCursor(page.nextCursor); }} /></div>
    </Card>

    <DetailDrawer open={Boolean(detail)} title={detail?.title || "측정 상세"} description={detail ? `${formatDate(detail.createdAt)} · ${detail.status}` : undefined} busy={busy} onClose={() => { setDetail(null); setResults([]); }} footer={<div className="flex justify-end"><Button type="button" variant="secondary" onClick={() => setDetail(null)}>닫기</Button></div>}>
      {detail && <div className="space-y-5"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="rounded-xl bg-slate-900 p-3"><span className="text-[10px] text-slate-600">응답 점유율</span><strong className="mt-1 block text-xl text-white">{detail.answerShare.toFixed(1)}%</strong></div><div className="rounded-xl bg-slate-900 p-3"><span className="text-[10px] text-slate-600">GenRank</span><strong className="mt-1 block text-xl text-white">{detail.genrank.toFixed(1)}</strong></div><div className="rounded-xl bg-slate-900 p-3"><span className="text-[10px] text-slate-600">퍼널</span><strong className="mt-1 block text-sm text-cyan-300">{detail.funnelStage}</strong></div><div className="rounded-xl bg-slate-900 p-3"><span className="text-[10px] text-slate-600">결과</span><strong className="mt-1 block text-xl text-white">{detail.resultCount}</strong></div></div>{detail.notes && <p className="rounded-xl border border-white/7 p-3 text-sm leading-6 text-slate-400">{detail.notes}</p>}<section><h3 className="mb-3 font-semibold text-white">불변 응답 증거</h3><div className="space-y-3">{results.map((result) => <article key={result.id} className="rounded-xl border border-white/7 bg-slate-900/50 p-3"><div className="flex flex-wrap items-center gap-2"><Badge tone="cyan">{result.provider}</Badge><Badge>{result.sentiment}</Badge><span className="text-[10px] text-slate-600">반복 {result.repetition}</span></div><p className="mt-2 text-xs font-medium leading-5 text-slate-300">{result.questionText}</p><pre className="mt-2 max-h-52 whitespace-pre-wrap rounded-lg bg-slate-950/60 p-3 text-xs leading-5 text-slate-500">{result.response}</pre></article>)}</div>{!results.length && <EmptyState>저장된 응답 결과가 없습니다.</EmptyState>}<div className="mt-3"><CursorPagination canPrevious={resultBackStack.length > 0} hasMore={resultPage.hasMore} busy={busy} onPrevious={() => { const stack = [...resultBackStack]; setResultCursor(stack.pop() ?? null); setResultBackStack(stack); }} onNext={() => { if (!resultPage.nextCursor) return; setResultBackStack((stack) => [...stack, resultCursor]); setResultCursor(resultPage.nextCursor); }} /></div></section></div>}
    </DetailDrawer>

    <DetailDrawer open={Boolean(editing)} title="측정 메타데이터 수정" description="응답 원문과 계산 결과는 변경되지 않습니다." busy={busy} onClose={() => setEditing(null)} footer={editing && <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditing(null)}>취소</Button><Button type="submit" form="measure-run-edit" disabled={busy || !editTitle.trim()}>{busy ? "저장 중…" : "저장"}</Button></div>}>
      {editing && <form id="measure-run-edit" className="space-y-4" onSubmit={save}><label className="block text-sm">제목<input className="mt-2" required maxLength={120} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} /></label><label className="block text-sm">메모<textarea className="mt-2 min-h-40" maxLength={5000} value={editNotes} onChange={(event) => setEditNotes(event.target.value)} /></label></form>}
    </DetailDrawer>

    <ConfirmDialog open={Boolean(deleteTarget)} title="측정 실행 이력을 삭제할까요?" description={deleteTarget && <><strong className="text-white">{deleteTarget.title}</strong>의 응답 원문 {deleteTarget.resultCount}건이 함께 삭제됩니다. 자동화 작업과 리포트 프리셋은 유지되지만 원본 연결은 해제됩니다.</>} requiredText={deleteTarget?.title} confirmLabel="측정 이력 삭제" destructive busy={busy} onClose={() => setDeleteTarget(null)} onConfirm={remove} />
  </>;
}
