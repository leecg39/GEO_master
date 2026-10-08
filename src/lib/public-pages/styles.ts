/**
 * 공개 페이지(소개·회원가입) 전용 인라인 CSS.
 * 비로그인 사용자는 앱 번들(JS·CSS)을 받을 수 없으므로 외부 자원 없이 동작해야 한다. 색상은 globals.css 토큰과 같다.
 */
export const BASE_STYLES = `
:root{color-scheme:dark;--bg:#150f23;--panel:#1f1633;--panel-2:#241a3c;--line:#362d59;--line-strong:#4a3d72;--text:#fff;--muted:#bdb8c0;--subtle:#aa9ab8;--lime:#c2ef4e;--lime-hover:#d2fa75;--pink:#fa7faa;--violet:#6a5fc1;--violet-soft:#9b8fe8;--ink:#1f1633;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Pretendard","Malgun Gothic",system-ui,sans-serif}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important}}
body{margin:0;min-height:100svh;background:var(--bg);color:var(--text);line-height:1.65;-webkit-font-smoothing:antialiased;word-break:keep-all;overflow-wrap:anywhere}
a{color:inherit}
img{max-width:100%}
.wrap{width:min(100% - 40px,1120px);margin-inline:auto}
.skip{position:absolute;left:-9999px;top:12px;z-index:50;padding:10px 16px;border-radius:10px;background:var(--lime);color:var(--ink);font-weight:700;text-decoration:none}
.skip:focus{left:16px}
a:focus-visible,button:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid var(--pink);outline-offset:3px}
.site-header{position:sticky;top:0;z-index:20;background:rgba(21,15,35,.88);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:64px}
.brand{display:inline-flex;align-items:center;gap:10px;text-decoration:none;font-weight:750;letter-spacing:-.01em;font-size:16px}
.brand-mark{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:var(--lime);color:var(--ink);font-weight:850;font-size:12px;letter-spacing:.02em}
.nav-links{display:flex;gap:24px;font-size:14px;color:var(--muted)}
.nav-links a{text-decoration:none}
.nav-links a:hover{color:#fff}
.nav-actions{display:flex;align-items:center;gap:10px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:12px 22px;border-radius:12px;border:1px solid transparent;font:inherit;font-weight:750;font-size:15px;line-height:1.2;text-decoration:none;cursor:pointer;transition:background .15s,border-color .15s}
.btn-primary{background:var(--lime);color:var(--ink)}
.btn-primary:hover{background:var(--lime-hover)}
.btn-ghost{border-color:var(--line-strong);background:rgba(255,255,255,.03);color:#fff}
.btn-ghost:hover{border-color:var(--violet-soft);background:rgba(255,255,255,.07)}
.btn-sm{min-height:40px;padding:9px 16px;font-size:14px;border-radius:10px}
.eyebrow{margin:0 0 14px;color:var(--lime);font-size:12px;font-weight:750;letter-spacing:.16em;text-transform:uppercase}
.muted{color:var(--muted)}
.site-footer{padding:36px 0 48px;border-top:1px solid var(--line);color:var(--subtle);font-size:13px}
.footer-row{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px}
.footer-row nav{display:flex;gap:18px}
.footer-row a{text-decoration:none}
.footer-row a:hover{color:#fff}
@media (max-width:640px){.wrap{width:min(100% - 32px,1120px)}.nav-links{display:none}.nav-actions .hide-sm{display:none}}
`;

