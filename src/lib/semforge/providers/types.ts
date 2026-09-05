export type ProviderStatus = "live" | "unavailable" | "error";

export interface ProviderResult<T> {
  status: ProviderStatus;
  data?: T;
  source: string;
  fetchedAt: string;
  reason?: string;
}

export function providerLive<T>(source: string, data: T): ProviderResult<T> {
  return { status: "live", data, source, fetchedAt: new Date().toISOString() };
}

export function providerUnavailable<T = never>(source: string, reason: string): ProviderResult<T> {
  return { status: "unavailable", source, reason, fetchedAt: new Date().toISOString() };
}

export function providerError<T = never>(source: string, reason: string): ProviderResult<T> {
  return { status: "error", source, reason, fetchedAt: new Date().toISOString() };
}

export interface ProviderBadgeMeta {
  status: ProviderStatus;
  source: string;
  fetchedAt: string;
  label: string;
  tone: "success" | "muted" | "danger";
  reason?: string;
}

const BADGE_LABEL: Record<ProviderStatus, string> = {
  live: "실시간 수집",
  unavailable: "연결 필요",
  error: "수집 실패",
};

const BADGE_TONE: Record<ProviderStatus, ProviderBadgeMeta["tone"]> = {
  live: "success",
  unavailable: "muted",
  error: "danger",
};

export function toProvenanceBadge<T>(result: ProviderResult<T>): ProviderBadgeMeta {
  return {
    status: result.status,
    source: result.source,
    fetchedAt: result.fetchedAt,
    label: BADGE_LABEL[result.status],
    tone: BADGE_TONE[result.status],
    ...(result.reason === undefined ? {} : { reason: result.reason }),
  };
}
