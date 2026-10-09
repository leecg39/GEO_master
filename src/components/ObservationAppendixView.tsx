import { Badge, Card } from "@/components/ui";
import type { ObservationAppendix } from "@/lib/observation-appendix";
import { OUTCOME_KIND_LABELS, PURPOSE_LABELS } from "@/lib/observation-labels";

const pct = (value: number | null) => (value === null ? "N/A" : `${(value * 100).toFixed(1)}%`);

function Head({ title, section }: { title: string; section: { status: string; source: string; definition: string } }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <Badge tone={section.status === "connected" ? "good" : "default"}>{section.status === "connected" ? "연결됨" : "연결 안 됨 · 0이 아님"}</Badge>
      </div>
      <p className="mt-1 text-xs text-slate-500">출처: {section.source}</p>
      <p className="text-xs text-slate-500">정의: {section.definition}</p>
    </div>
  );
}

/** 리포트 미리보기의 관측 지표 부록 — 원천별로 따로 보여 주고 합치지 않는다 */
export function ObservationAppendixView({ appendix }: { appendix: ObservationAppendix }) {
  const { searchConsole, botLogs, outcomes } = appendix;
  return (
    <Card className="print-card space-y-5">
      <div>
        <h2 className="font-semibold text-white">관측 지표 부록</h2>
        <p className="mt-1 text-xs text-amber-300">{appendix.note}</p>
      </div>
      <section className="space-y-2">
        <Head title="검색 성과" section={searchConsole} />
        {searchConsole.properties.map((item) => (
          <p key={item.propertyLabel} className="text-sm text-slate-300">
            {item.propertyLabel} <span className="text-xs text-slate-500">({item.periodStart ?? "?"} ~ {item.periodEnd ?? "?"})</span> — {item.hasData
              ? `클릭 ${item.clicks} · 노출 ${item.impressions} · CTR ${pct(item.ctr)} · 순위 ${item.position === null ? "N/A" : item.position.toFixed(1)}`
              : "노출 0 · 데이터 없음"}
          </p>
        ))}
      </section>
      <section className="space-y-2">
        <Head title="AI 봇 방문" section={botLogs} />
        {botLogs.latest && (
          <>
            <p className="text-xs text-slate-400">{botLogs.latest.fileName} ({botLogs.latest.periodStart} ~ {botLogs.latest.periodEnd}) · DNS 확인 {botLogs.latest.dnsChecked ? "실행" : "안 함"} · 자체 진단 {botLogs.latest.self} · 그 밖의 요청 {botLogs.latest.other}</p>
            {botLogs.latest.purposes.map((row) => (
              <p key={row.purpose} className="text-sm text-slate-300">{PURPOSE_LABELS[row.purpose]} {row.hits}회 <span className="text-xs text-slate-500">— DNS 확인 {row.verifiedHits} · 불일치 {row.failedHits} · 미확인 {row.uncheckedHits}</span></p>
            ))}
          </>
        )}
      </section>
      <section className="space-y-2">
        <Head title="사업 성과" section={outcomes} />
        {outcomes.sources.map((source) => (
          <div key={source.sourceLabel}>
            <p className="text-xs text-slate-400">{source.sourceLabel} ({source.periodStart} ~ {source.periodEnd}){source.unmappedEvents ? ` · 미분류 이벤트 ${source.unmappedEvents}개 제외` : ""}</p>
            {source.metrics.length === 0 && <p className="text-xs text-slate-500">정의된 지표 없음</p>}
            {source.metrics.map((metric) => (
              <p key={metric.kind} className="text-sm text-slate-300">{OUTCOME_KIND_LABELS[metric.kind]} {metric.count}회 <span className="text-xs text-slate-500">— {metric.events.map((event) => `${event.eventName}: ${event.definition}`).join(" / ")}</span></p>
            ))}
          </div>
        ))}
      </section>
    </Card>
  );
}
