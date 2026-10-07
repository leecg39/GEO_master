# GEO Master 링크 공유 미리보기 배포

2026-10-07 (Asia/Seoul) · https://geo.soverin.cloud/

## 적용 결과

- 운영 이미지: `geo-master:og-20261007-v1`, 컨테이너 `geo-master-app-1` healthy.
- 대표 주소의 미인증 GET/HEAD 요청에는 OG·Twitter 메타태그가 포함된 정적 소개 화면을 반환합니다.
- OG: `https://geo.soverin.cloud/og/geo-master-20261007.jpg`, 1200×630, 약 156 KiB.
- Twitter 카드: `https://geo.soverin.cloud/og/geo-master-thumbnail-20261007.jpg`, 1280×720, 약 208 KiB.
- 인증된 사용자의 대표 주소는 기존 대시보드입니다. 신규 사용자는 소개 화면에서 ‘워크스페이스 열기’ → Basic Auth 로그인으로 진입합니다.
- 업무 화면과 API의 기존 로그인 보호를 유지합니다. 내부 화면 링크는 미인증 접근이 막혀 있으므로 공유에는 대표 주소를 사용하세요.
- 전체 경로 또는 특정 User-Agent에 대한 인증 예외는 추가하지 않았습니다. 공개 경로에서 사용자 인증 헤더는 제거됩니다.

## 검증

- 로컬 타입 검사·수정 코드 ESLint·git diff 검사 통과.
- API 출처 보호 및 계정 권한 테스트: 2개 파일 / 11개 테스트 통과.
- 실제 Linux Docker 프로덕션 빌드 통과.
- 실제 외부 HTTPS 검증: 68개 항목 통과. 기본 요청 및 Kakao/Facebook/Twitter/Slack/Telegram/Discord 식별 요청에 공개 HTML이 동일하게 반환됩니다.
- OG 태그가 초기 HTML head 안에 존재하고, 두 JPG가 인증 없이 올바른 MIME 타입·해상도·원본 바이트로 응답합니다.
- 미인증 업무 API·내부 화면·쓰기 요청·잘못된 비밀번호 및 위조 인증 헤더 차단 확인.
- 인증된 대시보드·API 정상 응답 및 배포 전후 프로젝트 데이터 해시 일치 확인.
- Ego Lite에서 1440px PC와 375px 모바일 화면 확인. 모바일 수평 넘침 없음.
- 카카오 계정 로그인이 없어 카카오 공식 도구의 캐시 초기화 및 실제 카카오톡 대화방 전송 검증은 수행하지 않았습니다.

검증 재실행: `node scripts/verify-social-preview.mjs`

[HTTP 검증 결과](evidence/social-preview/checks.json) · [PC 화면](evidence/social-preview/desktop.png) · [모바일 화면](evidence/social-preview/mobile.png)

## 캐시

기존 공유 결과가 남아 있으면 [카카오 URL 메타정보 관리](https://developers.kakao.com/tool/debugger/sharing)에서 `https://geo.soverin.cloud/`의 캐시를 초기화한 뒤 새 메시지로 링크를 공유합니다. [카카오 공식 설명](https://developers.kakao.com/docs/ko/tool/common).

## 복구 자료

서버 백업: `/docker/geo-master/backups/before-social-preview-20261007`

변경 전 `.env`, Compose 설정, Dockerfile, 루트 layout 및 이미지 이름을 권한 0600으로 보관했습니다. 이전 이미지는 `geo-master:9b8014c`입니다. 데이터 볼륨 변경이나 DB 마이그레이션은 없습니다.

## 후속 로그인 변경

위 내용은 최초 미리보기 배포 기록입니다. 현재는 [세션 로그인 및 게스트 권한](LOGIN_GUEST_ACCESS.md)이 적용되었으며 Basic Auth 팝업 대신 일반 로그인 화면으로 이동합니다. 최신 미리보기 재검증은 67개 항목을 통과했습니다. 프로젝트 스냅샷 비교는 운영 중 편집을 고려해 명시적 옵션으로 분리했습니다.
