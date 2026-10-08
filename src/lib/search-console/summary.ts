import type { ConsoleImport } from "./store";

export interface ConsolePropertySummary {
  propertyLabel: string;
  latest: ConsoleImport;
  importCount: number;
}

export interface ConsoleImportSummary {
  properties: ConsolePropertySummary[];
  importCount: number;
  withData: number;
}

/** 기간 끝이 늦은 것이 최신, 같으면 나중에 가져온 것이 최신. 기간이 없는 파일은 가장 오래된 것으로 본다 */
function isNewer(candidate: ConsoleImport, current: ConsoleImport) {
  const candidateEnd = candidate.periodEnd ?? "";
  const currentEnd = current.periodEnd ?? "";
  if (candidateEnd !== currentEnd) return candidateEnd > currentEnd;
  return candidate.importedAt > current.importedAt;
}

/**
 * 속성별 최신 콘솔 내보내기만 요약한다.
 * 속성마다 기간·필터가 다를 수 있으므로 속성을 가로지르는 합계는 만들지 않는다.
 */
export function summarizeConsoleImports(imports: readonly ConsoleImport[]): ConsoleImportSummary {
  const byLabel = new Map<string, ConsolePropertySummary>();
  for (const item of imports) {
    const existing = byLabel.get(item.propertyLabel);
    byLabel.set(item.propertyLabel, existing
      ? { ...existing, latest: isNewer(item, existing.latest) ? item : existing.latest, importCount: existing.importCount + 1 }
      : { propertyLabel: item.propertyLabel, latest: item, importCount: 1 });
  }
  const properties = [...byLabel.values()].sort((left, right) =>
    Number(right.latest.hasData) - Number(left.latest.hasData) || left.propertyLabel.localeCompare(right.propertyLabel, "ko"));
  return {
    properties,
    importCount: imports.length,
    withData: properties.filter((item) => item.latest.hasData).length,
  };
}
