import type { MonitoringMetric } from "./monitoring-types";

export interface MonitoringTally {
  succeeded: number; failed: number; refused: number;
  brands: Map<string, { mentions: number; rankSum: number; providers: Set<string> }>;
}
export function tally(): MonitoringTally { return { succeeded: 0, failed: 0, refused: 0, brands: new Map() }; }
export function count(target: MonitoringTally, status: string, provider: string, positions: Map<string, number>) {
  if (status === "failed") { target.failed++; return; }
  if (status === "refused") { target.refused++; return; }
  if (status !== "succeeded") return;
  target.succeeded++;
  for (const [id, position] of positions) {
    const item = target.brands.get(id) ?? { mentions: 0, rankSum: 0, providers: new Set<string>() };
    item.mentions++;
    item.rankSum += position + 1;
    item.providers.add(provider);
    target.brands.set(id, item);
  }
}
export function round(value: number) { return Math.round(value * 10) / 10; }
export function metric(value: MonitoringTally, brand = "own"): MonitoringMetric {
  const item = value.brands.get(brand);
  return {
    succeeded: value.succeeded, failed: value.failed, refused: value.refused,
    mentions: item?.mentions ?? 0,
    share: value.succeeded ? round((item?.mentions ?? 0) / value.succeeded * 100) : null,
    providerCount: value.succeeded ? (item?.providers.size ?? 0) : null,
    averageRank: item?.mentions ? round(item.rankSum / item.mentions) : null,
  };
}
