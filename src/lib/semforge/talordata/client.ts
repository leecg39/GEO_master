import { AppError } from "@/lib/errors";
import { normalizeDomain } from "@/lib/semforge/utils/domain";

const ENDPOINT = "https://serpapi.talordata.net/serp/v1/request";

export type SerpEngine = "google" | "bing";

export interface SerpOrganicItem {
  position: number;
  title: string;
  link: string;
  domain: string;
  displayLink: string | null;
  description: string | null;
}

export interface AiOverviewCitation {
  url: string;
  domain: string;
  title: string | null;
}

export interface AiOverviewInfo {
  present: boolean;
  citationsAvailable: boolean;
  citations: AiOverviewCitation[];
}

export interface SerpResult {
  query: string;
  engine: SerpEngine;
  organic: SerpOrganicItem[];
  features: string[];
  aiOverview: AiOverviewInfo;
  capturedAt: Date;
}

function getToken(): string | null {
  return process.env.TALORDATA_API_TOKEN?.trim() || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAiOverview(raw: unknown): AiOverviewInfo {
  if (raw === undefined || raw === null || raw === false) {
    return { present: false, citationsAvailable: false, citations: [] };
  }
  if (typeof raw !== "object") {
    return { present: true, citationsAvailable: false, citations: [] };
  }
  const citations = new Map<string, AiOverviewCitation>();
  const walk = (value: unknown, depth: number): void => {
    if (depth > 6 || value === null || value === undefined) return;
    if (Array.isArray(value)) { for (const item of value) walk(item, depth + 1); return; }
    if (typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const link = typeof record.link === "string" ? record.link
      : typeof record.url === "string" ? record.url : null;
    if (link && /^https?:\/\//i.test(link)) {
      const domain = normalizeDomain(link);
      if (domain && !citations.has(link)) {
        citations.set(link, { url: link, domain, title: typeof record.title === "string" ? record.title : null });
      }
    }
    for (const child of Object.values(record)) walk(child, depth + 1);
  };
  walk(raw, 0);
  return { present: true, citationsAvailable: citations.size > 0, citations: [...citations.values()] };
}

const FEATURE_KEYS: Record<string, string> = {
  google_ai_overview: "ai_overview",
  ai_overview: "ai_overview",
  snack_pack: "local_pack",
  knowledge: "knowledge_panel",
  people_also_ask: "people_also_ask",
};

export async function fetchSerp(input: {
  q: string;
  engine?: SerpEngine;
  num?: number;
  gl?: string;
  hl?: string;
  device?: "desktop" | "mobile";
}): Promise<SerpResult> {
  const token = getToken();
  if (!token) {
    throw new AppError("TALORDATA_API_TOKEN 이 설정되지 않았습니다.", 503, "TALORDATA_UNAVAILABLE");
  }
  const engine = input.engine ?? "google";
  const body = new URLSearchParams({
    engine,
    q: input.q,
    num: String(Math.min(100, Math.max(1, input.num ?? 10))),
    gl: (input.gl ?? "kr").toLowerCase(),
    hl: (input.hl ?? "ko").toLowerCase(),
    device: input.device ?? "desktop",
    json: "1",
  });
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new AppError("SERP API 토큰이 유효하지 않습니다.", 502, "TALORDATA_AUTH_FAILED");
    }
    if (response.status === 429) {
      throw new AppError("SERP API 사용량 한도에 도달했습니다.", 429, "RATE_LIMITED");
    }
    throw new AppError(`SERP 제공사가 HTTP ${response.status} 를 반환했습니다.`, 502, "TALORDATA_ERROR");
  }
  const payload = await response.json() as Record<string, unknown>;
  const data = isRecord(payload.data) ? payload.data : payload;
  const organicRaw = Array.isArray(data.organic) ? data.organic as Record<string, unknown>[] : [];
  const organic: SerpOrganicItem[] = organicRaw
    .filter((item) => typeof item.link === "string" && item.link.length > 0)
    .map((item, index) => ({
      position: Number.isInteger(item.position) && (item.position as number) > 0 ? item.position as number : index + 1,
      title: String(item.title ?? ""),
      link: String(item.link),
      domain: normalizeDomain(String(item.link)),
      displayLink: typeof item.display_link === "string" ? item.display_link : null,
      description: typeof item.description === "string" ? item.description : null,
    }));
  if (organic.length === 0) {
    throw new AppError("SERP 제공사가 빈 결과를 반환했습니다.", 502, "TALORDATA_EMPTY");
  }
  const features = Object.entries(FEATURE_KEYS)
    .filter(([key]) => data[key] !== undefined && data[key] !== null && data[key] !== false)
    .map(([, name]) => name);
  const aiOverview = parseAiOverview(data.ai_overview ?? data.google_ai_overview);
  if (aiOverview.present && !features.includes("ai_overview")) features.push("ai_overview");
  return {
    query: input.q,
    engine,
    organic,
    features: [...new Set(features)],
    aiOverview,
    capturedAt: new Date(),
  };
}

export function talordataConfigured(): boolean {
  return Boolean(getToken());
}
