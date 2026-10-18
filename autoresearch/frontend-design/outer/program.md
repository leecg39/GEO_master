# 프론트엔드 디자인 RSI — 2026-10-18

목표: 19개 경로의 시각 일관성(타이포 스케일·간격·색·모서리), 터치 영역, 레이아웃 무결성(겹침·잘림·넘침) 개선.
Ego Lite 사용. 평가 대상은 실행 중인 dev 서버 `http://127.0.0.1:3002`(읽기 전용 페이지 순회만 수행, 데이터 변경 없음).

## 고정 평가 (수정 금지)
- `../eval/design.mjs`, `../eval/score.mjs`, `../meta_eval/`는 베이스라인 커밋 이후 변경하지 않는다.
- 이전 세션의 `../../frontend/eval/`(접근성 고정 평가)을 그대로 불러와 Guard로 사용한다. 역시 수정 금지.
- 축: typography .25 / spacing .15 / color .15 / shape .10 / targets .15 / integrity .20.
- 조건: 1440×1000 dark/light, 375×812 dark, 320×740 dark. 범위는 `main`, 사이드바/헤더 표면. 개발 도구 오버레이 제외.

## Guard (회귀 금지)
- 접근성 고정 검사: error 100, dom 100, visual 100, 대비 위반 노드 수 베이스라인 이하.
- `npm run lint`, `npm run typecheck`, `npm test`.
- 시각 검토 거부권: 점수가 올라도 스크린샷에서 명백히 나빠지면 REVERT.

## Inner Loop
가설 1개 → 변경 전 증거 → 실험 커밋 → 대상 경로 평가 → 개선 KEEP / 동일·악화 REVERT(`git revert`) → `inner_results.tsv` 기록.
사용자 미추적 파일 보호를 위해 `reset --hard` 금지.

## 수정 범위
`src/components/`, `src/app/globals.css`, `src/app/**/page.tsx`의 마크업·클래스, 관련 테스트만.
API/DB/지표 계산/데이터 소스 변경 금지. 문구 변경 최소화.
디자인 방향(보라/라임 Sentri 톤, 다크 기본, 대시보드 2열) 유지.

## 우선순위 힌트
1. 레이아웃 무결성: 입력 아이콘 겹침, 잘림, 뷰포트 밖 텍스트 (전역 base 스타일이 Tailwind 유틸리티를 덮는지 확인)
2. 타이포 스케일: 10px/15px 등 비표준 크기를 12/14/16 스케일로, 본문 행간 1.35~1.85
3. 모바일 터치 영역 40px, 데스크톱 24px
4. 간격 4px 그리드, 모서리 반경 4종 이하
5. 색 수 제한 (텍스트 8 / 배경 10 / 테두리 6)

## Outer Loop
6회 실험마다 결과를 분석해 우선순위만 조정. 가중치 변경 없음.
