// Ported from leecg39/GEO_master2 packages/core/src/urls/normalize.ts
/**
 * URL 정규화 (TRD §5 단계 4).
 * - 트래킹 파라미터 제거 (utm_*, gclid, fbclid …)
 * - 상품 식별 쿼리 보존
 * - 등록 도메인 추출 (공개 접미사 2단 TLD 처리)
 */

const TRACKING_PARAMS = new Set([
  'gclid', 'fbclid', 'msclkid', 'mc_cid', 'mc_eid', 'dclid', 'gbraid',
  'wbraid', 'igshid', 'ref_src', '_ga', '_gl', 'spm', 'pvid', 'si',
  'scm', 'ref_', 'ref', 'yclid', 'twclid', 'ttclid', 'epik',
]);

const TWO_PART_TLDS = new Set([
  'co.kr', 'or.kr', 'ne.kr', 'go.kr', 'ac.kr', 're.kr', 'pe.kr',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'co.jp', 'or.jp', 'ne.jp',
  'com.br', 'com.au', 'com.tw', 'com.hk', 'com.cn', 'com.sg', 'com.my',
  'com.mx', 'com.co', 'com.vn', 'com.ph', 'com.pk', 'com.pe', 'com.ar',
  'com.sa', 'com.eg', 'com.ng', 'com.tr', 'com.pl', 'co.in', 'co.id',
  'co.nz', 'co.za', 'co.th', 'net.au', 'org.au', 'edu.au', 'com.bd',
]);

export interface NormalizedUrl {
  raw: string;
  normalized: string;
  domain: string;
  registeredDomain: string;
  valid: boolean;
}

export function registeredDomain(host: string): string {
  const labels = host.toLowerCase().split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const last2 = labels.slice(-2).join('.');
  if (TWO_PART_TLDS.has(last2) && labels.length >= 3) {
    return labels.slice(-3).join('.');
  }
  return last2;
}

export function normalizeUrl(raw: string): NormalizedUrl {
  const invalid: NormalizedUrl = {
    raw,
    normalized: raw.trim(),
    domain: '',
    registeredDomain: '',
    valid: false,
  };
  const trimmed = raw.trim();
  if (!trimmed) return invalid;
  // 명시적 스킴이 있으면 http(s)만 허용
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed);
  if (schemeMatch && !/^https?$/i.test(schemeMatch[1]!)) return invalid;

  let url: URL;
  try {
    url = new URL(schemeMatch ? trimmed : `https://${trimmed}`);
  } catch {
    return invalid;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return invalid;
  if (!url.hostname.includes('.')) return invalid;

  // 호스트: 소문자 + www. 제거 + 기본 포트 제거
  let host = url.hostname.toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);
  url.hostname = host;
  if (
    (url.protocol === 'https:' && url.port === '443') ||
    (url.protocol === 'http:' && url.port === '80')
  ) {
    url.port = '';
  }

  // 쿼리 정리: 추적 파라미터·utm_* 제거, 나머지 보존 후 정렬
  const kept = [...url.searchParams.entries()].filter(
    ([k]) => !k.startsWith('utm_') && !TRACKING_PARAMS.has(k.toLowerCase()),
  );
  url.search = '';
  kept.sort(([a], [b]) => a.localeCompare(b));
  for (const [k, v] of kept) url.searchParams.append(k, v);

  url.hash = '';

  let normalized = url.toString();
  // 경로 없는 루트는 슬래시 제거해 일관성 확보
  if (normalized.endsWith('/') && url.pathname === '/' && !url.search) {
    normalized = normalized.slice(0, -1);
  }

  const domain = host;
  return { raw, normalized, domain, registeredDomain: registeredDomain(domain), valid: true };
}
