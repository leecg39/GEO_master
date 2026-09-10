# GEO Master용 Codex with ChatGPT

2026-09-10에 현재 프로젝트 내부 설치를 완료했다. ChatGPT 웹을 계획·검토에 사용하고 Codex가 코드 수정과 명령 실행을 담당하도록 연결하는 개발 도구다.

- 원본: [XiaoDuoYa/codex-with-chatgpt](https://github.com/XiaoDuoYa/codex-with-chatgpt)
- 설치 버전: `0.1.1`
- 설치 커밋: [`230eec1c4f8eeb9972b95245b5b784b9233c69db`](https://github.com/XiaoDuoYa/codex-with-chatgpt/tree/230eec1c4f8eeb9972b95245b5b784b9233c69db)
- 원본 라이선스: MIT. 원본 소스와 LICENSE는 도구 폴더에 보존했다.
- 설치 방식: 프로젝트 내부 독립 Git checkout + 프로젝트용 Codex 스킬 + npm 실행 명령.

**현재 상태**

| 항목 | 상태 |
|---|---|
| 도구 다운로드·의존성 설치·빌드 | 완료 |
| 프로젝트용 스킬 | `.agents/skills/codex-with-chatgpt/SKILL.md`에 설치 |
| 로컬 서비스 | 설치 검증 시 시작, `GEO Master · jiaolong` 프로젝트 연결 |
| 로컬 파일 읽기 | HTTP/MCP를 통해 실제 프로젝트 README 읽기 성공 |
| ChatGPT 계정 연결 | Orca 인증 팝업 승인 및 ChatGPT의 연결 완료 표시 확인 |
| ChatGPT에서 프로젝트 파일 읽기 | 사용자 승인으로 만든 새 대화에서 `workspace_info`와 README 읽기 성공 |
| 이후 사용할 대화 | 새 대화를 `long-chat` 세션으로 저장, 다음 작업에서 재사용 |
| 공개 연결 주소 | Cloudflare 임시 주소 생성 및 공개 상태 검사 성공 |
| 전역 Codex 설정·전역 스킬 | 변경하지 않음 |

설치와 공개 연결 및 계정 인증을 완료했다. 사용자가 승인한 임시 주소 방식으로 ChatGPT에 **Codex with ChatGPT · GEO Master jiaolong** 항목을 만들었다. 초기에는 macOS 접근성 오류가 있었으나 사용자 조치 후 Orca 인증 팝업 접근이 가능해졌다. 일회용 코드 승인 뒤 ChatGPT의 연결 완료 표시와 프로젝트의 인증 발급을 확인했다.

**연결된 대화: [C2C GEO Master · jiaolong](https://chatgpt.com/c/6aa22dbb-e6bc-83e8-9c84-248583e2acd4)**

ChatGPT가 `workspace_info`와 `read_file`로 README 1–20행을 읽고 `CONNECTION_VERIFIED`를 응답했다. 작업공간 이름은 `GEO Master · jiaolong`, README 첫 제목은 `# GEO Master`, 연결은 읽기 전용이다. 확인된 Git 브랜치 `leecg39/feat-settings-research-assist`와 커밋 `948cd04`도 로컬 조회와 일치했다. 도구에 표시되는 루트 `workspace:/`는 실제 파일시스템 경로를 숨기는 작업공간 표시다. 검증 성공 뒤 이 URL을 프로젝트의 `long-chat` 세션으로 저장했다.

[기존 ChatGPT 대화](https://chatgpt.com/c/6aa0c856-faf4-83ee-8f87-d6c54191cd91)는 보존했다. 기존 대화에서는 Pro와 `5.6 매우 높음` 모두 `FORBIDDEN: This conversation does not support developer MCPs`가 보고됐다. 사용자가 새 대화 사용을 승인한 후 위 대화로 전환해 실제 읽기를 검증했다. 상세 결과와 이전 실패 기록은 [연결 검증 기록](connection-verification.json)에 있다. 일회용 코드나 인증 토큰은 기록하지 않는다.

[OpenAI 앱 안내](https://help.openai.com/en/articles/11487775-connectors-in-chatgpt)는 Pro 모델의 앱 제한을 설명하지만, 이번 오류는 모델을 바꿔도 재현됐다. Pro 요금제 자체와 Pro 모델은 구분한다. [개발자 모드 안내](https://developers.openai.com/api/docs/guides/developer-mode)는 계정 설정 활성화와 대화에서의 도구 선택 절차를 설명한다.

임시 주소는 서비스·터널을 재시작하면 바뀔 수 있다. 기존 연결을 유지하려면 서비스를 실행해 둔다. 주소가 바뀌면 해당 프로젝트의 ChatGPT 연결 항목을 새 주소로 다시 설정해야 한다.

**실행 명령**

프로젝트 루트에서 실행한다.

```sh
# 버전 및 도움말
npm run c2c -- --version
npm run c2c -- --help

# 로컬 서비스 시작·상태·진단·종료
npm run c2c:start
npm run c2c:status
npm run c2c:doctor
npm run c2c:stop

# 공개 연결 시작 (정상 실행 중이면 기존 연결을 재사용)
npm run c2c -- start --tunnel --json
```

`c2c:start`는 로컬 서비스만 시작한다. `c2c:doctor`는 `--no-fix`로 실행해 상태만 확인한다. `scripts/c2c.mjs`는 항상 이 프로젝트를 작업 디렉터리로 지정하므로 도구 자체 저장소를 분석 대상으로 잘못 선택하지 않는다. 명시적으로 `--workspace`를 전달하면 원본 CLI 동작에 따라 그 경로를 사용할 수 있다.

Orca에서의 ChatGPT 설정은 `orca-cli`가 제공하는 작업공간 내장 브라우저를 사용한다. 2026-09-10에 실제 ChatGPT 로그인 화면과 개발자 모드 설정 접근을 확인했다. 별도 브라우저 플러그인의 과거 버전 경로 누락 오류는 이 Orca 브라우저의 사용 가능 여부와 구분한다. 프로젝트 스킬에도 이 환경의 실행 경로를 반영했다.

**현재 네트워크의 연결 보완**

2026-09-10 연결 과정에서 QUIC/UDP 통신 오류와 통신사 DNS의 `NXDOMAIN`을 확인했다. 동일한 임시 도메인은 Cloudflare DNS에서 정상 조회됐다. 실행 스크립트는 도구 프로세스에 HTTP/2를 기본 적용하고, `*.trycloudflare.com`의 시스템 DNS 조회가 `ENOTFOUND` 또는 `EAI_AGAIN`으로 실패할 때만 Cloudflare DNS로 재조회한다. OS DNS 설정과 TLS 인증서 검증은 변경하지 않는다. 구현은 [c2c-network.mjs](../../scripts/c2c-network.mjs)에 있다.

`TUNNEL_TRANSPORT_PROTOCOL`을 명시하면 해당 값을 우선한다. 지원하는 프로토콜과 환경변수는 [Cloudflare 실행 매개변수 문서](https://developers.cloudflare.com/tunnel/advanced/run-parameters/#protocol)를 참고한다. DNS 보완 적용 뒤 프로젝트가 관리하는 임시 연결 시작 및 공개 `/health` 검증에 성공했다.

**프로젝트 내부 설치 구성**

| 경로 | 역할 |
|---|---|
| [도구 폴더](../../tools/codex-with-chatgpt) | 원본 저장소, 자체 의존성, 빌드 결과 |
| [프로젝트 스킬](../../.agents/skills/codex-with-chatgpt/SKILL.md) | 원본 스킬을 복사하고 실제 설치 경로 및 프로젝트 전용 운영 규칙 반영 |
| [실행 스크립트](../../scripts/c2c.mjs) | 프로젝트 위치를 기준으로 CLI 실행 |
| [프로젝트 정보](../../.c2c.json) | 프로젝트 표시 이름과 반복 작업 상한 |
| [읽기 제외 설정](../../.c2cignore) | DB·마스터 키·백업·로컬 상태·도구 저장소 접근 제외 |
| [로컬 검증 기록](local-verification.json) | 실제 프로젝트를 대상으로 한 읽기와 접근 차단 결과 |

원본 도구는 별도 패키지로 설치해 GEO Master의 의존성에 섞지 않았다. 상위 프로젝트 `.gitignore`에서 도구 checkout을 제외하고, TypeScript·ESLint·Vitest에서도 해당 폴더만 별도로 제외했다. 이로써 앱 검사에 외부 도구의 소스와 테스트가 중복 포함되지 않는다. 원본 저장소의 내부 Git 이력은 유지된다.

도구는 `.gitignore`를 파일 접근 정책으로 자동 사용하지 않으므로 `.c2cignore`를 별도로 추가했다. `data/` 아래 SQLite·백업·마스터 키와 환경 파일을 읽지 못하게 검증했다. 도구의 실행·인증 상태는 원본 설계에 따라 프로젝트 밖 OS 앱 상태 폴더에 저장된다.

macOS 상태 폴더: `/Users/user01/Library/Application Support/codex-with-chatgpt`

`doctor`의 `sandbox` 항목은 전역 Codex 허용 목록에 등록하지 않아 `false`로 나온다. 현재 환경은 파일 접근 제한이 없으며 로컬 서비스와 상태 저장은 정상 동작했다. 전역 설정까지 수정하는 원본 `setup`·`sandbox-allow`는 이번 설치에서 실행하지 않았다. 프로젝트 스킬에는 연결 주소 방식 선택 후 `start --tunnel`과 `pair`를 사용하는 절차를 안내했다.

**검증 결과**

- 원본 도구: `corepack pnpm build` 성공, **16개 파일·170개 테스트 통과**.
- GEO Master: `npm run typecheck`, `npm run lint` 성공, **39개 파일·217개 테스트 통과**.
- 로컬 검증: 프로젝트 식별, README 읽기, 읽기 전용 도구 9개 확인, 인증 없는 요청 HTTP 401, 환경 파일·DB·마스터 키·외부 경로 접근 차단 확인.
- 현재 서비스: 로컬 시작·상태 조회·OAuth 발견 정보와 인증 차단 검사 확인.
- 공개 연결: 관리되는 Cloudflare 임시 터널 시작, 공개 `/health` 응답과 OAuth 정보 확인 성공.
- DNS 보완: 정상 조회 유지, 임시 도메인에 한정한 대체 조회, IPv4·IPv6 결과 및 다른 호스트 제외 확인. 실행 스크립트 두 파일의 ESLint 통과.
- ChatGPT: 계정 인증, 새 대화에서 `workspace_info`와 README 1–20행 읽기, `CONNECTION_VERIFIED` 응답 확인. 이름·README 제목·Git 브랜치·커밋을 로컬 결과와 교차 확인했다. 새 대화 세션 저장 및 재조회도 성공했다.

**다른 체크아웃에서 다시 설치하기**

상위 프로젝트 Git에는 도구 소스 자체가 포함되지 않는다. 새로운 체크아웃에서는 프로젝트 루트에서 다음 명령으로 같은 커밋을 설치한다. 이미 설치된 폴더에는 clone을 다시 실행하지 않는다.

```sh
git clone https://github.com/XiaoDuoYa/codex-with-chatgpt.git tools/codex-with-chatgpt
git -C tools/codex-with-chatgpt checkout 230eec1c4f8eeb9972b95245b5b784b9233c69db
cd tools/codex-with-chatgpt
corepack pnpm install --frozen-lockfile
corepack pnpm build
```

설치에 사용한 환경은 Node.js `22.23.1`, pnpm `11.24.0`이다. 공개 연결에 필요한 `cloudflared`도 설치 시 이미 사용 가능했다. 작업공간 경로가 바뀌면 프로젝트 스킬에 기록된 절대 경로를 새 경로로 수정한다.

**업데이트**

원본 도구 작업 트리를 확인한 뒤 `git pull --ff-only`, `corepack pnpm install --frozen-lockfile`, `corepack pnpm build`를 순서대로 실행한다. 버전 고정으로 detached HEAD에 설치한 경우 먼저 원본의 `main` 브랜치로 전환해야 한다. 원본 스킬 변경도 검토해 프로젝트 스킬에 반영하고, 프로젝트 전용 경로와 설정 규칙을 유지한다. 실행 중인 로컬 서비스에는 `npm run c2c -- restart`로 적용한다. 공개 연결을 사용 중이면 원본 재연결 절차도 따른다.
