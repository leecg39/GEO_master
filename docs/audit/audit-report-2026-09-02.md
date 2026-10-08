# Audit Report

**프로젝트**: geo-master (GEO Master)
**날짜**: 2026-09-02
**감사 범위**: Security / License / Privacy
**실행자**: Claude Labs `/audit`

---

## 요약

| 모듈 | Critical | High | Medium | Low | 총계 |
|------|----------|------|--------|-----|------|
| Security | 0 | 0 | 1 | 3 | 4 |
| License | 0 | 0 | 0 | 2 | 2 |
| Privacy | 0 | 0 | 0 | 1 | 1 |
| **합계** | **0** | **0** | **1** | **6** | **7** |

**전체 판정**: PASS (조건부 — 로컬 전용 바인딩 유지 전제)

---

## Security 결과

### Phase 1: 인프라 공격 표면

| 항목 | 상태 | 발견사항 |
|------|------|---------|
| 1a. 노출된 환경변수 | PASS | `.env*`가 `.gitignore`에 등록(`.env.example`만 예외). git 이력에 `.env.local` 없음 |
| 1b. Stale 크레덴셜 | PASS | git 전체 이력 시크릿 스캔(`sk-`, `csk_`, `xai-`, `AIza` 패턴) — 테스트 픽스처 가짜 값(`sk-env-openai-direct` 등)만 검출, 실키 없음 |
| 1c. 인프라 노출 | PASS | `dev`/`start` 스크립트 모두 `-H 127.0.0.1` 바인딩. `data/geo.db`, `data/.master-key` git 제외 확인(`git check-ignore`) |
| 1d. 서드파티 통합 | PASS | LLM SDK(OpenAI/Anthropic/Gemini/Grok) 최신 유지, npm audit 0건. 외부 URL fetch는 `src/lib/url-security.ts`로 통합 관리 |

### Phase 2: 의존성 취약점

실행 명령어: `npm audit --json`
실행 시간: 2026-09-01T15:24:10Z (UTC)

| Critical | High | Moderate | Low | Info | 총계 |
|----------|------|----------|-----|------|------|
| 0 | 0 | 0 | 0 | 0 | 0 |

### Phase 3: OWASP Top 10 스캔

| 항목 | 상태 | 발견사항 |
|------|------|---------|
| A01: Broken Access Control | PASS(조건부) | 인증 없는 로컬 단일 사용자 설계. `src/proxy.ts`가 모든 `/api/*` 변경 요청에 대해 `sec-fetch-site: cross-site` 차단 + Origin 호스트 검증 + JSON 강제(CSRF 방어). **단, 0.0.0.0 노출 시 무방어 — 공개 배포 금지 조건** |
| A02: Cryptographic Failures | PASS | API 키 AES-256-GCM 암호화 저장(`src/lib/crypto.ts`), 랜덤 IV, 마스터 키 파일 `0600` 권한 + gitignore. 평문 반환 없음(마스킹 `••••••••` + 끝 4자리) |
| A03: Injection | PASS | Drizzle ORM 파라미터 바인딩. `dangerouslySetInnerHTML`, `eval`, `new Function`, `child_process`/`exec` 전무(전체 src 스캔) |
| A04: Insecure Design | WARN | Rate limiting 없음 — 로컬 단일 사용자 앱에서는 수용 가능하나 LLM 유료 API 호출(측정 실행)이 비용 민감 |
| A05: Security Misconfiguration | WARN | `poweredByHeader: false` 적용됨. CSP, X-Frame-Options 등 보안 헤더 미설정(로컬 앱이므로 Low) |
| A06: Vulnerable Components | PASS | npm audit 0건, `package-lock.json` 커밋됨 |
| A07: Auth Failures | N/A | 인증 없는 로컬 앱 설계 |
| A08: Data Integrity | PASS | lock 파일 존재, zod 스키마로 모든 mutation 입력 검증(`src/lib/*.ts`의 `*Schema` → 라우트는 lib 계층 위임) |
| A09: Logging & Monitoring | WARN | 보안 이벤트 로깅 없음. 시크릿 로그 출력 스캔 결과 노출 없음 |
| A10: SSRF | PASS | `src/lib/url-security.ts`: DNS 피닝, 사설/예약 IP 전면 차단(IPv4/IPv6/mapped), 자격증명 URL 차단, 포트 80/443 제한, 리다이렉트 재검증, 2MB 응답 제한 |

### 시크릿 탐지

