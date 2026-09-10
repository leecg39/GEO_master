"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Download,
  FileCheck2,
  LoaderCircle,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { SeoFindingsPanel } from "@/components/SeoFindingsPanel";
import { SeoDriftPanel } from "@/components/SeoDriftPanel";
import {
  EDITOR_LABELS,
  FIELD_LABELS,
  PAGE_TYPES,
  type ChangeField,
  type ChangeSet,
  type Editor,
  type PageSnapshot,
  type PageType,
} from "@/lib/site-ops/types";

interface Workspace {
  connection: { editor: Editor };
  snapshots: PageSnapshot[];
  changes: ChangeSet[];
}
const STATUS: Record<ChangeSet["status"], string> = {
  draft: "초안",
  approved: "승인됨",
  delivered: "전달됨 · 반영 미확인",
  verification_pending: "반영 대기",
  verified: "공개 URL 확인 완료",
  conflict: "원본 변경 · 재승인 필요",
  failed: "재검증 실패",
};
const FIELDS = Object.keys(FIELD_LABELS) as ChangeField[];
async function parse<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error ?? "요청을 처리하지 못했습니다.");
  return body;
}

export function SiteOpsWorkbench({
  campaignId,
  domain,
  refreshKey,
}: {
  campaignId: number;
  domain: string;
  refreshKey: string | null;
}) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [url, setUrl] = useState(`https://${domain}/`);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [values, setValues] = useState<Partial<Record<ChangeField, string>>>(
    {},
  );
  const [reason, setReason] = useState(
    "페이지의 실제 내용에 맞게 검색 정보와 구조화 데이터를 정리합니다.",
  );
  const [schemaType, setSchemaType] = useState<PageType>("WebPage");
  const [approvedBy, setApprovedBy] = useState("");
  const [policyConfirmed, setPolicyConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const data = await parse<Workspace>(
      await fetch(`/api/site-ops?campaignId=${campaignId}`),
    );
    setWorkspace(data);
  }, [campaignId]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        setWorkspace(
          await parse<Workspace>(
            await fetch(`/api/site-ops?campaignId=${campaignId}`, {
              signal: controller.signal,
            }),
          ),
        );
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "작업대를 불러오지 못했습니다.",
          );
      }
    })();
    return () => controller.abort();
  }, [campaignId, refreshKey]);
  const snapshot =
    workspace?.snapshots.find((item) => item.url === selectedUrl) ?? null;
  function select(item: PageSnapshot) {
    setSelectedUrl(item.url);
    setValues({});
    setSchemaType(item.metadata?.pageType ?? "WebPage");
    setMessage("");
    setError("");
  }
  async function action(input: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await parse<{
        snapshot?: PageSnapshot;
        change?: ChangeSet;
        document?: string;
        delivery?: { document: string; filename: string };
        items?: unknown[];
        confirmed?: unknown[];
        content?: { id: number };
        brief?: { mode?: string };
      }>(
        await fetch("/api/site-ops", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...input, campaignId }),
        }),
      );
      if (result.snapshot) {
        select(result.snapshot);
        setMessage(
          result.snapshot.fetchState === "fetched"
            ? "공개 HTML과 근거를 저장했습니다."
            : `수집 실패: ${result.snapshot.errorCode}. HTTP 상태를 성공으로 처리하지 않았습니다.`,
        );
      }
      if (result.document)
        setValues((current) => ({ ...current, jsonLd: result.document }));
      if (result.change)
        setMessage(
          result.change.verification.message ??
            "변경안을 저장했습니다. 내용을 검토한 후 승인하세요.",
        );
      if (result.items || result.confirmed) {
        const stored = Array.isArray(result.items) ? result.items.length : 0;
        setMessage(`근거 있는 작업 카드 ${stored}건을 전략 워크스페이스에 등록했습니다.`);
      }
      if (result.brief) {
        setMessage(result.brief.mode === "new" ? "신규 페이지 기획을 스튜디오 이력에 저장했습니다." : "기존 페이지 개선 기획을 스튜디오 이력에 저장했습니다.");
      }
      if (result.delivery) {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(
          new Blob([result.delivery.document], {
            type: "text/markdown;charset=utf-8",
          }),
        );
        link.download = result.delivery.filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "요청 실패");
    } finally {
      setBusy(false);
    }
  }
  function currentValue(field: ChangeField) {
    return snapshot?.metadata
      ? field === "jsonLd"
        ? JSON.stringify(snapshot.metadata.jsonLd, null, 2)
        : snapshot.metadata[field]
      : "";
  }
  return (
    <section className="mt-6 space-y-5" aria-label="페이지 SEO GEO 작업대">
      <Card className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">
              페이지 SEO/GEO 작업대
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              실제 페이지 수집 → 수정안 검토 → 승인 → 큐샵에 적용 → 공개 URL
              재검증
            </p>
          </div>
          <Badge tone="cyan">큐샵 적용 도우미</Badge>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(11rem,14rem)_minmax(0,1fr)_auto] lg:items-end">
          <label className="text-sm">
            적용할 편집기
            <select
              className="mt-2"
              value={workspace?.connection.editor ?? "qshop_site"}
              disabled={busy || !workspace}
              onChange={(e) =>
                void action({ action: "connection", editor: e.target.value })
              }
            >
              {Object.entries(EDITOR_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <form
            className="contents"
            onSubmit={(e) => {
              e.preventDefault();
              void action({ action: "capture", url });
            }}
          >
            <label className="min-w-0 text-sm">
              공개 페이지 URL
              <input
                className="mt-2"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
            </label>
            <Button className="w-full shrink-0 lg:w-auto" disabled={busy}>
              <Search className="h-4 w-4" />
              페이지 수집
            </Button>
          </form>
        </div>
        <p className="mt-4 text-xs leading-5 text-slate-500">
          직접 수집은 API 키 없이 사용할 수 있습니다. 등록한 HTTPS 도메인 안의
          공개 HTML을 읽습니다. 사이트 소유권 및 외부 쓰기 권한은 연결하지
          않았습니다.
        </p>
      </Card>
      {workspace?.snapshots.length ? (
        <div className="grid gap-5 xl:grid-cols-[240px_1fr]">
          <Card className="self-start">
            <h3 className="mb-3 font-semibold text-white">수집한 페이지</h3>
            <ul className="max-h-[38rem] space-y-2 overflow-y-auto">
              {workspace.snapshots.map((item) => (
                <li key={item.id}>
                  <button
                    className={`w-full rounded-xl border p-3 text-left ${selectedUrl === item.url ? "border-cyan-400/40 bg-cyan-400/10" : "border-white/10"}`}
                    onClick={() => select(item)}
                  >
                    <p className="break-all text-xs text-slate-300">
                      {item.url}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      HTTP {item.statusCode ?? "미측정"} ·{" "}
                      {item.fetchState === "fetched"
                        ? "본문 확인"
                        : "수집 실패"}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="min-w-0">
            {snapshot && <SeoFindingsPanel
              analysis={snapshot.analysis}
              busy={busy}
              onRegisterWorkCards={() => void action({ action: "work-cards", snapshotId: snapshot.id })}
              onCreateBrief={(mode) => void action({ action: "content-brief", snapshotId: snapshot.id, mode })}
            />}
            {snapshot?.metadata ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-semibold text-white">현재 값과 수정안</h3>
                  <Badge>{snapshot.metadata.pageType}</Badge>
                </div>
                <p className="mt-2 break-all text-xs leading-5 text-slate-500">
                  {snapshot.capturedAt
                    ? new Date(snapshot.capturedAt).toLocaleString("ko-KR")
                    : "미수집"}{" "}
                  · 직접 HTML 요청 · {snapshot.parserVersion}
                  <br />
                  SHA-256 {snapshot.contentHash}
                </p>
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer text-slate-400">
                    공개 본문과 진단 근거 보기
                  </summary>
                  <p className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap text-xs leading-5 text-slate-400">
                    {snapshot.metadata.bodyText}
                  </p>
                  <ul className="mt-3 space-y-2">
                    {snapshot.rules.map((rule) => (
                      <li key={rule.code} className="text-xs text-slate-500">
                        {rule.category === "technical"
                          ? "기술 검사"
                          : rule.category === "experimental"
                            ? "GEO 가설"
                            : "유형별 권고"}{" "}
                        · {rule.passed ? "확인" : "검토"} · {rule.detail}
                      </li>
                    ))}
                  </ul>
                </details>
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[520px] table-fixed text-left text-sm">
                    <thead>
                      <tr>
                        <th className="w-24 pb-3">항목</th>
                        <th className="pb-3 pr-4">현재 값</th>
                        <th className="pb-3">수정 제안</th>
                      </tr>
                    </thead>
                    <tbody>
                      {FIELDS.map((field) => (
                        <tr
                          key={field}
                          className="border-t border-white/10 align-top"
                        >
                          <th
                            scope="row"
                            className="py-4 pr-3 text-xs font-medium text-slate-400"
                          >
                            {FIELD_LABELS[field]}
                          </th>
                          <td className="break-all whitespace-pre-wrap py-4 pr-4 text-xs text-slate-500">
                            <div className="max-h-40 overflow-auto">
                              {currentValue(field) || "미지정"}
                            </div>
                          </td>
                          <td className="py-3">
                            <textarea
                              aria-label={`${FIELD_LABELS[field]} 수정 제안`}
                              rows={field === "jsonLd" ? 6 : 2}
                              className="text-xs"
                              value={values[field] ?? currentValue(field)}
                              onChange={(e) =>
                                setValues((current) => ({
                                  ...current,
                                  [field]: e.target.value,
                                }))
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <label
                    className="sr-only"
                    htmlFor={`schema-type-${campaignId}`}
                  >
                    구조화 데이터 유형
                  </label>
                  <select
                    id={`schema-type-${campaignId}`}
                    className="!w-auto"
                    value={schemaType}
                    onChange={(e) => setSchemaType(e.target.value as PageType)}
                  >
                    {PAGE_TYPES.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void action({
                        action: "schema",
                        snapshotId: snapshot.id,
                        type: schemaType,
                      })
                    }
                  >
                    <FileCheck2 className="h-4 w-4" />
                    본문 근거로 스키마 제안
                  </Button>
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  가격·평점·재고·작성자를 추측하지 않습니다. 원본에 없는
                  주장이나 중복 엔티티는 저장을 차단합니다. 제목과 설명은 승인
                  전에 사실을 확인하세요.
                </p>
                <label className="mt-5 block text-sm">
                  변경 이유
                  <textarea
                    className="mt-2"
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <Button
                  className="mt-4"
                  disabled={
                    busy || !reason.trim() || !Object.keys(values).length
                  }
                  onClick={() =>
                    void action({
                      action: "draft",
                      snapshotId: snapshot.id,
                      items: Object.entries(values).map(([field, after]) => ({
                        field,
                        after,
                        reason,
                      })),
                    })
                  }
                >
                  <Save className="h-4 w-4" />
                  변경안 저장
                </Button>
                <div className="mt-4 flex gap-4 text-xs">
                  <a
                    className="text-cyan-300 hover:underline"
                    href="/geo-blocks"
                  >
                    GEO 콘텐츠 블록
                  </a>
                  <a className="text-cyan-300 hover:underline" href="/llms">
                    AI 안내 파일 관리
                  </a>
                </div>
              </>
            ) : (
              <EmptyState>
                {snapshot
                  ? `HTML 근거가 없습니다 (${snapshot.errorCode}). 페이지 URL을 확인하고 다시 수집하세요.`
                  : "수집한 페이지를 선택해 수정안을 준비하세요."}
              </EmptyState>
            )}
          </Card>
        </div>
      ) : (
        <Card className="min-w-0">
          <EmptyState>
            캠페인을 실행하거나 공개 페이지 URL을 입력해 첫 근거를 수집하세요.
          </EmptyState>
        </Card>
      )}
      <Card className="min-w-0">
        <h3 className="font-semibold text-white">승인과 적용 이력</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-sm">
            승인자 기록
            <input
              className="mt-2"
              value={approvedBy}
              maxLength={120}
              onChange={(e) => setApprovedBy(e.target.value)}
              placeholder="운영자 이름"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              className="!w-4"
              checked={policyConfirmed}
              onChange={(e) => setPolicyConfirmed(e.target.checked)}
            />
            검색 색인 정책(robots) 변경이 포함되면 별도로 확인했습니다.
          </label>
        </div>
        {workspace?.changes.length ? (
          <ul className="mt-5 space-y-4">
            {workspace.changes.map((change) => (
              <li
                key={change.id}
                className="rounded-xl border border-white/10 p-4"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-semibold text-white">
                    변경안 #{change.id}
                  </span>
                  <Badge
                    tone={
                      change.status === "verified"
                        ? "good"
                        : change.status === "conflict"
                          ? "warn"
                          : "default"
                    }
                  >
                    {STATUS[change.status]}
                  </Badge>
                  <span className="text-xs text-slate-500">
                    {EDITOR_LABELS[change.editor]}
                  </span>
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-slate-400">
                    승인할 변경 내용 {change.items.length}개 확인
                  </summary>
                  {change.items.map((item) => (
                    <div key={item.field} className="mt-3 text-xs">
                      <p className="text-slate-300">
                        {FIELD_LABELS[item.field]} · {item.reason}
                      </p>
                      <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-all text-slate-500">
                        {item.before || "(없음)"}
                        {"\n↓\n"}
                        {item.after || "(비움)"}
                      </pre>
                    </div>
                  ))}
                </details>
                {change.verification.message && (
                  <p className="mt-3 text-xs leading-5 text-slate-400">
                    {change.verification.message}
                  </p>
                )}
                <SeoDriftPanel change={change} />
                <p className="mt-2 text-xs text-slate-500">
                  {change.approvedBy
                    ? `승인: ${change.approvedBy} · ${change.approvedAt}`
                    : "미승인"}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {change.status === "draft" && (
                    <Button
                      variant="secondary"
                      disabled={busy || !approvedBy.trim()}
                      onClick={() =>
                        void action({
                          action: "approve",
                          changeId: change.id,
                          expectedUpdatedAt: change.updatedAt,
                          approvedBy,
                          policyConfirmed,
                        })
                      }
                    >
                      <ShieldCheck className="h-4 w-4" />
                      검토한 수정안 승인
                    </Button>
                  )}
                  {["approved", "delivered"].includes(change.status) && (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        void action({
                          action: "deliver",
                          changeId: change.id,
                          expectedUpdatedAt: change.updatedAt,
                        })
                      }
                    >
                      <Download className="h-4 w-4" />
                      적용 안내 다운로드
                    </Button>
                  )}
                  {change.deliveredAt &&
                    [
                      "delivered",
                      "verification_pending",
                      "failed",
                      "verified",
                    ].includes(change.status) && (
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          void action({
                            action: "verify",
                            changeId: change.id,
                            expectedUpdatedAt: change.updatedAt,
                          })
                        }
                      >
                        <RefreshCw className="h-4 w-4" />
                        공개 URL 재검증
                      </Button>
                    )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-slate-500">
            저장한 변경안이 없습니다.
          </p>
        )}
      </Card>
      {busy && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-cyan-300"
        >
          <LoaderCircle className="h-4 w-4 animate-spin" />
          공개 페이지와 저장 상태를 확인하고 있습니다.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-rose-300">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-cyan-300">
          {message}
        </p>
      )}
    </section>
  );
}
