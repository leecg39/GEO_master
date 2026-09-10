"use client";
import { Badge, Card } from "@/components/ui";

export interface SiteAuditBriefingData {
  ready: boolean;
  score: number | null;
  pageCount: number;
  measuredPages: number;
  issueCount: number;
  llmsState: string;
  legacyPages: number;
  narratives: string[];
  recommendations: string[];
  issues: Array<{
    id: number;
    url: string;
    severity: string;
    title: string;
    detail: string;
  }>;
  pages: Array<{
    url: string;
    statusCode: number | null;
    dataState: string;
    fetchState: string;
  }>;
}
export function SiteAuditBriefing({
  campaignName,
  domain,
  lastRunAt,
  briefing,
  loading,
}: {
  campaignName: string;
  domain: string;
  lastRunAt: string | null;
  briefing: SiteAuditBriefingData | null;
  loading: boolean;
}) {
  if (loading)
    return (
      <Card className="mt-5">
        <p role="status">수집 근거를 불러오는 중…</p>
      </Card>
    );
  if (!briefing) return null;
  const states: Record<string, string> = {
    present: "내용·형식 확인",
    missing: "404/410 응답",
    invalid: "내용 또는 MIME 검토 필요",
    unknown: "미확인",
  };
  return (
    <Card className="mt-5 space-y-4">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 className="font-semibold text-white">
            {campaignName} · 수집 근거
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {domain} ·{" "}
            {lastRunAt ? new Date(lastRunAt).toLocaleString("ko-KR") : "미실행"}
          </p>
        </div>
        <Badge tone="cyan">
          자체 기술 진단 {briefing.score ?? "미측정"}
          {briefing.score !== null ? "점" : ""}
        </Badge>
      </div>
      {briefing.narratives.map((text) => (
        <p key={text} className="text-sm leading-6 text-slate-400">
          {text}
        </p>
      ))}
      <p className="text-sm text-slate-300">
        /llms.txt 별도 요청: {states[briefing.llmsState] ?? "미확인"}
      </p>
      {briefing.issues.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-amber-300">
            수집·검토 항목 {briefing.issueCount}건
          </summary>
          <ul className="mt-3 max-h-80 space-y-3 overflow-y-auto">
            {briefing.issues.map((issue) => (
              <li
                key={issue.id}
                className="rounded-lg border border-white/10 p-3"
              >
                <p className="text-sm text-slate-200">
                  {issue.title} · {issue.detail}
                </p>
                <p className="mt-1 break-all text-xs text-slate-500">
                  {issue.url}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
      {briefing.pages.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr>
                <th className="p-2">발견 URL</th>
                <th>실측 HTTP</th>
                <th>수집 상태</th>
              </tr>
            </thead>
            <tbody>
              {briefing.pages.map((page) => (
                <tr key={page.url} className="border-t border-white/5">
                  <td className="break-all p-2">{page.url}</td>
                  <td>{page.statusCode ?? "미측정"}</td>
                  <td>
                    {page.dataState === "mock"
                      ? "샘플"
                      : page.fetchState === "fetched"
                        ? "본문 확인"
                        : page.fetchState === "failed"
                          ? "수집 실패"
                          : "발견만 됨"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
