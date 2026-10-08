# 소개 첫 화면·회원가입 재귀 개선 세션

- 시작: 2026-10-09, 기준 커밋 `98c484b`(PR #28 `feat/signup-landing`).
- 격리 브랜치: `autoresearch/signup-landing-20261009`. 작업 트리는 세션 임시 폴더에 있으며, 이어받을 때 `git worktree add <경로> autoresearch/signup-landing-20261009` 후 `node_modules`를 원래 저장소에 링크한다.
- 실험 전 평가를 고정하고 SHA-256을 확인한다. 기존 테스트를 수정하지 않는다.
- 상세 목표: `outer/program.md`. 결과: `inner_results.tsv`, `outer/strategy_log.tsv`, `results/*-score.json`.
- Bounded 8회(Outer 2회 × 4). 이어받을 때 program, 최근 git log, 결과를 먼저 읽는다.
