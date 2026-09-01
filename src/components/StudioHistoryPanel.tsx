"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Copy, Eye, History, LoaderCircle, Pencil, Pin, Plus, Trash2 } from "lucide-react";
import { ConfirmDialog, CrudListToolbar, CursorPagination, DetailDrawer } from "@/components/CrudPrimitives";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/utils";

export type StudioTool = "rewrite" | "intro" | "faq" | "entity";

export interface StudioContentSummary {
  id: number;
  projectId: number;
  tool: StudioTool;
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

export interface StudioContentResource extends StudioContentSummary {
  input: unknown;
  output: unknown;
}

interface ContentRevision {
  id: number;
  contentId: number;
  revision: number;
  input: unknown;
  output: unknown;
  origin: string;
  createdAt: string;
}

interface CursorPage<T> {
  items: T[];
  page: { nextCursor: string | null; hasMore: boolean };
}

interface ApiFailure extends Error { code?: string }

const changedEvent = "geo-master:studio-content-changed";
const projectChangedEvent = "geo-master:project-changed";
const statuses = ["generated", "draft", "review", "approved", "archived", "failed"] as const;
const toolLabels: Record<StudioTool, string> = { rewrite: "리라이팅", intro: "도입부", faq: "FAQ", entity: "엔티티" };

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

export function notifyStudioContentChanged() {
  window.dispatchEvent(new Event(changedEvent));
}

function statusTone(status: string): "good" | "bad" | "warn" | "cyan" | "default" {
  if (status === "approved") return "good";
  if (status === "failed") return "bad";
  if (status === "review") return "warn";
  if (status === "generated") return "cyan";
  return "default";
}

function pretty(value: unknown) {
  try { return JSON.stringify(value, null, 2); } catch { return "null"; }
}

export function StudioHistoryPanel({ tool, onSelect }: { tool: StudioTool; onSelect: (content: StudioContentResource | null) => void }) {
  const [items, setItems] = useState<StudioContentSummary[]>([]);
  const [page, setPage] = useState<CursorPage<StudioContentSummary>["page"]>({ nextCursor: null, hasMore: false });
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [backStack, setBackStack] = useState<Array<string | null>>([]);
  const [detail, setDetail] = useState<StudioContentResource | null>(null);
  const [revisions, setRevisions] = useState<ContentRevision[]>([]);
  const [revisionPage, setRevisionPage] = useState<CursorPage<ContentRevision>["page"]>({ nextCursor: null, hasMore: false });
  const [revisionCursor, setRevisionCursor] = useState<string | null>(null);
  const [revisionBackStack, setRevisionBackStack] = useState<Array<string | null>>([]);
  const [revisionOutput, setRevisionOutput] = useState("");
  const [editing, setEditing] = useState<StudioContentSummary | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editStatus, setEditStatus] = useState<(typeof statuses)[number]>("generated");
  const [editPinned, setEditPinned] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StudioContentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (nextCursor: string | null, search: string) => {
    try {
      setLoading(true);
      const parameters = new URLSearchParams({ limit: "20", tool });
      if (nextCursor) parameters.set("cursor", nextCursor);
      if (search) parameters.set("q", search);
      const result = await api<CursorPage<StudioContentSummary>>(`/api/contents?${parameters}`);
      setItems(result.items);
      setPage(result.page);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "스튜디오 이력을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [tool]);

  const loadRevisions = useCallback(async (contentId: number, nextCursor: string | null) => {
    const parameters = new URLSearchParams({ limit: "10" });
    if (nextCursor) parameters.set("cursor", nextCursor);
    const result = await api<CursorPage<ContentRevision>>(`/api/contents/${contentId}/revisions?${parameters}`);
    setRevisions(result.items);
    setRevisionPage(result.page);
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
    const timer = window.setTimeout(() => void loadRevisions(detail.id, revisionCursor).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "revision을 불러오지 못했습니다.")), 0);
    return () => window.clearTimeout(timer);
  }, [detail, loadRevisions, revisionCursor]);

