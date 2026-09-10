[C2C]
STATE: REVIEW
TASK_ID: c2c_9a30
ITERATION: 3
REVIEW_RESULT: CHANGES_REQUIRED
NEXT_EXPECTED_STEP: EXECUTED

검토 결과, Iteration 3에서 요청했던 closure는 정상 반영됐다.

src/lib/seo/drift.ts: analyzer analysis.version/configHash가 더 이상 drift comparability를 막지 않는다. parser/render/language/freshness 보호는 유지된다.

tests/seo-drift.test.ts: analyzer/config 변경 및 legacy analysis=null baseline 비교를 검증한다.

tests/site-ops.integration.test.ts: 실제 승인 baseline의 analysis=NULL 상태에서도 게시 후 verified가 되고 원래 snapshotId가 유지되는 것을 검증한다.

src/lib/seo/rules/schema.ts: @id-only reference를 중복 정의에서 제외하고, 명시적 @type이 없는 경우 확정 실패 대신 unknown, 공백/잘못된 명시형 type은 계속 fail로 처리한다.

next-env.d.ts는 현재 git status에 나타나지 않아 build 부수 변경도 정리됐다.

실행 기록 직접 확인: 41 files / 241 tests passed, typecheck/lint/build 모두 exit code 0.

다만 section 15의 Stage 2에 남은 한 가지 실제 검증 결함이 있다.

DEFECT — 승인된 JSON-LD 수정이 정상 반영되어도 conflict가 될 수 있음

src/lib/seo/drift.ts에서 jsonLd 자체는 승인 변경으로 expected 처리할 수 있지만, 바로 뒤의 protected fields에 jsonLdErrors가 무조건 포함돼 있다.

현재 구조:

baseline: 잘못된 JSON-LD가 있어 jsonLdErrors = 1

사용자가 jsonLd 수정안을 승인

게시 후: 승인한 정상 JSON-LD가 반영되어 jsonLd는 expected

동시에 정상화되므로 jsonLdErrors = 0

comparator는 1 → 0을 별도의 unexpected로 기록

최종 상태는 conflict

즉 승인한 스키마 오류 수정의 성공 자체가 승인 범위 밖 변경으로 오인될 수 있다.

이는 section 15의 “승인 변경과 예상하지 못한 변경을 분리” 조건에 어긋난다.

FIX

src/lib/seo/drift.ts에서 jsonLdErrors 비교를 승인된 jsonLd 변경과 연동한다.

권장 규칙:

jsonLd가 승인 변경이고 실제 jsonLd가 expected이며

current jsonLdErrors === 0

baseline의 오류 수가 current보다 감소했다면

→ jsonLdErrors 감소를 unexpected로 만들지 않는다.

반대로 다음은 계속 conflict여야 한다.

승인 JSON-LD가 반영됐더라도 current jsonLdErrors > 0

오류 수가 새로 증가함

승인하지 않았는데 JSON-LD 파싱 상태가 달라짐

REQUIRED TESTS

tests/seo-drift.test.ts

malformed baseline (jsonLdErrors > 0)

승인된 valid JSON-LD

current는 승인값과 일치하고 jsonLdErrors=0

결과: jsonLd=expected, unexpected=0.

추가 fixture:

승인값은 존재하지만 별도의 malformed JSON-LD가 남아 current jsonLdErrors > 0

결과: unexpected 유지.

tests/site-ops.integration.test.ts

malformed HTML capture

valid JSON-LD draft → approve → deliver

정상 JSON-LD가 게시된 HTML로 verify

최종 verified

baseline snapshotId 유지

expected drift event 저장

오류 해결 때문에 conflict가 발생하지 않음.

이 수정 후 241+ 전체 테스트, typecheck, lint, build를 다시 통과하면 section 15의 Stage 1·2를 DONE으로 판정할 수 있다.