| 파일 | 유형 | 심각도 |
|------|------|--------|
| (검출 없음) | — | — |

---

## License 결과

실행 명령어: `npx license-checker-rseidelsohn --production`

### 의존성 라이선스 요약 (프로덕션 의존성 기준)

| 라이선스 | 패키지 수 | 호환성 |
|---------|-----------|--------|
| MIT | 85 | PASS |
| ISC | 15 | PASS |
| Apache-2.0 | 14 | PASS |
| BSD-3-Clause | 13 | PASS |
| BSD-2-Clause | 10 | PASS |
| LGPL-3.0-or-later | 1 | PASS(조건부) |
| CC-BY-4.0 | 1 | PASS |
| Unlicense / 0BSD / 기타 | 4 | PASS |

### 라이선스 충돌

| 의존성 | 라이선스 | 프로젝트 라이선스 | 상태 |
|--------|---------|-----------------|------|
| `@img/sharp-libvips-darwin-arm64` | LGPL-3.0-or-later | 미지정(private) | PASS — sharp가 미수정 사전빌드 바이너리를 동적 링크로 사용, LGPL 동적 링크 조건 충족 |
| `geo-master` 자체 | UNLICENSED | — | WARN — `package.json`에 `license` 필드 없음(`private: true`라 배포 전엔 무해하나, 공개/배포 시 명시 필요) |

Copyleft 감염 위험(GPL/AGPL): 없음.

---

## Privacy 결과

### PII 데이터 매핑

| 데이터 | 위치 | 암호화 | 삭제 가능 |
|--------|------|--------|-----------|
| LLM API 키 (OpenAI/Anthropic/Gemini/Grok, 구독핀) | `settings` 테이블 | YES (AES-256-GCM) | YES (설정에서 키 삭제) |
| 브랜드명/카테고리/경쟁사 (사업 데이터, 개인정보 아님) | `projects` 테이블 | NO | YES (프로젝트 삭제 시 cascade) |
| 측정 질문/LLM 응답 | `questions`, `measure_*` 테이블 | NO | YES (cascade 삭제) |
| 개인 식별 정보(이메일/전화/주소 등) | — | — | 스키마에 PII 컬럼 자체가 없음 |

### GDPR 준수 현황

| 항목 | 상태 | 비고 |
|------|------|------|
| 동의 메커니즘 | N/A | 수집하는 개인정보 없음(계정/쿠키/추적 없음, 로컬 SQLite) |
| 데이터 삭제 | PASS | 프로젝트 삭제 시 의존 데이터 cascade + 확인 다이얼로그(`requiredText` 입력) |
| 데이터 이동성 | PASS | 워크스페이스 백업/내보내기(`src/lib/workspace-backups.ts`) |
| 데이터 최소화 | PASS | 사업 데이터만 저장, PII 필드 없음 |
| 암호화 저장 | PASS | 유일한 민감 데이터(API 키)만 선별 암호화 |
| 제3자 전송 | WARN | 측정 실행 시 질문 텍스트(브랜드/경쟁사명 포함 가능)가 OpenAI·Anthropic·Google·xAI로 전송됨. 개인정보는 아니나 사업상 민감 정보일 수 있으므로 사용자 인지 필요 |

---

## 권장 조치

### Critical (즉시 수정)
없음.

### High (배포 전 수정)
없음 — 단, **이 앱을 로컬호스트가 아닌 주소로 노출할 계획이라면 그 시점에 인증 계층 추가가 High로 상승**.

### Medium (계획적 수정)
1. LLM 측정 실행(`POST /api/share/run`)에 비용 보호용 실행 제한(rate limit 또는 일일 한도) 추가 검토.

### Low (개선 권장)
1. `next.config.ts`에 기본 보안 헤더(CSP, X-Content-Type-Options, X-Frame-Options) 추가.
2. `package.json`에 `license` 필드 명시(공개 계획 시).
3. 설정 화면에 "측정 시 질문이 외부 LLM API로 전송됩니다" 안내 문구 추가.
4. 보안 이벤트(키 저장/삭제, 프로젝트 삭제) 로깅 추가.

---

## 감사 환경

| 항목 | 값 |
|------|-----|
| OS | macOS (Darwin, arm64) |
| 런타임 | Node.js v22.23.1, Next.js 16.3.3 (Turbopack) |
| 패키지 매니저 | npm 10.9.8 |
| 스캔 도구 | npm audit (내장), license-checker-rseidelsohn (latest via npx), git log/ls-files, ripgrep |
