import { describe, expect, it } from "vitest";
import { buildApplyGuide, type GuideItem } from "@/lib/integrations/qshop-manual";

const item = (overrides: Partial<GuideItem>): GuideItem => ({
  id: 1, url: "https://shop.example/about", field: "title", originalValue: "회사 소개", proposedValue: "채널톡 | 고객 상담 도구", rationale: "브랜드를 앞에", status: "approved", ...overrides,
});

describe("buildApplyGuide (Qshop manual adapter)", () => {
  it("includes only approved items, grouped by page, and says nothing is auto-published", () => {
    const guide = buildApplyGuide([item({ id: 1 }), item({ id: 2, field: "description", proposedValue: "설명" }), item({ id: 3, status: "draft" }), item({ id: 4, url: "https://shop.example/blog/a", field: "json_ld", proposedValue: '{"@type":"Organization"}' })], "site-settings");
    expect(guide.pages.map((page) => [page.url, page.steps.length])).toEqual([["https://shop.example/about", 2], ["https://shop.example/blog/a", 1]]);
    expect(guide.skipped).toEqual([{ id: 3, reason: "승인되지 않은 수정안(초안)" }]);
    expect(guide.markdown).toContain("자동으로 게시하지 않습니다");
    expect(guide.markdown).toContain("채널톡 | 고객 상담 도구");
    expect(guide.markdown).not.toContain("DRAFT");
  });

  it("warns instead of inventing menu names, and flags editor-specific caveats", () => {
    const site = buildApplyGuide([item({ field: "json_ld", proposedValue: "{}" })], "site-settings");
    expect(site.pages[0]!.steps[0]!.caution).toContain("중복");
    expect(site.markdown).toContain("메뉴 이름은 큐샵 화면에서 직접 확인");
    const blog = buildApplyGuide([item({ field: "json_ld", proposedValue: "{}" })], "blog");
    expect(blog.pages[0]!.steps[0]!.caution).toContain("블로그");
  });

  it("warns that robots/noindex is not secret protection and body needs full review", () => {
    const guide = buildApplyGuide([item({ field: "robots_meta", proposedValue: "noindex" }), item({ id: 2, field: "body", proposedValue: "새 본문" })], "site-settings");
    expect(guide.pages[0]!.steps[0]!.caution).toContain("비밀");
    expect(guide.pages[0]!.steps[1]!.caution).toContain("전체");
  });

  it("returns an empty guide with a message when nothing is approved", () => {
    const guide = buildApplyGuide([item({ status: "draft" })], "site-settings");
    expect(guide.pages).toEqual([]);
    expect(guide.markdown).toContain("승인된 수정안이 없습니다");
  });

  it("neutralizes markdown fences inside values so the guide cannot be broken", () => {
    const guide = buildApplyGuide([item({ proposedValue: "```\n악성 블록\n```" })], "site-settings");
    expect(guide.markdown.match(/```/g)!.length % 2).toBe(0);
  });
});
