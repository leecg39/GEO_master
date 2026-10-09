import type { SignupMode } from "@/lib/accounts/signup";
import { SEMFORGE_FEATURES, SEMFORGE_MONTHLY_PRICE_KRW } from "@/lib/semforge-subscription";
import { semforgeFeatures } from "@/lib/semforge/navigation";
import { renderPublicDocument, siteFooter, siteHeader } from "./document";
import { html, type SafeHtml } from "./html";
import { LANDING_STYLES } from "./styles";

export interface LandingContext {
  /** local: 로그인 없는 단일 사용자 모드 · login: app/proxy 로그인 모드 */
  auth: "local" | "login";
  signedIn: boolean;
  signupMode: SignupMode;
}

interface Link { href: string; label: string }

interface LandingLinks {
  header: SafeHtml;
  primary: Link;
  secondary: Link;
  free: Link;
  semforge: Link;
  note: string;
}

const TITLE = "GEO Master | AI 검색 최적화 워크스페이스";
const DESCRIPTION = "AI 검색 속 브랜드의 존재감을 높이세요. GEO 진단, 응답 점유율 분석, 콘텐츠 전략을 한곳에서 관리합니다.";
const PRICE = SEMFORGE_MONTHLY_PRICE_KRW.toLocaleString("ko-KR");

const FUNNEL = [
  ["존재", "AI가 브랜드를 알고 있는가"],
  ["맥락", "무엇으로 이해하고 있는가"],
  ["시의성", "최신 정보로 답하는가"],
  ["추천", "조건에 맞게 권하는가"],
] as const;

const WORKFLOW = [
  ["측정", "브랜드명이 없는 실제 고객 질문을 GPT·Claude·Gemini·Grok에 반복 질의해 언급·순위·감정·경쟁사·인용 출처를 모읍니다. 예약 측정으로 변화를 꾸준히 추적합니다."],
  ["진단", "공식 사이트의 robots.txt·llms.txt·sitemap과 SEO·GEO·E-E-A-T·기술 항목을 점검하고, 이미지·영상의 대체 정보까지 확인합니다."],
  ["개선·보고", "수정안 작업대·콘텐츠 스튜디오·최적화 랩으로 개선안을 만들고, 진단과 점유율 근거를 JSON·CSV·PDF 리포트로 공유합니다."],
] as const;

const FEATURES = [
  ["AI 언급 모니터링", "질문별로 각 AI 모델의 응답 원문과 브랜드 언급·인용 변화를 추적합니다."],
  ["응답 점유율", "브랜드 없는 질문을 여러 모델에 반복 실행해 언급률·순위·감정·경쟁사와 GenRank를 분석합니다."],
  ["GEO 진단", "URL·robots.txt·llms.txt·sitemap을 수집해 SEO·GEO·E-E-A-T·기술·브랜드 항목을 점검합니다."],
  ["멀티모달 감사", "이미지 alt·파일명·차트 텍스트와 영상 자막·챕터·대본 신호를 한 번에 점검합니다."],
  ["llms.txt", "공식 제안 형식의 초안을 만들고 구조를 검증한 뒤 원격 /llms.txt 배포 상태를 확인합니다."],
  ["구조화 데이터", "Organization·WebSite·Product 등 JSON-LD를 만들어 브랜드 엔티티를 선명하게 합니다."],
  ["콘텐츠 스튜디오", "리라이팅·FAQ·엔티티 정의 등 AI가 인용하기 좋은 형식의 콘텐츠 초안을 만듭니다."],
  ["최적화 랩", "가상의 생성형 검색 답변으로 인용 비중을 추정하고 구조·내용·언어 피처를 조정해 개선 방향을 찾습니다."],
  ["검수함·사실 메모", "자동 식별과 사실 대조 결과를 사람이 확정하고, 공식 자료로 확인한 브랜드 사실을 관리합니다."],
  ["수정안 작업대", "페이지별 현재 값·수정안·근거를 나란히 두고 승인한 뒤 반영 여부를 기록합니다."],
  ["예약 측정·리포트", "비용 한도 안에서 측정을 반복하고 결과를 JSON·CSV·PDF와 만료형 공유 링크로 전달합니다."],
  ["전략·학습 센터", "질문 매핑·콘텐츠 캘린더와 38개 항목 GEO 체크리스트로 4주 개선 사이클을 운영합니다."],
] as const;

const FREE_PLAN = [
  "AI 언급 모니터링·응답 점유율 측정",
  "GEO 진단·멀티모달 감사",
  "llms.txt·구조화 데이터 생성",
  "콘텐츠 스튜디오·최적화 랩·수정안 작업대",
  "예약 측정·리포트·전략 워크스페이스",
] as const;

