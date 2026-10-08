# 소개 첫 화면·회원가입·회원 관리 RSI

## 목표와 실행 범위
사용자 요청: 재귀적 자기 개선으로 업그레이드. 대상은 `feat/signup-landing`(PR #28)의 소개 첫 화면·회원가입·`.env` 관리자·회원 관리 기능이다. 보안·접근성·흐름·구조화 데이터·관리 편의 5개 축을 개선한다.
Iterations: 8. Outer cycle 2회, 각 4개 실험. 한 실험은 하나의 제품 가설로 제한한다(같은 의도의 target 파일 여러 개는 허용).

## 고정 평가
- 저장소 루트에서 `node autoresearch/signup/eval/prepare.mjs <run-label>`
- 27개 독립 행동 시나리오 통과율(%), 높을수록 좋음. DB는 임시 디렉터리, 외부 통신 없음.
- Outer score: 5개 범주(security·a11y·flow·structured·admin) 중 가장 낮은 통과율.
- `eval/`·`meta_eval/`는 SHA-256 manifest(`eval/frozen.json`)로 고정한다. 평가를 바꿔 통과시키지 않는다.
- `*.eval.ts`는 전용 설정으로만 실행되며 `npm test`에 포함되지 않는다.

## Target 허용 목록
- `src/lib/accounts/signup.ts`, `src/lib/accounts/admin.ts`, `src/lib/accounts/store.ts`
- `src/lib/public-pages/signup-page.ts`, `src/lib/public-pages/landing.ts`, `src/lib/public-pages/document.ts`, `src/lib/public-pages/styles.ts`
- `src/app/signup/route.ts`, `src/app/api/auth/signup/route.ts`, `src/app/login/route.ts`
- `src/app/api/admin/accounts/route.ts`(신규), `src/components/AdminAccountsClient.tsx`
- `src/proxy.ts`(403 응답 헤더에 한함)

## Guard
1. `npx vitest run tests/accounts-signup.integration.test.ts tests/auth-signup-flow.test.ts tests/signup-rate-limit.test.ts tests/app-shell-roles.test.tsx tests/login-access.test.ts tests/proxy.test.ts tests/semforge-account-access.test.ts tests/app-shell-subscription.regression-1.test.tsx`
2. `npm run typecheck`
3. `npx eslint <변경한 target 파일> --max-warnings=0`

기존 테스트는 수정하지 않는다. 소개 화면에 `<script>`를 넣지 않는다(기존 테스트와 운영 검증 스크립트가 금지). 구조화 데이터는 microdata로 표기한다.

## 결정
검증 전에 target 변경을 커밋(`experiment(signup): ...`). 메트릭 상승 + Guard 통과만 KEEP. Guard 실패는 `git revert` 후 최대 2회 수정 재시도, 동일·악화는 DISCARD(`git revert`). 사용자 작업 공간에 reset/stash를 적용하지 않는다.

## 초기 전략 (cycle 1)
1. a11y: 필드별 오류 연결(aria-invalid, aria-describedby, 오류 요약 링크, 첫 오류 autofocus, 제목 접두어 "오류").
2. security 입력 정책: 흔한·연속·반복·서비스명 비밀번호, 이메일 아이디가 들어간 비밀번호, 보이지 않는·방향 제어 문자가 든 이름 차단. 평가 목록을 하드코딩하지 말고 일반 규칙으로 구현한다.
3. structured: 보이는 FAQ·요금제 요소에 FAQPage·SoftwareApplication·Offer microdata, 히어로 이미지 `fetchpriority="high"`.
4. flow: 로그인 상태 방문자 리다이렉트, `next`를 로그인→가입→가입 후 이동까지 전달하고 `safeReturnPath`로 열린 리다이렉트 차단.

cycle 2: Outer 분석 후 관리자 목록 API(상태 필터·검색)와 남은 보안 항목(403 응답 헤더, 로그인 Referrer-Policy, honeypot)에 집중한다.

## 제약
실제 사용자 DB·`.env.local`·외부 유료 API는 건드리지 않는다. 격리 worktree에서만 실험한다. 운영 배포·원격 푸시는 이번 실험에 포함하지 않는다. 사용자 개발 서버(3001)는 원래 작업 공간에서 계속 실행된다.

## Outer cycle 1 분석 및 전략 수정
실험 4개 모두 KEEP, 3.7% → 74.1%. a11y 7/7·flow 5/5·structured 5/5는 포화했다. admin 0/4가 Outer score(가장 약한 범주) 0의 원인이고 security는 3/6이다. 포화한 범주에는 더 손대지 않는다. cycle 2 가설은 (5) 관리자 회원 목록 API의 상태 필터·검색과 권한 검사, (6) 403 화면과 로그인 화면에 공개 페이지와 같은 보안 헤더 적용, (7) 사람에게는 보이지 않는 honeypot 입력으로 봇 가입 차단 순서로 진행한다. 목표에 먼저 도달하면 남은 회차를 쓰지 않고 멈춘다. Frozen Metric과 범주 구성은 그대로 유지한다.
