# claude-seo 선별 참조

- 원본: https://github.com/AgriciDaniel/claude-seo
- 고정 commit: `a1480c7e590b16001bd9dc1627eacdcd44d580f9`
- 확인일: 2026-09-10
- 라이선스: MIT. 원문은 [LICENSE](./LICENSE), 파일별 원본 URL·SHA-256·수정 여부는 [manifest.json](./manifest.json).
- `selected/` 파일은 원본 그대로 보관하는 참고 자료다. 스킬 등록, Python 실행, 셸 실행 권한 부여 또는 별도 DB 설치에 사용하지 않는다.
- FLOW 및 CC BY 4.0 자료는 포함하지 않았다.

| 원본 | 적용 대상 | 수정 방침 |
| --- | --- | --- |
| `skills/seo-technical/SKILL.md` | `src/lib/seo/` 기술 검사 | 실제 응답만 판정. 미측정과 실패 구분. 한국어 길이는 강제 점수 기준으로 사용하지 않음 |
| `skills/seo-schema/SKILL.md` | JSON-LD 검사 | 작은 검증 범위 명시, 필수·권고 분리, `@graph`·복수 `@type` 처리. 가격·리뷰 생성 금지 |
| `skills/seo-drift/SKILL.md` | 승인 기준선 비교 | 수집을 승인으로 간주하지 않음. 기존 프로젝트 DB와 스냅샷 재사용 |
| `scripts/drift_compare.py` | TypeScript 변경 감지 | 제목·canonical·noindex·스키마 변경 개념 선별. 예상 변경과 예상 밖 변경 분리 |
| `scripts/drift_baseline.py` | URL·해시 처리 | `/a`와 `/a/`, 쿼리 보존. 임의 URL 병합 제거. 원문 해시와 SEO 의미 해시 분리 |

상위 자료의 모든 SEO 주장·점수·지원 유형을 이식한 것은 아니다. 제품 규칙은 버전으로 고정하고 검사 범위를 결과와 함께 제공한다. 출처 확인:

- [OpenAI 봇 목적](https://developers.openai.com/api/docs/bots)
- [Google Product snippet 요건](https://developers.google.com/search/docs/appearance/structured-data/product-snippet)

GEO Master의 TypeScript 구현은 위 개념을 기존 수집·승인 흐름에 맞게 다시 작성한다. 원본 Python 런타임, 전역 캐시, 자동 baseline 승격, 영어 단어 수 기준은 사용하지 않는다.
