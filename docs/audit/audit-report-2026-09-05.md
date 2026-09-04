# Audit Report

**프로젝트**: geo-master (jiaolong)  
**날짜**: 2026-09-05  
**감사 범위**: Security / License / Privacy (GEO Blocks SEMForge 추가분 중심)  
**실행자**: Cursor `/audit`

---

## 요약

| 모듈 | Critical | High | Medium | Low | 총계 |
|------|----------|------|--------|-----|------|
| Security | 0 | 0 | 1 | 0 | 1 |
| License | 0 | 0 | 0 | 0 | 0 |
| Privacy | 0 | 0 | 0 | 1 | 1 |
| **합계** | **0** | **0** | **1** | **1** | **2** |

**전체 판정**: WARN (신규 기능 운영 주의사항만, 차단 이슈 없음)

---

## Security 결과

### 의존성 취약점

실행 명령어: `npm audit --json`  
결과: vulnerabilities total **0** (critical/high/moderate/low 모두 0)

### 인프라 / 앱 보안 (GEO Blocks)

| 항목 | 결과 |
|------|------|
| SEMForge 구독 게이트 | `requireSemforgeSubscription()` — 비활성 시 overview locked / mutation 402 |
| 원격 CMS/WP publish | **미구현** (의도적) — approved는 로컬 contents 상태만 |
| dry-run 승인 | `approved` 전 `dryRunConfirmed` 필수 |
| LLM 키 | 기존 AES settings 경로 재사용, 신규 제3자 SEO API 키 없음 |
| SSRF | GEO Blocks는 URL fetch 없음 (audit/share 기존 경로만 참조) |

### Medium

- **M1**: `content.suggestFromShare`는 SEMForge 구독이 필요하지만, 미인용 질문마다 로컬 초안을 다건 생성한다. 대량 실행 시 contents 테이블 증가 — UI에서 limit 기본 5로 제한됨. 운영 시 상한 유지 권장.

---

## License 결과

프로젝트 기존 의존성만 사용. GEO Blocks는 신규 npm 패키지 추가 없음. SPDX 충돌 신규 없음.

---

## Privacy 결과

| 항목 | 결과 |
|------|------|
| PII 신규 수집 | 없음 |
| 저장 데이터 | 주제·연구 메모·블록 스펙(JSON) — 활성 프로젝트 SQLite |
| Low | researchNotes에 외부 툴에서 붙여 넣은 텍스트가 로컬 DB에 남을 수 있음 — 기존 settings 메모와 동일 정책 |

---

## GEO Blocks 범위 확인

- Phase 5 (WP Application Password / MCP 서버): **미구현** (로드맵 보류와 일치)
- WP x MCP 코드/툴킷 이식: **없음**

---

## 권장 조치

1. SEMForge 비활성 계정으로 `/geo-blocks` 접속 시 게이트 배너 확인
2. `suggestFromShare` limit 기본값(5) 유지
3. 원격 게시/MCP는 별도 수요 확정 후 Phase 5로만 진행
