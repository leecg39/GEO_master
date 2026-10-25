import { AppError } from "./errors";
import { requireActiveProject } from "./projects";

export function haloEnabled() { return process.env.GEO_ENABLE_HALOX === "1"; }
export function requireHalo() {
  if (!haloEnabled()) throw new AppError("기회 발굴·라이브러리 기능이 비활성화되어 있습니다.", 404, "FEATURE_DISABLED");
}
export function requireHaloProject(request: Request) {
  requireHalo();
  const expected = request.headers.get("x-geo-project-id");
  if (expected !== null) requireActiveProject(Number(expected));
}