  useEffect(() => {
    const changed = () => void load(cursor, appliedQuery);
    const projectChanged = () => {
      setCursor(null);
      setBackStack([]);
      setDetail(null);
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
      const result = await api<{ content: StudioContentResource }>(`/api/contents/${id}`);
      setDetail(result.content);
      setRevisionOutput(pretty(result.content.output));
      setRevisionCursor(null);
      setRevisionBackStack([]);
      onSelect(result.content);
      setError("");
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : "스튜디오 결과 상세를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const beginEdit = (content: StudioContentSummary) => {
    setEditing(content);
    setEditTitle(content.title);
    setEditNotes(content.notes);
    setEditStatus(statuses.includes(content.status as (typeof statuses)[number]) ? content.status as (typeof statuses)[number] : "generated");
    setEditPinned(content.pinned);
  };

  const saveMetadata = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || busy) return;
    try {
      setBusy(true);
      const result = await api<{ content: StudioContentResource }>(`/api/contents/${editing.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: editTitle, notes: editNotes, status: editStatus, pinned: editPinned, expectedUpdatedAt: editing.updatedAt }),
      });
      setItems((current) => current.map((content) => content.id === result.content.id ? result.content : content));
      setDetail((current) => current?.id === result.content.id ? result.content : current);
      setEditing(null);
      onSelect(result.content);
    } catch (saveError) {
      const failure = saveError as ApiFailure;
      setEditing(null);
      setError(failure.code === "STALE_WRITE" ? "콘텐츠 메타데이터가 변경되어 최신 목록을 불러왔습니다." : failure.message);
      await load(cursor, appliedQuery);
    } finally {
      setBusy(false);
    }
  };

  const createRevision = async (event: FormEvent) => {
    event.preventDefault();
    if (!detail || busy) return;
    let output: unknown;
    try {
      output = JSON.parse(revisionOutput) as unknown;
      if (!output || typeof output !== "object" || Array.isArray(output)) throw new Error("object required");
    } catch {
      setError("편집 출력은 JSON 객체 형식이어야 합니다.");
      return;
    }
    try {
      setBusy(true);
      const result = await api<{ content: StudioContentResource; revision: ContentRevision }>(`/api/contents/${detail.id}/revisions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ output, origin: "edited", expectedUpdatedAt: detail.updatedAt }),
      });
      setDetail(result.content);
      setRevisionOutput(pretty(result.content.output));
      setRevisionCursor(null);
      setRevisionBackStack([]);
      onSelect(result.content);
      setItems((current) => current.map((content) => content.id === result.content.id ? result.content : content));
      setError("");
      await loadRevisions(result.content.id, null);
    } catch (revisionError) {
      const failure = revisionError as ApiFailure;
      setError(failure.code === "STALE_WRITE" ? "콘텐츠가 변경되어 revision을 저장하지 않았습니다. 상세를 다시 열어 주세요." : failure.message);
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async (content: StudioContentSummary) => {
    if (busy) return;
    try {
      setBusy(true);
      const result = await api<{ content: StudioContentResource }>(`/api/contents/${content.id}/duplicate`, { method: "POST" });
      setCursor(null);
      setBackStack([]);
      await load(null, appliedQuery);
      onSelect(result.content);
      setError("");
    } catch (duplicateError) {
      setError(duplicateError instanceof Error ? duplicateError.message : "콘텐츠를 복제하지 못했습니다.");
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
      setDetail(null);
      onSelect(null);
      await load(cursor, appliedQuery);
    } catch (deleteError) {
      const failure = deleteError as ApiFailure;
      setDeleteTarget(null);
      setError(failure.code === "STALE_WRITE" ? "콘텐츠가 변경되어 삭제하지 않았습니다." : failure.message);
      await load(cursor, appliedQuery);
    } finally {
      setBusy(false);
    }
  };

  return <>
    <Card className="mt-6">
      <div className="mb-4 flex items-center gap-2"><History className="h-4 w-4 text-slate-400" /><h2 className="font-semibold text-white">{toolLabels[tool]} 이력</h2></div>
      <CrudListToolbar query={query} onQueryChange={setQuery} placeholder="제목 또는 메모 검색" />
      {error && <p role="alert" className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/8 px-3 py-2 text-sm text-rose-300">{error}</p>}
      {loading ? <div className="grid min-h-36 place-items-center"><LoaderCircle className="h-5 w-5 animate-spin text-cyan-400" /></div> : items.length ? <div className="mt-3 divide-y divide-white/5">{items.map((content) => <article key={content.id} className="grid grid-cols-[1fr_auto] items-center gap-3 py-3 sm:grid-cols-[1fr_auto_auto_auto]">
        <div className="min-w-0"><p className="flex items-center gap-1 truncate text-sm font-medium text-slate-300">{content.pinned && <Pin className="h-3 w-3 shrink-0 text-cyan-300" />}{content.title || `${toolLabels[tool]} #${content.id}`}</p><p className="mt-0.5 truncate text-xs text-slate-600">{formatDate(content.createdAt)} · {content.provider || "로컬"} · revision {content.currentRevision}</p></div>
        <Badge tone={statusTone(content.status)}>{content.status}</Badge>
        <button type="button" disabled={busy} onClick={() => void openDetail(content.id)} className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-cyan-300" aria-label={`${content.title} 상세 보기`}><Eye className="h-4 w-4" /></button>
        <div className="flex">
          <button type="button" disabled={busy} onClick={() => void duplicate(content)} className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-cyan-300" aria-label={`${content.title} 복제`}><Copy className="h-4 w-4" /></button>
          <button type="button" disabled={busy} onClick={() => beginEdit(content)} className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-cyan-300" aria-label={`${content.title} 메타데이터 수정`}><Pencil className="h-4 w-4" /></button>
          <button type="button" disabled={busy} onClick={() => setDeleteTarget(content)} className="rounded-lg p-2 text-slate-600 hover:bg-rose-400/10 hover:text-rose-300" aria-label={`${content.title} 삭제`}><Trash2 className="h-4 w-4" /></button>
        </div>
      </article>)}</div> : <div className="mt-4"><EmptyState>{appliedQuery ? `검색된 ${toolLabels[tool]} 결과가 없습니다.` : `첫 ${toolLabels[tool]} 결과를 생성하면 이력이 쌓입니다.`}</EmptyState></div>}
      <div className="mt-4"><CursorPagination canPrevious={backStack.length > 0} hasMore={page.hasMore} busy={loading || busy} onPrevious={() => { const stack = [...backStack]; setCursor(stack.pop() ?? null); setBackStack(stack); }} onNext={() => { if (!page.nextCursor) return; setBackStack((stack) => [...stack, cursor]); setCursor(page.nextCursor); }} /></div>
    </Card>

    <DetailDrawer open={Boolean(detail)} title={detail?.title || `${toolLabels[tool]} 상세`} description={detail ? `${formatDate(detail.createdAt)} · revision ${detail.currentRevision}` : undefined} busy={busy} onClose={() => { setDetail(null); setRevisions([]); }} footer={<Button type="button" variant="secondary" onClick={() => setDetail(null)}>닫기</Button>}>
      {detail && <div className="space-y-5">{detail.notes && <p className="rounded-xl border border-white/7 p-3 text-sm leading-6 text-slate-400">{detail.notes}</p>}<section><h3 className="mb-2 text-sm font-semibold text-white">현재 입력</h3><pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950 p-3 text-xs leading-5 text-slate-500">{pretty(detail.input)}</pre></section><form onSubmit={createRevision}><div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold text-white">현재 출력 · 새 편집 revision</h3><Badge tone="cyan">r{detail.currentRevision}</Badge></div><textarea aria-label="새 revision 출력 JSON" className="min-h-64 font-mono text-xs leading-5" value={revisionOutput} onChange={(event) => setRevisionOutput(event.target.value)} /><Button className="mt-3" disabled={busy}><Plus className="h-4 w-4" />{busy ? "저장 중…" : "새 revision 저장"}</Button></form><section><h3 className="mb-3 text-sm font-semibold text-white">불변 revision 이력</h3><div className="space-y-3">{revisions.map((revision) => <article key={revision.id} className="rounded-xl border border-white/7 bg-slate-900/50 p-3"><div className="flex items-center justify-between"><Badge>r{revision.revision} · {revision.origin}</Badge><span className="text-[10px] text-slate-600">{formatDate(revision.createdAt)}</span></div><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950/60 p-3 text-xs leading-5 text-slate-500">{pretty(revision.output)}</pre></article>)}</div><div className="mt-3"><CursorPagination canPrevious={revisionBackStack.length > 0} hasMore={revisionPage.hasMore} busy={busy} onPrevious={() => { const stack = [...revisionBackStack]; setRevisionCursor(stack.pop() ?? null); setRevisionBackStack(stack); }} onNext={() => { if (!revisionPage.nextCursor) return; setRevisionBackStack((stack) => [...stack, revisionCursor]); setRevisionCursor(revisionPage.nextCursor); }} /></div></section></div>}
    </DetailDrawer>

    <DetailDrawer open={Boolean(editing)} title={`${toolLabels[tool]} 메타데이터 수정`} description="생성 입력·출력은 직접 덮어쓰지 않고 새 revision으로 보존합니다." busy={busy} onClose={() => setEditing(null)} footer={editing && <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditing(null)}>취소</Button><Button type="submit" form="studio-metadata-form" disabled={busy || !editTitle.trim()}>{busy ? "저장 중…" : "저장"}</Button></div>}>
      {editing && <form id="studio-metadata-form" className="space-y-4" onSubmit={saveMetadata}><label className="block text-sm">제목<input className="mt-2" required maxLength={120} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} /></label><label className="block text-sm">메모<textarea className="mt-2 min-h-32" maxLength={5000} value={editNotes} onChange={(event) => setEditNotes(event.target.value)} /></label><label className="block text-sm">상태<select className="mt-2" value={editStatus} onChange={(event) => setEditStatus(event.target.value as (typeof statuses)[number])}>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editPinned} onChange={(event) => setEditPinned(event.target.checked)} />중요 콘텐츠로 고정</label></form>}
    </DetailDrawer>

    <ConfirmDialog open={Boolean(deleteTarget)} title={`${toolLabels[tool]} 결과를 삭제할까요?`} description={deleteTarget && <><strong className="text-white">{deleteTarget.title}</strong>의 생성 evidence와 revision {deleteTarget.revisionCount}개가 영구 삭제됩니다.</>} requiredText={deleteTarget?.title || `${toolLabels[tool]} #${deleteTarget?.id}`} confirmLabel="콘텐츠 삭제" destructive busy={busy} onClose={() => setDeleteTarget(null)} onConfirm={remove} />
  </>;
}