function landingLinks(context: LandingContext): LandingLinks {
  if (context.auth === "local" || context.signedIn) {
    return {
      header: html`<a class="btn btn-primary btn-sm" href="/">워크스페이스 열기</a>`,
      primary: { href: "/", label: "워크스페이스 열기" },
      secondary: { href: "#pricing", label: "요금제 보기" },
      free: { href: "/", label: "GEO 측정 시작하기" },
      semforge: { href: "/subscription", label: "SEMForge Pro 구독하기" },
      note: context.auth === "local" ? "이 서버는 로그인 없는 단일 사용자 모드로 실행 중입니다." : "로그인되어 있습니다. 워크스페이스에서 바로 이어서 작업하세요.",
    };
  }
  if (context.signupMode === "closed") {
    return {
      header: html`<a class="btn btn-primary btn-sm" href="/login">로그인</a>`,
      primary: { href: "/login", label: "로그인" },
      secondary: { href: "#pricing", label: "요금제 보기" },
      free: { href: "/login", label: "로그인" },
      semforge: { href: "/login", label: "로그인 후 구독하기" },
      note: "현재 신규 가입은 받지 않습니다. 기존 회원은 로그인해 주세요.",
    };
  }
  return {
    header: html`<a class="btn btn-ghost btn-sm hide-sm" href="/login">로그인</a><a class="btn btn-primary btn-sm" href="/signup?plan=free">무료로 시작</a>`,
    primary: { href: "/signup?plan=free", label: "무료로 시작하기 · GEO 측정" },
    secondary: { href: "#semforge", label: "SEMForge Pro 알아보기" },
    free: { href: "/signup?plan=free", label: "무료로 시작하기" },
    semforge: { href: "/signup?plan=semforge", label: "SEMForge Pro로 시작하기" },
    note: context.signupMode === "approval" ? "가입 신청 후 관리자 승인을 거쳐 이용할 수 있습니다." : "가입하면 바로 이용할 수 있습니다.",
  };
}

function cards(items: readonly (readonly [string, string])[], className = "card"): SafeHtml[] {
  return items.map(([title, text]) => html`<article class="${className}"><h3>${title}</h3><p>${text}</p></article>`);
}

function heroSection(links: LandingLinks): SafeHtml {
  return html`<section class="hero" aria-labelledby="hero-title">
  <div class="wrap hero-grid">
    <div>
      <p class="eyebrow">GEO MASTER · ANSWER WORKSPACE</p>
      <h1 id="hero-title">AI 검색 속,<br><em>브랜드가 답이 되다</em></h1>
      <p class="lead">ChatGPT·Claude·Gemini·Grok이 우리 브랜드를 어떻게 언급하고 인용하는지 측정하고, 원인을 진단하고, 개선 콘텐츠까지 한 워크스페이스에서 관리하세요. GEO Master는 생성형 AI 답변 속 브랜드 가시성을 높이는 GEO(Generative Engine Optimization) 실행 도구입니다.</p>
      <div class="cta-row">
        <a class="btn btn-primary" href="${links.primary.href}">${links.primary.label}</a>
        <a class="btn btn-ghost" href="${links.secondary.href}">${links.secondary.label}</a>
      </div>
      <p class="cta-note">${links.note}</p>
      <div class="chips" aria-label="응답을 측정하는 AI 모델"><span>측정 모델</span><span class="chip">GPT</span><span class="chip">Claude</span><span class="chip">Gemini</span><span class="chip">Grok</span></div>
    </div>
    <figure class="hero-art"><img src="/og/geo-master-20261007.jpg" width="1200" height="630" alt="GEO Master 워크스페이스 — AI 검색 속, 브랜드의 존재감을 높이다"></figure>
  </div>
</section>`;
}

function geoSection(): SafeHtml {
  const funnel = FUNNEL.map(([stage, question], index) => html`<article class="card"><span class="num">0${index + 1}</span><strong>${stage}</strong><p>${question}</p></article>`);
  return html`<section class="section" id="geo" aria-labelledby="geo-title">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">WHAT IS GEO</p>
      <h2 id="geo-title">검색 결과에서 AI 답변으로, 최적화의 대상이 바뀌었습니다</h2>
      <p>제로클릭 환경에서는 사용자가 링크를 누르기 전에 AI 요약에서 탐색을 끝냅니다. 이제는 클릭 순위뿐 아니라 AI 답변 안에서 브랜드가 발견되고, 올바른 맥락으로 이해되고, 근거와 함께 추천되는지를 관리해야 합니다.</p>
    </div>
    <div class="grid grid-2 compare">
      <article class="card"><h3><span>SEO</span>검색 결과의 순위와 클릭을 높입니다</h3><p>키워드·링크·기술 최적화로 검색 결과 페이지에서 더 잘 보이도록 만듭니다.</p></article>
      <article class="card is-geo"><h3><span>GEO</span>AI 답변 속 언급·인용·추천을 높입니다</h3><p>엔티티 정의·근거 소스·구조화 데이터·llms.txt로 생성형 AI가 브랜드의 맥락을 정확히 선택하게 만듭니다.</p></article>
    </div>
    <div class="grid grid-4 funnel" aria-label="GEO 퍼널 4단계">${funnel}</div>
  </div>
</section>`;
}