export const LANDING_STYLES = `
.hero{padding:76px 0 64px;background:radial-gradient(ellipse 70% 65% at 88% 0,rgba(106,95,193,.38),transparent 70%),radial-gradient(ellipse 45% 40% at 0 35%,rgba(194,239,78,.09),transparent 70%)}
.hero-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:52px;align-items:center}
h1{margin:0 0 22px;font-size:clamp(36px,6vw,62px);line-height:1.1;letter-spacing:-.04em;font-weight:850}
h1 em{font-style:normal;color:var(--lime)}
.lead{max-width:640px;margin:0 0 32px;color:var(--muted);font-size:clamp(16px,2vw,18.5px)}
.cta-row{display:flex;flex-wrap:wrap;gap:12px}
.cta-note{margin:16px 0 0;color:var(--subtle);font-size:13.5px}
.chips{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:30px;color:var(--subtle);font-size:13px}
.chip{padding:6px 12px;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.03);color:var(--muted)}
.hero-art{margin:0;border:1px solid var(--line);border-radius:22px;overflow:hidden;box-shadow:0 30px 90px rgba(0,0,0,.5)}
.hero-art img{display:block;width:100%;height:auto}
.section{padding:84px 0;border-top:1px solid rgba(54,45,89,.7)}
.section-alt{background:linear-gradient(180deg,rgba(31,22,51,.55),rgba(21,15,35,0))}
.section-head{max-width:740px;margin-bottom:40px}
.section-head h2{margin:0 0 14px;font-size:clamp(27px,3.6vw,40px);line-height:1.2;letter-spacing:-.03em}
.section-head p{margin:0;color:var(--muted);font-size:16.5px}
.grid{display:grid;gap:16px}
.grid-2{grid-template-columns:repeat(2,1fr)}
.grid-3{grid-template-columns:repeat(3,1fr)}
.grid-4{grid-template-columns:repeat(4,1fr)}
.card{padding:26px;border:1px solid var(--line);border-radius:18px;background:var(--panel)}
.card h3{margin:0 0 8px;font-size:17.5px;letter-spacing:-.01em}
.card p{margin:0;color:var(--muted);font-size:14.5px}
.num{display:inline-grid;place-items:center;width:32px;height:32px;margin-bottom:16px;border-radius:9px;background:rgba(194,239,78,.12);color:var(--lime);font-size:13px;font-weight:850}
.compare .card h3 span{display:block;margin-bottom:6px;color:var(--subtle);font-size:12px;font-weight:750;letter-spacing:.12em}
.compare .card.is-geo{border-color:rgba(194,239,78,.45)}
.funnel{margin-top:16px}
.funnel .card{position:relative;background:var(--panel-2)}
.funnel strong{display:block;margin-bottom:4px;color:var(--lime);font-size:20px}
.feature-card h3{display:flex;align-items:center;gap:10px}
.feature-card h3::before{content:"";width:8px;height:8px;border-radius:3px;background:var(--violet-soft)}
.pro .feature-card h3::before{background:var(--lime)}
.plans{align-items:stretch}
.plan{display:flex;flex-direction:column;padding:32px;border:1px solid var(--line-strong);border-radius:22px;background:var(--panel)}
.plan-featured{border-color:rgba(194,239,78,.6);background:linear-gradient(180deg,rgba(194,239,78,.08),var(--panel) 45%)}
.plan-top{display:flex;align-items:center;justify-content:space-between;gap:12px}
.plan h3{margin:0;font-size:21px}
.badge{display:inline-flex;padding:4px 10px;border-radius:999px;background:rgba(194,239,78,.14);color:var(--lime);font-size:11.5px;font-weight:800;letter-spacing:.08em}
.badge-muted{background:rgba(155,143,232,.16);color:#cfc8ff}
.price{margin:20px 0 4px;font-size:40px;font-weight:850;letter-spacing:-.03em}
.price small{margin-left:6px;color:var(--muted);font-size:15px;font-weight:600;letter-spacing:0}
.price-note{margin:0 0 22px;color:var(--subtle);font-size:13.5px}
.checks{display:grid;gap:11px;margin:0 0 28px;padding:0;list-style:none;font-size:15px}
.checks li{position:relative;padding-left:28px}
.checks li::before{content:"✓";position:absolute;left:0;top:0;color:var(--lime);font-weight:850}
.plan .btn{margin-top:auto}
.plan-foot{margin:14px 0 0;color:var(--subtle);font-size:13px}
.steps{margin-top:28px}
.steps .card{padding:22px}
.faq{max-width:820px}
.faq details{padding:20px 0;border-bottom:1px solid var(--line)}
.faq summary{display:flex;justify-content:space-between;gap:16px;cursor:pointer;font-size:17px;font-weight:750;list-style:none}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";color:var(--lime);font-weight:850}
.faq details[open] summary::after{content:"−"}
.faq details p{margin:12px 0 0;color:var(--muted)}
.closing{padding:72px 0;text-align:center}
.closing h2{margin:0 0 14px;font-size:clamp(26px,3.4vw,36px);letter-spacing:-.03em}
.closing p{margin:0 auto 28px;max-width:560px;color:var(--muted)}
.closing .cta-row{justify-content:center}
@media (max-width:960px){.hero-grid{grid-template-columns:1fr;gap:40px}.grid-4{grid-template-columns:repeat(2,1fr)}.grid-3{grid-template-columns:repeat(2,1fr)}}
@media (max-width:640px){.hero{padding:52px 0 44px}.section{padding:60px 0}.grid-2,.grid-3,.grid-4{grid-template-columns:1fr}.plan{padding:26px}.cta-row .btn{flex:1 1 100%}}
`;

