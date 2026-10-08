# AI 언급 모니터링 v2 구현·QA 결과

검증일: 2026-10-08 · 대상: 현재 작업 트리 · 범위: `docs/planning/monitoring-v2-reference-plan.md`의 A~D

## 결과

계획의 A~D를 `/monitoring`에 구현했다. 기존 **ChatGPT·Claude·Gemini·Grok 4개 서비스**를 유지하며, 질문 → 측정 시점 → 서비스별 반복 응답 → 원문·출처를 탐색할 수 있다. Perplexity는 집계·선택·응답 카드에 추가하지 않았다.

전체 **95개 테스트 파일 / 714개 테스트**, lint, typecheck, production build를 통과했다. 빌드된 앱을 Ego Lite에서 실제 조작했고, 1440px·1280px 데스크톱과 390px 모바일 라이트/다크를 확인했다. 조회·QA 중 외부 LLM 호출과 운영 DB 수정은 하지 않았다. 커밋·푸시·운영 배포는 이번 결과에 포함하지 않는다.

## 구현 및 검토

| 단계 | 구현 | 근거 파일 |
| --- | --- | --- |
| A | 집계와 응답 상세의 사전·분모 공통화, 정확한 질문/실행 조회, 인증·프로젝트·기간 검사, 문맥에 묶인 커서, 출처 배치 조회 | `src/lib/monitoring-matching.ts`, `monitoring-metrics.ts`, `monitoring-responses.ts`, `src/app/api/monitoring/responses/route.ts` |
| B | 실행 선택·URL 복원, 4개 서비스 카드, 검색/일반 그룹, 반복 선택·페이지 이동, 원문 강조·복사·출처, 지연 응답 무시 | `MonitoringQuestionDetail.tsx`, `MonitoringResponsePanel.tsx`, `MonitoringModelResponseCard.tsx`, `useMonitoringResponses.ts` |
| C | 목록 전용 검색, 3종 정렬, 25개 페이지, 감소 표시, 자사 선·선택 링, 브랜드 ID별 색·선 패턴, 키보드 포인트 선택 | `MonitoringQuestionList.tsx`, `MonitoringCharts.tsx` |
| D | 질문·모델·검색·반복 구성 차이 안내, 최근 실행과 동일 조건 필터, 집계·상세·CSV·URL 조건 일치 | `monitoring-runs.ts`, `monitoring-query.ts`, `MonitoringConditions.tsx` |

표의 컴포넌트 경로는 `src/components/monitoring/`, 서버 모듈 경로는 `src/lib/` 기준이다. 기존 인라인 목록·상세·표 표현을 분리했고 기존 산식은 유지했다. 새 DB 마이그레이션은 필요하지 않다.

코드 리뷰에서 보완한 사항:

- 조회 범위를 확인하기 전에 동일 조건 판정을 실행하지 않도록 처리했다. 다른 프로젝트·기간의 실행은 404로 종료한다.
- 기본 응답 조회는 선택 실행만 범위 검사한다. 전체 기간의 조건 조회는 동일 조건 필터에 필요할 때 수행한다.
- 기준·최근 실행의 조건이 같아도 중간 실행의 조건이 다르거나 불명확하면 이를 안내한다.
- 차트 포인트에 명시적 키보드 포커스를 추가했다. 브라우저에서 Enter 선택과 3px 포커스 표시를 확인했다.
- 실행 URL을 기간 집계/CSV 요청에서 제외하고, 선택 실행 변경으로 상단 비교가 바뀌지 않도록 분리했다.

## 자동 검증

| 검사 | 결과 | 기록 |
| --- | --- | --- |
| 모니터링 관련 테스트 | 3개 파일 / 51개 통과 | `tests/monitoring.integration.test.ts`, `tests/monitoring-responses.integration.test.ts`, `tests/monitoring-client.test.tsx` |
| 전체 테스트 | 95개 파일 / 714개 통과 | [tests.log](./tests.log) |
| ESLint | 경고·오류 없이 종료 코드 0 | [lint.log](./lint.log) |
| TypeScript | 종료 코드 0 | [typecheck.log](./typecheck.log) |
| production build | 성공, `/monitoring` 및 응답 API 포함 | [build.log](./build.log) |
| 빌드 앱 API 대조 | 5개 질문 × 8개 실행 = 40개 조합 일치 | [api-csv-qa.json](./api-csv-qa.json) |
| 기간 CSV | 동일 조건 실행 6·7만 포함, 6회 제외 안내 | [question-same-conditions.csv](./question-same-conditions.csv) |

통합 검사는 정확한 질문 구분, 4개 provider 제한, 성공 분모·실패·거절, 미측정과 0%, 별칭 변경 재집계, 위험한 출처 URL 제외, 검색 조건 기록 부족, 인증 401·프로젝트 충돌 409·범위 밖 404·커서 오류 422, private/no-store, 페이지별 요약 불변을 포함한다.

클라이언트 검사는 과거 실행 복원, 실행 선택의 replaceState, 기간 수치 유지, 유효하지 않은 실행 복구, 마지막 측정 실행 기본 선택, 늦은 응답 무시, 원문 HTML 이스케이프·강조·복사, 그룹/반복 전환, 목록 검색·정렬 및 조건별 CSV 요청을 포함한다.

## 실제 브라우저 QA

Ego Lite TaskSpace **42**를 한 개 사용했다. `.next/standalone/server.js`의 빌드 결과를 `127.0.0.1:3102`에서 실행했다. 테스트 DB는 임시 디렉터리에 새로 생성했다. 원본 운영 DB는 사용하지 않았다.

