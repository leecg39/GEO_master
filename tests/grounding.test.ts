import { describe, expect, it } from "vitest";
import { parseAnthropicGrounding, parseGeminiGrounding, parseOpenAiGrounding } from "@/lib/grounding";

describe("parseOpenAiGrounding", () => {
  it("collects url_citation annotations and detects web_search_call", () => {
    const parsed = parseOpenAiGrounding({
      model: "gpt-test-2026",
      output_text: "브랜드A를 추천합니다.",
      output: [
        { type: "web_search_call" },
        {
          type: "message",
          content: [{
            type: "output_text",
            annotations: [
              { type: "url_citation", url: "https://www.example.com/a?utm_source=x", title: "A" },
              { type: "url_citation", url: "https://example.com/a", title: "A again" },
              { type: "file_citation" },
            ],
          }],
        },
      ],
    });
    expect(parsed).toEqual({
      text: "브랜드A를 추천합니다.",
      returnedModel: "gpt-test-2026",
      searchPerformed: true,
      citations: [{ url: "https://example.com/a", domain: "example.com", title: "A", kind: "cited" }],
    });
  });

  it("reports no search when the model answered without the tool", () => {
    expect(parseOpenAiGrounding({ output_text: "답변", output: [] })).toMatchObject({ searchPerformed: false, citations: [] });
  });
});

describe("parseAnthropicGrounding", () => {
  it("separates cited locations from searched results and keeps cited precedence", () => {
    const parsed = parseAnthropicGrounding({
      model: "claude-test",
      content: [
        { type: "server_tool_use", name: "web_search" },
        { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://news.example.org/1", title: "N" }, { type: "web_search_result", url: "https://b.example.com", title: "B" }] },
        { type: "text", text: "첫 문장.", citations: [{ type: "web_search_result_location", url: "https://b.example.com", title: "B" }] },
        { type: "text", text: "둘째 문장.", citations: null },
      ],
    });
    expect(parsed.text).toBe("첫 문장.둘째 문장.");
    expect(parsed.searchPerformed).toBe(true);
    expect(parsed.citations).toEqual([
      { url: "https://b.example.com", domain: "b.example.com", title: "B", kind: "cited" },
      { url: "https://news.example.org/1", domain: "news.example.org", title: "N", kind: "searched" },
    ]);
  });

  it("ignores search error payloads", () => {
    const parsed = parseAnthropicGrounding({ content: [{ type: "web_search_tool_result", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } }, { type: "text", text: "답" }] });
    expect(parsed.citations).toEqual([]);
  });
});

describe("parseGeminiGrounding", () => {
  it("uses the title as domain for Google grounding redirect links", () => {
    const parsed = parseGeminiGrounding({
      text: "답변",
      modelVersion: "gemini-test",
      candidates: [{
        groundingMetadata: {
          webSearchQueries: ["질문"],
          groundingChunks: [
            { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "brand.co.kr" } },
            { web: { uri: "https://direct.example.com/p", title: "Direct" } },
            { retrievedContext: {} },
          ],
        },
      }],
    });
    expect(parsed).toEqual({
      text: "답변",
      returnedModel: "gemini-test",
      searchPerformed: true,
      citations: [
        { url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", domain: "brand.co.kr", title: "brand.co.kr", kind: "cited" },
        { url: "https://direct.example.com/p", domain: "direct.example.com", title: "Direct", kind: "cited" },
      ],
    });
  });

  it("drops redirect links whose title is not a domain", () => {
    const parsed = parseGeminiGrounding({ text: "답", candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/x", title: "제목만" } }] } }] });
    expect(parsed.citations).toEqual([]);
    expect(parsed.searchPerformed).toBe(true);
  });
});
