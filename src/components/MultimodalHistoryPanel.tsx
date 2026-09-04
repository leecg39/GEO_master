"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Eye, History, LoaderCircle, Pencil, Pin, Trash2 } from "lucide-react";
import { ConfirmDialog, CrudListToolbar, CursorPagination, DetailDrawer } from "@/components/CrudPrimitives";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/utils";

export interface MultimodalContentSummary {
  id: number;
  projectId: number;
  tool: string;
  title: string;
  notes: string;
  status: string;
  pinned: boolean;
  provider: string | null;
  clientRequestId: string | null;
  metadata: Record<string, unknown>;
  revisionCount: number;
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface MultimodalContentResource extends MultimodalContentSummary {
  input: unknown;
  output: unknown;
}

interface CursorPage<T> {
  items: T[];
  page: { nextCursor: string | null; hasMore: boolean };
}

interface ApiFailure extends Error { code?: string }

const changedEvent = "geo-master:multimodal-audit-changed";
const projectChangedEvent = "geo-master:project-changed";
const statuses = ["generated", "dry_run_preview", "draft", "review", "approved", "archived", "failed"] as const;

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

export function notifyMultimodalAuditChanged() {
  window.dispatchEvent(new Event(changedEvent));
}

function statusTone(status: string): "good" | "warn" | "cyan" | "bad" | "default" {
  if (status === "approved") return "good";
  if (status === "dry_run_preview" || status === "review") return "warn";
  if (status === "failed") return "bad";
  if (status === "generated") return "cyan";
  return "default";
}

export function MultimodalHistoryPanel({ onSelect }: { onSelect: (content: MultimodalContentResource | null) => void }) {
  const [items, setItems] = useState<MultimodalContentSummary[]>([]);
  const [page, setPage] = useState<CursorPage<MultimodalContentSummary>["page"]>({ nextCursor: null, hasMore: false });
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [backStack, setBackStack] = useState<Array<string | null>>([]);
  const [editing, setEditing] = useState<MultimodalContentSummary | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editStatus, setEditStatus] = useState<(typeof statuses)[number]>("generated");
  const [editPinned, setEditPinned] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MultimodalContentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (nextCursor: string | null, search: string) => {
    try {
      setLoading(true);
      const parameters = new URLSearchParams({ limit: "20", tool: "multimodal-audit" });
      if (nextCursor) parameters.set("cursor", nextCursor);
      if (search) parameters.set("q", search);
      const result = await api<CursorPage<MultimodalContentSummary>>(`/api/contents?${parameters}`);
      setItems(result.items);
      setPage(result.page);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "멀티모달 감사 이력을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
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
    const changed = () => void load(cursor, appliedQuery);
    const projectChanged = () => {
      setCursor(null);
      setBackStack([]);
      setEditing(null);
      setDeleteTarget(null);
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
      const result = await api<{ content: MultimodalContentResource }>(`/api/contents/${id}`);
      onSelect(result.content);
      setError("");
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : "멀티모달 감사 상세를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const beginEdit = (content: MultimodalContentSummary) => {
    setEditing(content);
    setEditTitle(content.title);
    setEditNotes(content.notes);
    setEditStatus(statuses.includes(content.status as (typeof statuses)[number]) ? content.status as (typeof statuses)[number] : "generated");
    setEditPinned(content.pinned);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || busy) return;
    try {
      setBusy(true);
      const result = await api<{ content: MultimodalContentResource }>(`/api/contents/${editing.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: editTitle,
          notes: editNotes,
          status: editStatus,
          pinned: editPinned,
          expectedUpdatedAt: editing.updatedAt,
        }),
      });
      setItems((current) => current.map((content) => content.id === result.content.id ? result.content : content));
      setEditing(null);
      onSelect(result.content);
    } catch (saveError) {
      const failure = saveError as ApiFailure;
      setEditing(null);
      setError(failure.code === "STALE_WRITE" ? "감사 메타데이터가 변경되어 최신 목록을 불러왔습니다." : failure.message);
      await load(cursor, appliedQuery);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget || busy) return;
    try {
      setBusy(true);
      await api<void>(`/api/contents/${deleteTarget.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: deleteTarget.updatedAt, cascadeConfirmed: true }),
      });
      setDeleteTarget(null);
      onSelect(null);
      await load(cursor, appliedQuery);
    } catch (deleteError) {
      const failure = deleteError as ApiFailure;
      setDeleteTarget(null);
      setError(failure.code === "STALE_WRITE" ? "감사 이력이 변경되어 삭제하지 않았습니다." : failure.message);
      await load(cursor, appliedQuery);
    } finally {
      setBusy(false);
    }
  };

  return <>
    <Card className="mt-6">
      <div className="mb-4 flex items-center gap-2"><History className="h-4 w-4 text-slate-400" /><h2 className="font-semibold text-white">멀티모달 감사 이력</h2></div>
      <CrudListToolbar query={query} onQueryChange={setQuery} placeholder="제목 또는 메모 검색" />
      {error && <p role="alert" className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/8 px-3 py-2 text-sm text-rose-300">{error}</p>}
      {loading ? <div className="grid min-h-36 place-items-center"><LoaderCircle className="h-5 w-5 animate-spin text-cyan-400" /></div> : items.length ? <div className="mt-3 divide-y divide-white/5">{items.map((content) => <article key={content.id} className="grid grid-cols-[1fr_auto] items-center gap-3 py-3 sm:grid-cols-[1fr_auto_auto_auto]">
        <div className="min-w-0"><p className="flex items-center gap-1 truncate text-sm font-medium text-slate-300">{content.pinned && <Pin className="h-3 w-3 shrink-0 text-cyan-300" />}{content.title || `멀티모달 감사 #${content.id}`}</p><p className="mt-0.5 truncate text-xs text-slate-600">{formatDate(content.createdAt)} · revision {content.currentRevision}</p></div>
        <Badge tone={statusTone(content.status)}>{content.status}</Badge>
        <button type="button" disabled={busy} onClick={() => void openDetail(content.id)} className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-cyan-300" aria-label={`${content.title} 상세 보기`}><Eye className="h-4 w-4" /></button>
        <div className="flex"><button type="button" disabled={busy} onClick={() => beginEdit(content)} className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-cyan-300" aria-label={`${content.title} 메타데이터 수정`}><Pencil className="h-4 w-4" /></button><button type="button" disabled={busy} onClick={() => setDeleteTarget(content)} className="rounded-lg p-2 text-slate-600 hover:bg-rose-400/10 hover:text-rose-300" aria-label={`${content.title} 삭제`}><Trash2 className="h-4 w-4" /></button></div>
      </article>)}</div> : <div className="mt-4"><EmptyState>{appliedQuery ? "검색된 멀티모달 감사가 없습니다." : "첫 감사를 실행하면 이력이 쌓입니다."}</EmptyState></div>}
      <div className="mt-4"><CursorPagination canPrevious={backStack.length > 0} hasMore={page.hasMore} busy={loading || busy} onPrevious={() => { const stack = [...backStack]; setCursor(stack.pop() ?? null); setBackStack(stack); }} onNext={() => { if (!page.nextCursor) return; setBackStack((stack) => [...stack, cursor]); setCursor(page.nextCursor); }} /></div>
    </Card>

    <DetailDrawer open={Boolean(editing)} title="멀티모달 감사 메타데이터 수정" description="수집 URL과 이미지·영상 판정은 불변 evidence로 유지됩니다." busy={busy} onClose={() => setEditing(null)} footer={editing && <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditing(null)}>취소</Button><Button type="submit" form="multimodal-metadata-form" disabled={busy || !editTitle.trim()}>{busy ? "저장 중…" : "저장"}</Button></div>}>
      {editing && <form id="multimodal-metadata-form" className="space-y-4" onSubmit={save}><label className="block text-sm">제목<input className="mt-2" required maxLength={120} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} /></label><label className="block text-sm">메모<textarea className="mt-2 min-h-32" maxLength={5000} value={editNotes} onChange={(event) => setEditNotes(event.target.value)} /></label><label className="block text-sm">상태<select className="mt-2" value={editStatus} onChange={(event) => setEditStatus(event.target.value as (typeof statuses)[number])}>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editPinned} onChange={(event) => setEditPinned(event.target.checked)} />중요 감사로 고정</label></form>}
    </DetailDrawer>

    <ConfirmDialog open={Boolean(deleteTarget)} title="멀티모달 감사 이력을 삭제할까요?" description={deleteTarget && <><strong className="text-white">{deleteTarget.title}</strong>의 URL·이미지·영상 판정과 모든 revision이 영구 삭제됩니다.</>} requiredText={deleteTarget?.title || `멀티모달 감사 #${deleteTarget?.id}`} confirmLabel="감사 이력 삭제" destructive busy={busy} onClose={() => setDeleteTarget(null)} onConfirm={remove} />
  </>;
}
