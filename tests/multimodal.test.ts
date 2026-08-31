import { describe, expect, it } from "vitest";
import { auditImagesFromHtml, multimodalRequestSchema } from "@/lib/multimodal";

describe("multimodal image audit", () => {
  it("passes descriptive alt and kebab-case filenames", () => {
    const result = auditImagesFromHtml('<main><img src="/geo-answer-share-dashboard.png" alt="GPT 응답 점유율이 2025년 20%에서 2026년 35%로 증가"></main>', "https://example.com/report");
    expect(result.summary).toMatchObject({ total: 1, missingAlt: 0, filenameIssues: 0, averageScore: 100 });
    expect(result.images[0].issues).toEqual([]);
  });

  it("flags missing alt and generic filenames", () => {
    const result = auditImagesFromHtml('<img src="/IMG_1234.jpg">', "https://example.com");
    expect(result.images[0].issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["ALT_MISSING", "FILENAME"]));
  });

  it("requires chart numbers and a companion text version", () => {
    const bad = auditImagesFromHtml('<figure><img src="/monthly-share-chart.png" alt="월별 점유율 차트"></figure>', "https://example.com");
    expect(bad.images[0].issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["CHART_DATA", "CHART_TEXT"]));
    const good = auditImagesFromHtml('<figure><img src="/monthly-share-chart.png" alt="응답 점유율이 20%에서 35%로 상승"><figcaption>2026년 8월 기준 35%, 전년 대비 15%p 상승</figcaption></figure>', "https://example.com");
    expect(good.images[0].issues.map((issue) => issue.code)).not.toEqual(expect.arrayContaining(["CHART_DATA", "CHART_TEXT"]));
  });

  it("accepts explicit empty alt for decorative images", () => {
    const result = auditImagesFromHtml('<img src="/section-divider-pattern.png" alt="">', "https://example.com");
    expect(result.images[0].decorative).toBe(true);
    expect(result.images[0].issues.map((issue) => issue.code)).not.toContain("ALT_MISSING");
  });

  it("reads picture srcset and catches unnamed image-only links", () => {
    const result = auditImagesFromHtml('<a href="/pricing"><picture><source srcset="/geo-pricing-overview.webp 1x, /geo-pricing-overview@2x.webp 2x"><img alt=""></picture></a>', "https://example.com");
    expect(result.images[0].src).toBe("/geo-pricing-overview.webp");
    expect(result.images[0].issues.map((issue) => issue.code)).toContain("LINK_ALT_MISSING");
    expect(result.images[0].issues.map((issue) => issue.code)).not.toContain("SOURCE_MISSING");
  });

  it("caps hostile media counts and reports truncation", () => {
    const html = `${'<img src="/descriptive-image-name.webp" alt="구체적인 정보 설명">'.repeat(205)}${'<video title="설명"></video>'.repeat(105)}`;
    const result = auditImagesFromHtml(html, "https://example.com");
    expect(result.images).toHaveLength(200);
    expect(result.videos).toHaveLength(100);
    expect(result.summary).toMatchObject({ discoveredImages: 205, truncatedImages: 5, discoveredVideos: 105, truncatedVideos: 5 });
  });

  it("does not mistake deceptive iframe hosts for supported video embeds", () => {
    const result = auditImagesFromHtml('<iframe src="https://youtube.com.evil.example/embed/abc" title="가짜"></iframe>', "https://example.com");
    expect(result.videos).toEqual([]);
  });

  it("audits native video caption, chapter, and transcript signals", () => {
    const bad = auditImagesFromHtml('<video src="/launch.mp4"></video>', "https://example.com");
    expect(bad.videos[0].issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["VIDEO_TITLE", "VIDEO_CAPTIONS", "VIDEO_CHAPTERS", "VIDEO_TRANSCRIPT"]));
    const good = auditImagesFromHtml('<figure><video src="/launch.mp4" title="GEO 연구 결과 설명"><track kind="captions" srclang="ko" src="/ko.vtt"><track kind="chapters" src="/chapters.vtt"></video><a href="/launch-transcript">대본 보기</a></figure>', "https://example.com");
    expect(good.summary).toMatchObject({ videos: 1, videosWithoutCaptions: 0, videosWithoutChapters: 0 });
    expect(good.videos[0].issues).toEqual([]);
  });

  it("marks external video embeds for manual caption verification", () => {
    const result = auditImagesFromHtml('<figure><iframe src="https://www.youtube.com/embed/abc" title="GEO 강의"></iframe><div class="transcript">강의 대본</div></figure>', "https://example.com");
    expect(result.videos[0]).toMatchObject({ kind: "embed", hasTranscript: true });
    expect(result.videos[0].issues.map((issue) => issue.code)).toEqual(["EMBED_CAPTIONS"]);
  });

  it("deduplicates URLs and enforces the ten-page limit", () => {
    expect(multimodalRequestSchema.parse({ urls: ["https://example.com", "https://example.com"] }).urls).toHaveLength(1);
    expect(() => multimodalRequestSchema.parse({ urls: Array.from({ length: 11 }, (_, index) => `https://example.com/${index}`) })).toThrow();
  });
});
