# Autoresearch Session — Frontend Design RSI (2026-10-18)

## 기준
- 고정 지표 커밋 `539bd75`: `eval/design.mjs`, `eval/score.mjs`, `meta_eval/`, `outer/metric_weights.json`. 이후 수정 없음.
- 평가: 19경로 × 4조건(1440 dark/light, 375, 320) = 76회. 대상은 `main`·사이드바·헤더. 개발 도구 오버레이 제외.
- 축: typography .25 / spacing .15 / color .15 / shape .10 / targets .15 / integrity .20.
- Guard: 이전 세션의 접근성 고정 검사(`../frontend/eval/browser.mjs`)를 같은 순회에서 함께 실행. lint·typecheck·vitest.
- 평가 서버: 사용자의 dev 서버 `http://127.0.0.1:3002`. 페이지 조회만 하며 데이터를 바꾸지 않음.

## 결과
| 항목 | 베이스라인 | 최종 |
|---|---|---|
| 디자인 점수 | 91.68 | **98.16** |
| typography | 84.41 | 98.38 |
| spacing | 96.29 | 100 |
| color | 92.35 | 93.09 |
| shape | 96.58 | 100 |
| targets | 87.66 | 97.32 |
| integrity (겹침·잘림·넘침) | 97.37 (20건) | 100 (0건) |
| Guard error / dom / visual | 100 / 99.67 / 94.74 | 100 / 99.67 / 94.74 |

실험 13회: KEEP 11, REVERT 2. 후속 QA 수정 1회(라이트 테마 옅은 색조).
lint·typecheck 통과, vitest 122파일 1011개 통과.

## 해석과 한계
- 동적 콘텐츠(브리핑 펼침, 보고서 로딩 시점)에 따라 회차마다 ±0.05 내외 변동이 있다. 0.05 미만 차이는 판정 근거로 약하다.
- 고정 접근성 검사는 테마 전환 직후 axe를 실행하므로 `transition` 클래스가 있는 요소에서 대비 노드 수가 흔들린다. 1.5초 뒤 재검사(`tools/stable.mjs`)로 실제 위반만 확인했다.
- 실제로 남은 대비 위반: `/share`의 `opacity-70` 질문 수 보조 문구(베이스라인부터 존재), `/reports` 라이트의 비활성 버튼(축 외).
- 이전 세션의 상호작용 평가(데이터를 바꿈)는 격리 DB가 필요해 이번에는 다시 실행하지 않았다.

## 다음 후보
- 색 축(93): 대시보드 라이트 텍스트 15색 → 의미 토큰(본문/보조/강조/상태)으로 축소.
- 좁은 화면 한국어 줄바꿈: `keep-all`은 좁은 타일의 영문 라벨을 깨뜨려 REVERT. 요소 단위 적용(설명 문단만)으로 재시도 가능.
- `/share` 보조 문구 대비, 사이트 진단 브리핑 문단 폭(max-w-prose).

## 재실행
```bash
# ego-browser 공간 54, dev 서버 3002 실행 중일 때
autoresearch/frontend-design/tools/exp.sh <tag> <비교 tag>
node autoresearch/frontend-design/eval/score.mjs autoresearch/frontend-design/results/<tag>-pages.json
```
