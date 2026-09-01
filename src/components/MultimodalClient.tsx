"use client";

import { FormEvent, useCallback, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileImage, Film, Images, LoaderCircle } from "lucide-react";
import { MultimodalHistoryPanel, notifyMultimodalAuditChanged, type MultimodalContentResource } from "@/components/MultimodalHistoryPanel";
import { Badge, Button, Card, EmptyState, PageHeader, Progress } from "@/components/ui";

interface Issue { code: string; severity: "error" | "warning" | "info"; message: string }
interface ImageResult { index: number; src: string; filename: string; alt: string; decorative: boolean; chartLike: boolean; caption: string; companionText: string; score: number; issues: Issue[] }
interface VideoResult { index: number; kind: "native" | "embed"; src: string; title: string; captionLanguages: string[]; hasChapters: boolean; hasTranscript: boolean; score: number; issues: Issue[] }
interface PageResult { ok: boolean; url: string; finalUrl?: string; error?: string; result?: { summary: { total: number; discoveredImages: number; truncatedImages: number; withIssues: number; missingAlt: number; filenameIssues: number; charts: number; chartsWithoutData: number; averageScore: number; videos: number; discoveredVideos: number; truncatedVideos: number; videosWithoutCaptions: number; videosWithoutChapters: number }; images: ImageResult[]; videos: VideoResult[] } }
interface Audit { contentId: number; generatedAt: string; summary: { requested: number; succeeded: number; failed: number; images: number; videos: number; issues: number }; pages: PageResult[] }
async function json<T>(response: Response): Promise<T> { const body = await response.json() as T & { error?: string }; if (!response.ok) throw new Error(body.error ?? "요청에 실패했습니다."); return body; }


function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validIssue(value: unknown): value is Issue {
  const issue = record(value);
  return Boolean(issue && typeof issue.code === "string" && ["error", "warning", "info"].includes(String(issue.severity)) && typeof issue.message === "string");
}

function validImage(value: unknown): value is ImageResult {
  const image = record(value);
  return Boolean(image && typeof image.index === "number" && typeof image.src === "string" && typeof image.filename === "string"
    && typeof image.alt === "string" && typeof image.decorative === "boolean" && typeof image.chartLike === "boolean"
    && typeof image.caption === "string" && typeof image.companionText === "string" && typeof image.score === "number"
    && Array.isArray(image.issues) && image.issues.every(validIssue));
}

function validVideo(value: unknown): value is VideoResult {
  const video = record(value);
  return Boolean(video && typeof video.index === "number" && ["native", "embed"].includes(String(video.kind))
    && typeof video.src === "string" && typeof video.title === "string" && Array.isArray(video.captionLanguages)
    && video.captionLanguages.every((language) => typeof language === "string") && typeof video.hasChapters === "boolean"
    && typeof video.hasTranscript === "boolean" && typeof video.score === "number" && Array.isArray(video.issues)
    && video.issues.every(validIssue));
}

