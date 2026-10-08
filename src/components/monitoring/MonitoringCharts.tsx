"use client";

import { useId } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MonitoringBrand, MonitoringData } from "@/lib/monitoring-types";

export const percent = (value: number | null | undefined) => value == null ? "—" : `${value.toFixed(1)}%`;
export const rank = (value: number | null | undefined) => value == null ? "—" : `${value.toFixed(1)}위`;
export const runDate = (value: string | undefined | null) => value ? new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
}).format(new Date(value)) : "—";
const axis = { fill: "var(--app-text-muted)", fontSize: 11 };
const tooltipStyle = { background: "var(--app-card-bg)", border: "1px solid var(--app-card-border)", borderRadius: 12, color: "var(--app-text)" };
const palette = ["var(--app-chart-previous)", "var(--model-gemini)", "var(--model-grok)", "var(--app-chart-blue)", "var(--app-chart-teal)"];
function brandHash(id: string) { let hash = 2166136261; for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return hash >>> 0; }
export function brandColor(brand: Pick<MonitoringBrand, "id" | "own">) {
  return brand.own ? "var(--app-text)" : palette[brandHash(brand.id) % palette.length];
}
export function brandDash(brand: Pick<MonitoringBrand, "id" | "own">) {
  return brand.own ? undefined : [undefined, "6 3", "2 3", "8 3 2 3"][Math.floor(brandHash(brand.id) / palette.length) % 4];
}

export function WeeklyChart({ data }: { data: MonitoringData }) {
  const gradient = useId().replaceAll(":", "");
  const points = data.weeks.map((point) => ({ week: point.week, share: point.metric.share, succeeded: point.metric.succeeded }));
  return <div className="h-64 min-w-0" role="img" aria-label="월요일 기준 주별 전체 언급률. 아래 주별 데이터 표에서 수치를 확인할 수 있습니다.">
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <AreaChart data={points} margin={{ left: -20, right: 14, top: 12, bottom: 8 }}>
        <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--app-chart-current)" stopOpacity={0.32} /><stop offset="100%" stopColor="var(--app-chart-current)" stopOpacity={0.02} /></linearGradient></defs>
        <CartesianGrid stroke="var(--app-card-border)" strokeDasharray="3 5" />
        <XAxis dataKey="week" tick={axis} tickFormatter={(value: string) => value.slice(5).replace("-", "/")} interval="preserveStartEnd" minTickGap={24} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={axis} unit="%" axisLine={false} tickLine={false} />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={(value) => `${value} 주 · KST`} formatter={(value) => [percent(Number(value)), "언급률"]} />
        <Area dataKey="share" type="linear" stroke="var(--app-chart-current)" strokeWidth={2.5} fill={`url(#${gradient})`} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}

export function ProviderRadar({ data }: { data: MonitoringData }) {
  // A polygon would imply zero for unmeasured services. Render it only for complete series.
  const baselineComplete = data.providers.every((item) => item.baseline?.share != null);
  const currentComplete = data.providers.every((item) => item.current?.share != null);
  const points = data.providers.map((item) => ({ name: item.name, baseline: item.baseline?.share ?? null, current: item.current?.share ?? null }));
  return <div>
    <div className="h-64 min-w-0" role="img" aria-label="ChatGPT, Claude, Gemini, Grok 4축 언급률 비교. 미측정이 있는 시점의 도형은 생략합니다.">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <RadarChart data={points} outerRadius="65%">
          <PolarGrid stroke="var(--app-card-border)" />
          <PolarAngleAxis dataKey="name" tick={axis} />
          <PolarRadiusAxis domain={[0, 100]} ticks={[25, 50, 75, 100]} tick={false} axisLine={false} />
          {baselineComplete && <Radar dataKey="baseline" name="기준" stroke="var(--app-chart-previous)" fill="var(--app-chart-previous)" fillOpacity={0.15} isAnimationActive={false} />}
          {currentComplete && <Radar dataKey="current" name="현재" stroke="var(--app-chart-current)" fill="var(--app-chart-current)" fillOpacity={0.25} isAnimationActive={false} />}
          <Tooltip contentStyle={tooltipStyle} formatter={(value) => percent(Number(value))} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
    <div className="flex justify-center gap-4 text-xs"><span style={{ color: "var(--app-chart-previous)" }}>● 기준</span><span style={{ color: "var(--app-chart-current)" }}>● 현재</span></div>
    {(!baselineComplete || !currentComplete) && <p className="mt-3 text-center text-xs text-[color:var(--app-text-muted)]">4개 모델이 모두 측정된 시점만 도형으로 표시합니다.</p>}
  </div>;
}

export function BrandTrendChart({ selected, visible, selectedRunId, onSelectRun }: { selected: NonNullable<MonitoringData["selected"]>; visible: string[]; selectedRunId: number | null; onSelectRun: (id: number) => void }) {
  const points = selected.trends.map((point) => ({ run: point.id, at: point.at, ...Object.fromEntries(selected.brands.map((brand) => [brand.id, point.brands[brand.id]?.share ?? null])) }));
  return <div className="h-80 min-w-0" role="group" aria-label="질문별 브랜드 언급률 실행 추이. 자사 포인트 또는 아래 측정 시점 선택기로 응답을 확인할 수 있습니다.">
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <LineChart data={points} margin={{ left: -20, right: 16, top: 15, bottom: 12 }}>
        <CartesianGrid stroke="var(--app-card-border)" strokeDasharray="3 5" />
        <XAxis dataKey="run" tick={axis} minTickGap={45} interval="preserveStartEnd" tickFormatter={(id: number) => { const point = points.find((row) => row.run === id); return point ? runDate(point.at) : ""; }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} unit="%" tick={axis} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={(id) => { const point = points.find((row) => row.run === Number(id)); return `${runDate(point?.at)} · #${id}`; }} formatter={(value) => percent(Number(value))} />
        {selectedRunId !== null && <ReferenceLine x={selectedRunId} stroke="var(--app-text-muted)" strokeDasharray="4 5" />}
        {[...selected.brands].sort((a, b) => Number(a.own) - Number(b.own)).map((brand) => visible.includes(brand.id) && <Line key={brand.id} type="linear" dataKey={brand.id} name={brand.name} stroke={brandColor(brand)} strokeWidth={brand.own ? 3.5 : 1.8} strokeDasharray={brandDash(brand)} dot={brand.own ? (props) => {
          const point = props.payload as { run: number; at: string; own: number | null };
          if (props.cx == null || props.cy == null || point?.own == null) return <g key={props.index} />;
          const active = point.run === selectedRunId;
          return <g key={point.run} role="button" tabIndex={0} aria-label={`${runDate(point.at)} 실행 ${point.run} 응답 보기`} aria-pressed={active} onClick={() => onSelectRun(point.run)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectRun(point.run); } }} className="cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-ring-focus)]">
            <circle cx={props.cx} cy={props.cy} r={22} fill="transparent" />
            {active && <circle cx={props.cx} cy={props.cy} r={8} fill="var(--app-card-bg)" stroke="var(--app-text)" strokeWidth={2} />}
            <circle cx={props.cx} cy={props.cy} r={4} fill="var(--app-card-bg)" stroke="var(--app-text)" strokeWidth={2} />
          </g>;
        } : { r: 2 }} activeDot={false} connectNulls={false} isAnimationActive={false} />)}
      </LineChart>
    </ResponsiveContainer>
  </div>;
}
