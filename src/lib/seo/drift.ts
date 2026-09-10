import { FIELD_LABELS, type ChangeField, type ChangeItem, type PageMetadata, type PageSnapshot } from "@/lib/site-ops/types";
import { equalSeoValue } from "./normalize";

export const DRIFT_VERSION = "drift/1";
export type DriftClassification = "expected" | "pending" | "unexpected" | "unknown";
export interface SeoDriftEvent {
  field: string;
  classification: DriftClassification;
  approvedChange: boolean;
  before: string | null;
  after: string | null;
  expectedValue: string | null;
  ruleId: string;
  ruleVersion: string;
  detail: string;
}
export interface SeoDriftComparison {
  version: string;
  baselineSnapshotId: number;
  currentSnapshotId: number;
  comparable: boolean;
  fields: Record<string, boolean>;
  counts: Record<DriftClassification, number>;
  events: SeoDriftEvent[];
}
export interface StoredDriftEvent extends SeoDriftEvent {
  id: number;
  baselineSnapshotId: number;
  currentSnapshotId: number;
  createdAt: string;
}
export function fieldValue(page: PageMetadata, field: ChangeField) {
  return field === "jsonLd" ? JSON.stringify(page.jsonLd, null, 2) : page[field];
}

/** Pure comparator. Only an approved change set supplies a baseline; this never promotes a capture. */
export function compareSeoSnapshots(
  baseline: PageSnapshot,
  current: PageSnapshot,
  items: ChangeItem[],
  approvedAt?: string | null,
): SeoDriftComparison {
  const result: SeoDriftComparison = {
    version: DRIFT_VERSION, baselineSnapshotId: baseline.id, currentSnapshotId: current.id,
    comparable: true, fields: Object.fromEntries(items.map((item) => [item.field, false])),
    counts: { expected: 0, pending: 0, unexpected: 0, unknown: 0 }, events: [],
  };
  const add = (event: Omit<SeoDriftEvent, "ruleVersion">) => {
    result.events.push({ ...event, ruleVersion: DRIFT_VERSION });
    result.counts[event.classification]++;
  };
  const unknown = (field: string, detail: string) => {
    result.comparable = false;
    add({ field, classification: "unknown", approvedChange: false,
      before: null, after: null, expectedValue: null, ruleId: `${field}-unknown`, detail });
    return result;
  };
  if (baseline.projectId !== current.projectId || baseline.campaignId !== current.campaignId || baseline.url !== current.url)
    return unknown("scope", "프로젝트·캠페인·URL이 달라 비교할 수 없습니다. 쿼리와 마지막 슬래시는 보존합니다.");
  if (baseline.dataState !== "live" || current.dataState !== "live" ||
      baseline.fetchState !== "fetched" || current.fetchState !== "fetched" || !baseline.metadata || !current.metadata)
    return unknown("collection", `비교할 HTML 근거가 없습니다. 현재 HTTP ${current.statusCode ?? "미측정"}. 수집 실패를 정상 변경으로 보지 않습니다.`);
  if (current.id <= baseline.id || !current.capturedAt || !Number.isFinite(Date.parse(current.capturedAt)) ||
      (approvedAt && (!Number.isFinite(Date.parse(approvedAt)) || Date.parse(current.capturedAt) < Date.parse(approvedAt))))
    return unknown("freshness", "승인 후 새로 수집한 페이지 근거가 필요합니다.");
  if (baseline.renderMode !== current.renderMode || baseline.parserVersion !== current.parserVersion ||
      baseline.responseHeaders["content-language"] !== current.responseHeaders["content-language"])
    return unknown("conditions", "수집 방식·언어·HTML 파서 버전이 달라 비교를 제한합니다. 같은 조건으로 새 변경안을 검토하세요.");
  // Diagnostic score versions/configs do not affect metadata drift comparability.

  for (const field of Object.keys(FIELD_LABELS) as ChangeField[]) {
    const before = fieldValue(baseline.metadata, field), after = fieldValue(current.metadata, field);
    const item = items.find((item) => item.field === field);
    if (item && !equalSeoValue(field, before, item.before)) return unknown("baseline", "승인 항목의 원본 값과 기준 스냅샷이 일치하지 않습니다.");
    if (!item && equalSeoValue(field, before, after)) continue;
    const classification: DriftClassification = item
      ? equalSeoValue(field, after, item.after) ? "expected" : equalSeoValue(field, after, item.before) ? "pending" : "unexpected"
      : "unexpected";
    if (item) result.fields[field] = classification === "expected";
    add({ field, classification, approvedChange: Boolean(item), before, after, expectedValue: item?.after ?? null,
      ruleId: field === "robots" && /\b(noindex|none)\b/i.test(after) && !/\b(noindex|none)\b/i.test(before)
        ? "noindex-added" : field === "canonical" && before && !after ? "canonical-removed" : `${field}-${classification}`,
      detail: `${FIELD_LABELS[field]}: ${classification === "expected" ? "승인한 값으로 반영됐습니다." : classification === "pending" ? "아직 승인 전 원본 값입니다." : "승인 범위 밖의 변경입니다. 최신 근거로 재승인하세요."}`,
    });
  }
  const protectedFields = ["bodyHash", "robotsHeader", "jsonLdErrors", "heading"] as const;
  for (const field of protectedFields) {
    const before = String(baseline.metadata[field]), after = String(current.metadata[field]);
    if (field === "jsonLdErrors" && result.fields.jsonLd === true) {
      // Repairing the approved JSON-LD may remove parser errors. Remaining invalid
      // scripts still block verification, even when their error count is unchanged.
      if (current.metadata.jsonLdErrors === 0) continue;
      add({ field, classification: "unexpected", approvedChange: false, before, after, expectedValue: "0",
        ruleId: "jsonld-errors-remain", detail: "승인한 스키마는 반영됐지만 파싱할 수 없는 JSON-LD가 남아 있습니다." });
      continue;
    }
    if (equalSeoValue(field, before, after)) continue;
    add({ field, classification: "unexpected", approvedChange: false, before, after, expectedValue: null,
      ruleId: field === "robotsHeader" && /\b(noindex|none)\b/i.test(after) && !/\b(noindex|none)\b/i.test(before)
        ? "http-noindex-added" : `${field}-changed`,
      detail: `${field === "bodyHash" ? "공개 본문" : field === "robotsHeader" ? "HTTP 색인 정책" : field === "heading" ? "본문 제목" : "스키마 파싱 상태"}이 승인 범위 밖에서 변경됐습니다.`,
    });
  }
  if (baseline.finalUrl !== current.finalUrl)
    add({ field: "finalUrl", classification: "unexpected", approvedChange: false,
      before: baseline.finalUrl, after: current.finalUrl, expectedValue: null,
      ruleId: "redirect-target-changed", detail: "최종 도착 URL이 변경됐습니다. 대상 페이지를 다시 확인하세요." });
  // contentHash alone is raw HTML noise; semantic fields/bodyHash determine conflicts.
  return result;
}
