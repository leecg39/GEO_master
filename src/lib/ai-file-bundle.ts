/**
 * AI 파일 묶음 점검 (Qshop P07).
 * llms.txt 외의 llms-ko.txt·ai.txt·ai-ko.txt는 큐샵 호환용 선택 파일이며 모든 AI 제공자의 보편 규격이 아니다 (계획 §5.3).
 * 저장 문서 모델은 바꾸지 않고, 공개 사이트에서 각 파일을 실제로 요청해 상태를 보여 준다.
 * - present: 2xx이고 HTML이 아님 / missing: 404·410 또는 HTML 소프트 404 / unknown: 오류·5xx (없다고 단정하지 않음)
 */
import { createHash } from "node:crypto";
import { normalizePublicUrl, fetchPublicText } from "@/lib/url-security";

export type BundleTier = "standard" | "optional";
export type BundleState = "present" | "missing" | "unknown";

export const BUNDLE_FILES: ReadonlyArray<{ path: string; tier: BundleTier; purpose: string }> = [
  { path: "/llms.txt", tier: "standard", purpose: "제안 규격의 기본 파일" },
  { path: "/llms-ko.txt", tier: "optional", purpose: "한국어 안내(큐샵 호환용)" },
  { path: "/ai.txt", tier: "optional", purpose: "AI 이용 안내(큐샵 호환용)" },
  { path: "/ai-ko.txt", tier: "optional", purpose: "한국어 AI 이용 안내(큐샵 호환용)" },
];

const PROBE_TIMEOUT_MS = 8_000;
const TEXT_MIME = /(?:text\/plain|text\/markdown|text\/x-markdown)/i;

export interface BundleFileResult {
  path: string; tier: BundleTier; purpose: string; url: string; state: BundleState; httpStatus: number | null;
  contentType: string | null; contentHash: string | null; bytes: number | null; detail: string; warnings: string[];
}

async function probe(origin: string, file: (typeof BUNDLE_FILES)[number]): Promise<BundleFileResult> {
  const url = new URL(file.path, origin).toString();
  const base = { path: file.path, tier: file.tier, purpose: file.purpose, url };
  try {
    const response = await fetchPublicText(url, PROBE_TIMEOUT_MS);
    const empty = { httpStatus: response.status, contentType: response.contentType || null, contentHash: null, bytes: null, warnings: [] as string[] };
    if (response.status >= 200 && response.status < 300) {
      if (/html/i.test(response.contentType) || /^\s*<(?:!doctype|html|head|body)/i.test(response.text)) {
        return { ...base, ...empty, state: "missing", detail: `HTTP ${response.status}이지만 HTML 페이지가 응답했습니다(소프트 404)` };
      }
      const warnings = response.contentType && !TEXT_MIME.test(response.contentType) ? [`MIME 유형이 text/plain 또는 Markdown이 아닙니다 (${response.contentType})`] : [];
      return { ...base, ...empty, state: "present", detail: `HTTP ${response.status}`, contentHash: createHash("sha256").update(response.text).digest("hex"), bytes: Buffer.byteLength(response.text), warnings };
    }
    if (response.status === 404 || response.status === 410) return { ...base, ...empty, state: "missing", detail: `HTTP ${response.status}` };
    return { ...base, ...empty, state: "unknown", detail: `HTTP ${response.status}` };
  } catch {
    return { ...base, httpStatus: null, contentType: null, contentHash: null, bytes: null, warnings: [], state: "unknown", detail: "요청 실패(네트워크·차단·시간 초과) — 없다고 판정하지 않았습니다" };
  }
}

export async function checkAiFileBundle(website: string) {
  const site = normalizePublicUrl(website);
  const files = await Promise.all(BUNDLE_FILES.map((file) => probe(site.origin, file)));
  return {
    website: site.origin,
    checkedAt: new Date().toISOString(),
    files,
    note: "llms-ko.txt·ai.txt·ai-ko.txt는 큐샵 호환용 선택 파일이며 모든 AI 제공자가 읽는 보편적인 규격이 아닙니다. 파일이 있다고 AI 검색에 인용된다는 뜻도 아닙니다.",
  };
}
