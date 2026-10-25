# 인계 문서: RankSEO 반영 계획 진행 상태

이 문서는 작업자가 바뀌어도(Claude → Devin 등) 같은 방식으로 이어서 작업하기 위한 지시서다. 티켓을 하나 끝낼 때마다 갱신한다.

## 이어서 하는 방법

```sh
cd ~/Desktop/GEO_master
git switch feat/rankseo-track-a && git pull
devin --prompt-file docs/planning/rankseo-handoff.md
```

## 목표

`prompt_plan.md`(확정 2026-10-13)의 남은 티켓을 모두 끝낸다. 티켓마다 아래 순서를 지킨다.

1. 구현: TDD. 실패하는 테스트를 먼저 쓰고(RED) → 최소 구현(GREEN) → 정리.
2. 적대적 검토: 직접 반례를 찾는다. 경계값, 빈 입력, 악성 입력(XSS·SSRF·프로토타입 키), 기존 데이터 호환, 한국어 처리, 화면 375px.
3. 수정: 검토에서 나온 문제를 고치고 테스트를 추가한다.
4. 검증: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`가 모두 통과해야 한다. 결과 숫자를 커밋 본문에 적는다.
5. 커밋·푸시: conventional commits(`feat:`, `fix:`, `test:`, `docs:`), 끝에 `Co-Authored-By` 줄. `git push`.
6. 이 문서의 "진행 상태"를 갱신해 커밋한다.
7. 다음 티켓으로 넘어간다.

## 작업 규칙

- 근거 자료: `~/Desktop/profound_REA/output/rankseo-rea-2026-10-12/` (REA_REPORT.md, reports/, source/). RankSEO 코드는 복사하지 않는다. 개념만 참고한다.
- 트랙 B 상세는 `docs/planning/rankseo-gap-reports-plan.md`.
- Next.js가 학습 데이터와 다른 버전이다. 라우트·API를 만들기 전에 `node_modules/next/dist/docs/`의 관련 문서를 읽는다.
- 파일 800줄 이하, 함수 50줄 이하. `src/lib/audit.ts`는 이미 740줄이라 새 로직은 별도 파일에 둔다.
- 불변 객체 패턴, zod 입력 검증, 비밀값 하드코딩 금지, 외부 URL 요청은 `src/lib/url-security.ts`의 `assertPublicUrl`·`fetchPublicText`를 거친다.
- 측정값과 추정값을 섞지 않는다. 가설 규칙은 점수에 넣지 않는다.
- 운영 데이터(`data/geo.db`)를 지우거나 덮어쓰지 않는다. DB 변경은 `src/lib/db/index.ts`의 버전 마이그레이션(현재 31)으로 컬럼·테이블 추가만 한다.
- 브랜치: `feat/rankseo-track-a`(기반은 `feat/signup-landing`, PR #28 위에 쌓는다).

## 진행 상태

| 티켓 | 상태 | 커밋 / 메모 |
|---|---|---|
| A0 기준선 | 완료 | 테스트 100개 파일·810개 통과, typecheck·lint 통과, build exit 0 |
| A1 규칙 문서 링크·등급 척도 | 완료 | `src/lib/rule-docs.ts`, `src/lib/audit-grade.ts`, `src/components/RuleDocLink.tsx` |
| A2 기술 SEO 규칙 보강 | 완료 | `src/lib/page-seo-rules.ts`, `src/lib/hreflang.ts`, 사이트 감사 상호 참조 이슈. 사이트맵·HTTP 헤더 hreflang은 미지원 |
| A3 Schema 필드 검사 | 완료 | `src/lib/schema-fields.ts` (Google 문서 2026-09 기준 16개 스펙), `page-rules/3`. FAQPage·HowTo는 "표시 안 함" 안내 |
| R01~R02 진단 Markdown 보고서 | 완료 | `src/lib/report-markdown.ts`, `report-markdown-data.ts`, `/api/reports?format=md`, 리포트 화면 Markdown 버튼 |
| R03 반영 확인 이력 | 완료 | 마이그레이션 28 `change_verifications`, `src/lib/change-verifications.ts` |
| R04~R05 수정 결과 보고서 | 완료 | `src/lib/change-report.ts`, `change-report-markdown.ts`, `/api/change-items/report`, `/changes/report` 화면 |
| A4 JS 의존 콘텐츠 | 완료 | `src/lib/render-compare.ts`, rendered 수집 시 페이지마다 직접 요청 1회 추가(크레딧 없음), `page-rules/4` |
| A5 답변 구조 지표 | 완료 | `src/lib/answer-structure.ts`, GEO 가설(점수 미반영), `page-rules/5` |
| A6 llms.txt 초안 | 완료 | `src/lib/llms-suggest.ts`, `llms-resources.ts`, `/api/llms` action `suggest`, "사이트맵에서 채우기" 버튼 |
| R06 WordPress 실측 | 완료 | `docs/planning/rankseo-wordpress-spike.md`, 실제 응답 fixture `tests/fixtures/wordpress/`. 쓰기 가능: Yoast 제목·설명 메타뿐(허용 시) |
| R07 WordPress 연결·읽기 | 완료 | 마이그레이션 29, `src/lib/integrations/wordpress.ts`, `wordpress-connections.ts`, `/api/wordpress/connection`·`/lookup`, 수정안 화면의 연결 패널, `sendPublicRequest`(url-security) |
| R08 WordPress 쓰기 전달 | 완료 | 마이그레이션 30 `change_deliveries`, `src/lib/wordpress-delivery.ts`, `/api/change-items/[id]/wordpress`(preview/execute), 수동 전달도 이력 기록 |
| R09 보고서 WordPress 칸 | 완료 | `src/lib/wordpress-verify.ts`, 반영 확인 때 저장값을 동시에 기록, 보고서에 캐시 가능성 안내 |
| R10 수정 결과 보고서 PDF | 완료 | `src/lib/change-report-pdf.ts`, `/api/change-items/report?format=pdf`, 화면 PDF 버튼 |
| A7 PageSpeed | 완료 | 마이그레이션 31 `integration_secrets`, `src/lib/pagespeed.ts`, `/api/pagespeed`(+`/key`), 진단 화면 패널. 키 없는 호출은 할당량 0(실측 429). CrUX 지표 키 이름은 실키 호출로 확인하지 못함 — 모르는 키는 원문 표시 |
| A8 만점 테스트 | 완료 | `tests/max-score.test.ts` — 진단 32/32, 페이지 규칙 전부 통과, llms.txt 100. Red-Green 확인 |

## 완료 (2026-10-13)

계획의 모든 티켓(A0~A8, R01~R10)을 끝냈다. PR: https://github.com/leecg39/GEO_master/pull/29 (base `feat/signup-landing` = PR #28).
최종 검증: 테스트 121개 파일·999개 통과, typecheck 통과, lint 경고 0, build exit 0.

### 후속 보강 완료 (2026-10-19)

- [실행 계획](residual-work-2026-10-19.md)에 따라 보고서 인증·활성 프로젝트 필터, 수정 결과 재요청/늦은 응답 경합, 모바일 긴 값·입력/버튼 표시를 수정했다.
- `db/index.ts`는 56줄로 분리했다. `db/base-schema.ts`와 `db/migrations/`로 기존 SQL을 옮겼으며 버전 31, 기존 데이터와 export는 그대로 유지한다.
- 독립 적대적 검토에서 함수 길이 1건과 프로젝트 변경/JSON 본문 완료 경합 1건을 찾아 수정했다. 재검토 미해결 지적 0건.
- 최종 검증: 123개 파일·1,023개 테스트 통과, typecheck·lint·build 통과. Ego Lite에서 375px 라이트/다크·1440px 수정안/보고서의 가로 넘침 없음, 실제 PDF 다운로드 확인.
- [검증 보고서·스크린샷](../../output/residual-work/2026-10-19/report.md), [다음 실행 계획](next-plan-2026-10-19.md).

### 다음에 할 일

1. PR #28 → #29 순서로 머지. 머지 후 운영 DB에 마이그레이션 28~31(테이블 추가만)이 적용된다.
2. 실제 서비스 점검: WordPress(Yoast)에서 승인된 제목·설명 쓰기 → 반영 확인, PageSpeed 실제 키로 1회 측정해 CrUX 지표 이름 확인. 2026-10-19 로컬 상태 조회에서는 WordPress 미연결·PageSpeed 키 미설정이었다.
3. 계정별 데이터 분리: 기존 공용 프로젝트의 귀속·팀 공유·계정별 활성 프로젝트 정책을 먼저 설계한다. 이번 활성 프로젝트 필터는 테넌트 분리가 아니다. DB 분할과 375px 화면 문제는 위 후속 보강에서 처리했다.

## 알려진 사항

- 375px 화면 잘림은 2026-10-19에 다시 검증했다. 빈 화면은 정상이며, 긴 수정안 값·충돌 확인 컨트롤·보고서 이력의 넘침을 보강한 후 Ego Lite에서 확인했다.
- 개발 서버가 떠 있으면 새 마이그레이션(28~)이 `data/geo.db`에 바로 적용된다. 테이블 추가만 한다.

- `/api/reports`(json·csv·pdf·md)는 2026-10-19부터 인증과 활성 프로젝트를 검사한다. 계정별 데이터 분리는 아직 없으며 프로젝트와 활성 프로젝트 설정은 공용이다. 다계정 운영 정책은 다음 실행 계획 N1에서 다룬다.
- 진단 관련 기존 통합 테스트는 환경 변수의 LLM 키(GROK_API_KEY 등)가 있으면 실제 API를 호출한다. 새 테스트는 키를 비워 막았다.

- `audit.ts`의 `extractJsonLdTypes`는 `https://schema.org/Product` 같은 IRI 타입을 줄이지 않는다(기존 동작, 이번 범위 밖). `schema-fields.ts`는 줄여서 판정한다.

- 2026-10-13 전체 테스트 첫 실행에서 2건이 실패했고(실행 시간 46초, 평소의 2.5배), 이어진 두 번의 실행에서는 모두 통과했다. 부하 때문에 생긴 간헐적 타임아웃으로 보인다. 다시 실패하면 테스트 이름을 기록한다.
- Google 공지(2026-06): Google 검색은 llms.txt를 쓰지 않는다. 다른 AI 서비스용으로 유지는 가능하다.
