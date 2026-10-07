# GEO Master 프론트엔드 재귀 개선 세션

- 시작 커밋: `58525bf`, 브랜치 `feat/geo-master-app`.
- 사용자 요청: `$autoresearch-frontend 재귀적 개선`.
- 별도 인프라: `autoresearch/frontend/`. 이전 대시보드 평가 파일은 수정하지 않음.
- 고정 인프라 커밋: `eaddbf6`. `eval/`, `meta_eval/` 및 가중치를 이후 수정하지 않음.
- Ego Lite 작업 공간 12 / p1, QA 서버 `http://127.0.0.1:3100`.
- QA DB `.gstack/frontend-rsi/qa.db`, 사용자 DB와 포트 3000은 그대로 유지.
- 베이스라인: 19경로 × 4조건 = 76회, 상호작용 27개. **73.5370/100**.
- 조건: 1440×1000 dark/light, 375×812 dark, 320×740 dark. iframe/브라우저 UI/개발도구는 제품 평가에서 제외.
- 재개 시 `outer/program.md`, `inner_results.tsv`, 최신 `results/`를 읽고 아직 실패하는 축을 먼저 개선.
- 한 가설씩 커밋하고 브라우저로 확인. 사용자 파일을 보호하기 위해 전체 reset은 사용하지 않음.

## 현재
1차: hydration, modal/메뉴 키보드, 폼 명명, 모바일 폼·Enter 저장을 개선. 상호작용 27/27 통과.
2차 완료: 12개 실험 중 11개 KEEP, 1개 REVERT. 후속 검토 수정 3개.
최종 고정 점수 99.3092/100. 상호작용 27/27, 209개 테스트·린트·타입 검사·프로덕션 빌드 통과.
전환 직후 고정 검사에는 107개 대비 노드 지적이 남지만, 정지 상태와 예약 화면 재검사를 합친 76개 조건에는 지속 위반 0.
가중치·eval·meta_eval 변경 없음. 세부 보고서: `../../docs/qa/frontend-rsi-2026-10-07/report.md`.
최종 점수 입력 `results/final-score-input.json`은 전체 마지막 순회의 원본 `final-pages.json`에 예약 화면 4조건 재검사 `final-automation-recheck.json`을 반영한 집계다. 원본도 보존.
다음 연구는 별도 베이스라인을 정한 뒤 중간 전환 상태의 시각적 안정성 또는 더 많은 오류/장문 입력 상태를 확장 대상으로 삼을 수 있다. 현재 고정 평가를 수정해 이전 점수를 대체하지 않는다.

## 재실행
Ego Lite `taskSpace`를 하나 생성하거나 기존 소유 공간을 재사용한다. `ego-browser nodejs`에서 `eval/browser.mjs`의 `runPages(page, { output })`와 `eval/interactions.mjs`의 `runInteractions(page, output)`를 실행한다. 기본 포트는 3100이며 `FRONTEND_BASE_URL`로 평가 실행 환경만 지정할 수 있다.

```bash
node autoresearch/frontend/eval/score.mjs <pages.json> <interactions.json>
npm run typecheck
npm test
npm run lint
npm run build
```

상호작용 평가는 설정 저장·로컬 백업 생성/이름 변경·메모 저장을 수행하므로 반드시 격리 QA DB에서 실행한다. 외부 유료 API를 호출하지 않는다.
