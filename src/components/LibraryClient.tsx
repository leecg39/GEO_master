"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { BookOpen, Plus } from "lucide-react";
import { Button, Card, EmptyState, PageHeader } from "./ui";
import { ConfirmDialog } from "./CrudPrimitives";
import { haloApi, safeExternalUrl } from "./halo-api";
import type { KnowledgeDocument, WritingProfile } from "@/lib/library";

export function LibraryClient({ projectId, documents: initialDocuments, profiles: initialProfiles }: { projectId: number; documents: KnowledgeDocument[]; profiles: WritingProfile[] }) {
  const [tab, setTab] = useState<"documents" | "profiles">("documents");
  const [documents, setDocuments] = useState(initialDocuments), [profiles, setProfiles] = useState(initialProfiles);
  const [editing, setEditing] = useState<KnowledgeDocument | WritingProfile | null>(null);
  const [name, setName] = useState(""), [body, setBody] = useState(""), [sourceUrl, setSourceUrl] = useState(""), [notes, setNotes] = useState("");
  const [audience, setAudience] = useState(""), [tone, setTone] = useState(""), [forbidden, setForbidden] = useState(""), [samples, setSamples] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [deleting, setDeleting] = useState<KnowledgeDocument | WritingProfile | null>(null);
  const endpoint = tab === "documents" ? "/api/knowledge-documents" : "/api/writing-profiles";
  function reset() { setEditing(null); setName(""); setBody(""); setSourceUrl(""); setNotes(""); setAudience(""); setTone(""); setForbidden(""); setSamples(""); }
  function edit(item: KnowledgeDocument | WritingProfile) {
    reset(); setEditing(item); setName(item.data.name); setError(""); setMessage("");
    if ("body" in item.data) { setBody(item.data.body); setSourceUrl(item.data.sourceUrl); setNotes(item.data.notes); }
    else { setAudience(item.data.audience); setTone(item.data.tone); setForbidden(item.data.forbiddenTerms.join(", ")); setSamples(item.data.samples); }
  }
  async function reload() {
    const [docs, styles] = await Promise.all([haloApi<{ items: KnowledgeDocument[] }>("/api/knowledge-documents", projectId), haloApi<{ items: WritingProfile[] }>("/api/writing-profiles", projectId)]);
    setDocuments(docs.items); setProfiles(styles.items);
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    const data = tab === "documents" ? { name, body, sourceUrl, notes } : { name, audience, tone, forbiddenTerms: forbidden.split(",").map(v => v.trim()).filter(Boolean), samples };
    try { await haloApi(endpoint + (editing ? `/${editing.id}` : ""), projectId, editing ? "PATCH" : "POST", editing ? { data, expectedUpdatedAt: editing.updatedAt } : data); await reload(); reset(); setMessage("저장했습니다."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "저장 실패"); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!deleting) return; setBusy(true); setError("");
    try { await haloApi(`${endpoint}/${deleting.id}`, projectId, "DELETE", { expectedUpdatedAt: deleting.updatedAt }); if (editing?.id === deleting.id) reset(); setDeleting(null); await reload(); setMessage("삭제했습니다. 과거 생성 문맥은 보존됩니다."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "삭제 실패"); setDeleting(null); }
    finally { setBusy(false); }
  }
  return <div>
    <PageHeader eyebrow="CONTENT LIBRARY" title="지식 자료·작성 페르소나" description="브랜드 자료와 문체를 준비하고 콘텐츠 스튜디오에서 선택하세요. 참고 자료의 수치는 사실 메모에서 별도로 확인해야 합니다." action={<Link className="text-sm underline" href="/studio">스튜디오로 이동</Link>} />
    <div className="mb-5 flex flex-wrap gap-2" aria-label="라이브러리 분류">
      <Button variant={tab === "documents" ? "primary" : "secondary"} disabled={busy} onClick={() => { setTab("documents"); reset(); }}>브랜드 자료</Button>
      <Button variant={tab === "profiles" ? "primary" : "secondary"} disabled={busy} onClick={() => { setTab("profiles"); reset(); }}>작성 페르소나</Button>
    </div>
    {error && <p role="alert" className="mb-4 text-rose-300">{error} <button className="underline" onClick={() => void reload().catch(() => {})}>목록 새로고침</button></p>}
    {message && <p role="status" className="mb-4 text-emerald-300">{message}</p>}
    <div className="grid gap-5 xl:grid-cols-2">
      <Card><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">{tab === "documents" ? "브랜드 자료" : "작성 페르소나"}</h2><Button variant="secondary" disabled={busy} onClick={reset}><Plus className="h-4 w-4" />새 항목</Button></div>
        {!(tab === "documents" ? documents : profiles).length && <EmptyState>등록된 항목이 없습니다. 첫 자료를 준비해 보세요.</EmptyState>}
        <ul className="space-y-3">{(tab === "documents" ? documents : profiles).map(item => <li key={item.id} className="rounded-xl border border-white/10 p-4">
          <div className="flex items-start gap-3"><BookOpen className="h-5 w-5 shrink-0" /><div className="min-w-0 flex-1"><h3 className="break-words font-semibold">{item.data.name}</h3><p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-slate-400">{"body" in item.data ? item.data.body : `${item.data.audience} · ${item.data.tone}`}</p>
            {"sourceUrl" in item.data && safeExternalUrl(item.data.sourceUrl) && <a href={safeExternalUrl(item.data.sourceUrl)} target="_blank" rel="noopener noreferrer" className="mt-2 block break-all text-sm underline">출처 열기</a>}</div></div>
          <div className="mt-3 flex gap-2"><Button variant="secondary" disabled={busy} onClick={() => edit(item)}>편집</Button><Button variant="danger" disabled={busy} onClick={() => setDeleting(item)}>삭제</Button></div>
        </li>)}</ul>
      </Card>
      <Card><h2 className="mb-4 font-semibold">{editing ? "항목 편집" : "새 항목 등록"}</h2><form onSubmit={save}><fieldset disabled={busy} className="space-y-4">
        <label className="block text-sm">이름<input required maxLength={120} className="mt-2" value={name} onChange={e => setName(e.target.value)} /></label>
        {tab === "documents" ? <>
          <label className="block text-sm">자료 본문<textarea required rows={10} maxLength={20_000} className="mt-2" value={body} onChange={e => setBody(e.target.value)} /></label>
          <label className="block text-sm">출처 URL<input type="url" maxLength={2048} className="mt-2" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://example.com/product" /></label>
          <label className="block text-sm">메모<textarea rows={3} maxLength={2000} className="mt-2" value={notes} onChange={e => setNotes(e.target.value)} /></label>
          <p className="text-sm text-slate-400">자료는 자동 수집되지 않습니다. 가격·수치·인증은 <Link href="/facts" className="underline">사실 메모</Link>에서 확인하세요.</p>
        </> : <>
          <label className="block text-sm">대상 독자<textarea rows={2} maxLength={1000} className="mt-2" value={audience} onChange={e => setAudience(e.target.value)} /></label>
          <label className="block text-sm">문체<textarea rows={2} maxLength={1000} className="mt-2" value={tone} onChange={e => setTone(e.target.value)} /></label>
          <label className="block text-sm">금지 표현 (쉼표 구분)<input className="mt-2" value={forbidden} onChange={e => setForbidden(e.target.value)} /></label>
          <label className="block text-sm">예문<textarea rows={6} maxLength={5000} className="mt-2" value={samples} onChange={e => setSamples(e.target.value)} /></label>
        </>}
        <div className="flex gap-2"><Button type="submit">{busy ? "저장 중…" : "저장"}</Button>{editing && <Button type="button" variant="secondary" onClick={reset}>편집 취소</Button>}</div>
      </fieldset></form></Card>
    </div>
    <ConfirmDialog open={!!deleting} title="자료 삭제" description="이 항목을 삭제합니다. 이전 콘텐츠에 저장된 생성 당시 자료는 유지됩니다." busy={busy} destructive onClose={() => setDeleting(null)} onConfirm={remove} />
  </div>;
}
