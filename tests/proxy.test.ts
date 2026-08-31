import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";

function request(headers: Record<string, string>) {
  return new NextRequest("http://127.0.0.1:3000/api/share/run", { method: "POST", headers, body: "{}" });
}

describe("API mutation proxy", () => {
  it("blocks cross-site browser requests", () => {
    const response = proxy(request({ origin: "https://evil.example", host: "127.0.0.1:3000", "content-type": "application/json", "sec-fetch-site": "cross-site" }));
    expect(response.status).toBe(403);
  });
  it("blocks simple text/plain requests that avoid CORS preflight", () => {
    const response = proxy(request({ host: "127.0.0.1:3000", "content-type": "text/plain" }));
    expect(response.status).toBe(415);
  });
  it("allows same-origin JSON and originless CLI requests", () => {
    expect(proxy(request({ origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000", "content-type": "application/json" })).status).toBe(200);
    expect(proxy(request({ host: "127.0.0.1:3000", "content-type": "application/json" })).status).toBe(200);
  });
});
