import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText } from "@/lib/llm";

const options = {
  provider: "hyperclova" as const,
  apiKey: "nv-test-secret",
  model: "HCX-DASH-002",
  system: "균형 있게 답하세요.",
  prompt: "국내 GEO 도구를 추천해 주세요.",
};

afterEach(() => vi.unstubAllGlobals());

describe("HyperCLOVA X adapter", () => {
  it("uses the official v3 endpoint and Bearer API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: { code: "20000", message: "OK" },
      result: { message: { role: "assistant", content: "  추천 결과입니다.  " } },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateText({ ...options, maxTokens: 9_999 })).resolves.toBe("추천 결과입니다.");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://clovastudio.stream.ntruss.com/v3/chat-completions/HCX-DASH-002");
    expect(request.headers).toMatchObject({ authorization: "Bearer nv-test-secret", "content-type": "application/json" });
    expect(request.headers).not.toHaveProperty("accept");
    expect(JSON.parse(String(request.body))).toMatchObject({
      messages: [
        { role: "system", content: options.system },
        { role: "user", content: options.prompt },
      ],
      maxTokens: 4096,
      topP: 0.8,
      topK: 0,
      repetitionPenalty: 1.1,
    });
  });

  it("maps authentication failures without exposing response bodies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"secret":"do-not-leak"}', { status: 401 })));
    await expect(generateText(options)).rejects.toMatchObject({ status: 401, code: "LLM_AUTH_FAILED", message: "HyperCLOVA X API 키 인증에 실패했습니다." });
  });

  it("rejects a successful response without assistant text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: { code: "20000" }, result: {} }), { status: 200 })));
    await expect(generateText(options)).rejects.toMatchObject({ status: 502, code: "INVALID_LLM_OUTPUT" });
  });
});