function storedAudit(content: MultimodalContentResource): Audit | null {
  const output = record(content.output);
  const summary = record(output?.summary);
  if (!output || !summary || typeof output.generatedAt !== "string" || !Array.isArray(output.pages)) return null;
  const summaryKeys = ["requested", "succeeded", "failed", "images", "videos", "issues"] as const;
  if (!summaryKeys.every((key) => typeof summary[key] === "number")) return null;
  const pages = output.pages;
  if (!pages.every((item) => {
    const page = record(item);
    if (!page || typeof page.ok !== "boolean" || typeof page.url !== "string") return false;
    if (!page.ok) return page.error === undefined || typeof page.error === "string";
    if (page.finalUrl !== undefined && typeof page.finalUrl !== "string") return false;
    const result = record(page.result);
    const pageSummary = record(result?.summary);
    if (!result || !pageSummary || !Array.isArray(result.images) || !Array.isArray(result.videos)) return false;
    const pageSummaryKeys = ["total", "discoveredImages", "truncatedImages", "withIssues", "missingAlt", "filenameIssues", "charts", "chartsWithoutData", "averageScore", "videos", "discoveredVideos", "truncatedVideos", "videosWithoutCaptions", "videosWithoutChapters"];
    return pageSummaryKeys.every((key) => typeof pageSummary[key] === "number")
      && result.images.every(validImage) && result.videos.every(validVideo);
  })) return null;
  return {
    contentId: content.id,
    generatedAt: output.generatedAt,
    summary: summary as unknown as Audit["summary"],
    pages: pages as PageResult[],
  };
}
export function MultimodalClient() {
  const [urls, setUrls] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [audit, setAudit] = useState<Audit | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef<string | null>(null);
  const urlList = useMemo(() => [...new Set(urls.split("\n").map((url) => url.trim()).filter(Boolean))], [urls]);

  const selectStoredAudit = useCallback((content: MultimodalContentResource | null) => {
    if (!content) { setAudit(null); return; }
    const stored = storedAudit(content);
    setAudit(stored);
    setError(stored ? "" : "저장된 감사 결과 형식이 올바르지 않습니다.");
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setAudit(null);
    try {
      requestId.current ??= crypto.randomUUID();
      const data = await json<{ audit: Audit }>(await fetch("/api/multimodal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls: urlList, title, notes, clientRequestId: requestId.current }),
      }));
      setAudit(data.audit);
      notifyMultimodalAuditChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "감사에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }
  return <div><PageHeader eyebrow="Multimodal GEO" title="이미지·영상 일괄 감사" description="이미지 alt와 파일명, 차트 수치, 영상 자막·챕터·대본 신호를 여러 페이지에서 한 번에 점검합니다." />
    <Card><form onSubmit={submit} aria-busy={loading}><div className="mb-4 grid gap-4 sm:grid-cols-2"><label className="block text-sm">저장 제목 <span className="text-xs text-slate-600">(선택)</span><input className="mt-2" maxLength={120} value={title} onChange={(event) => { setTitle(event.target.value); requestId.current = null; }} placeholder="예: 핵심 랜딩 페이지 감사" /></label><label className="block text-sm">메모 <span className="text-xs text-slate-600">(선택)</span><input className="mt-2" maxLength={5000} value={notes} onChange={(event) => { setNotes(event.target.value); requestId.current = null; }} placeholder="담당자나 검토 목적" /></label></div><div className="flex items-center justify-between"><label htmlFor="multimodal-urls" className="font-semibold text-white">감사할 공개 URL</label><Badge>{urlList.length}/10</Badge></div><textarea id="multimodal-urls" className="mt-3" rows={6} required value={urls} onChange={(event) => { setUrls(event.target.value); requestId.current = null; }} placeholder="https://example.com/article&#10;https://example.com/report" /><div className="mt-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><p className="flex items-center gap-2 text-xs text-slate-500"><AlertTriangle className="h-3.5 w-3.5 text-amber-400" />공개 HTML만 수집하며 사설망·압축·2MB 초과 응답은 차단합니다.</p><Button type="submit" disabled={loading || !urlList.length || urlList.length > 10}>{loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Images className="h-4 w-4" />}{loading ? "미디어 분석 중…" : "일괄 감사"}</Button></div></form>{error && <p role="alert" className="mt-4 rounded-xl bg-rose-400/10 p-3 text-sm text-rose-300">{error}</p>}</Card>
    {audit && <section className="mt-5 space-y-5" aria-live="polite">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <Card><span className="text-xs text-slate-500">페이지</span><strong className="mt-2 block text-2xl text-white">{audit.summary.succeeded}/{audit.summary.requested}</strong></Card>
        <Card><span className="text-xs text-slate-500">이미지</span><strong className="mt-2 block text-2xl text-white">{audit.summary.images}</strong></Card>
        <Card><span className="text-xs text-slate-500">영상</span><strong className="mt-2 block text-2xl text-white">{audit.summary.videos}</strong></Card>
        <Card><span className="text-xs text-slate-500">개선 미디어</span><strong className="mt-2 block text-2xl text-amber-300">{audit.summary.issues}</strong></Card>
        <Card><span className="text-xs text-slate-500">수집 실패</span><strong className="mt-2 block text-2xl text-rose-300">{audit.summary.failed}</strong></Card>
        <Card><span className="text-xs text-slate-500">감사 시각</span><strong className="mt-2 block text-sm text-white">{new Date(audit.generatedAt).toLocaleString("ko-KR")}</strong></Card>
      </div>
      {audit.pages.map((page) => <Card key={page.url}>{!page.ok || !page.result ? <div className="flex gap-3 text-rose-300"><AlertTriangle className="h-5 w-5 shrink-0" /><div><p className="break-all text-sm font-semibold">{page.url}</p><p className="mt-1 text-xs">{page.error}</p></div></div> : <>
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="break-all font-semibold text-white">{page.finalUrl}</h2><p className="mt-1 text-xs text-slate-500">분석 이미지 {page.result.summary.total}/{page.result.summary.discoveredImages} · alt 누락 {page.result.summary.missingAlt} · 파일명 {page.result.summary.filenameIssues} · 차트 데이터 누락 {page.result.summary.chartsWithoutData}</p><p className="mt-1 text-xs text-slate-500">분석 영상 {page.result.summary.videos}/{page.result.summary.discoveredVideos} · 자막 누락 {page.result.summary.videosWithoutCaptions} · 챕터 누락 {page.result.summary.videosWithoutChapters}</p>{(page.result.summary.truncatedImages > 0 || page.result.summary.truncatedVideos > 0) && <p className="mt-2 text-xs text-amber-300">페이지 보호 상한으로 이미지 {page.result.summary.truncatedImages}개, 영상 {page.result.summary.truncatedVideos}개는 제외했습니다.</p>}</div><div className="min-w-32"><div className="flex justify-between text-xs"><span>이미지 평균</span><strong>{page.result.summary.averageScore}</strong></div><Progress value={page.result.summary.averageScore} ariaLabel="이미지 감사 평균 점수" className="mt-2" /></div></div>
        {page.result.images.length ? <div className="mt-5 grid gap-3 lg:grid-cols-2">{page.result.images.map((image) => <div key={`${image.index}-${image.src}`} className="rounded-xl border border-white/7 bg-slate-950/35 p-4"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-violet-400/10"><FileImage className="h-4 w-4 text-violet-300" /></span><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><p className="truncate text-sm font-semibold text-slate-200">{image.filename || `이미지 ${image.index}`}</p><Badge tone={image.score >= 88 ? "good" : image.score >= 60 ? "warn" : "bad"}>{image.score}</Badge></div><p className="mt-1 line-clamp-2 text-xs text-slate-500">alt: {image.alt || "(없음)"}</p><div className="mt-2 flex gap-2">{image.decorative && <Badge>장식</Badge>}{image.chartLike && <Badge tone="cyan">차트</Badge>}{!image.issues.length && <span className="flex items-center gap-1 text-xs text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />양호</span>}</div></div></div>{image.issues.length > 0 && <ul className="mt-3 space-y-1.5">{image.issues.map((issue) => <li key={issue.code} className={`text-xs ${issue.severity === "error" ? "text-rose-300" : "text-amber-300"}`}><span className="sr-only">{issue.severity === "error" ? "오류: " : "경고: "}</span>{issue.message}</li>)}</ul>}</div>)}</div> : <EmptyState>이 페이지에는 img 요소가 없습니다.</EmptyState>}
        {page.result.videos.length > 0 && <div className="mt-5"><h3 className="mb-3 text-sm font-semibold text-white">영상 접근성 신호</h3><div className="grid gap-3 lg:grid-cols-2">{page.result.videos.map((video) => <div key={`${video.index}-${video.src}`} className="rounded-xl border border-white/7 bg-slate-950/35 p-4"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-cyan-400/10"><Film className="h-4 w-4 text-cyan-300" /></span><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><p className="truncate text-sm font-semibold text-slate-200">{video.title || `영상 ${video.index}`}</p><Badge tone={video.score >= 88 ? "good" : video.score >= 60 ? "warn" : "bad"}>{video.score}</Badge></div><div className="mt-2 flex flex-wrap gap-2"><Badge tone="cyan">{video.kind === "native" ? "HTML 영상" : "외부 임베드"}</Badge>{video.captionLanguages.length > 0 && <Badge tone="good">자막 {video.captionLanguages.join(", ")}</Badge>}{video.hasChapters && <Badge>챕터</Badge>}{video.hasTranscript && <Badge>대본</Badge>}</div></div></div>{video.issues.length > 0 && <ul className="mt-3 space-y-1.5">{video.issues.map((issue) => <li key={issue.code} className={`text-xs ${issue.severity === "error" ? "text-rose-300" : issue.severity === "warning" ? "text-amber-300" : "text-cyan-300"}`}><span className="sr-only">{issue.severity === "error" ? "오류: " : issue.severity === "warning" ? "경고: " : "정보: "}</span>{issue.message}</li>)}</ul>}</div>)}</div></div>}
      </>}</Card>)}
    </section>}
    <MultimodalHistoryPanel onSelect={selectStoredAudit} />
  </div>;
}
