/**
 * Qshop 계획 P01 — URL 발견(Map)과 실제 측정을 구분한다.
 * - Map으로 찾은 URL은 요청하지 않았으므로 HTTP 상태를 "미측정"으로 둔다
 * - llms.txt는 사이트맵 목록이 아니라 실제 공개 경로 요청으로 판정한다 (§5.1-7)
 */
import { fetchPublicText } from "@/lib/url-security";

export type LlmsTxtState = "present" | "missing" | "unknown";
export type SiteAuditDataState = "none" | "discovered" | "legacy_estimate";

const PROBE_TIMEOUT_MS = 8_000;

/** URL 경로 세그먼트 수 — 클릭 깊이가 아니라 주소 구조상의 깊이 */
export function urlPathDepth(url: string) {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return 0;
  }
}

function looksLikeHtml(text: string, contentType: string) {
  return /html/i.test(contentType) || /^\s*<(?:!doctype|html|head|body)/i.test(text);
}

/** 실제 /llms.txt 요청 결과. 네트워크 오류·서버 오류는 "확인 불가"이며 "없음"이 아니다 */
export async function probeLlmsTxt(domain: string): Promise<{ state: LlmsTxtState; detail: string }> {
  try {
    const response = await fetchPublicText(`https://${domain}/llms.txt`, PROBE_TIMEOUT_MS);
    if (response.status >= 200 && response.status < 300) {
      return looksLikeHtml(response.text, response.contentType)
        ? { state: "missing", detail: `HTTP ${response.status}이지만 HTML 페이지가 응답했습니다(소프트 404)` }
        : { state: "present", detail: `HTTP ${response.status}` };
    }
    if (response.status === 404 || response.status === 410) return { state: "missing", detail: `HTTP ${response.status}` };
    return { state: "unknown", detail: `HTTP ${response.status}` };
  } catch {
    return { state: "unknown", detail: "요청 실패(네트워크·차단·시간 초과)" };
  }
}
