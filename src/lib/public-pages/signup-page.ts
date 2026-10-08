import { MIN_PASSWORD_LENGTH } from "@/lib/accounts/env-admin";
import { SIGNUP_FIELD_ORDER, type SignupField, type SignupFieldErrors, type SignupMode, type SignupValues } from "@/lib/accounts/signup";
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
  /** 입력란별 오류. 해당 입력란에 aria-invalid·오류 문구 연결·첫 오류 포커스를 준다. */
  fieldErrors?: SignupFieldErrors;
}

interface FieldContext {
  fieldErrors: SignupFieldErrors;
  focus: SignupField | null;
}

const TITLE = "회원가입 · GEO Master";
const DESCRIPTION = "무료로 GEO 측정을 시작하거나 SEMForge Pro 유료 계정으로 가입하세요.";
const PRICE = SEMFORGE_MONTHLY_PRICE_KRW.toLocaleString("ko-KR");
/** 오류 요약 링크가 이동할 입력란 id */
const FIELD_ANCHORS: Record<SignupField, string> = { plan: "plan-free", email: "email", displayName: "displayName", password: "password", passwordConfirm: "passwordConfirm", consent: "consent" };

function noticeCard(title: string, message: string, action: { href: string; label: string }): SafeHtml {
  return html`<div class="auth-card">
  <p class="eyebrow">GEO MASTER 회원가입</p>
  <h1>${title}</h1>
  <p>${message}</p>
  <a class="btn btn-primary submit" href="${action.href}">${action.label}</a>
  <div class="auth-links"><a href="/welcome">서비스 소개</a></div>
</div>`;
}

/** 오류가 있으면 aria-invalid와 오류 문구 연결을, 첫 오류 입력란에는 autofocus를 붙인다. */
function fieldState(field: SignupField, context: FieldContext, describedBy: string[] = []): SafeHtml {
  const error = context.fieldErrors[field];
  const ids = [...describedBy, ...(error ? [`${field}-error`] : [])];
  return html`${error ? html` aria-invalid="true"` : ""}${ids.length ? html` aria-describedby="${ids.join(" ")}"` : ""}${context.focus === field ? html` autofocus` : ""}`;
}

function fieldError(field: SignupField, context: FieldContext): SafeHtml {
  const error = context.fieldErrors[field];
  return error ? html`<span class="field-error" id="${field}-error">${error}</span>` : html``;
}

function errorSummary(errors: string[], fieldErrors: SignupFieldErrors): SafeHtml {
  const linked = SIGNUP_FIELD_ORDER.flatMap((field) => {
    const message = fieldErrors[field];
    return message ? [{ href: `#${FIELD_ANCHORS[field]}`, message }] : [];
  });
  const linkedMessages = new Set(linked.map(({ message }) => message));
  const general = errors.filter((message) => !linkedMessages.has(message));
  if (!linked.length && !general.length) return html``;
  return html`<div class="alert" role="alert">
    <p class="alert-title">입력 내용을 확인해 주세요.</p>
    <ul>${linked.map(({ href, message }) => html`<li><a href="${href}">${message}</a></li>`)}${general.map((message) => html`<li>${message}</li>`)}</ul>
  </div>`;
}

function planOptions(plan: AccountPlan, context: FieldContext): SafeHtml {
  return html`<fieldset>
  <legend>가입 유형</legend>
  <div class="plan-options">
    <label class="plan-option"><input type="radio" id="plan-free" name="plan" value="free"${plan === "free" ? html` checked` : ""} required${fieldState("plan", context)}><span>
      <strong>무료로 시작 · GEO 측정</strong><span class="plan-price">₩0</span>
      <small>AI 언급 모니터링·응답 점유율·GEO 진단·llms.txt·콘텐츠 도구</small>
    </span></label>
    <label class="plan-option"><input type="radio" id="plan-semforge" name="plan" value="semforge"${plan === "semforge" ? html` checked` : ""}><span>
      <strong>SEMForge Pro · 유료</strong><span class="plan-price">월 ₩${PRICE} (VAT 별도)</span>
      <small>무료 기능 전체 + 실측 SERP·사이트 진단·포지션 추적·지역 SEO. 결제는 로그인 후 구독 화면에서 진행합니다.</small>
    </span></label>
  </div>
  ${fieldError("plan", context)}
</fieldset>`;
}

