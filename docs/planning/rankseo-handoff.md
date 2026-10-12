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
- 운영 데이터(`data/geo.db`)를 지우거나 덮어쓰지 않는다. DB 변경은 `src/lib/db/index.ts`의 버전 마이그레이션(현재 27)으로 컬럼·테이블 추가만 한다.
- 브랜치: `feat/rankseo-track-a`(기반은 `feat/signup-landing`, PR #28 위에 쌓는다).

## 진행 상태

| 티켓 | 상태 | 커밋 / 메모 |
|---|---|---|
| A0 기준선 | 완료 | 테스트 100개 파일·810개 통과, typecheck·lint 통과, build exit 0 |
| A1 규칙 문서 링크·등급 척도 | 완료 | `src/lib/rule-docs.ts`, `src/lib/audit-grade.ts`, `src/components/RuleDocLink.tsx` |
| A2 기술 SEO 규칙 보강 | 완료 | `src/lib/page-seo-rules.ts`, `src/lib/hreflang.ts`, 사이트 감사 상호 참조 이슈. 사이트맵·HTTP 헤더 hreflang은 미지원 |
| A3 Schema 필드 검사 | 다음 | Google 문서를 다시 받아 표 작성. FAQ 리치 결과는 2026년 5월 이후 Google 검색에 표시되지 않음 |
| R01~R05 보고서 | 대기 | `rankseo-gap-reports-plan.md` |
| A4 JS 의존 콘텐츠 | 대기 | |
| A5 답변 구조 지표 | 대기 | |
| A6 llms.txt 초안 | 대기 | |
| R06~R10 WordPress | 대기 | R06은 로컬 WordPress가 필요. 없으면 스파이크 문서에 "미실측"으로 기록하고 쓰기 범위를 코어 REST `content`로만 제한 |
| A7 PageSpeed | 대기 | |
| A8 만점 테스트 | 대기 | |

## 알려진 사항

- 2026-10-13 전체 테스트 첫 실행에서 2건이 실패했고(실행 시간 46초, 평소의 2.5배), 이어진 두 번의 실행에서는 모두 통과했다. 부하 때문에 생긴 간헐적 타임아웃으로 보인다. 다시 실패하면 테스트 이름을 기록한다.
- Google 공지(2026-06): Google 검색은 llms.txt를 쓰지 않는다. 다른 AI 서비스용으로 유지는 가능하다.