export const AUTH_STYLES = `
.auth{display:grid;place-items:start center;padding:48px 20px 64px}
.auth-card{width:min(100%,600px);padding:36px;border:1px solid var(--line);border-radius:24px;background:var(--panel)}
.auth-card h1{margin:0 0 10px;font-size:clamp(26px,4vw,32px);letter-spacing:-.03em;line-height:1.25}
.auth-card>p:not(.notice){margin:0;color:var(--muted)}
fieldset{margin:28px 0 0;padding:0;border:0}
legend{margin-bottom:12px;padding:0;font-size:14px;font-weight:700}
.plan-options{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.plan-option{display:flex;gap:12px;padding:16px;border:1px solid var(--line-strong);border-radius:16px;background:rgba(255,255,255,.02);cursor:pointer}
.plan-option:has(input:checked){border-color:var(--lime);background:rgba(194,239,78,.07)}
.plan-option input{flex:none;width:18px;height:18px;margin:3px 0 0;accent-color:var(--lime)}
.plan-option strong{display:block;font-size:15px}
.plan-option .plan-price{display:block;margin:4px 0 6px;color:var(--lime);font-size:14px;font-weight:750}
.plan-option small{display:block;color:var(--subtle);font-size:12.5px;line-height:1.55}
.field{display:block;margin-top:20px;font-size:14px;font-weight:650}
.field label{display:block}
.field input{display:block;width:100%;margin-top:8px;padding:13px 14px;border:1px solid #655379;border-radius:10px;background:#171021;color:#fff;font:inherit;font-weight:400}
.field input:focus{border-color:var(--lime)}
.hint{display:block;margin-top:6px;color:var(--subtle);font-size:12.5px;font-weight:400}
.consent{display:flex;gap:10px;align-items:flex-start;margin-top:24px;font-size:14px;font-weight:650}
.consent input{flex:none;width:18px;height:18px;margin:3px 0 0;accent-color:var(--lime)}
.consent-detail{margin:8px 0 0 28px;color:var(--subtle);font-size:12.5px}
.alert{margin:22px 0 0;padding:12px 16px;border:1px solid rgba(250,127,170,.45);border-radius:12px;background:rgba(250,127,170,.09);color:#ffc7da;font-size:14px}
.alert ul{margin:0;padding-left:18px}
.notice{margin:22px 0 0;padding:12px 16px;border:1px solid rgba(194,239,78,.4);border-radius:12px;background:rgba(194,239,78,.07);color:#e6f8b8;font-size:14px}
.submit{width:100%;margin-top:28px}
.auth-links{display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;margin-top:20px;color:var(--muted);font-size:14px}
.auth-links a{color:var(--lime)}
@media (max-width:640px){.auth{padding:28px 16px 48px}.auth-card{padding:26px 20px}.plan-options{grid-template-columns:1fr}}
`;