function accountFields(values: Partial<SignupValues>, context: FieldContext): SafeHtml {
  return html`<div class="field"><label for="email">이메일 (로그인 아이디)</label>
  <input id="email" name="email" type="email" autocomplete="email" maxlength="128" required value="${values.email ?? ""}"${fieldState("email", context)}>${fieldError("email", context)}</div>
<div class="field"><label for="displayName">이름</label>
  <input id="displayName" name="displayName" autocomplete="name" maxlength="50" required value="${values.displayName ?? ""}"${fieldState("displayName", context)}>${fieldError("displayName", context)}</div>
<div class="field"><label for="password">비밀번호</label>
  <input id="password" name="password" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" maxlength="72" required${fieldState("password", context, ["password-hint"])}>
  <span class="hint" id="password-hint">${MIN_PASSWORD_LENGTH}자 이상, 이메일과 다른 비밀번호를 사용하세요.</span>${fieldError("password", context)}</div>
<div class="field"><label for="passwordConfirm">비밀번호 확인</label>
  <input id="passwordConfirm" name="passwordConfirm" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" maxlength="72" required${fieldState("passwordConfirm", context)}>${fieldError("passwordConfirm", context)}</div>
<label class="consent"><input type="checkbox" id="consent" name="consent" value="on" required${values.consent ? html` checked` : ""}${fieldState("consent", context, ["consent-detail"])}><span>[필수] 개인정보 수집·이용에 동의합니다.</span></label>
<p class="consent-detail" id="consent-detail">수집 항목: 이메일, 이름 · 이용 목적: 회원 식별, 가입 승인, 서비스 제공 · 보유 기간: 회원 탈퇴(계정 삭제 요청) 시까지</p>${fieldError("consent", context)}`;
}

function signupForm(options: SignupPageOptions): SafeHtml {
  const approval = options.signupMode === "approval";
  const fieldErrors = options.fieldErrors ?? {};
  const context: FieldContext = { fieldErrors, focus: SIGNUP_FIELD_ORDER.find((field) => fieldErrors[field]) ?? null };
  return html`<div class="auth-card">
  <p class="eyebrow">GEO MASTER 회원가입</p>
  <h1>계정 만들기</h1>
  <p>무료 계정으로 GEO 측정을 시작하거나, SEMForge Pro 유료 계정으로 SEMForge 실행 기능까지 사용하세요. 무료로 시작한 뒤에도 언제든 구독할 수 있습니다.</p>
  ${approval ? html`<p class="notice" role="note">가입 신청 후 관리자가 승인하면 로그인할 수 있습니다.</p>` : ""}
  ${errorSummary(options.errors ?? [], fieldErrors)}
  <form method="post" action="/api/auth/signup">
    ${planOptions(options.plan, context)}
    ${accountFields(options.values ?? {}, context)}
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
  const hasErrors = Boolean(options.errors?.length) || Object.keys(options.fieldErrors ?? {}).length > 0;
  const body = html`${siteHeader(html`<a class="btn btn-ghost btn-sm" href="/login">로그인</a>`)}
<main id="main" class="auth">
${signupContent(options)}
</main>
${siteFooter(html`<a href="/welcome">서비스 소개</a><a href="/login">로그인</a>`)}`;
  // 오류가 있으면 화면 낭독기가 페이지 제목에서 바로 알 수 있도록 접두어를 붙인다.
  return renderPublicDocument({ title: hasErrors ? `오류: ${TITLE}` : TITLE, description: DESCRIPTION, styles: AUTH_STYLES, body });
}
