# GEO Master 프론트엔드 재귀 개선

2026-10-07 · 브랜치 `feat/geo-master-app` · 시작 커밋 `58525bf`

## 결과

고정 평가 점수를 **73.54 → 93.19 → 99.31 / 100**으로 개선했다(+25.77점). 두 차례 전략 반복에서 12개 가설을 실험했고, 11개를 유지하고 효과가 없던 1개를 되돌렸다. 이후 검토에서 발견한 확인 문구 초기화, 실제 키보드 초점 색상, 비동기 중첩 팝업의 초점 복귀 문제도 수정했다.

| 고정 평가 축 | 시작 | 최종 |
|---|---:|---:|
| 콘솔 오류·경고 | 97.89 | 100 |
| DOM 의미·이름·내비게이션 | 76.97 | 100 |
| 키보드·폼 상호작용 | 48.15 | 100 |
| 레이아웃·색상 대비 | 53.29 | 95.39 |
| 가중 합계 | **73.54** | **99.31** |

- 19개 경로 × 4조건 = **76개 화면 조건**. 1440×1000 다크/라이트, 375×812 및 320×740 다크.
- 고정 상호작용 **27/27 통과**. 폼 생성·검증·저장, Enter 제출, 메뉴·드로어·확인 창의 Tab/Shift+Tab/Escape와 초점 복귀를 포함한다.
- 고정 검사에서 콘솔 오류·경고 0, 입력 이름 누락 0, 가로 넘침 0.
- 전환과 로딩이 끝난 상태의 추가 axe 검사 및 수정 경로 재검증을 합쳐 **76개 조건에서 지속적인 자동 접근성 위반 0건**.
- **42개 테스트 파일 / 209개 테스트**, ESLint, TypeScript, 프로덕션 빌드 통과.
- 프로덕션 서버에서도 19개 경로 HTTP 200, 대표 4경로 × 2테마의 콘솔·DOM·대비 검사, 상호작용 **27/27**을 다시 확인했다.

## 주요 개선

1. **키보드로 전체 작업 수행**: 본문 바로가기, 현재 메뉴 표시, 모바일 메뉴의 초점 경계·Escape·배경 스크롤 차단. 활성 구독에서도 구독 관리 메뉴에 접근할 수 있다.
2. **팝업의 안전한 초점 처리**: native dialog와 명시적 Tab 경계를 사용한다. 중첩 창은 맨 위만 닫고, 비동기 작업 때문에 실행 버튼이 잠시 비활성화돼도 해당 버튼으로 초점을 돌려준다. 창을 다시 열면 확인 문구는 비어 있다.
3. **읽고 입력할 수 있는 화면**: 학습 메모 38개, 백업·리포트 입력과 진행률에 이름을 부여했다. 저장 완료를 스크린 리더에 알리고, 320px 폼과 백업 목록을 화면 안에 배치했다. 백업 이름 변경은 Enter로 저장된다.
4. **테마별 대비**: 보조 글자, 배지, 보조 버튼, 모델별 수치, 차트, 내보내기 버튼, 비용 안내문을 수정했다. 기존 보라·라임 방향과 대시보드 2열 구성은 유지했다.
5. **리포트 안정성**: 서버와 브라우저의 날짜 표기 차이로 발생하던 hydration 오류를 제거했다.

## 반복과 판정

| 단계 | 가설과 결과 |
|---|---|
| 1차, 01–06 | 날짜 hydration, modal, Tab/Escape, 셸 내비게이션, 이름·상태 안내, 모바일 폼. 27개 상호작용과 DOM 검사가 모두 통과해 93.19점 도달 |
| 2차, 07–09 | 보조 글자 → 배지/버튼 → 모델·차트 토큰 순으로 대비 개선 |
| 실험 10 | 장식 숫자를 접근성 트리에서 제외해도 대비 검사는 동일. **REVERT** (`4158947`) |
| 실험 11–12 | 내보내기 전경색과 장식 숫자의 실제 대비 개선. 각 대상의 4조건 모두 통과 |
| 후속 검토 | 확인 문구 재사용, 라이트 모드의 본문 바로가기·비용 안내, 비동기 중첩 창 초점 복귀를 재현하고 수정 |

[실험별 결과와 커밋](../../../autoresearch/frontend/inner_results.tsv), [전략 변경 기록](../../../autoresearch/frontend/outer/strategy_log.tsv), [세션 재개 문서](../../../autoresearch/frontend/autoresearch.md).

## 점수 해석과 검증 범위

평가 스크립트와 가중치(error .35 / dom .25 / form .25 / visual .15)는 베이스라인 커밋 `eaddbf6` 이후 변경하지 않았다. 기존 대시보드 evaluator와 새 `meta_eval/`도 변경하지 않았다. 사용자 선호에 따라 Chrome MCP 대신 Ego Lite에서 동일한 DOM·콘솔·폼·크기 측정을 수행했다.

고정 evaluator는 테마를 바꾼 직후 검사하므로 색상 전환 도중이나 버튼 로딩 상태의 대비를 일부 포착한다. 최종 원본 점수에도 107개 노드 지적이 남아 있다. 평가 기준을 느슨하게 바꿔 점수를 100으로 만들지 않았다. 별도의 정지 상태 검사는 CSS transition과 메인 로딩 종료를 기다린 뒤 수행했고, 고정 점수와 분리했다. 마지막 예약 화면 수정은 4개 조건을 재검사해 최종 집계에 반영했다. 원본과 재검사 파일을 모두 남겼다.

이 결과는 지정된 QA 데이터와 화면 상태에서의 자동 검사이며, 전체 WCAG 준수 인증이나 모든 입력·보조기기 조합에 대한 보증은 아니다. 외부 유료 API는 호출하지 않았고 운영 결제·Google 연동의 기존 제한을 변경하지 않았다.

QA DB는 `.gstack/frontend-rsi/qa.db`에 분리했다. 사용자 DB와 기존 포트 3000 서버, 미추적 `.commandcode/`, `GEO_master_Qshop_Integration_Plan.md`, `qshop.pdf`는 수정하지 않았다.

## 증거

- [시작 점수](../../../autoresearch/frontend/results/baseline-score.json) · [최종 고정 점수](../../../autoresearch/frontend/results/final-score.json)
- [최종 상호작용](../../../autoresearch/frontend/results/final-interactions.json) · [정지 상태와 수정 경로 검증](../../../autoresearch/frontend/results/final-verified-audit.json) · [추가 키보드 검증](../../../autoresearch/frontend/results/keyboard-extra.json)
- [프로덕션 페이지](../../../autoresearch/frontend/results/production-pages.json) · [프로덕션 상호작용](../../../autoresearch/frontend/results/production-interactions.json) · [HTTP 응답](../../../autoresearch/frontend/results/production-http.json)
- [320px 수정 전](workspace-before.png) · [320px 수정 후](workspace-after.png)
- [라이트 대시보드](dashboard-light-after.png) · [모바일 메뉴](mobile-menu-after.png)
