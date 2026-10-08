import { gzipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { analyzeAccessLog, botIpsOf } from "@/lib/bot-logs/analyze";
import { classifyUserAgent } from "@/lib/bot-logs/classify";
import { parseAccessLog } from "@/lib/bot-logs/parse";
import { verifyBotIps, type DnsResolver } from "@/lib/bot-logs/verify";

const UA = {
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  gptbot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
  oaiSearch: "Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)",
  chatgptUser: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
  claudeBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  self: "GEO-Master-Audit/1.0 (+local diagnostic tool)",
  chrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
};

const line = (ip: string, time: string, request: string, status: number, ua: string) =>
  `${ip} - - [${time}] "${request}" ${status} 1234 "-" "${ua}"`;

const sample = [
  line("66.249.66.1", "08/Oct/2026:10:00:00 +0900", "GET /products/1?utm=x HTTP/1.1", 200, UA.googlebot),
  line("66.249.66.1", "08/Oct/2026:10:05:00 +0900", "GET /products/2 HTTP/1.1", 200, UA.googlebot),
  line("203.0.113.9", "08/Oct/2026:11:00:00 +0900", "GET /products/1 HTTP/1.1", 200, UA.googlebot),
  line("20.15.240.1", "08/Oct/2026:12:00:00 +0900", "GET /llms.txt HTTP/1.1", 404, UA.gptbot),
  line("20.15.240.2", "09/Oct/2026:00:30:00 +0900", "GET / HTTP/2.0", 200, UA.oaiSearch),
  line("23.98.142.1", "09/Oct/2026:01:00:00 +0900", "GET /faq HTTP/1.1", 301, UA.chatgptUser),
  line("160.79.104.1", "09/Oct/2026:02:00:00 +0900", "GET /blog HTTP/1.1", 503, UA.claudeBot),
  line("127.0.0.1", "09/Oct/2026:03:00:00 +0900", "GET / HTTP/1.1", 200, UA.self),
  line("198.51.100.4", "09/Oct/2026:04:00:00 +0900", "GET / HTTP/1.1", 200, UA.chrome),
  "garbage line that is not a log",
].join("\n");

describe("parseAccessLog", () => {
  it("parses combined log lines, strips query strings and keeps the log's own date and offset", () => {
    const parsed = parseAccessLog(Buffer.from(sample));
    expect(parsed.format).toBe("combined");
    expect(parsed.counts).toEqual({ lines: 10, parsed: 9, skipped: 1 });
    expect(parsed.entries[0]).toEqual({ ip: "66.249.66.1", date: "2026-10-08", offset: "+0900", method: "GET", path: "/products/1", status: 200, userAgent: UA.googlebot });
    expect(parsed.offsets).toEqual(["+0900"]);
  });

  it("reads gzip-compressed logs and ignores a trailing newline", () => {
    const parsed = parseAccessLog(Buffer.from(gzipSync(strToU8(`${sample}\n`))));
    expect(parsed.counts.parsed).toBe(9);
  });

  it("rejects files with no parsable lines, oversized input and gzip bombs", () => {
    expect(() => parseAccessLog(Buffer.from("hello\nworld"))).toThrow(expect.objectContaining({ code: "LOG_UNRECOGNIZED" }));
    expect(() => parseAccessLog(Buffer.alloc(0))).toThrow(expect.objectContaining({ code: "LOG_EMPTY" }));
    const bomb = Buffer.from(gzipSync(new Uint8Array(60 * 1024 * 1024)));
    expect(() => parseAccessLog(bomb)).toThrow(expect.objectContaining({ code: "LOG_TOO_LARGE" }));
  });

  it("skips impossible dates instead of storing them", () => {
    const parsed = parseAccessLog(Buffer.from([
      line("192.0.2.1", "32/Oct/2026:10:00:00 +0000", "GET / HTTP/1.1", 200, UA.gptbot),
      line("192.0.2.1", "31/Oct/2026:10:00:00 +0000", "GET / HTTP/1.1", 200, UA.gptbot),
    ].join("\n")));
    expect(parsed.counts).toEqual({ lines: 2, parsed: 1, skipped: 1 });
    expect(() => parseAccessLog(Buffer.from(line("192.0.2.1", "30/Feb/2026:10:00:00 +0000", "GET / HTTP/1.1", 200, UA.gptbot)))).toThrow(expect.objectContaining({ code: "LOG_UNRECOGNIZED" }));
  });

  it("masks token-like path segments so reset links or session ids are not stored", () => {
    const parsed = parseAccessLog(Buffer.from(line("192.0.2.1", "08/Oct/2026:10:00:00 +0000", "GET /reset/3f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c/confirm HTTP/1.1", 200, UA.gptbot)));
    expect(parsed.entries[0]?.path).toBe("/reset/:id/confirm");
    const keep = parseAccessLog(Buffer.from(line("192.0.2.1", "08/Oct/2026:10:00:00 +0000", "GET /blog/how-to-write-llms-txt HTTP/1.1", 200, UA.gptbot)));
    expect(keep.entries[0]?.path).toBe("/blog/how-to-write-llms-txt");
  });

  it("handles escaped quotes in the user agent", () => {
    const parsed = parseAccessLog(Buffer.from(line("192.0.2.1", "08/Oct/2026:10:00:00 +0000", "GET / HTTP/1.1", 200, 'Bot \\"quoted\\" GPTBot/1.0')));
    expect(parsed.entries[0]?.userAgent).toBe('Bot "quoted" GPTBot/1.0');
  });

  it.each([
    "AbCdEf0123456789-long_secret",
    "abcdefghijklmnopqrstuvwxyz-012345",
    "AbCdEf0123456789.long.secret",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature",
    "AbCdEf0123456789~long_secret",
    "AbCdEf0123456789+long_secret==",
    "%41bCdEf0123456789%2Dlong_secret",
    "%2541bCdEf0123456789%252Dlong_secret",
    "%252541bCdEf0123456789%25252Dlong_secret",
    "%25252541bCdEf0123456789-long_secret",
    "AbCdEf0123%2F456789-long_secret",
    "AbCdEf0123%3F456789-long_secret",
    "AbCdEf0123%23456789-long_secret",
    "AbCdEf0123%5C456789-long_secret",
    "AbCdEf0123456789%ZZlong_secret",
    "AbCdEf0123456789%E0%A4long_secret",
    "12345678-abcd-1234-abcd-1234567890ab",
  ])("masks URL-safe and encoded synthetic secrets (%#)", (token) => {
    for (const prefix of ["", "https://example.test"]) {
      const parsed = parseAccessLog(Buffer.from(line("192.0.2.1", "08/Oct/2026:10:00:00 +0000", `GET ${prefix}/reset/${token}/confirm?private=value HTTP/1.1`, 200, UA.gptbot)));
      expect(parsed.entries[0]?.path).toBe("/reset/:id/confirm");
    }
  });

  it.each([
    "/blog/how-to-write-llms-txt",
    "/blog/a-decade-of-feedback-and-decaf-coffee",
    "/assets/site.css",
    "/llms.txt",
    "/products/123",
    "/%ED%95%9C%EA%B8%80",
    "/blog/how%2Dto%2Dwrite%2Dllms%2Dtxt",
  ])("preserves ordinary public paths (%#)", (target) => {
    const parsed = parseAccessLog(Buffer.from(line("192.0.2.1", "08/Oct/2026:10:00:00 +0000", `GET ${target} HTTP/1.1`, 200, UA.gptbot)));
    expect(parsed.entries[0]?.path).toBe(target);
  });
});

describe("classifyUserAgent", () => {
  it("maps AI crawler user agents to their operator and purpose", () => {
    expect(classifyUserAgent(UA.googlebot)).toMatchObject({ kind: "ai_bot", bot: { token: "Googlebot", operator: "Google", purpose: "search" } });
    expect(classifyUserAgent(UA.gptbot)).toMatchObject({ kind: "ai_bot", bot: { token: "GPTBot", purpose: "training" } });
    expect(classifyUserAgent(UA.oaiSearch)).toMatchObject({ kind: "ai_bot", bot: { token: "OAI-SearchBot", purpose: "search" } });
    expect(classifyUserAgent(UA.chatgptUser)).toMatchObject({ kind: "ai_bot", bot: { token: "ChatGPT-User", purpose: "user" } });
    expect(classifyUserAgent("Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)")).toMatchObject({ kind: "ai_bot", bot: { token: "Bingbot" } });
  });

  it("separates GEO Master's own crawler and ordinary browsers", () => {
    expect(classifyUserAgent(UA.self)).toEqual({ kind: "self" });
    expect(classifyUserAgent(UA.chrome)).toEqual({ kind: "other" });
    expect(classifyUserAgent("")).toEqual({ kind: "other" });
  });

  it("never treats Google-Extended as a user agent (it is a robots.txt control token only)", () => {
    expect(classifyUserAgent("Google-Extended")).toEqual({ kind: "other" });
  });
});

function fakeResolver(table: { reverse: Record<string, string[]>; forward: Record<string, string[]> }): DnsResolver {
  return {
    reverse: async (ip) => { const hosts = table.reverse[ip]; if (!hosts) throw new Error("ENOTFOUND"); return hosts; },
    lookup: async (host) => table.forward[host] ?? [],
  };
}

describe("verifyBotIps", () => {
  it("confirms Googlebot only when reverse and forward DNS agree, and flags mismatches", async () => {
    const resolver = fakeResolver({
      reverse: { "66.249.66.1": ["crawl-66-249-66-1.googlebot.com"], "203.0.113.9": ["fake.example.com"] },
      forward: { "crawl-66-249-66-1.googlebot.com": ["66.249.66.1"] },
    });
    const result = await verifyBotIps(new Map([["Googlebot", ["66.249.66.1", "203.0.113.9"]]]), { resolver });
    expect(result.get("Googlebot|66.249.66.1")).toBe("verified");
    expect(result.get("Googlebot|203.0.113.9")).toBe("failed");
  });

  it("does not verify operators without a documented DNS method and caps lookups", async () => {
    let calls = 0;
    const resolver: DnsResolver = { reverse: async () => { calls += 1; return ["x.googlebot.com"]; }, lookup: async () => [] };
    const ips = Array.from({ length: 30 }, (_, i) => `192.0.2.${i}`);
    const result = await verifyBotIps(new Map([["GPTBot", ["20.15.240.1"]], ["Googlebot", ips]]), { resolver, maxIpsPerBot: 5 });
    expect(result.get("GPTBot|20.15.240.1")).toBe("unchecked");
    expect(calls).toBe(5);
    expect(result.get("Googlebot|192.0.2.29")).toBe("unchecked");
  });

  it("treats DNS errors and timeouts as unchecked, never as verified", async () => {
    const resolver: DnsResolver = { reverse: () => new Promise(() => {}), lookup: async () => [] };
    const result = await verifyBotIps(new Map([["Bingbot", ["40.77.167.1"]]]), { resolver, timeoutMs: 20 });
    expect(result.get("Bingbot|40.77.167.1")).toBe("unchecked");
  });
});

describe("analyzeAccessLog", () => {
  it("aggregates AI bot hits by day, bot and status class without keeping IPs or query strings", () => {
    const parsed = parseAccessLog(Buffer.from(sample));
    const verification = new Map([["Googlebot|66.249.66.1", "verified" as const], ["Googlebot|203.0.113.9", "failed" as const]]);
    const analysis = analyzeAccessLog(parsed, verification);
    expect(analysis.period).toEqual({ start: "2026-10-08", end: "2026-10-09" });
    expect(analysis.totals).toEqual({ lines: 10, parsed: 9, skipped: 1, aiBot: 7, self: 1, other: 1 });
    expect(analysis.hits).toContainEqual({ date: "2026-10-08", botToken: "Googlebot", operator: "Google", purpose: "search", statusClass: "2xx", hits: 3, verifiedHits: 2, failedHits: 1 });
    expect(analysis.hits).toContainEqual({ date: "2026-10-08", botToken: "GPTBot", operator: "OpenAI", purpose: "training", statusClass: "4xx", hits: 1, verifiedHits: 0, failedHits: 0 });
    expect(analysis.hits).toContainEqual(expect.objectContaining({ date: "2026-10-09", botToken: "ClaudeBot", statusClass: "5xx", hits: 1 }));
    expect(analysis.paths).toContainEqual({ botToken: "Googlebot", path: "/products/1", hits: 2 });
    expect(JSON.stringify(analysis)).not.toMatch(/66\.249|203\.0\.113|utm=/);
  });

  it("collects unique IPs per bot for verification", () => {
    expect(botIpsOf(parseAccessLog(Buffer.from(sample))).get("Googlebot")).toEqual(["66.249.66.1", "203.0.113.9"]);
  });

  it("keeps only the top paths per bot", () => {
    const many = Array.from({ length: 40 }, (_, i) => line("192.0.2.1", "08/Oct/2026:10:00:00 +0000", `GET /p/${i} HTTP/1.1`, 200, UA.gptbot)).join("\n");
    const analysis = analyzeAccessLog(parseAccessLog(Buffer.from(many)), new Map(), { topPaths: 10 });
    expect(analysis.paths.filter((item) => item.botToken === "GPTBot")).toHaveLength(10);
  });
});
