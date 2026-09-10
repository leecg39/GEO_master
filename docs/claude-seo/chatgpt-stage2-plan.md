[C2C]
STATE: PLAN
TASK_ID: c2c_9a30
ITERATION: 2
REVIEW_RESULT: CONDITIONAL_PASS
NEXT_EXPECTED_STEP: EXECUTED

INDEPENDENT_REVIEW

Stage 1의 핵심 목표는 충족됐다.

실행 기록 직접 확인: 40 files / 224 tests passed.

npm run typecheck, npm run lint, npm run build 모두 exit code 0.

테스트 stderr의 Grok 인증 fallback·손상 schedule 메시지는 기존 테스트가 검증하는 오류 경로이며 Stage 1 실패는 아니다.

src/lib/seo/는 실제로 고정 allowlist의 offline technical/schema 분석기로 구현됐고 추가 fetch/model 호출이 없다.

page_snapshots.analysis에 Finding 전체와 rule/analyzer version, evidence reference, config hash가 저장된다.

네트워크 실패는 title/schema 결함으로 변환되지 않고 unknown으로 남는다.

404처럼 실제 HTTP 관측이 있는 경우에만 http-status=fail이 된다.

unknown/not_applicable은 기술 점수 분모에서 제외되고 coverage가 별도 제공된다.

기존 change_sets 승인→전달→재검증 상태 머신은 유지됐다.

v13을 수정하지 않고 v14 additive migration을 추가한 점도 적절하다.

STAGE_1_REQUIRED_FIXES

Stage 2에 들어가기 전에 같은 iteration에서 아래 3가지만 먼저 정리한다.

src/lib/seo/rules/schema.ts / src/lib/seo/normalize.ts

현재 scalar @type: " "는 jsonld-type을 통과할 수 있다.

schemaTypes()에서 trim 후 빈 문자열을 제외하거나 scalar/array 모두 동일한 non-empty type 검사를 적용한다.

fixture 추가: 빈/공백 scalar @type은 fail.

기존 multi-type 정상 fixture는 계속 pass해야 한다.

src/lib/seo/run-analysis.ts

현재 evidence가 없는 fail만 unknown으로 강등한다.

계약 주석대로 **evidence 없는 pass와 fail 모두 unknown**으로 강등해 향후 analyzer 추가 시 근거 없는 확정 판정을 구조적으로 막는다.

현재 allowlisted analyzer 결과에는 회귀가 없어야 한다.

next-env.d.ts

Stage 1 시작 시 clean이었으나 production build가 .next/dev/... → .next/... import로 변경했다.

구현 범위가 아닌 생성 부수효과이므로 이 파일 하나만 HEAD 상태로 복구한다.

다른 dirty Qshop 파일에는 reset/checkout을 사용하지 않는다.

STAGE_2_GOAL

승인된 변경안의 원본 snapshot을 baseline으로 고정하고, 게시 후 새 snapshot과 비교하여 expected / pending / unexpected / unknown 변경을 버전 있는 drift event로 남긴다.

별도 seo_baselines DB는 만들지 않는다. 현재 change_sets.snapshot_id는 승인 전에 재수집하여 revisionHash가 동일해야만 승인되므로, approved_at이 존재하는 change set에서는 이 snapshot을 승인 baseline으로 사용할 수 있다.

1. src/lib/seo/drift.ts 신규

순수 comparator로 구현한다. 네트워크·DB 접근 금지.

입력:

baseline PageSnapshot

current PageSnapshot

승인된 ChangeItem[]

출력은 버전 drift/1과 event 배열, touched-field verification 결과를 포함한다.

분류:

expected: 승인한 after 값이 실제로 반영됨.

pending: 승인 필드가 아직 before 값 그대로임.

unexpected: 승인하지 않은 변경 또는 승인 필드가 before/after 어느 쪽도 아님.

unknown: 새 수집 실패 등 비교 근거 부족.

비교 대상:

title

description

canonical

ogImage

robots

jsonLd

기존 conflict 보호를 유지하기 위한 robotsHeader, bodyHash

가능하면 finalUrl도 보호 필드로 포함해 예상 밖 redirect target 변화를 탐지.

중요 규칙:

canonical URL에서 trailing slash나 query를 임의 제거하지 않는다.

/a와 /a/는 서로 다른 baseline이다.

robots token 순서 차이는 동일하게 취급.

JSON-LD는 stableJson/schemaEntities 기반 의미 비교로 object key 순서만 다른 경우 drift가 아니다.

raw HTML contentHash 변화만으로 conflict를 만들지 않는다. 동적 HTML 잡음 때문에 현재의 의미 필드/bodyHash 중심 비교를 유지한다.

baseline을 current로 자동 승격하지 않는다.

2. 비교 공통화