QA 데이터: 2개 프로젝트, 등록 질문 60개, 등록 경쟁사 20개, 완료 실행 8개(원문 없는 과거 실행 포함), 질문 일부가 빠진 실행, 서비스 미측정, 실패·거절, 검색 수행 미확인, 일반 응답으로 전환된 슬롯, 23개 반복 응답으로 원문 페이지 이동, 긴 한국어 문장·긴 URL·HTML 모양의 원문.

| 시나리오 | 관찰 결과 |
| --- | --- |
| 동일 조건 필터 | 완료 8회에서 2회로 변경, 6회 제외. 질문·추이·CSV가 동일한 실행 범위 사용 |
| 차트 키보드 선택 | 자사 포인트에 포커스 후 Enter로 실행 #6 선택, URL 및 응답 카드 동시 변경 |
| 새로고침·뒤로 가기 | 실행 #6 새로고침 복원. 다른 질문 선택 시 run 제거, 뒤로 가면 원래 질문·실행 #2 복원 |
| 기간 변경 | 조회 시작일을 9월 28일로 바꾸자 이전 실행 #2에 범위 오류 표시. 복구 버튼으로 최신 #7 선택 |
| 원문 페이지 | 2페이지의 반복 23까지 조회. 서비스 요약은 17/23·73.9% 유지. 이전 페이지 복귀 가능 |
| 조건·반복 선택 | 일반 응답 그룹으로 바꾸면 실제 반복 원문 및 ‘웹검색 요청 → 일반 응답으로 수집’ 표시 |
| 실패·거절·검색 | Claude 실패 원문 없음, Gemini 거절·집계 제외, 웹검색 수행 미확인 표시 확인 |
| 원문 안전성 | `<img ...>`가 텍스트로 표시되고 이미지 요소는 생성되지 않음. 자사/경쟁사 강조와 3종 출처 확인 |
| 목록 검색·페이지 | 특정 질문 1개만 검색해도 선택 상세 유지. 숨겨진 선택 안내. 2/3페이지에서 질문 25개 표시 |
| 유효하지 않은 실행 | `run=99999`에서 오류·복구 버튼 표시, 응답 카드 0개. 자동 대체하지 않음 |
| 원문 없는 실행 | 4개 서비스 카드 유지, ‘원문 없음’, 0/성공 0·—. 0%로 표시하지 않음 |
| 일시 오류 | 브라우저에서 응답 fetch 1회만 503으로 주입. 오류 표시 후 ‘응답 다시 불러오기’로 회복 |
| 프로젝트 전환 | 미측정 프로젝트에서 기존 질문 상세를 숨기고 질문 없음 안내. 전체 성과는 빈 상태, 동일 조건 옵션 비활성 |
| 반응형 | 1440·1280·390px 모두 문서 가로 넘침 없음. 모바일 원문·출처 긴 URL 줄바꿈 확인 |

날짜 입력 QA에서는 브라우저 도구의 `fill`만으로 React 변경 이벤트가 반영되지 않아 한 차례 대기가 만료됐다. 이후 실제 키보드 날짜 편집과 폼 제출로 기간 변경·범위 오류·복구를 확인했다. 미해결 앱 오류로 남긴 항목은 없다.

## 화면 증거

저장한 PNG는 모두 이미지 뷰어로 직접 확인했다. 화면 수치는 **합성 QA 데이터이며 실제 고객의 성과가 아니다**.

- [전체 화면 · 1440px 다크](./screenshots/desktop-overview-dark.png)
- [질문 추이·선택 포인트](./screenshots/desktop-selected-chart-dark.png)
- [응답 원문 · 데스크톱 다크](./screenshots/desktop-responses-dark.png)
- [4개 서비스 · 1280px 라이트](./screenshots/desktop-1280-light.png)
- [모바일 응답 · 라이트](./screenshots/mobile-responses-light.png)
- [모바일 원문 · 다크](./screenshots/mobile-raw-dark.png)
- [모바일 출처 · 다크](./screenshots/mobile-sources-dark.png)
- [모바일 차트 · 라이트](./screenshots/mobile-chart-light.png) / [다크](./screenshots/mobile-chart-dark.png)
- [원문 없는 실행](./screenshots/mobile-no-raw.png) / [거절 응답](./screenshots/mobile-refused-dark.png)

## 적용 범위 및 한계

이번 결과는 저장된 측정 데이터의 조회·분석 기능이다. 새 모델 API 지원, 실제 유료 LLM 측정, Google/SNS 연동을 재검증한 결과가 아니다. 과거 수집 조건이 부족하면 동일 조건 필터를 사용할 수 없으며 전체 조건으로 조회한다. 현재 브랜드 설정 변경은 과거 원문의 재집계·강조 결과에 반영된다.

계획 E(지역·의도 태그, 질문 설계 도우미, 경쟁사 후보 자동 발견)는 별도 설계 과제로 남긴다. 질문 생성·자동 경쟁사 발견을 이번 완료 범위로 주장하지 않는다.

[사용자 기능/API 문서](../../../docs/ai-mention-monitoring.md) · [계획](../../../docs/planning/monitoring-v2-reference-plan.md) · [QA 데이터 생성 스크립트](./seed-qa.ts) · [결과물 폴더](/Users/user01/Desktop/GEO_master/output/monitoring-v2/2026-10-08)
