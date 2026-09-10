# 큐샵 기존 사이트 적용 도우미

대상 URL: https://example.com/
변경안: 1
승인자: 로컬 QA 운영자
승인 시각: 2026-09-09T05:12:54.904Z
원본 수집: 2026-09-09T05:12:54.381Z
원본 해시: ff67a9d764d6a2367a187734e697f6a53217db9a21c101d410a113ca871a299d

큐샵 관리자 설정 → SEO/GEO → 페이지별 SEO에서 대상 페이지의 제목·설명·메타 이미지를 검토하세요. 기존 사이트의 구조화 데이터 확인 메뉴는 직접 편집용이 아닙니다. 원본 상품/회사 정보를 수정하거나 지원되는 편집 경로를 확인하세요.

전달은 게시 완료가 아닙니다. 지원하지 않는 항목을 공통 header에 우회 삽입하지 마세요. 특히 Product는 해당 상품 페이지에만 적용합니다. 검색 noindex, AI 검색 수집, 학습 이용, 로그인 비공개는 각각 다른 정책입니다.

## 페이지 제목

현재 값:

Example Domain

수정안:

Example Domain — GEO 검증 초안

이유: 공개 페이지 제목을 수정하는 수동 적용 절차 QA
근거: {"url":"https://example.com/","capturedAt":"2026-09-09T05:12:54.381Z","contentHash":"ff67a9d764d6a2367a187734e697f6a53217db9a21c101d410a113ca871a299d","quote":"Example Domain","parserVersion":"site-ops/1"}

## 반영 확인

큐샵에서 저장·게시한 뒤 GEO Master의 ‘공개 URL 재검증’을 실행하세요. 대상 필드가 일치하고 원본과 충돌하지 않을 때만 확인 완료로 표시됩니다. 충돌 시 최신 페이지를 다시 수집하여 새 변경안을 승인하세요.

참고: https://help.qshop.ai/customer_support/guide/setting/manage/seo
https://qshop.ai/insights/qshop-blog-jsonld-content-type-guide