src/lib/seo/normalize.ts에 필요한 순수 helper만 추가한다.

예:

normalized text equality

robots directive normalization/equality

structured-data semantic equality

현재 src/lib/site-ops/index.ts의 equal()과 새 drift comparator가 서로 다른 정규화 규칙을 갖지 않도록 한다.

normalize.ts가 site-ops 타입을 import하게 만들어 순환 의존성을 만들지는 말 것.

3. DB v15

신규 src/lib/db/seo-drift-migration.ts를 만들고 DATABASE_MIGRATIONS에 v15로 추가한다. v13/v14는 수정하지 않는다.

seo_drift_events 권장 필드:

id

project_id

campaign_id

change_set_id

baseline_snapshot_id

current_snapshot_id

field

classification

approved_change

before_value

after_value

expected_value

rule_id

rule_version

detail

created_at

프로젝트/캠페인/변경안 기준 index와 동일 current snapshot에 대한 중복 event 방지 제약을 둔다.

unchanged인 비승인 필드는 저장하지 않는다. expected, pending, unexpected, unknown처럼 감사 이력이 필요한 결과만 저장한다.

4. src/lib/site-ops/index.ts

approve/deliver 흐름은 재작성하지 않는다.

verify의 현재 inline diff를 새 comparator로 교체한다.

상태 결정:

fresh capture 실패 → failed, collection unknown event.

unexpected 존재 → conflict.

unexpected 없음 + 모든 승인 필드 expected → verified.

unexpected 없음 + 하나 이상 pending → verification_pending.

기존 verification.fields 호환은 유지한다.

additive metadata로 다음을 넣을 수 있다:

baselineSnapshotId

snapshotId

driftVersion

driftEventIds

expected/pending/unexpected/unknown count

drift event 저장과 change-set 상태 변경은 같은 DB transaction에서 처리한다.

5. 조회/UI

getChangeSet() 또는 별도 scoped loader에서 drift event를 반드시 project_id + campaign_id + change_set_id로 제한해 읽는다.

기존 SiteOpsWorkbench에 최소 표시만 추가한다:

승인 기준 snapshot → 재검증 snapshot

승인대로 반영

아직 반영 대기

예상 밖 변경

비교 불가

새 대형 화면은 만들지 않는다.

TESTS

tests/seo-drift.test.ts 신규 pure fixtures:

승인 title 반영 + 동시에 noindex 추가 → title expected, robots unexpected.

JSON-LD object key 순서만 변경 → event 없음.

canonical 변경 또는 삭제 → unexpected.

robots directive 순서만 변경 → event 없음.

/a baseline을 /a/ current와 자동 비교/병합하지 않음.

current capture 실패 → unknown, 정상 baseline 승격 없음.

comparator 반복 실행 결과 동일.

tests/site-ops.integration.test.ts 확장:

title 정상 게시 → expected event 저장 + verified.

아직 before 값 → pending event + verification_pending.

승인 title + 비승인 noindex → persisted unexpected event + conflict.

visible body 변경 conflict 동작 유지.

verification 실패 snapshot도 저장되지만 baseline은 그대로.

여러 번 verify해도 과거 drift history를 덮어쓰지 않음.

다른 프로젝트에서 drift event 조회 불가.

마이그레이션:

v15 migration test.

LATEST_SCHEMA_VERSION === 15.

기존 v13/v14 데이터 유지와 foreign_key_check 정상.

최종 회귀:

npm test

npm run typecheck

npm run lint

npm run build

SUCCESS_CRITERIA

승인된 title 변경은 expected로 기록되면서 같은 재수집의 추가 noindex는 별도 unexpected conflict로 잡힌다.

JSON-LD key-order 변화만으로 conflict가 발생하지 않는다.

예상 밖 canonical 변경/삭제가 영속 event로 남는다.

/a와 /a/를 임의 동일 baseline으로 취급하지 않는다.

수집 실패를 verified 또는 정상 drift로 표시하지 않는다.

어떤 current snapshot도 자동으로 승인 baseline이 되지 않는다.

프로젝트 간 snapshot/change/drift event가 섞이지 않는다.

기존 Qshop 승인·수동 전달·재검증 기능과 Stage 1 Finding/score 테스트가 모두 유지된다.

DO_NOT:

GSC/PageSpeed/Studio Improve-New까지 범위를 넓히지 말 것.

새 crawler DB 또는 seo_baselines 테이블을 만들지 말 것.

v13/v14 migration을 수정하지 말 것.

Python/FLOW/shell 실행기를 추가하지 말 것.

기존 dirty Qshop 작업을 정리·reset하지 말 것.

Codex는 Stage 1의 3개 closure 항목과 위 Stage 2만 실행하고, 변경 파일·v15 schema·drift fixture 결과·전체 테스트 결과를 EXECUTED로 보고한다.
