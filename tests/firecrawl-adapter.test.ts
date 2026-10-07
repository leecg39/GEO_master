import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { firecrawlPost, mapSite, parseMapLinks, scrapePage } from "@/lib/integrations/firecrawl";

const request = vi.fn();

beforeEach(() => { vi.stubGlobal("fetch", request.mockReset()); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("Firecrawl Map response contract", () => {
  it("accepts v1 string links and v2 link objects", () => {
    expect(parseMapLinks({ success: true, links: ["https://example.com", "https://example.com/a"] }, 25).links)
      .toEqual(["https://example.com", "https://example.com/a"]);
    expect(parseMapLinks({ success: true, links: [{ url: "https://example.com/b", title: "B" }, { url: "https://example.com/c" }] }, 25).links)
      .toEqual(["https://example.com/b", "https://example.com/c"]);
  });

  it("drops invalid entries, removes fragments and de-duplicates equivalent URLs", () => {
    const parsed = parseMapLinks({
      links: [
        "https://example.com", "https://example.com/", "https://Example.com/about#team", "https://example.com/about/",
        "mailto:hello@example.com", { title: "no url" }, 42, "not a url", "https://example.com/p?id=1", "https://example.com/p?id=2",
      ],
    }, 25);
    expect(parsed.links).toEqual(["https://example.com", "https://Example.com/about", "https://example.com/p?id=1", "https://example.com/p?id=2"]);
    expect(parsed).toMatchObject({ invalid: 4, duplicates: 2 });
  });

  it("applies the limit after de-duplication", () => {
    expect(parseMapLinks({ links: ["https://a.com/1", "https://a.com/1#x", "https://a.com/2", "https://a.com/3"] }, 2).links)
      .toEqual(["https://a.com/1", "https://a.com/2"]);
  });

  it("rejects payloads without a link list instead of reporting an empty site", () => {
    expect(() => parseMapLinks({ success: true, data: [] }, 25)).toThrow(expect.objectContaining({ code: "FIRECRAWL_CONTRACT" }));
    expect(() => parseMapLinks("<html>", 25)).toThrow(expect.objectContaining({ code: "FIRECRAWL_CONTRACT" }));
    expect(() => parseMapLinks({ success: false, error: "bad" }, 25)).toThrow(expect.objectContaining({ code: "FIRECRAWL_ERROR" }));
  });

  it("calls the v2 map endpoint with the site URL and limit", async () => {
    request.mockResolvedValue(Response.json({ success: true, links: [{ url: "https://example.com" }] }));
    expect(await mapSite("example.com", { apiKey: "fc-test", limit: 25 })).toMatchObject({ links: ["https://example.com"] });
    const [url, init] = request.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.firecrawl.dev/v2/map");
    expect(JSON.parse(String(init.body))).toMatchObject({ url: "https://example.com", limit: 25 });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer fc-test");
  });
});

describe("Firecrawl error mapping", () => {
  const call = (signal?: AbortSignal) => firecrawlPost("/map", { url: "https://example.com" }, { apiKey: "k", timeoutMs: 1_000, signal });

  it("reports rate limits with the server's Retry-After", async () => {
    request.mockResolvedValue(Response.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "retry-after": "7" } }));
    await expect(call()).rejects.toMatchObject({ status: 429, code: "FIRECRAWL_RATE_LIMITED", details: { retryAfterSeconds: 7 } });
  });

  it("separates credits, authentication and server errors", async () => {
    request.mockResolvedValueOnce(Response.json({ error: "Payment required" }, { status: 402 }));
    await expect(call()).rejects.toMatchObject({ code: "FIRECRAWL_CREDITS_EXHAUSTED" });
    request.mockResolvedValueOnce(Response.json({ error: "Unauthorized" }, { status: 401 }));
    await expect(call()).rejects.toMatchObject({ code: "FIRECRAWL_AUTH_FAILED" });
    request.mockResolvedValueOnce(Response.json({ error: "boom" }, { status: 500 }));
    await expect(call()).rejects.toMatchObject({ code: "FIRECRAWL_ERROR" });
  });

  it("reports caller cancellation separately from timeouts", async () => {
    const controller = new AbortController();
    request.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const pending = call(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "FIRECRAWL_CANCELLED" });
    request.mockRejectedValueOnce(new DOMException("timeout", "TimeoutError"));
    await expect(call()).rejects.toMatchObject({ code: "FIRECRAWL_TIMEOUT" });
  });

  it("treats a non-JSON success body as a contract error", async () => {
    request.mockResolvedValue(new Response("<html>gateway</html>", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(call()).rejects.toMatchObject({ code: "FIRECRAWL_CONTRACT" });
  });
});

describe("Firecrawl Scrape response contract", () => {
  it("returns the page's own status, final URL and raw HTML, and forces a fresh render", async () => {
    request.mockResolvedValue(Response.json({
      success: true,
      data: {
        rawHtml: "<html><head><title>원본 제목</title></head></html>", markdown: "# 본문",
        metadata: { statusCode: 404, url: "https://example.com/final", sourceURL: "https://example.com/start", title: ["메타 제목"], contentType: "text/html" },
      },
    }));
    expect(await scrapePage("https://example.com/start", { apiKey: "k" })).toEqual({
      statusCode: 404, finalUrl: "https://example.com/final", rawHtml: "<html><head><title>원본 제목</title></head></html>",
      markdown: "# 본문", metadataTitle: "메타 제목", contentType: "text/html", cached: false,
    });
    const body = JSON.parse(String((request.mock.calls[0] as [string, RequestInit])[1].body));
    expect(request.mock.calls[0]?.[0]).toBe("https://api.firecrawl.dev/v2/scrape");
    expect(body).toMatchObject({ url: "https://example.com/start", formats: ["rawHtml", "markdown"], maxAge: 0 });
  });

  it("marks cache hits so they are not reported as a fresh render", async () => {
    request.mockResolvedValue(Response.json({ success: true, data: { metadata: { statusCode: 200, sourceURL: "https://example.com", cacheState: "hit" } } }));
    expect(await scrapePage("https://example.com", { apiKey: "k" })).toMatchObject({ cached: true, finalUrl: "https://example.com", rawHtml: null });
  });

  it("rejects responses without the page status code", async () => {
    request.mockResolvedValue(Response.json({ success: true, data: { markdown: "x", metadata: {} } }));
    await expect(scrapePage("https://example.com", { apiKey: "k" })).rejects.toMatchObject({ code: "FIRECRAWL_CONTRACT" });
  });
});
