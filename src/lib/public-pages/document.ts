import { NextResponse } from "next/server";
import { html, raw, type SafeHtml } from "./html";
import { BASE_STYLES } from "./styles";

/** layout.tsx의 metadataBase와 같은 운영 주소. 공유 미리보기에는 절대 URL이 필요하다. */
export const SITE_ORIGIN = "https://geo.soverin.cloud";
const SOCIAL_IMAGE = `${SITE_ORIGIN}/og/geo-master-20261007.jpg`;
const SOCIAL_THUMBNAIL = `${SITE_ORIGIN}/og/geo-master-thumbnail-20261007.jpg`;

/** 스크립트 없이 인라인 CSS·같은 출처 이미지·같은 출처 폼 전송만 허용한다. */
export const PUBLIC_PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

interface DocumentOptions {
  title: string;
  description: string;
  styles: string;
  body: SafeHtml;
  /** 링크 공유 미리보기(OG·Twitter) 메타 태그 포함 여부 */
  social?: boolean;
}

function socialMeta(title: string, description: string) {
  return html`
<link rel="canonical" href="${SITE_ORIGIN}/">
<meta property="og:type" content="website">
<meta property="og:locale" content="ko_KR">
<meta property="og:url" content="${SITE_ORIGIN}/">
<meta property="og:site_name" content="GEO Master">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${SOCIAL_IMAGE}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="GEO Master — AI 검색 속, 브랜드의 존재감을 높이다">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${SOCIAL_THUMBNAIL}">
<meta name="twitter:image:alt" content="GEO Master — AI 검색, 브랜드가 답이 되다">`;
}

export function renderPublicDocument({ title, description, styles, body, social = false }: DocumentOptions): string {
  return html`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#150f23">${social ? socialMeta(title, description) : ""}
<style>${raw(BASE_STYLES + styles)}</style>
</head>
<body>
${body}
</body>
</html>
`.value;
}

export function siteHeader(actions: SafeHtml, sectionLinks = false): SafeHtml {
  return html`<a class="skip" href="#main">본문으로 건너뛰기</a>
<header class="site-header">
  <div class="wrap nav">
    <a class="brand" href="/welcome"><span class="brand-mark" aria-hidden="true">GEO</span>GEO Master</a>
    ${sectionLinks ? html`<nav class="nav-links" aria-label="소개 메뉴">
      <a href="#geo">GEO란?</a><a href="#features">기능</a><a href="#semforge">SEMForge Pro</a><a href="#pricing">요금제</a><a href="#faq">FAQ</a>
    </nav>` : ""}
    <div class="nav-actions">${actions}</div>
  </div>
</header>`;
}

export function siteFooter(links: SafeHtml): SafeHtml {
  return html`<footer class="site-footer">
  <div class="wrap footer-row">
    <span>© GEO Master · AI 검색 최적화 워크스페이스</span>
    <nav aria-label="바닥글 메뉴">${links}</nav>
  </div>
</footer>`;
}

export function publicHtmlResponse(document: string, status = 200): NextResponse {
  return new NextResponse(document, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "same-origin",
      "content-security-policy": PUBLIC_PAGE_CSP,
    },
  });
}
