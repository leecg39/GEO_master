# geo.soverin.cloud 배포 결과

최신 권한 배포는 [SEMForge 계정 권한 배포 기록](ACCOUNT_ACCESS.md)을 참조하세요. 아래 내용은 최초 배포 시점의 기록입니다.

2026-10-07, Hostinger Docker 플러그인으로 VPS에 배포 완료.

| 항목 | 결과 |
|---|---|
| URL | https://geo.soverin.cloud |
| 서버 | `srv1655088` / `72.61.116.250` |
| 소스 커밋 | `37843a3` |
| 실행 이미지 | `geo-master:37843a3` |
| 이미지 ID | `sha256:33bc67bc08705088d7b02edf5d3427cd3ce0b6b04cfbcde6fbe499eb46003b98` |
| 컨테이너 | `geo-master-app-1`, healthy, 비루트 UID 1000 |
| DNS | Cloudflare `geo` A → `72.61.116.250`, DNS only |
| HTTPS | Let's Encrypt, 인증서 만료 2027-01-05 UTC, Traefik 자동 갱신 |
| 접속 보호 | 전체 경로 Basic Auth, bcrypt, 공개 앱 포트 없음 |
| 데이터 | 새 SQLite 워크스페이스, `geo-master_geo-data` 영구 볼륨 |
| 초기 백업 | `/docker/geo-master/backups/20261007T052406Z` |
| 서버 디스크 | 전체 193GB, 사용 153GB, 여유 41GB, 사용률 79% |

## 검증

- Linux Docker 프로덕션 빌드, 로컬 타입 검사·ESLint·`git diff --check` 통과.
- 초기 HTTP/API 32개 검증: 화면 19개, API 조회 6개, 미인증·잘못된 비밀번호 401, cross-origin 403, 유효성 검사 422, 테스트 프로젝트 생성 201.
- 실제 컨테이너 재생성 후 프로젝트 이름·수정시각 유지 확인. 검증용 프로젝트 삭제 204 및 후속 404 확인. 운영 데이터에는 기본 프로젝트 1개만 남음.
- 최종 이미지의 화면 19개 모두 인증된 HTTPS 요청으로 200 확인.
- HTTP → HTTPS 308 리다이렉트 확인. Node TLS 검증과 Ego Lite에서 인증서 검증을 켠 상태로 접속 성공.
- Ego Lite: 데스크톱 대시보드 → 팀 공유 이동, 375px 모바일 메뉴 열기·Escape 닫기, 수평 넘침 없음, 관찰한 전역 오류·미처리 rejection 0건.
- SQLite `integrity_check=ok`, 작업 큐 0개. 초기 백업 완료.

로컬 curl의 인증서 저장소에서는 발급 체인을 신뢰하지 못해 Node와 Chromium의 TLS 검증으로 확인했습니다. 인증서 검증을 끄고 성공으로 처리하지 않았습니다.

브라우저 확인은 대표 동작 smoke test이며, 이번 배포에서 기존 209개 단위 테스트 전체를 재실행한 것은 아닙니다. 외부 유료 API 호출이나 실제 결제는 검증 과정에서 실행하지 않았습니다.

## 접속 정보 및 운영

관리자 계정은 `geo-admin`입니다. 비밀번호는 이 저장소에 포함하지 않으며 로컬 `.gstack/deploy/geo.soverin.cloud/access.txt`에 권한 `0600`으로 저장했습니다. 제공자 API 키는 별도의 서버 `runtime.env`에 저장했습니다.

현재 로컬 프로젝트 데이터는 이전하지 않았습니다. 새 운영 워크스페이스에서 시작합니다. 실제 결제 승인·Google OAuth/GSC/GBP 등 기존 미구현 기능의 제한은 유지됩니다.

[운영·업데이트·백업 안내](README.md), [데스크톱 화면](evidence/desktop.png), [모바일 메뉴](evidence/mobile-menu.png), [최종 경로 검증](evidence/final-routes.json), [브라우저 검증](evidence/browser.json).
