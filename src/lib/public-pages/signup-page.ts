import { MIN_PASSWORD_LENGTH } from "@/lib/accounts/env-admin";
import type { SignupMode, SignupValues } from "@/lib/accounts/signup";
import type { AccountPlan } from "@/lib/accounts/store";
import { SEMFORGE_MONTHLY_PRICE_KRW } from "@/lib/semforge-subscription";
import { renderPublicDocument, siteFooter, siteHeader } from "./document";
import { html, type SafeHtml } from "./html";
import { AUTH_STYLES } from "./styles";

export interface SignupPageOptions {
  /** local: 로그인 없는 단일 사용자 모드 · login: app/proxy 로그인 모드 */
  auth: "local" | "login";
  signupMode: SignupMode;
  plan: AccountPlan;
  values?: Partial<SignupValues>;
  errors?: string[];
}

const TITLE = "회원가입 · GEO Master";
const DESCRIPTION = "무료로 GEO 측정을 시작하거나 SEMForge Pro 유료 계정으로 가입하세요.";
const PRICE = SEMFORGE_MONTHLY_PRICE_KRW.toLocaleString("ko-KR");

function noticeCard(title: string, message: string, action: { href: string; label: string }): SafeHtml {
  return html`<div class="auth-card">
  <p class="eyebrow">GEO MASTER 회원가입</p>
  <h1>${title}</h1>
  <p>${message}</p>
  <a class="btn btn-primary submit" href="${action.href}">${action.label}</a>
  <div class="auth-links"><a href="/welcome">서비스 소개</a></div>
</div>`;
}

function planOptions(plan: AccountPlan): SafeHtml {
  return html`<fieldset>
  <legend>가입 유형</legend>
  <div class="plan-options">
    <label class="plan-option"><input type="radio" name="plan" value="free"${plan === "free" ? html` checked` : ""} required><span>
      <strong>무료로 시작 · GEO 측정</strong><span class="plan-price">₩0</span>
      <small>AI 언급 모니터링·응답 점유율·GEO 진단·llms.txt·콘텐츠 도구</small>
    </span></label>
    <label class="plan-option"><input type="radio" name="plan" value="semforge"${plan === "semforge" ? html` checked` : ""}><span>
      <strong>SEMForge Pro · 유료</strong><span class="plan-price">월 ₩${PRICE} (VAT 별도)</span>
      <small>무료 기능 전체 + 실측 SERP·사이트 진단·포지션 추적·지역 SEO. 결제는 로그인 후 구독 화면에서 진행합니다.</small>
    </span></label>
  </div>
</fieldset>`;
}

function accountFields(values: Partial<SignupValues>): SafeHtml {
  return html`<div class="field"><label for="email">이메일 (로그인 아이디)</label>
  <input id="email" name="email" type="email" autocomplete="email" maxlength="128" required value="${values.email ?? ""}"></div>
<div class="field"><label for="displayName">이름</label>
  <input id="displayName" name="displayName" autocomplete="name" maxlength="50" required value="${values.displayName ?? ""}"></div>
<div class="field"><label for="password">비밀번호</label>
  <input id="password" name="password" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" maxlength="72" required aria-describedby="password-hint">
  <span class="hint" id="password-hint">${MIN_PASSWORD_LENGTH}자 이상, 이메일과 다른 비밀번호를 사용하세요.</span></div>
<div class="field"><label for="passwordConfirm">비밀번호 확인</label>
  <input id="passwordConfirm" name="passwordConfirm" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" maxlength="72" required></div>
<label class="consent"><input type="checkbox" name="consent" value="on" required aria-describedby="consent-detail"${values.consent ? html` checked` : ""}><span>[필수] 개인정보 수집·이용에 동의합니다.</span></label>
<p class="consent-detail" id="consent-detail">수집 항목: 이메일, 이름 · 이용 목적: 회원 식별, 가입 승인, 서비스 제공 · 보유 기간: 회원 탈퇴(계정 삭제 요청) 시까지</p>`;
}

function signupForm(options: SignupPageOptions): SafeHtml {
  const approval = options.signupMode === "approval";
  const errors = options.errors ?? [];
  return html`<div class="auth-card">
  <p class="eyebrow">GEO MASTER 회원가입</p>
  <h1>계정 만들기</h1>
  <p>무료 계정으로 GEO 측정을 시작하거나, SEMForge Pro 유료 계정으로 SEMForge 실행 기능까지 사용하세요. 무료로 시작한 뒤에도 언제든 구독할 수 있습니다.</p>
  ${approval ? html`<p class="notice" role="note">가입 신청 후 관리자가 승인하면 로그인할 수 있습니다.</p>` : ""}
  ${errors.length ? html`<div class="alert" role="alert"><ul>${errors.map((error) => html`<li>${error}</li>`)}</ul></div>` : ""}
  <form method="post" action="/api/auth/signup">
    ${planOptions(options.plan)}
    ${accountFields(options.values ?? {})}
    <button class="btn btn-primary submit" type="submit">${approval ? "가입 신청하기" : "가입하고 시작하기"}</button>
  </form>
  <div class="auth-links"><span>이미 계정이 있나요? <a href="/login">로그인</a></span><a href="/welcome">서비스 소개</a></div>
</div>`;
}

function signupContent(options: SignupPageOptions): SafeHtml {
  if (options.auth === "local") {
    return noticeCard(
      "로그인 없는 단일 사용자 모드입니다",
      "이 서버는 GEO_AUTH_MODE=local로 실행 중이라 회원가입과 로그인을 사용하지 않습니다. 회원가입을 켜려면 .env에서 GEO_AUTH_MODE=app으로 바꾸고 GEO_ADMIN_ID·GEO_ADMIN_PASSWORD를 입력한 뒤 서버를 다시 시작하세요.",
      { href: "/", label: "워크스페이스 열기" },
    );
  }
  if (options.signupMode === "closed") {
    return noticeCard("현재 신규 가입을 받지 않습니다", "이미 계정이 있다면 로그인해 주세요.", { href: "/login", label: "로그인" });
  }
  return signupForm(options);
}

export function renderSignupPage(options: SignupPageOptions): string {
  const body = html`${siteHeader(html`<a class="btn btn-ghost btn-sm" href="/login">로그인</a>`)}
<main id="main" class="auth">
${signupContent(options)}
</main>
${siteFooter(html`<a href="/welcome">서비스 소개</a><a href="/login">로그인</a>`)}`;
  return renderPublicDocument({ title: TITLE, description: DESCRIPTION, styles: AUTH_STYLES, body });
}
