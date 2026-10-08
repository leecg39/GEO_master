"use client";

import { useEffect, useState } from "react";
import { DetailDrawer } from "@/components/CrudPrimitives";
import { Badge, EmptyState } from "@/components/ui";

interface Finding {
  code: string;
  tier: "technical" | "recommendation" | "hypothesis";
  severity: "error" | "warning" | "notice";
  passed: boolean;
  label: string;
  detail: string;
  evidence: string | null;
}

interface PageSnapshot {
  id: number;
  url: string;
  finalUrl: string | null;
  statusCode: number;
  contentType: string | null;
  renderMode: "native" | "rendered" | "cache";
  contentHash: string;
  bytes: number;
  htmlStored: boolean;
  htmlTruncated: boolean;
  facts: {
    title: string | null; description: string | null; canonical: string | null; robotsMeta: string | null; lang: string | null;
    h1: string[]; og: { title: string | null; description: string | null; image: string | null };
    jsonLdTypes: string[]; jsonLdBlocks: number; jsonLdInvalid: number; wordCount: number;
  } | null;
  findings: Finding[];
  skipped: string | null;
  parserVersion: string;
  rulesVersion: string;
  capturedAt: string;
  lastSeenAt: string;
  versions: Array<{ id: number; capturedAt: string; lastSeenAt: string; contentHash: string; statusCode: number; renderMode: string }>;
}

const tierLabels: Record<Finding["tier"], string> = { technical: "기술 오류", recommendation: "페이지 권고", hypothesis: "GEO 가설" };
const renderLabels: Record<PageSnapshot["renderMode"], string> = { native: "일반 요청", rendered: "Firecrawl 렌더링", cache: "Firecrawl 캐시" };
const when = (value: string) => new Date(value).toLocaleString("ko-KR");

function tone(item: Finding): "good" | "bad" | "warn" | "default" {
  if (item.passed) return "good";
  if (item.severity === "error") return "bad";
  return item.severity === "warning" ? "warn" : "default";
}

function FactRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 border-b border-white/5 py-2 text-xs last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="break-all text-slate-200">{value || <span className="text-slate-600">없음</span>}</dd>
    </div>
  );
}

