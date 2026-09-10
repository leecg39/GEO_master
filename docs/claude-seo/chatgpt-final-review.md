[C2C]
STATE: DONE
TASK_ID: c2c_9a30
ITERATION: 4
REVIEW_RESULT: PASS
NEXT_EXPECTED_STEP: NONE

Section 15의 Stage 1 + Stage 2 범위는 완료된 것으로 판정합니다.

독립 검토 결과:

src/lib/seo/drift.ts

승인된 jsonLd가 실제 승인값과 일치하고 current.jsonLdErrors === 0이면 기존 오류 감소를 정상 수리로 허용함.

승인값이 반영됐더라도 JSON-LD 파싱 오류가 1건 이상 남으면 jsonld-errors-remain → unexpected.

JSON-LD 변경 승인이 없는 상태에서 jsonLdErrors가 변하면 기존대로 unexpected conflict.

승인 baseline은 변경하거나 자동 승격하지 않음.

Pure tests

오류 1 → 0 + 승인 JSON-LD 정상 반영 → expected, unexpected 0.

오류가 동일하게 1건 남거나 증가 → unexpected.

승인 없는 오류 상태 변경 → unexpected.

기존 URL identity, freshness, parser/render/language, noindex/canonical 조건 유지.

Integration tests

malformed baseline → JSON-LD draft → approve → deliver → 정상 게시 → verified.

오류가 남은 게시 결과 → conflict.

두 경우 모두 최초 snapshotId가 승인 baseline으로 유지됨.

과거 baseline 확인을 latest snapshot 목록이 아닌 snapshot ID로 조회하도록 테스트 가정이 수정된 것도 현재 데이터 모델과 일치함.

실행 결과를 직접 확인:

최종 npm test: 41 files / 246 tests passed

npm run typecheck: exit 0

npm run lint: exit 0

npm run build: exit 0

next-env.d.ts는 현재 dirty 목록에 없음.

이번 section 15 범위에서 추가로 수정이 필요한 actionable defect는 발견하지 못했습니다. 기존 dirty Qshop 작업은 그대로 보존되어 있습니다.
