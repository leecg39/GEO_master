import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzePage } from "@/lib/site-ops/snapshots";
import { buildContentBrief, persistContentBrief } from "@/lib/seo/content-brief";
import { closeDatabase } from "@/lib/db";
import { requireActiveProject } from "@/lib/projects";
import { listContents } from "@/lib/contents";
import { runStudioTool } from "@/lib/studio";

const product = fs.readFileSync(new URL("./fixtures/seo/product.ko.html", import.meta.url), "utf8");

function sourceFromFixture() {
  const parsed = analyzePage(product, "https://example.com/tea");
  return {
    url: "https://example.com/tea",
    title: parsed.metadata.title,
    heading: parsed.metadata.heading,
    bodyText: parsed.metadata.bodyText,
    questions: ["녹차는 어떻게 보관하나요?"],
    answers: ["직사광선을 피하고 서늘한 곳에 보관하세요."],
    internalLinks: [{ href: "https://example.com/about", text: "회사 소개" }],
  };
}

const competitorSources = [{
  url: "https://competitor.example/tea-club",
  excerpt: "프리미엄 녹차 구독 서비스를 월 29,000원에 제공합니다. 당일 배송과 연 매출 12억을 달성했습니다.",
}];
const citationSources = [{
  url: "https://example.com/tea",
  excerpt: "제주에서 재배한 녹차입니다. 직사광선을 피하고 서늘한 곳에 보관하세요.",
}];
const inventedDraft = {
  add: [
    "프리미엄 녹차 구독 서비스를 추가하세요",
    "연 매출 12억을 강조하세요",
    "보관 방법을 본문에 보강하세요",
  ],
};

function serializedClaims(brief: { keep: string[]; reinforce: string[]; add: string[]; currentAnswers: string[] }) {
  return [...brief.keep, ...brief.reinforce, ...brief.add, ...brief.currentAnswers].join("\n");
}

describe("Improve vs New source-grounded content briefs", () => {
  it("keeps Improve and New distinct and lists keep/reinforce/add instead of replacing the page", () => {
    const source = sourceFromFixture();
    const input = { source, competitorSources, citationSources, draft: inventedDraft };
    const improve = buildContentBrief({ ...input, mode: "improve" });
    const created = buildContentBrief({ ...input, mode: "new" });

    expect(improve.mode).toBe("improve");
    expect(created.mode).toBe("new");
    expect(improve).not.toEqual(created);
    expect(improve.keep.join(" ")).toMatch(/직사광선|보관|녹차/);
    expect(improve.reinforce.length).toBeGreaterThan(0);
    expect(improve.add.length).toBeGreaterThan(0);
    expect(improve.changeScope).toEqual({ type: "partial", replaceWholePage: false });
    expect(created.keep).toEqual([]);
    expect(created.changeScope).toEqual({ type: "new-page", replaceWholePage: false });

    for (const brief of [improve, created]) {
      expect(brief.targetQuestions.length).toBeGreaterThan(0);
      expect(brief.currentAnswers.length).toBeGreaterThan(0);
      expect(Array.isArray(brief.gaps)).toBe(true);
      expect(Array.isArray(brief.internalLinks)).toBe(true);
      expect(brief.internalLinks).toEqual(source.internalLinks);
      expect(brief.sources.competitor).toEqual(competitorSources);
      expect(brief.sources.citation).toEqual(citationSources);
      expect(brief.sources.competitor).not.toEqual(brief.sources.citation);
      expect(brief).not.toHaveProperty("minWordCount");
      expect(brief).not.toHaveProperty("publishBlocked");
    }
  });

  it("omits competitor-only products, services, and numbers that are absent from the source", () => {
    const source = sourceFromFixture();
    const improve = buildContentBrief({
      mode: "improve", source, competitorSources, citationSources, draft: inventedDraft,
    });
    const claims = serializedClaims(improve);
    expect(claims).toMatch(/보관/);
    expect(claims).not.toMatch(/구독/);
    expect(claims).not.toMatch(/12억/);
    expect(claims).not.toMatch(/29,?000/);
    expect(claims).not.toMatch(/당일\s*배송/);
    const publishable = JSON.stringify({
      targetQuestions: improve.targetQuestions,
      currentAnswers: improve.currentAnswers,
      gaps: improve.gaps,
      keep: improve.keep,
      reinforce: improve.reinforce,
      add: improve.add,
    });
    expect(publishable).not.toMatch(/구독 서비스|12억|29,000/);
    expect(improve.sources.competitor[0].excerpt).toMatch(/구독 서비스/);
  });

  it("does not treat citation-only numbers as page-source evidence", () => {
    const source = sourceFromFixture();
    const brief = buildContentBrief({
      mode: "improve",
      source,
      citationSources: [{ url: "https://lab.example/tea", excerpt: "카페인 함량 35mg, 연 매출 12억" }],
      draft: { add: ["카페인 35mg을 표기하세요", "보관 방법을 본문에 보강하세요"] },
    });
    expect(brief.add.join("\n")).toMatch(/보관/);
    expect(brief.add.join("\n")).not.toMatch(/35|12억/);
  });
});

describe("persisted content briefs", () => {
  let directory: string;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "geo-content-brief-"));
    vi.stubEnv("GEO_DB_PATH", path.join(directory, "test.db"));
    requireActiveProject();
  });
  afterEach(() => {
    closeDatabase(path.join(directory, "test.db"));
    fs.rmSync(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("stores the grounded Improve brief through contents without invented claims", () => {
    const source = sourceFromFixture();
    const result = persistContentBrief({
      mode: "improve", source, competitorSources, citationSources, draft: inventedDraft,
    });
    expect(result.content.tool).toBe("brief");
    expect(result.content.output).toMatchObject({
      mode: "improve",
      changeScope: { type: "partial", replaceWholePage: false },
    });
    const listed = listContents({ tool: "brief", limit: 10 });
    expect(listed.items.some((item) => item.id === result.content.id)).toBe(true);
    const claims = serializedClaims(result.brief);
    expect(claims).not.toMatch(/구독|12억|29,?000/);
    expect(result.brief.keep.length).toBeGreaterThan(0);
  });

  it("runs the Studio brief path without an LLM key and still drops invented claims", async () => {
    const source = sourceFromFixture();
    const result = await runStudioTool({
      action: "brief",
      briefMode: "improve",
      title: source.title,
      text: source.bodyText,
      url: source.url,
      competitorSources,
      citationSources,
    });
    expect(result.action).toBe("brief");
    expect(result.output).toMatchObject({ mode: "improve", changeScope: { replaceWholePage: false } });
    expect(JSON.stringify({ add: result.output.add, keep: result.output.keep })).not.toMatch(/구독|12억|29,?000/);
  });
});
