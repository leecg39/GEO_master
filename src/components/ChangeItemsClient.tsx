"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, LoaderCircle, Plus, Send, Trash2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";

type Status = "draft" | "approved" | "delivered" | "verification_pending" | "verified" | "conflict" | "failed";
interface Item {
  id: number; url: string; field: string; originalValue: string; proposedValue: string; rationale: string;
  status: Status; updatedAt: string;
}

const FIELDS: Record<string, string> = { title: "제목", description: "설명", canonical: "대표 URL", og_image: "OG 이미지", robots_meta: "robots 메타", json_ld: "JSON-LD", body: "본문" };
const STATUS: Record<Status, { label: string; tone: "default" | "good" | "warn" | "bad" | "cyan" }> = {
  draft: { label: "초안", tone: "default" }, approved: { label: "승인", tone: "cyan" }, delivered: { label: "전달됨", tone: "good" },
  verification_pending: { label: "확인 대기", tone: "warn" }, verified: { label: "확인됨", tone: "good" }, conflict: { label: "충돌", tone: "bad" }, failed: { label: "실패", tone: "bad" },
};
const empty = { url: "", field: "title", originalValue: "", proposedValue: "", rationale: "" };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error || "요청을 처리하지 못했습니다.");
  return body as T;
}
const send = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function ChangeItemsClient() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [form, setForm] = useState<typeof empty | null>(null);
  const [current, setCurrent] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setItems((await request<{ items: Item[] }>("/api/change-items")).items); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "불러오지 못했습니다."); setItems([]); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    const reload = () => { void load(); };
    window.addEventListener("geo-master:project-changed", reload);
    return () => { window.clearTimeout(timer); window.removeEventListener("geo-master:project-changed", reload); };
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await action(); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "처리하지 못했습니다."); } finally { setBusy(false); }
  }

  if (!items) return <div className="grid min-h-96 place-items-center"><LoaderCircle className="h-7 w-7 animate-spin text-cyan-400" /></div>;
  return (
    <div>
      <PageHeader eyebrow="Change workbench" title="수정안 작업대" description="페이지별 현재 값과 수정안, 근거를 나란히 두고 승인합니다. 자동 게시는 하지 않으며, 승인한 수정안을 직접 반영한 뒤 '전달 처리'로 기록합니다. 페이지의 현재 값이 달라지면 충돌로 표시됩니다."
        action={<Button type="button" onClick={() => setForm({ ...empty })}><Plus className="h-4 w-4" />수정안 추가</Button>} />
      {error && <p role="alert" className="mb-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-300">{error}</p>}
      {form && (
        <Card className="mb-5">
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void run(async () => { await request("/api/change-items", send("POST", form)); setForm(null); }); }}>
            <label className="block text-xs sm:col-span-2">페이지 URL<input className="mt-1.5" type="url" required placeholder="https://" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></label>
            <label className="block text-xs">항목<select className="mt-1.5" value={form.field} onChange={(e) => setForm({ ...form, field: e.target.value })}>{Object.entries(FIELDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <span />
            <label className="block text-xs">현재 값<textarea className="mt-1.5 min-h-24" value={form.originalValue} onChange={(e) => setForm({ ...form, originalValue: e.target.value })} /></label>
            <label className="block text-xs">수정안<textarea className="mt-1.5 min-h-24" required value={form.proposedValue} onChange={(e) => setForm({ ...form, proposedValue: e.target.value })} /></label>
            <label className="block text-xs sm:col-span-2">변경 이유·근거<textarea className="mt-1.5 min-h-16" value={form.rationale} onChange={(e) => setForm({ ...form, rationale: e.target.value })} /></label>
            <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" onClick={() => setForm(null)}>취소</Button><Button type="submit" disabled={busy}>저장</Button></div>
          </form>
        </Card>
      )}
      {items.length === 0 ? <EmptyState>수정안이 없습니다. 진단에서 찾은 문제를 수정안으로 추가하세요.</EmptyState> : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={STATUS[item.status].tone}>{STATUS[item.status].label}</Badge>
                <Badge>{FIELDS[item.field] ?? item.field}</Badge>
                <a className="truncate text-xs text-cyan-300 hover:underline" href={item.url} target="_blank" rel="noopener noreferrer nofollow">{item.url}</a>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div><p className="text-xs text-slate-500">현재 값</p><pre className="mt-1 whitespace-pre-wrap rounded-xl bg-slate-950/40 p-3 text-sm text-slate-400">{item.originalValue || "(비어 있음)"}</pre></div>
                <div><p className="text-xs text-slate-500">수정안</p><pre className="mt-1 whitespace-pre-wrap rounded-xl border border-cyan-400/15 bg-cyan-400/5 p-3 text-sm text-slate-200">{item.proposedValue}</pre></div>
              </div>
              {item.rationale && <p className="mt-2 text-xs text-slate-500">근거: {item.rationale}</p>}
              {item.status === "conflict" && <p className="mt-2 text-xs text-rose-300">페이지의 현재 값이 처음 기록한 값과 달라졌습니다. 현재 값을 확인해 수정안을 새로 만드세요.</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2 print:hidden">
                {item.status === "draft" && <Button type="button" disabled={busy} onClick={() => void run(() => request(`/api/change-items/${item.id}`, send("PATCH", { action: "approve", expectedUpdatedAt: item.updatedAt })))}><Check className="h-4 w-4" />승인</Button>}
                {item.status === "approved" && <Button type="button" disabled={busy} onClick={() => void run(() => request(`/api/change-items/${item.id}`, send("PATCH", { action: "deliver", method: "manual" })))}><Send className="h-4 w-4" />전달 처리(직접 반영함)</Button>}
                {["draft", "approved"].includes(item.status) && (
                  <span className="flex items-center gap-2">
                    <input aria-label="페이지의 현재 값 붙여넣기" className="w-56" placeholder="페이지의 지금 값으로 충돌 확인" value={current[item.id] ?? ""} onChange={(e) => setCurrent({ ...current, [item.id]: e.target.value })} />
                    <Button type="button" className="shrink-0 whitespace-nowrap" variant="secondary" disabled={busy || !(current[item.id] ?? "").length} onClick={() => void run(() => request(`/api/change-items/${item.id}`, send("PATCH", { action: "report-current", currentValue: current[item.id] })))}>충돌 확인</Button>
                  </span>
                )}
                <Button type="button" variant="danger" aria-label="수정안 삭제" disabled={busy} onClick={() => void run(() => request(`/api/change-items/${item.id}`, send("DELETE", { expectedUpdatedAt: item.updatedAt })))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
