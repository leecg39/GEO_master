# llms.txt 기능 신뢰성 RSI

## 목표와 실행 범위
사용자 요청: 재귀적 자기 개선으로 기능 개선. 이번 회차는 llms.txt 워크플로의 저장 상태·이력·원격 확인·편집 보호를 개선한다.
Iterations: 6. Outer cycle 2회, 각 3개 실험. 한 실험은 하나의 제품 가설과 하나의 target 파일 변경으로 제한한다.

## 고정 평가
- `node autoresearch/llms/eval/prepare.mjs <run-label>`
- 25개 독립 행동 시나리오 통과율, 높을수록 좋음. 원격 응답은 고정 fixtures, DB는 임시 디렉터리.
- Outer score: 6개 범주 중 가장 낮은 통과율. 평가 코드·시나리오·기존 테스트·가중치는 고정한다.
- prepare 실행 시 SHA-256 manifest를 확인한다. 실험을 통과시키려고 평가를 바꾸지 않는다.

## Target 허용 목록
- `src/lib/llms-documents.ts`
- `src/lib/llms-history.ts`
- `src/lib/llms-txt.ts`
- `src/components/LlmsTxtClient.tsx`

## Guard
- `npm test -- tests/llms-remote.test.ts tests/llms-txt.test.ts tests/llms-history.integration.test.ts tests/url-security.test.ts tests/remaining-crud.integration.test.ts`
- `npm run typecheck`
- `npx eslint src/lib/llms-documents.ts src/lib/llms-history.ts src/lib/llms-txt.ts src/components/LlmsTxtClient.tsx --max-warnings=0`

## 결정
검증 전에 target 변경을 커밋. 메트릭 상승 + Guard 통과만 KEEP. 실패는 `git revert <실험커밋>` 후 최대 2회 수정 재시도한다. 기존 사용자 작업에 reset/stash를 적용하지 않는다.

## 초기 전략
1. 저장된 배포 상태가 현재 본문·URL·경로와 일치하도록 한다.
2. 과거 리비전 복원에서 현재 경로와 확인 증적을 일치시킨다.
3. 정상 HTTP로 온 오류 본문을 배포 성공으로 취급하지 않는다.
4. Outer 분석 후 실패가 남은 클라이언트 편집·경쟁 상태·프로젝트 전환 범주로 집중한다.

## 제약
실제 사용자 DB, 외부 유료 API, OAuth 설정, AX브릿지 서버, 기존 평가 파일은 수정하지 않는다. 평가에는 외부 통신이 없다. 검증된 코드만 원래 작업 공간에 통합하며 배포·푸시는 이번 실험에 포함하지 않는다.
