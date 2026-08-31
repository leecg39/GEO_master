import { describe, expect, it } from "vitest";
import { generateLlmsTxt, validateLlmsTxt } from "@/lib/llms-txt";

const input = {
  brandName: "GEO Master",
  summary: "GEO Master는 마케터가 생성형 AI 노출을 진단하고 개선하도록 돕는 공식 워크스페이스입니다.",
  website: "https://example.com",
  details: "한국어 문서를 우선하며 각 링크 설명을 기준으로 문서를 선택하세요.",
  sections: [{ heading: "핵심 문서", links: [
    { title: "시작 가이드", url: "https://example.com/start", description: "설치와 첫 진단 절차" },
    { title: "API", url: "https://example.com/api", description: "서버 API 계약" },
  ] }],
};

describe("llms.txt workflow", () => {
  it("generates the proposed H1, blockquote, H2 and annotated-link structure", () => {
    const result = generateLlmsTxt(input);
    expect(result.document).toContain("# GEO Master\n\n> GEO Master는");
    expect(result.document).toContain("## 핵심 문서\n\n- [시작 가이드](https://example.com/start): 설치와 첫 진단 절차");
    expect(result.validation.valid).toBe(true);
    expect(result.validation.stats).toMatchObject({ sections: 1, links: 2, errors: 0, warnings: 0 });
  });

  it("rejects a missing H1 and relative or malformed list links", () => {
    const validation = validateLlmsTxt("> 충분히 긴 사이트 설명입니다.\n\n## Docs\n\n- [문서](/relative): 설명");
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["H1_COUNT", "H1_FIRST", "LINK_URL"]));
  });

  it("warns for duplicate URLs and reports external links as information", () => {
    const text = "# Site\n\n> 이 사이트는 충분히 긴 공식 설명과 문서 선택 기준을 제공합니다.\n\n## Docs\n\n- [A](https://other.example/a): 설명\n- [A2](https://other.example/a): 다른 설명\n";
    const validation = validateLlmsTxt(text, "https://example.com");
    expect(validation.valid).toBe(true);
    expect(validation.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["DUPLICATE_LINK", "EXTERNAL_LINKS"]));
  });

  it("blocks credentials embedded in generated resource URLs", () => {
    expect(() => generateLlmsTxt({ ...input, sections: [{ heading: "Docs", links: [{ title: "비밀", url: "https://user:pass@example.com/private", description: "설명" }] }] })).toThrow(/자격증명/);
  });

  it("blocks credential URLs hidden in optional details", () => {
    expect(() => generateLlmsTxt({ ...input, details: "참고: https://user:pass@example.com/private" })).toThrow(/자격증명/);
  });

  it("neutralizes heading and list markers injected through details", () => {
    const result = generateLlmsTxt({ ...input, details: "# Injected H1\n\n## Fake\n- [x](https://example.com/x)" });
    expect(result.document).toContain("\\# Injected H1 ## Fake - [x](https://example.com/x)");
    expect(result.validation.valid).toBe(true);
    expect(result.validation.stats.sections).toBe(1);
  });

  it("round-trips escaped closing brackets in link titles", () => {
    const result = generateLlmsTxt({ ...input, sections: [{ heading: "Docs", links: [{ title: "a]b", url: "https://example.com/x", description: "설명" }] }] });
    expect(result.document).toContain("[a\\]b]");
    expect(result.validation.valid).toBe(true);
    expect(result.validation.stats.links).toBe(1);
  });
});
