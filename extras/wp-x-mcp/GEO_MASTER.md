# GEO Master ↔ WP x MCP

이 폴더는 [WP x MCP](https://www.mubashirhassan.com/wp-x-mcp.html) 플러그인 원본입니다. GEO Master **코어가 아닙니다.**

## 역할 분리

| | GEO Master | 이 플러그인 (선택) |
|--|------------|-------------------|
| 하는 일 | `GeoPageSpec` 초안 → dry-run → 승인 → **WP draft push** | WP 사이트에 MCP 엔드포인트 노출 |
| 게시 경로 | Settings의 **Application Password** → `POST /wp-json/wp/v2/posts` (draft만) | 별도 AI 클라이언트가 MCP tools 호출 |
| 이식 | 플러그인 119 tools를 Next.js로 복제하지 **않음** | WordPress에만 설치 |

## GEO Master에서 쓰는 방법

1. WordPress에 이 플러그인을 설치·활성화해도 되고, **안 해도** 됩니다.
2. GEO Master Settings에 사이트 URL · WP 사용자명 · **Application Password**를 저장합니다.
3. `/geo-blocks`에서 스펙을 승인(approved)한 뒤 **WP 초안 게시**를 실행합니다.
4. GEO Master는 Gutenberg 코어 블록 HTML만 보냅니다 (Elementor/Kadence/SQL 도구는 호출하지 않음).

## 설치 (WordPress)

1. `extras/wp-x-mcp` 폴더를 zip으로 묶거나 이 디렉터리를 `wp-content/plugins/wp-x-mcp`에 복사합니다.
2. Plugins → Activate.
3. 생성되는 MCP API 키는 Cursor/Claude용이며, GEO Master draft push에는 **필수 아닙니다**.
