import { describe, expect, it } from "vitest";
import { canAccessPath } from "@/lib/account-policy";

describe("사업 성과 접근 정책", () => {
  it("게스트는 사업 성과 화면과 API에 접근할 수 없다", () => {
    for (const path of ["/outcomes", "/api/outcomes", "/api/outcomes/1", "/api/outcomes/definitions"]) expect(canAccessPath("guest", path)).toBe(false);
  });
  it("멤버는 접근할 수 있다", () => expect(canAccessPath("member", "/outcomes")).toBe(true));
});
