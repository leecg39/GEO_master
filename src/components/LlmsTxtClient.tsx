"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { CheckCircle2, Copy, Download, FileCode2, Globe2, LoaderCircle, RefreshCw, Save, ShieldAlert, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/CrudPrimitives";
import { Badge, Button, Card, EmptyState, PageHeader, Progress } from "@/components/ui";

interface Validation { valid: boolean; score: number; issues: { severity: "error" | "warning" | "info"; code: string; message: string; line?: number }[]; stats: { bytes: number; lines: number; sections: number; links: number; errors: number; warnings: number } }
interface Settings { brandName: string; category: string }
async function json<T>(response: Response): Promise<T> { const body = await response.json() as T & { error?: string }; if (!response.ok) throw new Error(body.error ?? "요청에 실패했습니다."); return body; }

export function LlmsTxtClient() {
  const editedDefaults = useRef({ brandName: false, summary: false });
  const [brandName, setBrandName] = useState(""); const [website, setWebsite] = useState(""); const [summary, setSummary] = useState(""); const [details, setDetails] = useState("");
  const [resources, setResources] = useState("홈 | https://example.com/ | 브랜드와 핵심 서비스 소개\n서비스 | https://example.com/service | 주요 기능과 이용 대상");
  const [document, setDocument] = useState(""); const [validation, setValidation] = useState<Validation | null>(null); const [remoteUrl, setRemoteUrl] = useState(""); const [remoteContentType, setRemoteContentType] = useState("");
  const [loading, setLoading] = useState(false); const [remoteLoading, setRemoteLoading] = useState(false); const [error, setError] = useState("");
  const [title, setTitle] = useState("공식 llms.txt");
  const [targetPath, setTargetPath] = useState("/llms.txt");
  const [language, setLanguage] = useState("ko");
  const [remoteMatch, setRemoteMatch] = useState<boolean | null>(null);
  const [remoteDocument, setRemoteDocument] = useState("");
  const [revisions, setRevisions] = useState<Array<{ id: number; document: string; targetPath: string; createdAt: string }>>([]);
  const [comparison, setComparison] = useState("");
  const [savedId, setSavedId] = useState<number | null>(null);
  const [savedUpdatedAt, setSavedUpdatedAt] = useState("");
  const [documents, setDocuments] = useState<Array<{ id: number; title: string; status: string; updatedAt: string }>>([]);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; title: string; updatedAt: string } | null>(null);

  async function loadDocuments() {
    const data = await json<{ items: Array<{ id: number; title: string; status: string; updatedAt: string }> }>(await fetch("/api/llms-documents?limit=20"));
    setDocuments(data.items);
  }
  useEffect(() => { let active = true; void (async () => { try { const data = await json<{ settings: Settings }>(await fetch("/api/settings")); if (active) { if (!editedDefaults.current.brandName) setBrandName(data.settings.brandName); if (!editedDefaults.current.summary && data.settings.category) setSummary(`${data.settings.brandName || "브랜드"}은(는) ${data.settings.category} 정보를 제공하는 공식 웹사이트입니다.`); } } catch { /* 직접 입력으로 계속 사용할 수 있다. */ } try { if (active) await loadDocuments(); } catch { /* 이력은 없어도 편집 가능 */ } })();
    const onProject = () => { active = false; setSavedId(null); setSavedUpdatedAt(""); setDocument(""); setWebsite(""); setBrandName(""); setSummary(""); setDetails(""); setValidation(null); setRemoteMatch(null); setRemoteUrl(""); setRemoteDocument(""); setTargetPath("/llms.txt"); setRevisions([]); setComparison(""); void loadDocuments().catch(() => undefined); };
    window.addEventListener("geo-master:project-changed", onProject);
    return () => { active = false; window.removeEventListener("geo-master:project-changed", onProject); };
  }, []);

  function parsedLinks() { return resources.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => { const [title = "", url = "", description = ""] = line.split("|").map((part) => part.trim()); return { title, url, description }; }); }
  async function generate(event: FormEvent) { event.preventDefault(); setLoading(true); setError(""); try { const data = await json<{ result: { document: string; validation: Validation } }>(await fetch("/api/llms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "generate", input: { brandName, website, summary, details, sections: [{ heading: "핵심 문서", links: parsedLinks() }] } }) })); setDocument(data.result.document); setValidation(data.result.validation); setRemoteMatch(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "초안을 만들지 못했습니다."); } finally { setLoading(false); } }
  async function validate() { setLoading(true); setError(""); try { const data = await json<{ result: { validation: Validation } }>(await fetch("/api/llms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "validate", document, website: website || undefined }) })); setValidation(data.result.validation); } catch (cause) { setError(cause instanceof Error ? cause.message : "검증하지 못했습니다."); } finally { setLoading(false); } }
  async function verifyRemote() {
    setRemoteLoading(true); setError(""); setRemoteMatch(null);
    try {
      if (savedId) {
        const saved = await json<{ document: { document: string; targetPath: string; website: string } }>(await fetch(`/api/llms-documents/${savedId}`));
        if (saved.document.document !== document || saved.document.targetPath !== targetPath || saved.document.website !== website) throw new Error("편집한 내용과 게시 경로를 먼저 저장해 주세요.");
        const data = await json<{ document: { remoteDocument: string; remoteMatch: boolean; status: string; remoteUrl: string; remoteContentType: string; validation: Validation; updatedAt: string } }>(await fetch(`/api/llms-documents/${savedId}/remote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedUpdatedAt: savedUpdatedAt }) }));
        setRemoteDocument(data.document.remoteDocument); setRemoteMatch(data.document.status === "deployed");
        setValidation(data.document.validation); setRemoteUrl(data.document.remoteUrl); setRemoteContentType(data.document.remoteContentType); setSavedUpdatedAt(data.document.updatedAt);
        await loadDocuments();
      } else {
        const data = await json<{ result: { url: string; contentType: string; document: string; validation: Validation; verified: boolean } }>(await fetch("/api/llms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "remote", website, targetPath, expectedDocument: document }) }));
        setRemoteDocument(data.result.document); setRemoteMatch(data.result.verified); setValidation(data.result.validation); setRemoteUrl(data.result.url); setRemoteContentType(data.result.contentType);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "공개 파일을 확인하지 못했습니다."); }
    finally { setRemoteLoading(false); }
  }
  function download() { if (!validation?.valid) return; const blob = new Blob([document], { type: "text/markdown;charset=utf-8" }); const link = window.document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = targetPath.split("/").at(-1) || "llms.txt"; link.click(); window.setTimeout(() => URL.revokeObjectURL(link.href), 0); }
  async function saveDocument() {
    setLoading(true); setError(""); setRemoteMatch(null);
    try {
      const payload = { title, website, brandName, summary, details, resources: parsedLinks(), document, targetPath, language };
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
    editedDefaults.current = { brandName: true, summary: true };
    try {
      const data = await json<{ document: { id: number; title: string; website: string; brandName: string; summary: string; details: string; resources: Array<{ title: string; url: string; description: string }>; document: string; validation: Validation; updatedAt: string } }>(await fetch(`/api/llms-documents/${id}`));
      const doc = data.document as typeof data.document & { targetPath: string; language: string; remoteDocument: string | null; remoteMatch: boolean | null };
      setTargetPath(doc.targetPath); setLanguage(doc.language); setRemoteDocument(doc.remoteDocument || ""); setRemoteMatch(doc.remoteMatch);
      const history = await json<{ revisions: Array<{ id: number; document: string; targetPath: string; createdAt: string }> }>(await fetch(`/api/llms-documents/${id}/revisions`));
      setRevisions(history.revisions); setComparison("");
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

  return <div><PageHeader eyebrow="AI discovery file" title="llms.txt 워크플로" description="경로와 언어별 AI 안내 파일을 작성하고 버전·원격 내용 차이를 확인합니다. 문서 생성과 게시 확인을 구분합니다." action={<a href="https://llmstxt.org" target="_blank" rel="noreferrer"><Badge tone="cyan">제안 형식 참고</Badge></a>} />
    <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]"><Card><form onSubmit={generate} className="space-y-4"><h2 className="font-semibold text-white">초안 정보</h2><label className="block text-sm">게시 경로<input className="mt-2" value={targetPath} onChange={e => { setTargetPath(e.target.value); setRemoteMatch(null); }} placeholder="/docs/llms.txt" list="ai-file-paths" /><datalist id="ai-file-paths"><option value="/llms.txt" /><option value="/llms-ko.txt" /><option value="/ai.txt" /><option value="/ai-ko.txt" /></datalist></label><label className="block text-sm">문서 언어<select className="mt-2" value={language} onChange={e => setLanguage(e.target.value)}><option value="ko">한국어</option><option value="en">영어</option></select></label><p className="text-xs leading-5 text-slate-500">llms-ko.txt·ai.txt·ai-ko.txt는 큐샵 호환용 선택 파일입니다. 공통 강제 규격이나 번역 기능이 아닙니다. sitemap.xml은 운영 시스템에서 관리하고 robots.txt 정책은 별도로 검토하세요.</p><label className="text-sm">저장 제목<input className="mt-2" value={title} onChange={(e) => setTitle(e.target.value)} /></label><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">사이트·브랜드명<input className="mt-2" required value={brandName} onChange={(e) => { editedDefaults.current.brandName = true; setBrandName(e.target.value); }} /></label><label className="text-sm">공식 사이트 URL<input className="mt-2" type="url" required value={website} onChange={(e) => setWebsite(e.target.value)} onBlur={() => { if (website) setResources((current) => current.replaceAll("https://example.com", website.replace(/\/$/, ""))); }} placeholder="https://example.com" /></label></div><label className="block text-sm">한 줄 요약<textarea className="mt-2" rows={3} value={summary} onChange={(e) => { editedDefaults.current.summary = true; setSummary(e.target.value); }} placeholder="누구에게 어떤 정보와 가치를 제공하는 공식 사이트인지 설명하세요." /></label><label className="block text-sm">추가 안내 <span className="text-slate-600">(선택)</span><textarea className="mt-2" rows={4} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="AI가 문서를 선택할 때 알아야 할 범위, 기준일, 언어 등을 적으세요." /></label><label className="block text-sm">핵심 문서 <span className="text-xs text-slate-600">(한 줄: 제목 | 절대 URL | 설명)</span><textarea className="mt-2 font-mono text-xs" rows={7} required value={resources} onChange={(e) => setResources(e.target.value)} /></label><div className="grid gap-2 sm:grid-cols-2"><Button className="w-full" disabled={loading}>{loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileCode2 className="h-4 w-4" />}초안 생성</Button><Button type="button" variant="secondary" className="w-full" disabled={loading || !brandName || !website} onClick={() => void saveDocument()}><Save className="h-4 w-4" />문서 저장</Button></div></form></Card>
      <Card><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-white">llms.txt 편집기</h2><p className="mt-1 text-xs text-slate-500">H1 → 선택 요약 → H2별 문서 링크 · 품질 권고와 형식 오류 구분</p></div><div className="flex gap-2"><Button type="button" variant="secondary" disabled={!document || loading} onClick={() => void validate()}><RefreshCw className="h-4 w-4" />검증</Button><Button type="button" variant="secondary" disabled={!document || !validation?.valid} onClick={download}><Download className="h-4 w-4" />다운로드</Button></div></div>{document ? <textarea aria-label="llms.txt 내용" className="min-h-[28rem] font-mono text-xs leading-5" value={document} onChange={(e) => { setDocument(e.target.value); setValidation(null); setRemoteMatch(null); }} /> : <EmptyState>왼쪽 정보를 입력해 llms.txt 초안을 만드세요.</EmptyState>}</Card></div>
    {error && <p role="alert" className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-300">{error}</p>}
    <section className="mt-5 grid gap-5 xl:grid-cols-[1fr_0.7fr]">{validation ? <Card><div className="flex items-start justify-between"><div><h2 className="font-semibold text-white">구조 검증</h2><p className="mt-1 text-xs text-slate-500">{validation.stats.bytes} bytes · {validation.stats.sections} sections · {validation.stats.links} links</p></div><Badge tone={validation.valid ? "good" : "bad"}>{validation.valid ? "배포 가능" : "수정 필요"}</Badge></div><div className="mt-5 flex items-center gap-4"><strong className="text-3xl text-white">{validation.score}</strong><Progress value={validation.score} ariaLabel="llms.txt 구조 점수" className="flex-1" /></div><div className="mt-5 space-y-2" role="list" aria-live="polite">{validation.issues.length ? validation.issues.map((issue, index) => <div role="listitem" key={`${issue.code}-${index}`} className={`flex gap-3 rounded-xl p-3 text-sm ${issue.severity === "error" ? "bg-rose-400/8 text-rose-300" : issue.severity === "warning" ? "bg-amber-400/8 text-amber-300" : "bg-slate-950/40 text-slate-400"}`}>{issue.severity === "error" ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}<span><span className="sr-only">{issue.severity === "error" ? "오류: " : issue.severity === "warning" ? "경고: " : "정보: "}</span>{issue.line ? `${issue.line}행 · ` : ""}{issue.message}</span></div>) : <p className="rounded-xl bg-emerald-400/8 p-3 text-sm text-emerald-300">제안 구조에 맞습니다.</p>}</div></Card> : <Card><EmptyState>초안을 생성하거나 편집한 문서를 검증하세요.</EmptyState></Card>}
      <Card><div className="flex items-center gap-3"><Globe2 className="h-5 w-5 text-cyan-400" /><div><h2 className="font-semibold text-white">배포 확인</h2><p className="text-xs text-slate-500">지정한 경로의 파일 내용 비교</p></div></div><p className="mt-4 text-xs leading-5 text-slate-500">게시 경로의 HTTP 응답·MIME·문서 내용이 작성한 초안과 일치하는지 확인합니다. 초안은 원격 파일로 덮어쓰지 않습니다.</p><Button type="button" className="mt-5 w-full" variant="secondary" disabled={!website || remoteLoading} onClick={() => void verifyRemote()}>{remoteLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Globe2 className="h-4 w-4" />}공개 파일 재검증</Button>{remoteMatch !== null && <p role="status" className="mt-3 text-sm text-cyan-300">{remoteMatch ? "작성한 파일과 내용 일치" : "작성한 파일과 내용이 다르거나 형식 확인 실패"}</p>}{remoteDocument && <details className="mt-3 text-xs"><summary>원격 파일 비교</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">{remoteDocument}</pre></details>}{remoteUrl && <p className="mt-3 break-all text-xs text-emerald-300">확인: {remoteUrl}<br /><span className="text-slate-500">{remoteContentType || "content-type 없음"}</span></p>}</Card></section>
    {revisions.length > 0 && <Card className="mt-5"><h2 className="font-semibold text-white">파일 버전 비교</h2><select aria-label="비교할 저장 버전" className="mt-3" onChange={e => setComparison(revisions.find(r => r.id === Number(e.target.value))?.document || "")}><option value="">저장한 버전 선택</option>{revisions.map(revision => <option value={revision.id} key={revision.id}>{revision.createdAt} · {revision.targetPath}</option>)}</select>{comparison && <div className="mt-4 grid gap-4 md:grid-cols-2"><div><p className="mb-2 text-xs">선택한 이전 버전</p><pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs text-slate-400">{comparison}</pre></div><div><p className="mb-2 text-xs">현재 편집본 · {comparison === document ? "내용 일치" : "내용 변경됨"}</p><pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs text-slate-400">{document}</pre></div></div>}</Card>}
    <Card className="mt-5"><h2 className="font-semibold text-white">저장된 AI 안내 파일</h2>{documents.length ? <div className="mt-3 divide-y divide-white/5">{documents.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-3"><button type="button" className="min-w-0 text-left" onClick={() => void openDocument(item.id)}><p className="truncate text-sm text-slate-200">{item.title}</p><p className="text-xs text-slate-600">{item.status}</p></button><div className="flex"><button type="button" aria-label={`${item.title} 복제`} onClick={() => void duplicateDocument(item.id)} className="rounded-lg p-2 text-slate-500 hover:text-cyan-300"><Copy className="h-4 w-4" /></button><button type="button" aria-label={`${item.title} 삭제`} onClick={() => setDeleteTarget(item)} className="rounded-lg p-2 text-slate-600 hover:text-rose-400"><Trash2 className="h-4 w-4" /></button></div></div>)}</div> : <p className="mt-3 text-sm text-slate-600">저장한 문서가 없습니다.</p>}</Card>
    <ConfirmDialog open={Boolean(deleteTarget)} title="llms.txt 문서를 삭제할까요?" description={deleteTarget && <>{deleteTarget.title} 초안과 검증 결과가 삭제됩니다.</>} confirmLabel="문서 삭제" destructive onClose={() => setDeleteTarget(null)} onConfirm={removeDocument} />
  </div>;
}
