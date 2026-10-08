import { describe, expect, it } from "vitest";
import { canAccessPath } from "@/lib/account-policy";

describe("AI 봇 방문 로그 접근 정책", () => {
  it("게스트는 서버 로그 집계 화면과 API에 접근할 수 없다", () => {
    for (const path of ["/bot-logs", "/api/bot-logs", "/api/bot-logs/1", "/BOT-LOGS"]) expect(canAccessPath("guest", path)).toBe(false);
  });
  it("멤버와 관리자는 접근할 수 있다", () => {
    expect(canAccessPath("member", "/bot-logs")).toBe(true);
    expect(canAccessPath("admin", "/api/bot-logs")).toBe(true);
  });
});