function workflowSection(): SafeHtml {
  const steps = WORKFLOW.map(([title, text], index) => html`<article class="card"><span class="num">0${index + 1}</span><h3>${title}</h3><p>${text}</p></article>`);
  return html`<section class="section section-alt" id="how" aria-labelledby="how-title">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">HOW IT WORKS</p>
      <h2 id="how-title">측정하고, 진단하고, 개선합니다</h2>
      <p>GEO Master는 4주 단위 개선 사이클을 한 워크스페이스에서 운영하도록 설계되었습니다. 매달 응답 점유율과 GenRank 변화를 비교해 실제로 달라졌는지 확인합니다.</p>
    </div>
    <div class="grid grid-3">${steps}</div>
  </div>
</section>`;
}

function featuresSection(): SafeHtml {
  return html`<section class="section" id="features" aria-labelledby="features-title">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">FEATURES</p>
      <h2 id="features-title">GEO 실행에 필요한 도구를 한곳에</h2>
      <p>무료 계정으로 아래 GEO 측정·진단·개선 도구를 모두 사용할 수 있습니다.</p>
    </div>
    <div class="grid grid-3">${cards(FEATURES, "card feature-card")}</div>
  </div>
</section>`;
}

function semforgeSection(): SafeHtml {
  const items = semforgeFeatures.map(({ label, description }) => [label, description] as const);
  return html`<section class="section section-alt pro" id="semforge" aria-labelledby="semforge-title">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">SEMFORGE PRO · 유료</p>
      <h2 id="semforge-title">AI 답변 너머 검색 성과까지, SEMForge Pro</h2>
      <p>GEO 측정에 더해 실측 SERP 데이터와 크롤 기반 진단으로 검색 성과 전반을 관리하는 유료 워크스페이스입니다. 계정별 월 ${PRICE}원(VAT 별도) 구독으로 이용합니다.</p>
    </div>
    <div class="grid grid-3">${cards(items, "card feature-card")}</div>
  </div>
</section>`;
}

function checkList(items: readonly string[]): SafeHtml {
  return html`<ul class="checks">${items.map((item) => html`<li>${item}</li>`)}</ul>`;
}

function pricingSection(links: LandingLinks, context: LandingContext): SafeHtml {
  const approval = context.auth === "login" && !context.signedIn && context.signupMode === "approval";
  return html`<section class="section" id="pricing" aria-labelledby="pricing-title">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">PRICING</p>
      <h2 id="pricing-title">무료로 시작하고, 필요할 때 SEMForge Pro로</h2>
      <p>가입할 때 계정 유형을 고릅니다. 무료 계정은 GEO 측정에, SEMForge Pro 계정은 결제 후 SEMForge 실행 기능까지 사용합니다.</p>
    </div>
    <div class="grid grid-2 plans">
      <article class="plan" aria-labelledby="plan-free">
        <div class="plan-top"><h3 id="plan-free">무료 · GEO 측정</h3><span class="badge badge-muted">FREE</span></div>
        <p class="price">₩0</p>
        <p class="price-note">신용카드 없이 시작</p>
        ${checkList(FREE_PLAN)}
        <a class="btn btn-ghost" href="${links.free.href}">${links.free.label}</a>
      </article>
      <article class="plan plan-featured" aria-labelledby="plan-pro">
        <div class="plan-top"><h3 id="plan-pro">SEMForge Pro · 유료</h3><span class="badge">PRO</span></div>
        <p class="price">₩${PRICE}<small>/ 월</small></p>
        <p class="price-note">VAT 별도 · 계정별 구독</p>
        ${checkList(["무료 플랜의 모든 GEO 기능", ...SEMFORGE_FEATURES])}
        <a class="btn btn-primary" href="${links.semforge.href}">${links.semforge.label}</a>
        <p class="plan-foot">결제는 로그인 후 구독 화면에서 진행하며, 결제가 확인되면 SEMForge 기능이 열립니다.</p>
      </article>
    </div>
    ${approval ? html`<div class="grid grid-3 steps" aria-label="가입 절차">
      <article class="card"><span class="num">01</span><h3>가입 신청</h3><p>이메일과 비밀번호로 계정 유형을 골라 신청합니다.</p></article>
      <article class="card"><span class="num">02</span><h3>관리자 승인</h3><p>관리자가 신청을 확인하고 계정을 승인합니다.</p></article>
      <article class="card"><span class="num">03</span><h3>로그인 후 시작</h3><p>무료 계정은 GEO 측정으로, SEMForge Pro 계정은 구독 결제 화면으로 바로 이동합니다.</p></article>
    </div>` : ""}
  </div>
</section>`;
}

