import Link from "next/link";
import { ArrowRight, FileSpreadsheet } from "lucide-react";
import { formatCtr, formatPosition } from "@/lib/search-console/format";
import type { ConsoleImportSummary } from "@/lib/search-console/summary";

/** 대시보드용 콘솔 내보내기 요약. AI 답변 점유율과는 다른 원천이므로 별도 카드로만 보여 준다 */
export function SearchConsoleDashboardCard({ summary }: { summary: ConsoleImportSummary }) {
  return (
    <section aria-labelledby="sc-dashboard-title" className="mt-4 overflow-hidden rounded-[12px] border border-dash-line bg-dash-panel text-slate-300">
      <header className="flex min-h-12 items-center justify-between gap-3 border-b border-dash-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 shrink-0 text-[color:var(--color-accent-lime)]" />
          <h2 id="sc-dashboard-title" className="truncate text-sm font-bold tracking-tight text-white">Search Console 검색 성과 · 콘솔 내보내기</h2>
        </div>
        <Link href="/search-console" className="inline-flex shrink-0 items-center gap-1 text-xs text-slate-400 hover:text-white">
          가져오기 관리 <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </header>
      {summary.properties.length === 0 ? (
        <p className="px-4 py-5 text-xs text-slate-500">
          가져온 보고서가 없습니다. Search Console 실적 화면에서 내보낸 Excel 파일을 <Link href="/search-console" className="underline">검색 성과 가져오기</Link>에서 올리면 여기에 표시됩니다.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-dash-line/30">
            {summary.properties.map(({ propertyLabel, latest, importCount }) => (
              <li key={propertyLabel} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))] sm:items-center">
                <div className="min-w-0">
                  <strong className="block truncate text-sm text-white">{propertyLabel}</strong>
                  <span className="text-[11px] text-slate-500">
                    {latest.periodStart ?? "기간 미상"} ~ {latest.periodEnd ?? "기간 미상"} · 가져오기 {importCount}회
                  </span>
                </div>
                {latest.hasData ? (
                  <>
                    <Metric label="클릭수" value={String(latest.totals.clicks)} />
                    <Metric label="노출" value={String(latest.totals.impressions)} />
                    <Metric label="CTR" value={formatCtr(latest.totals.ctr)} />
                    <Metric label="평균 게재 순위" value={formatPosition(latest.totals.position)} />
                  </>
                ) : (
                  <p className="text-xs text-amber-300 sm:col-span-4">노출 0 · 데이터 없음 — 성과 0인지 데이터 미축적인지 파일만으로는 구분할 수 없습니다.</p>
                )}
              </li>
            ))}
          </ul>
          <p className="border-t border-dash-line/30 px-4 py-2 text-[11px] text-slate-500">
            속성마다 기간·필터가 다를 수 있어 속성 간 합계는 표시하지 않습니다. API 연결 데이터와 섞지 않은 콘솔 내보내기 값입니다.
          </p>
        </>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-[10px] text-slate-500">{label}</span>
      <strong className="text-sm text-white">{value}</strong>
    </div>
  );
}
