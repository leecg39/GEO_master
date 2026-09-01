"use client";

import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, Copy, Download, FileCode2, Globe2, LoaderCircle, RefreshCw, Save, ShieldAlert, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/CrudPrimitives";
import { Badge, Button, Card, EmptyState, PageHeader, Progress } from "@/components/ui";

interface Validation { valid: boolean; score: number; issues: { severity: "error" | "warning" | "info"; code: string; message: string; line?: number }[]; stats: { bytes: number; lines: number; sections: number; links: number; errors: number; warnings: number } }
interface Settings { brandName: string; category: string }
async function json<T>(response: Response): Promise<T> { const body = await response.json() as T & { error?: string }; if (!response.ok) throw new Error(body.error ?? "요청에 실패했습니다."); return body; }

export function LlmsTxtClient() {
  const [brandName, setBrandName] = useState(""); const [website, setWebsite] = useState(""); const [summary, setSummary] = useState(""); const [details, setDetails] = useState("");
  const [resources, setResources] = useState("홈 | https://example.com/ | 브랜드와 핵심 서비스 소개\n서비스 | https://example.com/service | 주요 기능과 이용 대상");
  const [document, setDocument] = useState(""); const [validation, setValidation] = useState<Validation | null>(null); const [remoteUrl, setRemoteUrl] = useState(""); const [remoteContentType, setRemoteContentType] = useState("");
  const [loading, setLoading] = useState(false); const [remoteLoading, setRemoteLoading] = useState(false); const [error, setError] = useState("");
  const [title, setTitle] = useState("공식 llms.txt");
  const [savedId, setSavedId] = useState<number | null>(null);
  const [savedUpdatedAt, setSavedUpdatedAt] = useState("");
  const [documents, setDocuments] = useState<Array<{ id: number; title: string; status: string; updatedAt: string }>>([]);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; title: string; updatedAt: string } | null>(null);

  async function loadDocuments() {
    const data = await json<{ items: Array<{ id: number; title: string; status: string; updatedAt: string }> }>(await fetch("/api/llms-documents?limit=20"));
    setDocuments(data.items);
  }
  useEffect(() => { void (async () => { try { const data = await json<{ settings: Settings }>(await fetch("/api/settings")); setBrandName(data.settings.brandName); if (data.settings.category) setSummary(`${data.settings.brandName || "브랜드"}은(는) ${data.settings.category} 정보를 제공하는 공식 웹사이트입니다.`); } catch { /* 직접 입력으로 계속 사용할 수 있다. */ } try { await loadDocuments(); } catch { /* 이력은 없어도 편집 가능 */ } })();
    const onProject = () => { setSavedId(null); void loadDocuments().catch(() => undefined); };
    window.addEventListener("geo-master:project-changed", onProject);
    return () => window.removeEventListener("geo-master:project-changed", onProject);
  }, []);

  function parsedLinks() { return resources.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => { const [title = "", url = "", description = ""] = line.split("|").map((part) => part.trim()); return { title, url, description }; }); }
  async function generate(event: FormEvent) { event.preventDefault(); setLoading(true); setError(""); try { const data = await json<{ result: { document: string; validation: Validation } }>(await fetch("/api/llms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "generate", input: { brandName, website, summary, details, sections: [{ heading: "핵심 문서", links: parsedLinks() }] } }) })); setDocument(data.result.document); setValidation(data.result.validation); } catch (cause) { setError(cause instanceof Error ? cause.message : "초안을 만들지 못했습니다."); } finally { setLoading(false); } }
  async function validate() { setLoading(true); setError(""); try { const data = await json<{ result: { validation: Validation } }>(await fetch("/api/llms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "validate", document, website: website || undefined }) })); setValidation(data.result.validation); } catch (cause) { setError(cause instanceof Error ? cause.message : "검증하지 못했습니다."); } finally { setLoading(false); } }
  async function verifyRemote() { setRemoteLoading(true); setError(""); try { const data = await json<{ result: { url: string; contentType: string; document: string; validation: Validation } }>(await fetch("/api/llms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "remote", website }) })); setDocument(data.result.document); setValidation(data.result.validation); setRemoteUrl(data.result.url); setRemoteContentType(data.result.contentType); } catch (cause) { setError(cause instanceof Error ? cause.message : "배포 파일을 확인하지 못했습니다."); } finally { setRemoteLoading(false); } }
  function download() { if (!validation?.valid) return; const blob = new Blob([document], { type: "text/markdown;charset=utf-8" }); const link = window.document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "llms.txt"; link.click(); window.setTimeout(() => URL.revokeObjectURL(link.href), 0); }
  async function saveDocument() {
    setLoading(true); setError("");
    try {
      const payload = { title, website, brandName, summary, details, resources: parsedLinks(), document };
      if (savedId && savedUpdatedAt) {
        const data = await json<{ document: { id: number; updatedAt: string; validation: Validation } }>(await fetch(`/api/llms-documents/${savedId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, expectedUpdatedAt: savedUpdatedAt }) }));
        setSavedUpdatedAt(data.document.updatedAt); setValidation(data.document.validation);
      } else {
        const data = await json<{ document: { id: number; updatedAt: string; validation: Validation; document: string } }>(await fetch("/api/llms-documents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
        setSavedId(data.document.id); setSavedUpdatedAt(data.document.updatedAt); setDocument(data.document.document); setValidation(data.document.validation);
      }
      await loadDocuments();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "문서를 저장하지 못했습니다."); }
    finally { setLoading(false); }
  }
  async function openDocument(id: number) {
    try {
      const data = await json<{ document: { id: number; title: string; website: string; brandName: string; summary: string; details: string; resources: Array<{ title: string; url: string; description: string }>; document: string; validation: Validation; updatedAt: string } }>(await fetch(`/api/llms-documents/${id}`));
      const doc = data.document;
      setSavedId(doc.id); setSavedUpdatedAt(doc.updatedAt); setTitle(doc.title); setWebsite(doc.website);
      setBrandName(doc.brandName); setSummary(doc.summary); setDetails(doc.details); setDocument(doc.document);
      setValidation(doc.validation);
      setResources(doc.resources.map((item) => `${item.title} | ${item.url} | ${item.description}`).join("\n"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "문서를 열지 못했습니다."); }
  }
  async function duplicateDocument(id: number) {
    try {
      const data = await json<{ document: { id: number; updatedAt: string } }>(await fetch(`/api/llms-documents/${id}/duplicate`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
      await loadDocuments();
      await openDocument(data.document.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "문서를 복제하지 못했습니다."); }
  }
  async function removeDocument() {
    if (!deleteTarget) return;
    try {
      const response = await fetch(`/api/llms-documents/${deleteTarget.id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedUpdatedAt: deleteTarget.updatedAt }) });
      if (!response.ok) throw new Error("삭제하지 못했습니다.");
      if (savedId === deleteTarget.id) { setSavedId(null); setSavedUpdatedAt(""); }
      setDeleteTarget(null);
      await loadDocuments();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "문서를 삭제하지 못했습니다."); }
  }

  return <div><PageHeader eyebrow="AI discovery file" title="llms.txt 워크플로" description="공식 제안 형식의 AI용 사이트 안내 파일을 만들고, 문법을 검사하고, 배포된 /llms.txt까지 안전하게 확인합니다." action={<a href="https://llmstxt.org" target="_blank" rel="noreferrer"><Badge tone="cyan">제안 형식 참고</Badge></a>} />
    <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]"><Card><form onSubmit={generate} className="space-y-4"><h2 className="font-semibold text-white">초안 정보</h2><label className="text-sm">저장 제목<input className="mt-2" value={title} onChange={(e) => setTitle(e.target.value)} /></label><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">사이트·브랜드명<input className="mt-2" required value={brandName} onChange={(e) => setBrandName(e.target.value)} /></label><label className="text-sm">공식 사이트 URL<input className="mt-2" type="url" required value={website} onChange={(e) => setWebsite(e.target.value)} onBlur={() => { if (website) setResources((current) => current.replaceAll("https://example.com", website.replace(/\/$/, ""))); }} placeholder="https://example.com" /></label></div><label className="block text-sm">한 줄 요약<textarea className="mt-2" rows={3} required minLength={20} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="누구에게 어떤 정보와 가치를 제공하는 공식 사이트인지 설명하세요." /></label><label className="block text-sm">추가 안내 <span className="text-slate-600">(선택)</span><textarea className="mt-2" rows={4} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="AI가 문서를 선택할 때 알아야 할 범위, 기준일, 언어 등을 적으세요." /></label><label className="block text-sm">핵심 문서 <span className="text-xs text-slate-600">(한 줄: 제목 | 절대 URL | 설명)</span><textarea className="mt-2 font-mono text-xs" rows={7} required value={resources} onChange={(e) => setResources(e.target.value)} /></label><div className="grid gap-2 sm:grid-cols-2"><Button className="w-full" disabled={loading}>{loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileCode2 className="h-4 w-4" />}초안 생성</Button><Button type="button" variant="secondary" className="w-full" disabled={loading || !brandName || !website || !summary} onClick={() => void saveDocument()}><Save className="h-4 w-4" />문서 저장</Button></div></form></Card>
      <Card><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-white">llms.txt 편집기</h2><p className="mt-1 text-xs text-slate-500">H1 → blockquote 요약 → H2별 문서 링크 순서</p></div><div className="flex gap-2"><Button type="button" variant="secondary" disabled={!document || loading} onClick={() => void validate()}><RefreshCw className="h-4 w-4" />검증</Button><Button type="button" variant="secondary" disabled={!document || !validation?.valid} onClick={download}><Download className="h-4 w-4" />다운로드</Button></div></div>{document ? <textarea aria-label="llms.txt 내용" className="min-h-[28rem] font-mono text-xs leading-5" value={document} onChange={(e) => { setDocument(e.target.value); setValidation(null); }} /> : <EmptyState>왼쪽 정보를 입력해 llms.txt 초안을 만드세요.</EmptyState>}</Card></div>
    {error && <p role="alert" className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-300">{error}</p>}
    <section className="mt-5 grid gap-5 xl:grid-cols-[1fr_0.7fr]">{validation ? <Card><div className="flex items-start justify-between"><div><h2 className="font-semibold text-white">구조 검증</h2><p className="mt-1 text-xs text-slate-500">{validation.stats.bytes} bytes · {validation.stats.sections} sections · {validation.stats.links} links</p></div><Badge tone={validation.valid ? "good" : "bad"}>{validation.valid ? "배포 가능" : "수정 필요"}</Badge></div><div className="mt-5 flex items-center gap-4"><strong className="text-3xl text-white">{validation.score}</strong><Progress value={validation.score} ariaLabel="llms.txt 구조 점수" className="flex-1" /></div><div className="mt-5 space-y-2" role="list" aria-live="polite">{validation.issues.length ? validation.issues.map((issue, index) => <div role="listitem" key={`${issue.code}-${index}`} className={`flex gap-3 rounded-xl p-3 text-sm ${issue.severity === "error" ? "bg-rose-400/8 text-rose-300" : issue.severity === "warning" ? "bg-amber-400/8 text-amber-300" : "bg-slate-950/40 text-slate-400"}`}>{issue.severity === "error" ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}<span><span className="sr-only">{issue.severity === "error" ? "오류: " : issue.severity === "warning" ? "경고: " : "정보: "}</span>{issue.line ? `${issue.line}행 · ` : ""}{issue.message}</span></div>) : <p className="rounded-xl bg-emerald-400/8 p-3 text-sm text-emerald-300">제안 구조에 맞습니다.</p>}</div></Card> : <Card><EmptyState>초안을 생성하거나 편집한 문서를 검증하세요.</EmptyState></Card>}
      <Card><div className="flex items-center gap-3"><Globe2 className="h-5 w-5 text-cyan-400" /><div><h2 className="font-semibold text-white">배포 확인</h2><p className="text-xs text-slate-500">공식 사이트 루트의 /llms.txt 확인</p></div></div><p className="mt-4 text-xs leading-5 text-slate-500">사이트 URL을 기준으로 SSRF 방어형 크롤러가 공개 파일을 가져와 동일한 규칙으로 검사합니다.</p><Button type="button" className="mt-5 w-full" variant="secondary" disabled={!website || remoteLoading} onClick={() => void verifyRemote()}>{remoteLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Globe2 className="h-4 w-4" />}원격 /llms.txt 확인</Button>{remoteUrl && <p className="mt-3 break-all text-xs text-emerald-300">확인: {remoteUrl}<br /><span className="text-slate-500">{remoteContentType || "content-type 없음"}</span></p>}</Card></section>
    <Card className="mt-5"><h2 className="font-semibold text-white">저장된 llms.txt</h2>{documents.length ? <div className="mt-3 divide-y divide-white/5">{documents.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-3"><button type="button" className="min-w-0 text-left" onClick={() => void openDocument(item.id)}><p className="truncate text-sm text-slate-200">{item.title}</p><p className="text-xs text-slate-600">{item.status}</p></button><div className="flex"><button type="button" aria-label={`${item.title} 복제`} onClick={() => void duplicateDocument(item.id)} className="rounded-lg p-2 text-slate-500 hover:text-cyan-300"><Copy className="h-4 w-4" /></button><button type="button" aria-label={`${item.title} 삭제`} onClick={() => setDeleteTarget(item)} className="rounded-lg p-2 text-slate-600 hover:text-rose-400"><Trash2 className="h-4 w-4" /></button></div></div>)}</div> : <p className="mt-3 text-sm text-slate-600">저장한 문서가 없습니다.</p>}</Card>
    <ConfirmDialog open={Boolean(deleteTarget)} title="llms.txt 문서를 삭제할까요?" description={deleteTarget && <>{deleteTarget.title} 초안과 검증 결과가 삭제됩니다.</>} confirmLabel="문서 삭제" destructive onClose={() => setDeleteTarget(null)} onConfirm={removeDocument} />
  </div>;
}