function signupAnswer(context: LandingContext): string {
  if (context.auth === "local") return "이 서버는 로그인 없는 단일 사용자 모드로 실행 중이라 가입 없이 바로 워크스페이스를 사용합니다.";
  if (context.signupMode === "auto") return "네. 가입을 마치면 바로 로그인되어 선택한 계정 유형으로 시작합니다.";
  if (context.signupMode === "closed") return "현재 신규 가입은 받지 않습니다. 이미 계정이 있다면 로그인해 주세요.";
  return "가입 신청 후 관리자가 승인하면 로그인할 수 있습니다. 승인 전에는 로그인 화면에서 승인 대기 상태를 안내합니다.";
}

function faqSection(context: LandingContext): SafeHtml {
  const items: [string, string][] = [
    ["GEO는 SEO와 무엇이 다른가요?", "SEO가 검색 결과의 순위와 클릭을 다룬다면, GEO는 생성형 AI가 답변을 만들 때 브랜드를 발견하고 올바른 맥락으로 이해해 근거와 함께 추천하도록 만드는 작업입니다. GEO Master는 SEO 기본기 위에서 AI 답변 속 존재감을 측정하고 개선합니다."],
    ["무료 계정으로 무엇을 할 수 있나요?", "AI 언급 모니터링, 응답 점유율 측정, GEO 진단, llms.txt·구조화 데이터, 콘텐츠 스튜디오와 리포트 등 GEO Master의 측정·진단·개선 도구를 사용할 수 있습니다."],
    ["SEMForge Pro는 무엇이 다른가요?", `실측 SERP 기반 AI Overview 가시성, 크롤 기반 사이트 진단, 포지션 추적, 도메인 개요, 지역 SEO 같은 SEMForge 실행 기능이 추가됩니다. 계정별 월 ${PRICE}원(VAT 별도) 구독으로 이용합니다.`],
    ["가입하면 바로 이용할 수 있나요?", signupAnswer(context)],
    ["무료로 시작한 뒤 SEMForge Pro로 바꿀 수 있나요?", "네. 로그인 후 SEMForge Pro 구독 화면에서 결제를 마치면 같은 계정에서 SEMForge 기능이 활성화됩니다."],
    ["데이터는 어디에 저장되나요?", "프로젝트와 측정 결과는 이 서비스를 운영하는 서버의 데이터베이스에 저장되고, AI 공급자 API 키는 AES-256-GCM으로 암호화해 보관합니다."],
  ];
  return html`<section class="section section-alt" id="faq" aria-labelledby="faq-title">
  <div class="wrap">
    <div class="section-head"><p class="eyebrow">FAQ</p><h2 id="faq-title">자주 묻는 질문</h2></div>
    <div class="faq">${items.map(([question, answer]) => html`<details><summary>${question}</summary><p>${answer}</p></details>`)}</div>
  </div>
</section>`;
}

function closingSection(links: LandingLinks): SafeHtml {
  return html`<section class="closing" aria-labelledby="closing-title">
  <div class="wrap">
    <h2 id="closing-title">AI가 답할 때, 우리 브랜드가 함께 나오도록</h2>
    <p>지금 GEO 측정을 시작하고 AI 답변 속 브랜드의 현재 위치부터 확인하세요.</p>
    <div class="cta-row"><a class="btn btn-primary" href="${links.primary.href}">${links.primary.label}</a><a class="btn btn-ghost" href="#pricing">요금제 비교</a></div>
  </div>
</section>`;
}

export function renderLandingPage(context: LandingContext): string {
  const links = landingLinks(context);
  const footerLinks = context.auth === "local" || context.signedIn
    ? html`<a href="/">워크스페이스</a><a href="#pricing">요금제</a>`
    : html`<a href="/login">로그인</a>${context.signupMode === "closed" ? "" : html`<a href="/signup">회원가입</a>`}<a href="#pricing">요금제</a>`;
  const body = html`${siteHeader(links.header, true)}
<main id="main">
${heroSection(links)}
${geoSection()}
${workflowSection()}
${featuresSection()}
${semforgeSection()}
${pricingSection(links, context)}
${faqSection(context)}
${closingSection(links)}
</main>
${siteFooter(footerLinks)}`;
  return renderPublicDocument({ title: TITLE, description: DESCRIPTION, styles: LANDING_STYLES, body, social: true });
}
