# R06 WordPress 실측 스파이크 결과

실측일: 2026-10-13 · 도구: WordPress Playground CLI 3.1.16 (Node에서 WASM PHP 8.3, WordPress 최신) · 로컬 전용, 운영 사이트에는 쓰지 않았다.

## 결론

코어 REST(`/wp-json/wp/v2/posts/{id}`)로 GEO_master의 필드를 써서 공개 페이지에 그대로 반영되는 경우는 **Yoast SEO의 제목·설명 메타 두 개뿐**이다. 나머지는 수동 적용 안내로 둔다. 플러그인 메타 쓰기는 원래 계획대로 별도 승인이 필요하므로, 연결 설정에서 사용자가 명시적으로 허용해야 켜지게 한다(기본 꺼짐).

## 구성별 결과

| GEO_master 필드 | 플러그인 없음 | Yoast SEO 28.6 | Rank Math 1.0.280 |
|---|---|---|---|
| `title` (HTML `<title>`) | 글 제목(`title`)을 쓰면 `<title>`이 "제목 – 사이트명"이 되어 제안 값과 일치시킬 수 없음 → **쓰기 안 함** | `meta._yoast_wpseo_title` 쓰기 → `<title>`이 제안 값과 정확히 같아짐 → **쓰기 가능(허용 시)** | 코어 REST 메타 미등록, 200 응답이지만 저장 안 됨 → **쓰기 안 함** |
| `description` | 코어는 meta description을 출력하지 않음(`excerpt`도 출력 안 됨) → **쓰기 안 함** | `meta._yoast_wpseo_metadesc` 쓰기 → `<meta name="description">`에 그대로 반영 → **쓰기 가능(허용 시)** | 위와 같음 → **쓰기 안 함** |
| `canonical`, `robots_meta`, `og_image` | 코어 REST로 쓸 수 없음 | REST 메타에 등록되지 않음 → **쓰기 안 함** | **쓰기 안 함** |
| `json_ld` | 테마·플러그인 의존 | 플러그인이 생성 → **쓰기 안 함** | **쓰기 안 함** |
| `body` | `content`는 반영되지만, GEO_master의 body는 "페이지 전체 텍스트에 제안 문구가 포함되는가"로 비교하는 일부 문구라 `content`에 쓰면 글 전체가 덮어써짐 → **쓰기 안 함** | 같음 | 같음 |

## 관찰한 동작 (구현에 반영)

1. 애플리케이션 비밀번호 Basic 인증으로 `GET /wp-json/wp/v2/users/me?context=edit`가 동작한다. 틀린 비밀번호는 401 `rest_not_logged_in`이다. 운영 환경에서는 HTTPS가 필요하다(로컬은 `WP_ENVIRONMENT_TYPE=local`).
2. `GET /wp-json/`의 `namespaces`에 `yoast/v1`이 있으면 Yoast가 활성이다. 플러그인 목록(`/wp/v2/plugins`)은 관리자 권한이 필요하므로 탐지에 쓰지 않는다.
3. URL → 글 ID: `GET /wp/v2/posts?slug={마지막 경로}`(페이지는 `/wp/v2/pages`) 결과 중 `link`가 대상 URL과 같은 것 하나만 인정한다.
4. 쓰기 전 현재 값: `GET /wp/v2/posts/{id}?context=edit&_fields=meta,modified_gmt`.
5. **등록되지 않은 메타 키를 보내도 200 OK이고 아무것도 저장되지 않는다**(Rank Math 구성에서 확인). 그래서 쓰기 응답의 `meta`를 다시 읽어 실제로 바뀌었는지 확인하고, 최종 판정은 공개 페이지 재수집으로 한다.
6. 쓰기마다 리비전이 생긴다(`/wp/v2/posts/{id}/revisions`) — 되돌리기 안내에 쓴다. 메타 변경은 리비전에 포함되지 않을 수 있으므로 이전 값을 전달 기록에 남긴다.
7. SSRF 방지(`assertPublicUrl`) 때문에 앱에서 로컬 WordPress(127.0.0.1)로는 연결할 수 없다. 통합 테스트는 이 스파이크에서 저장한 실제 응답(`tests/fixtures/wordpress/`)으로 한다.

## 계획 변경

- 마이그레이션 번호: 29 = `wordpress_connections`(R07), 30 = `change_deliveries`(R08). 원래 계획의 29·30 순서를 바꿨다(연결이 먼저 필요).
- 플러그인 메타 쓰기 허용 여부는 연결 정보의 `allow_seo_plugin_writes`(기본 0)로 둔다.
