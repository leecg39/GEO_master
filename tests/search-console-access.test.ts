import { describe, expect, it } from "vitest";
import { canAccessPath } from "@/lib/account-policy";

describe("Search Console 가져오기 접근 정책", () => {
  it("게스트는 /analytics와 같은 기준으로 검색 성과 화면과 API에 접근할 수 없다", () => {
    for (const path of ["/search-console", "/api/search-console/imports", "/api/search-console/imports/1", "/SEARCH-CONSOLE"]) {
      expect(canAccessPath("guest", path)).toBe(false);
    }
  });

  it("멤버와 관리자는 접근할 수 있다", () => {
    expect(canAccessPath("member", "/search-console")).toBe(true);
    expect(canAccessPath("admin", "/api/search-console/imports")).toBe(true);
  });
});
