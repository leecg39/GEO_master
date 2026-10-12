/**
 * A8 — 만점 도달 검증. RankSEO는 GEO 묶음 최대 합이 78/80이라 모든 신호를 충족해도 98점이었다(REA L3).
 * 모든 신호를 갖춘 페이지가 각 점수에서 실제로 만점·전부 통과가 되는지, 서로 모순되는 규칙이 없는지 확인한다.
 */
import { describe, expect, it } from "vitest";
import { AUDIT_RULES, parseAuditHtml, scoreAudit } from "@/lib/audit";
import { generateLlmsTxt } from "@/lib/llms-txt";
import { analyzeObservation } from "@/lib/page-snapshots";

const ORIGIN = "https://shop.example";
const PAGE = `${ORIGIN}/guide/cordless-vacuum`;
const sentence = (text: string, times: number) => Array.from({ length: times }, () => text).join(" ");
const jsonLd = [
  { "@context": "https://schema.org", "@type": "Organization", name: "큐샵", url: ORIGIN, logo: `${ORIGIN}/logo.png`, sameAs: ["https://www.instagram.com/qshop"], description: "생활가전 전문 쇼핑몰" },
  { "@context": "https://schema.org", "@type": "Article", headline: "무선 청소기 고르는 법", image: `${ORIGIN}/a.png`, datePublished: "2026-09-01", dateModified: "2026-10-01", author: { "@type": "Person", name: "김에디터" } },
  { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [] },
];

const html = `<!doctype html><html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>무선 청소기 고르는 법 — 큐샵 가이드</title>
<meta name="description" content="무선 청소기를 흡입력, 사용 시간, 무게, 필터 기준으로 비교하고 우리 집에 맞는 모델을 고르는 방법을 정리했습니다.">
<meta name="author" content="김에디터">
<meta property="article:published_time" content="2026-09-01"><meta property="article:modified_time" content="2026-10-01">
<link rel="canonical" href="${PAGE}">
<meta property="og:title" content="무선 청소기 고르는 법"><meta property="og:description" content="흡입력·사용 시간·무게 비교"><meta property="og:image" content="${ORIGIN}/og.png">
${jsonLd.map((block) => `<script type="application/ld+json">${JSON.stringify(block)}</script>`).join("\n")}
</head><body><main><article>
<h1>무선 청소기 고르는 법</h1>
<p>결론부터 말하면 30평 이하 집에는 사용 시간 40분 이상, 무게 2.5kg 이하 모델이 알맞습니다. 아래에서 기준별로 비교합니다.</p>
<h2>무선 청소기는 어떻게 고르나요?</h2>
<p>${sentence("흡입력은 에어와트 기준으로 비교하고, 사용 시간은 표준 모드 기준으로 확인합니다.", 9)}</p>
<h3>흡입력</h3><ul><li>에어와트 150AW 이상</li><li>먼지 센서 여부</li></ul>
<h2>모델별 비교</h2>
<table><tr><th>모델</th><th>사용 시간</th></tr><tr><td>A1</td><td>45분</td></tr><tr><td>B2</td><td>60분</td></tr></table>
<p>${sentence("가격은 공식 판매처 기준이며 2026년 10월 1일에 확인했습니다.", 9)}</p>
<h2>자주 묻는 질문</h2>
<details><summary>배터리는 교체할 수 있나요?</summary><p>대부분 교체할 수 있습니다.</p></details>
<details><summary>물걸레 기능이 필요한가요?</summary><p>바닥재에 따라 다릅니다.</p></details>
<details><summary>필터는 얼마나 자주 갈아야 하나요?</summary><p>6개월마다 권장합니다.</p></details>
<p>${sentence("출처는 제조사 사양표와 한국소비자원 비교 시험 결과입니다.", 7)}</p>
<p><a href="${ORIGIN}/guide">가이드 목록</a> · <a href="${ORIGIN}/products">상품 보기</a> · <a href="https://www.kca.go.kr/">한국소비자원</a> · <a href="mailto:help@shop.example">문의</a></p>
<img src="/a.png" alt="무선 청소기 A1 정면 사진">
</article></main></body></html>`;

const files = {
  robots: "User-agent: *\nAllow: /\n\nSitemap: https://shop.example/sitemap.xml\n",
  llms: "# 큐샵\n\n> 생활가전 전문 쇼핑몰\n",
  sitemap: `<?xml version="1.0"?><urlset><url><loc>${PAGE}</loc></url></urlset>`,
};

describe("A8: a page with every signal reaches the maximum", () => {
  it("passes all 32 audit items (manual items confirmed) and gets the top grade", () => {
    const manual = Object.fromEntries(AUDIT_RULES.filter((rule) => rule.manual).map((rule) => [rule.code, true]));
    const scored = scoreAudit(parseAuditHtml(html, PAGE), files, manual);
    expect(scored.items.filter((item) => !item.passed).map((item) => `${item.code}: ${item.detail}`)).toEqual([]);
    expect(scored.score).toBe(scored.total);
    expect(scored.total).toBe(AUDIT_RULES.length);
    expect(scored.grade).toBe("우수");
  });

  it("passes every page snapshot rule, including hypotheses, with no rule contradicting another", () => {
    const analysis = analyzeObservation({ url: PAGE, finalUrl: PAGE, statusCode: 200, contentType: "text/html", renderMode: "native", body: html, bodyKind: "html" }, "shop.example");
    expect(analysis.skipped).toBeNull();
    expect(analysis.findings.filter((finding) => !finding.passed).map((finding) => `${finding.code}: ${finding.detail}`)).toEqual([]);
  });

  it("gives a complete llms.txt a validation score of 100", () => {
    const { validation } = generateLlmsTxt({
      brandName: "큐샵", website: ORIGIN, summary: "생활가전을 비교하고 고르는 방법을 안내하는 공식 쇼핑몰입니다.", details: "모든 가격은 공식 판매처 기준입니다.",
      sections: [{ heading: "가이드", links: [{ title: "무선 청소기 고르는 법", url: PAGE, description: "흡입력·사용 시간·무게 비교" }] }],
    });
    expect(validation.issues.filter((issue) => issue.severity !== "info")).toEqual([]);
    expect(validation.score).toBe(100);
  });
});
