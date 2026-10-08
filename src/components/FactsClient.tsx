"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/CrudPrimitives";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";

type FactStatus = "verified" | "unverified" | "expired";
interface Fact {
  id: number; attribute: string; value: string; unit: string | null; conditions: string; sourceUrl: string | null;
  excerpt: string; checkedAt: string | null; validUntil: string | null; verified: boolean; status: FactStatus; updatedAt: string;
}
interface Draft {
  id?: number; attribute: string; value: string; unit: string; conditions: string; sourceUrl: string; excerpt: string;
  checkedAt: string; validUntil: string; verified: boolean; expectedUpdatedAt?: string;
}

const statusLabels: Record<FactStatus, { label: string; tone: "good" | "warn" | "bad" }> = {
  verified: { label: "확인됨", tone: "good" },
  unverified: { label: "미확인", tone: "warn" },
  expired: { label: "만료", tone: "bad" },
};

const emptyDraft: Draft = { attribute: "", value: "", unit: "", conditions: "", sourceUrl: "", excerpt: "", checkedAt: "", validUntil: "", verified: false };

function draftFor(fact: Fact): Draft {
  return {
    id: fact.id, attribute: fact.attribute, value: fact.value, unit: fact.unit ?? "", conditions: fact.conditions,
    sourceUrl: fact.sourceUrl ?? "", excerpt: fact.excerpt, checkedAt: fact.checkedAt ?? "", validUntil: fact.validUntil ?? "",
    verified: fact.verified, expectedUpdatedAt: fact.updatedAt,
  };
}

function payload(draft: Draft) {
  return {
    attribute: draft.attribute, value: draft.value, unit: draft.unit.trim() || null, conditions: draft.conditions,
    sourceUrl: draft.sourceUrl.trim() || null, excerpt: draft.excerpt, checkedAt: draft.checkedAt || null,
    validUntil: draft.validUntil || null, verified: draft.verified,
  };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || "요청을 처리하지 못했습니다.");
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export function FactsClient() {
  const [facts, setFacts] = useState<Fact[]>([]);
  const [attributes, setAttributes] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Fact | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await request<{ items: Fact[]; recommendedAttributes: string[] }>("/api/facts");
      setFacts(data.items);
      setAttributes(data.recommendedAttributes);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "사실 메모를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => { void load(); }, 0);
    const reload = () => { void load(); };
    window.addEventListener("geo-master:project-changed", reload);
    return () => {
      window.clearTimeout(initial);
      window.removeEventListener("geo-master:project-changed", reload);
    };
  }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || busy) return;
    setBusy(true);
    setError("");
    try {
      const body = draft.id ? { ...payload(draft), expectedUpdatedAt: draft.expectedUpdatedAt } : payload(draft);
      await request(draft.id ? `/api/facts/${draft.id}` : "/api/facts", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setDraft(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await request(`/api/facts/${pendingDelete.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: pendingDelete.updatedAt }),
      });
      setPendingDelete(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "삭제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof Draft, label: string, props: Record<string, unknown> = {}) => draft && (
    <label className="block text-xs">{label}<input className="mt-1.5" value={String(draft[key] ?? "")} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} {...props} /></label>
  );

  if (loading) return <div className="grid min-h-96 place-items-center"><LoaderCircle className="h-7 w-7 animate-spin text-cyan-400" /></div>;
  return (
    <div>
      <PageHeader
        eyebrow="Fact memos"
        title="사실 메모"
        description="공식 자료로 확인한 브랜드 사실을 기록합니다. AI 답변 속 주장 대조와 콘텐츠 초안의 유일한 수치 근거로 쓰이며, 확인되지 않았거나 유효기간이 지난 메모는 초안 근거로 쓰지 않습니다."
        action={<Button type="button" onClick={() => setDraft({ ...emptyDraft })}><Plus className="h-4 w-4" />사실 추가</Button>}
      />
      {error && <p role="alert" className="mb-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-300">{error}</p>}
      {draft && (
        <Card className="mb-5">
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
            <h2 className="font-semibold text-white sm:col-span-2">{draft.id ? "사실 메모 수정" : "사실 메모 추가"}</h2>
            {field("attribute", "속성 (예: 가격, 인증)", { required: true, maxLength: 60, list: "fact-attributes" })}
            <datalist id="fact-attributes">{attributes.map((attribute) => <option key={attribute} value={attribute} />)}</datalist>
            <div className="grid grid-cols-[1fr_96px] gap-2">{field("value", "값", { required: true, maxLength: 200 })}{field("unit", "단위", { maxLength: 20 })}</div>
            {field("conditions", "적용 조건 (선택)", { maxLength: 500 })}
            {field("sourceUrl", "출처 URL", { type: "url", maxLength: 2048, placeholder: "https://" })}
            {field("checkedAt", "확인일", { type: "date" })}
            {field("validUntil", "유효기간 (선택)", { type: "date" })}
            <label className="block text-xs sm:col-span-2">출처 발췌<textarea className="mt-1.5 min-h-20" maxLength={2000} value={draft.excerpt} onChange={(event) => setDraft({ ...draft, excerpt: event.target.value })} /></label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={draft.verified} onChange={(event) => setDraft({ ...draft, verified: event.target.checked })} />공식 자료로 확인했습니다</label>
            <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" onClick={() => setDraft(null)}>취소</Button><Button type="submit" disabled={busy}>{busy ? "저장 중…" : "저장"}</Button></div>
          </form>
        </Card>
      )}
      {facts.length === 0 ? <EmptyState>등록된 사실 메모가 없습니다. 가격·규격·인증처럼 AI가 틀리기 쉬운 사실부터 추가하세요.</EmptyState> : (
        <div className="space-y-3">
          {facts.map((fact) => (
            <Card key={fact.id} className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><Badge tone={statusLabels[fact.status].tone}>{statusLabels[fact.status].label}</Badge><strong className="text-white">{fact.attribute}</strong><span className="text-slate-300">{fact.value}{fact.unit ? ` ${fact.unit}` : ""}</span></div>
                {fact.conditions && <p className="mt-1 text-xs text-slate-500">조건: {fact.conditions}</p>}
                <p className="mt-1 text-xs text-slate-500">확인일 {fact.checkedAt ?? "-"} · 유효기간 {fact.validUntil ?? "없음"}</p>
                {fact.sourceUrl && <a className="mt-1 block truncate text-xs text-cyan-300 hover:underline" href={fact.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">{fact.sourceUrl}</a>}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button type="button" variant="secondary" aria-label={`${fact.attribute} 수정`} onClick={() => setDraft(draftFor(fact))}><Pencil className="h-4 w-4" /></Button>
                <Button type="button" variant="danger" aria-label={`${fact.attribute} 삭제`} onClick={() => setPendingDelete(fact)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="사실 메모 삭제"
        description={`'${pendingDelete?.attribute ?? ""}' 메모를 삭제합니다. 이 메모와 연결된 주장 대조 결과는 근거 없음으로 바뀝니다.`}
        confirmLabel="삭제"
        destructive
        busy={busy}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
