[C2C]
STATE: REVIEW
TASK_ID: c2c_9a30
ITERATION: 2
REVIEW_RESULT: CHANGES_REQUIRED
NEXT_EXPECTED_STEP: EXECUTED

VERIFIED:

Stage 1 closure 수정 확인:

공백 scalar @type → jsonld-type=fail.

evidence 없는 pass/fail → unknown.

next-env.d.ts는 HEAD 상태로 복구됨.

Stage 2 핵심 구조 확인:

승인 원본 change_sets.snapshot_id 유지.

fresh snapshot으로만 verify.

expected / pending / unexpected / unknown 분리.

승인 title + 비승인 noindex를 별도 event로 탐지.

canonical 삭제/변경, HTTP noindex, final URL 변경 탐지.

JSON-LD object key 순서 및 robots token 순서 차이는 무시.

query/trailing-slash URL identity 보존.

v15 seo_drift_events가 프로젝트/캠페인/change-set 범위로 영속화됨.

과거 drift history를 덮어쓰지 않음.

실패 수집은 collection=unknown, baseline 자동 승격 없음.

실행 결과 직접 확인:

최초 Stage 2 실행: 237 passed / 1 failed; collection/freshness 분류 오류 확인.

수정 후 41 files / 238 tests passed.

typecheck, lint, build exit code 0.

최신 harness 상태는 Stage 2 API/embedded-browser verification 성공으로 기록됨.

ACTIONABLE_DEFECT:

src/lib/seo/drift.ts의 비교 조건에서 다음 두 항목을 blocking condition으로 사용하면 안 된다.

baseline.analysis?.version !== current.analysis?.version

baseline.analysis?.configHash !== current.analysis?.configHash

Drift comparator가 실제 비교하는 것은 snapshot의 metadata/headers이고 SEO analysis 결과는 비교 계산에 사용하지 않는다. 따라서 parser/render/language가 동일한데 analyzer 규칙 버전이나 config만 바뀌어도 기존 승인 변경안이 conditions=unknown → failed가 된다.

이는 승인 후 게시 검증을 SEO 진단 규칙 배포와 불필요하게 결합한다. analyzer 버전을 올렸다는 이유만으로 이미 승인된 title/canonical 변경 검증이 불가능해져서는 안 된다.

FIX:

src/lib/seo/drift.ts

analysis version/configHash 비교를 comparability 차단 조건에서 제거.

다음 조건은 그대로 유지:

project/campaign/request URL identity

live/fetched evidence

fresh capture

renderMode

parserVersion

content-language

tests/seo-drift.test.ts

baseline/current의 parser/render/language와 페이지 근거는 동일하게 두고 analysis version/config만 다르게 설정.

결과가 comparable=true이고 승인 필드가 정상적으로 expected 또는 pending 처리되는지 검증.

tests/site-ops.integration.test.ts

승인 baseline의 analysis를 null 또는 이전 config/version으로 만든 뒤
approve → deliver → 실제 승인값 게시 → verify.

최종 verified.

expected drift event 저장.

change.snapshotId는 최초 승인 baseline 그대로인지 확인.

다른 Stage 2 구조·v15 schema·UI는 변경하지 말 것.

ACCEPTANCE:

analyzer version/config 변경만으로 site verification이 실패하지 않는다.

parser/render/language가 달라지는 경우에는 기존처럼 비교를 제한한다.

targeted drift/site-ops 테스트 통과.

전체 npm test, typecheck, lint, build 재통과.

이 한 가지를 수정하면, 현재 요청한 section 15의 1단계 + 2단계 범위는 완료 판정 가능하다.
