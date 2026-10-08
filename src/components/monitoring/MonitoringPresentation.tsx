import type { ReactNode } from "react";
import type { MonitoringComparison, MonitoringData } from "@/lib/monitoring-types";
import { percent, runDate } from "./MonitoringCharts";

export function Delta({ value }: { value: number | null }) {
  return <span className="whitespace-nowrap text-sm font-semibold" style={{ color: value == null || value === 0 ? "var(--app-text-muted)" : value > 0 ? "var(--app-status-good)" : "var(--app-status-danger)" }}>{value == null ? "비교 없음" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%p`}</span>;
}
export function Table({ children, label }: { children: ReactNode; label: string }) {
  return <div className="max-w-full overflow-x-auto"><table aria-label={label} className="w-full text-left text-sm [&_th]:whitespace-nowrap [&_th]:px-3 [&_th]:py-3 [&_th]:text-xs [&_th]:font-medium [&_th]:text-[color:var(--app-text-muted)] [&_td]:px-3 [&_td]:py-3 [&_tbody_tr]:border-t [&_tbody_tr]:border-[color:var(--app-card-border)]">{children}</table></div>;
}
export function Comparison({ value, data }: { value: MonitoringComparison; data: MonitoringData }) {
  return <div className="my-6 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-[color:var(--app-badge-bg)] px-5 py-4">
    <span className="text-sm text-[color:var(--app-text-muted)]">전체 언급률</span>
    <span title={`기준: ${runDate(data.endpoints.baseline?.at)}`} className="text-lg text-[color:var(--app-text-muted)]">{percent(value.baseline?.share)}</span>
    <Delta value={value.delta} /><span aria-hidden="true" className="text-[color:var(--app-text-muted)]">→</span>
    <strong title={`현재: ${runDate(data.endpoints.current?.at)}`} className="text-3xl tracking-tight">{percent(value.current?.share)}</strong>
  </div>;
}
