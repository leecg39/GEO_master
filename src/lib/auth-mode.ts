/**
 * GEO_AUTH_MODE
 * - local: 로그인 없는 단일 사용자 모드(기본값)
 * - app:   앱이 직접 로그인·회원가입을 처리. Next 프록시가 신원 헤더의 신뢰 경계다.
 * - proxy: Traefik 같은 신뢰 프록시가 비밀 헤더를 주입하고 앱이 로그인·회원가입을 처리
 */
export type AuthMode = "local" | "app" | "proxy";

export function configuredAuthMode(): string {
  return process.env.GEO_AUTH_MODE?.trim() || "local";
}

export function authMode(): AuthMode | null {
  const mode = configuredAuthMode();
  return mode === "local" || mode === "app" || mode === "proxy" ? mode : null;
}

/** 로그인·회원가입 화면을 사용하는 모드인지 */
export function loginEnabled(): boolean {
  const mode = authMode();
  return mode === "app" || mode === "proxy";
}