/** 페이지 스냅샷 근거 — 실제로 받은 응답, 추출한 값, 규칙 판정과 버전을 보여 준다 (Qshop P03) */
/** 다른 페이지를 열 때는 부모가 key로 새로 마운트한다 */
export function PageSnapshotDrawer({ snapshotId, onClose }: { snapshotId: number; onClose: () => void }) {
  const [shownId, setShownId] = useState(snapshotId);
  const [loaded, setLoaded] = useState<{ id: number; snapshot: PageSnapshot | null; error: string } | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/site-audit?snapshot=${shownId}`);
        const body = await response.json() as { snapshot?: PageSnapshot; error?: string };
        if (!response.ok || !body.snapshot) throw new Error(body.error ?? "스냅샷을 불러오지 못했습니다.");
        if (active) setLoaded({ id: shownId, snapshot: body.snapshot, error: "" });
      } catch (cause) {
        if (active) setLoaded({ id: shownId, snapshot: null, error: cause instanceof Error ? cause.message : "스냅샷을 불러오지 못했습니다." });
      }
    })();
    return () => { active = false; };
  }, [shownId]);

  const current = loaded?.id === shownId ? loaded : null;
  const snapshot = current?.snapshot ?? null;
  const error = current?.error ?? "";

  const groups = (["technical", "recommendation", "hypothesis"] as const).map((tier) => ({
    tier,
    items: (snapshot?.findings ?? []).filter((item) => item.tier === tier).sort((a, b) => Number(a.passed) - Number(b.passed)),
  })).filter((group) => group.items.length > 0);

  return (
    <DetailDrawer
      open
      title="페이지 근거"
      description={snapshot ? snapshot.url : "실제로 받은 응답과 규칙 판정"}
      onClose={onClose}
    >
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      {!snapshot && !error && <EmptyState>근거를 불러오는 중…</EmptyState>}
      {snapshot && (
        <div className="space-y-6">
          <section>
            <div className="flex flex-wrap gap-2">
              <Badge tone={snapshot.statusCode >= 200 && snapshot.statusCode < 300 ? "good" : "bad"}>HTTP {snapshot.statusCode}</Badge>
              <Badge>{renderLabels[snapshot.renderMode]}</Badge>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">규칙 버전 <code className="text-cyan-300">{snapshot.rulesVersion}</code> · 파서 버전 <code className="text-slate-300">{snapshot.parserVersion}</code></p>
            <dl className="mt-3">
              <FactRow label="최종 URL" value={snapshot.finalUrl} />
              <FactRow label="수집 시각" value={`${when(snapshot.capturedAt)}${snapshot.lastSeenAt !== snapshot.capturedAt ? ` (같은 내용 마지막 확인 ${when(snapshot.lastSeenAt)})` : ""}`} />
              <FactRow label="형식·용량" value={`${snapshot.contentType ?? "형식 미상"} · ${snapshot.bytes.toLocaleString("ko-KR")} bytes`} />
              <FactRow label="본문 해시" value={`sha256 ${snapshot.contentHash.slice(0, 16)}…`} />
              <FactRow label="원본 보관" value={snapshot.htmlStored ? (snapshot.htmlTruncated ? "HTML 앞부분만 보관(용량 제한)" : "HTML 보관") : "보관하지 않음(HTML 아님)"} />
            </dl>
          </section>

          {snapshot.skipped && <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-5 text-amber-200">{snapshot.skipped}</p>}

          {snapshot.facts && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-white">원본 HTML에서 읽은 값</h3>
              <dl>
                <FactRow label="title" value={snapshot.facts.title} />
                <FactRow label="description" value={snapshot.facts.description} />
                <FactRow label="canonical" value={snapshot.facts.canonical} />
                <FactRow label="meta robots" value={snapshot.facts.robotsMeta} />
                <FactRow label="lang" value={snapshot.facts.lang} />
                <FactRow label="H1" value={snapshot.facts.h1.join(" / ")} />
                <FactRow label="OG" value={[snapshot.facts.og.title, snapshot.facts.og.description, snapshot.facts.og.image].filter(Boolean).join(" · ")} />
                <FactRow label="JSON-LD" value={snapshot.facts.jsonLdBlocks ? `${snapshot.facts.jsonLdTypes.join(", ") || "유형 없음"} (블록 ${snapshot.facts.jsonLdBlocks}개, 구문 오류 ${snapshot.facts.jsonLdInvalid}개)` : null} />
                <FactRow label="본문 단어 수" value={String(snapshot.facts.wordCount)} />
              </dl>
            </section>
          )}

          {groups.map((group) => (
            <section key={group.tier}>
              <h3 className="mb-2 text-sm font-semibold text-white">
                {tierLabels[group.tier]} <span className="text-xs font-normal text-slate-500">미충족 {group.items.filter((item) => !item.passed).length} / {group.items.length}</span>
              </h3>
              {group.tier === "hypothesis" && <p className="mb-2 text-xs text-slate-500">GEO 가설은 페이지 유형에 따라 필요 없을 수 있어 오류로 세지 않습니다.</p>}
              <ul className="space-y-2">
                {group.items.map((item) => (
                  <li key={item.code} className="rounded-lg border border-white/6 bg-slate-950/40 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={tone(item)}>{item.passed ? "충족" : item.severity === "error" ? "오류" : item.severity === "warning" ? "경고" : "참고"}</Badge>
                      <span className="text-sm text-white">{item.label}</span>
                      <code className="ml-auto text-[10px] text-slate-600">{item.code}</code>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-400">{item.detail}</p>
                    {item.evidence && <p className="mt-1 break-all text-[11px] text-slate-500">관측값: {item.evidence}</p>}
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {snapshot.versions.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-white">버전 <span className="text-xs font-normal text-slate-500">(내용이 바뀐 경우만 새 버전, 최근 3개 보관)</span></h3>
              <ul className="space-y-1 text-xs">
                {snapshot.versions.map((version) => (
                  <li key={version.id}>
                    <button
                      type="button"
                      onClick={() => setShownId(version.id)}
                      aria-current={version.id === snapshot.id ? "true" : undefined}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white/5 ${version.id === snapshot.id ? "bg-cyan-400/10 text-cyan-200" : "text-slate-400"}`}
                    >
                      <span>{when(version.capturedAt)}</span>
                      <span className="text-slate-600">HTTP {version.statusCode}</span>
                      <code className="ml-auto text-[10px] text-slate-600">{version.contentHash.slice(0, 10)}</code>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </DetailDrawer>
  );
}
