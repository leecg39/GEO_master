"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ChevronRight, History, LoaderCircle, Pencil, Trash2 } from "lucide-react";
import { ConfirmDialog, CrudListToolbar, CursorPagination, DetailDrawer } from "@/components/CrudPrimitives";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/utils";

export interface AuditItemResource {
  code: string;
  category: string;
  label: string;
  passed: boolean;
  manual: boolean;
  detail: string;
  recommendation: string;
}

export interface AuditResource {
  id: number;
  projectId: number;
  title: string;
  notes: string;
  clientRequestId: string | null;
  url: string;
  score: number;
  total: number;
  grade: string;
  items: AuditItemResource[];
  metadata: { recommendations?: string[]; finalUrl?: string; [key: string]: unknown };
  createdAt: string;
  updatedAt: string;
}

interface Page {
  items: AuditResource[];
  page: { nextCursor: string | null; hasMore: boolean };
}

interface ApiFailure extends Error { code?: string }

const auditChangedEvent = "geo-master:audit-changed";
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

export function notifyAuditChanged() {
  window.dispatchEvent(new Event(auditChangedEvent));
}

export function AuditHistoryPanel({ onSelect }: { onSelect: (audit: AuditResource | null) => void }) {
  const [items, setItems] = useState<AuditResource[]>([]);
  const [page, setPage] = useState<Page["page"]>({ nextCursor: null, hasMore: false });
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [backStack, setBackStack] = useState<Array<string | null>>([]);
  const [editing, setEditing] = useState<AuditResource | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<AuditResource | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (nextCursor: string | null, search: string) => {
    try {
      setLoading(true);
      const parameters = new URLSearchParams({ limit: "20" });
      if (nextCursor) parameters.set("cursor", nextCursor);
      if (search) parameters.set("q", search);
      const result = await api<Page>(`/api/audits?${parameters}`);
      setItems(result.items);
      setPage(result.page);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "진단 이력을 불러오지 못했습니다.");
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
    const initialLoad = window.setTimeout(() => void load(cursor, appliedQuery), 0);
    return () => window.clearTimeout(initialLoad);
  }, [appliedQuery, cursor, load]);

  useEffect(() => {
    const changed = () => void load(cursor, appliedQuery);
    const projectChanged = () => {
      setCursor(null);
      setBackStack([]);
      onSelect(null);
      void load(null, appliedQuery);
    };
    window.addEventListener(auditChangedEvent, changed);
    window.addEventListener(projectChangedEvent, projectChanged);
    return () => {
      window.removeEventListener(auditChangedEvent, changed);
      window.removeEventListener(projectChangedEvent, projectChanged);
    };
  }, [appliedQuery, cursor, load, onSelect]);

  const openDetail = async (id: number) => {
    try {
      setBusy(true);
      const result = await api<{ audit: AuditResource }>(`/api/audits/${id}`);
      onSelect(result.audit);
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : "진단 상세를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const beginEdit = (audit: AuditResource) => {
    setEditing(audit);
    setEditTitle(audit.title);
    setEditNotes(audit.notes);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || busy) return;
    try {
      setBusy(true);
      const result = await api<{ audit: AuditResource }>(`/api/audits/${editing.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: editTitle, notes: editNotes, expectedUpdatedAt: editing.updatedAt }),
      });
      setItems((current) => current.map((audit) => audit.id === result.audit.id ? result.audit : audit));
      setEditing(null);
      onSelect(result.audit);
    } catch (saveError) {
      const failure = saveError as ApiFailure;
      setEditing(null);
      setError(failure.code === "STALE_WRITE" ? "다른 화면에서 진단 메타데이터가 수정되었습니다. 목록을 새로 불러왔습니다." : failure.message);
      await load(cursor, appliedQuery);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget || busy) return;
    try {
      setBusy(true);
      await api<void>(`/api/audits/${deleteTarget.id}`, {
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
      setError(failure.code === "STALE_WRITE" ? "진단 이력이 변경되어 삭제하지 않았습니다. 목록을 새로 불러왔습니다." : failure.message);
      await load(cursor, appliedQuery);
    } finally {
      setBusy(false);
    }
  };

  return <>
    <Card className="mt-6">
      <div className="mb-4 flex items-center gap-2"><History className="h-4 w-4 text-slate-400" /><h2 className="font-semibold text-white">진단 이력</h2></div>
      <CrudListToolbar query={query} onQueryChange={setQuery} placeholder="제목, 메모 또는 URL 검색" />
      {error && <p role="alert" className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/8 px-3 py-2 text-sm text-rose-300">{error}</p>}
      {loading ? <div className="grid min-h-36 place-items-center"><LoaderCircle className="h-5 w-5 animate-spin text-cyan-400" /></div> : items.length ? <div className="mt-3 divide-y divide-white/5">{items.map((audit) => <article key={audit.id} className="flex items-center gap-3 py-3">
        <button type="button" disabled={busy} onClick={() => void openDetail(audit.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-800 text-sm font-bold text-white">{audit.score}</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-300">{audit.title || audit.url}</span><span className="mt-0.5 block truncate text-xs text-slate-600">{formatDate(audit.createdAt)} · {audit.url}</span></span>
          <Badge tone={audit.score >= 25 ? "good" : audit.score < 20 ? "bad" : "warn"}>{audit.grade}</Badge><ChevronRight className="h-4 w-4 shrink-0 text-slate-700" />
        </button>
        <button type="button" disabled={busy} onClick={() => beginEdit(audit)} className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-cyan-300" aria-label={`${audit.title || audit.url} 메타데이터 수정`}><Pencil className="h-4 w-4" /></button>
        <button type="button" disabled={busy} onClick={() => setDeleteTarget(audit)} className="rounded-lg p-2 text-slate-600 hover:bg-rose-400/10 hover:text-rose-300" aria-label={`${audit.title || audit.url} 삭제`}><Trash2 className="h-4 w-4" /></button>
      </article>)}</div> : <div className="mt-4"><EmptyState>{appliedQuery ? "검색된 진단 이력이 없습니다." : "아직 저장된 진단이 없습니다."}</EmptyState></div>}
      <div className="mt-4"><CursorPagination canPrevious={backStack.length > 0} hasMore={page.hasMore} busy={loading || busy} onPrevious={() => { const stack = [...backStack]; const previous = stack.pop() ?? null; setBackStack(stack); setCursor(previous); }} onNext={() => { if (!page.nextCursor) return; setBackStack((stack) => [...stack, cursor]); setCursor(page.nextCursor); }} /></div>
    </Card>

    <DetailDrawer open={Boolean(editing)} title="진단 메타데이터 수정" description="점수와 진단 항목은 원본 증거로 유지됩니다." busy={busy} onClose={() => setEditing(null)} footer={editing && <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditing(null)}>취소</Button><Button type="submit" form="audit-metadata-form" disabled={busy || !editTitle.trim()}>{busy ? "저장 중…" : "저장"}</Button></div>}>
      {editing && <form id="audit-metadata-form" className="space-y-4" onSubmit={save}><label className="block text-sm">제목<input className="mt-2" required maxLength={120} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} /></label><label className="block text-sm">메모<textarea className="mt-2 min-h-40" maxLength={5000} value={editNotes} onChange={(event) => setEditNotes(event.target.value)} /></label><div className="rounded-xl border border-white/7 bg-slate-900/50 p-3 text-xs leading-5 text-slate-500">진단 URL, 점수, 판정과 32개 항목은 생성 당시의 불변 증거입니다.</div></form>}
    </DetailDrawer>

    <ConfirmDialog open={Boolean(deleteTarget)} title="진단 이력을 영구 삭제할까요?" description={deleteTarget && <><strong className="text-white">{deleteTarget.title || deleteTarget.url}</strong>과 32개 진단 증거가 삭제됩니다. 연결된 리포트 프리셋은 유지되지만 원본 연결이 해제됩니다.</>} requiredText={deleteTarget?.title || deleteTarget?.url} confirmLabel="진단 삭제" destructive busy={busy} onClose={() => setDeleteTarget(null)} onConfirm={remove} />
  </>;
}
