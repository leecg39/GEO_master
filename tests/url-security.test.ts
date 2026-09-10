import { describe, expect, it } from "vitest";
import { createPinnedLookup, isPrivateAddress, isSamePublicSite, normalizePublicUrl, selectPublicAddress } from "@/lib/url-security";

describe("URL security", () => {
  it.each(["127.0.0.1", "10.2.3.4", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "203.0.113.10"])("blocks %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("allows public address %s", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
  it("rejects credentials, internal hosts, non-web protocols and custom ports", () => {
    expect(() => normalizePublicUrl("http://localhost/test")).toThrow();
    expect(() => normalizePublicUrl("http://user:pass@example.com")).toThrow();
    expect(() => normalizePublicUrl("file:///etc/passwd")).toThrow();
    expect(() => normalizePublicUrl("https://example.com:8443")).toThrow();
  });
  it("normalizes a valid public URL without fragments", () => {
    expect(normalizePublicUrl("https://example.com/path?q=1#secret").toString()).toBe("https://example.com/path?q=1");
  });
  it("treats apex and www as the same public site", () => {
    expect(isSamePublicSite(new URL("https://www.uinus.co.kr/"), "https://uinus.co.kr")).toBe(true);
    expect(isSamePublicSite(new URL("https://uinus.co.kr/about"), "https://www.uinus.co.kr")).toBe(true);
    expect(isSamePublicSite(new URL("https://uinus.co.kr/"), "https://uinus.co.kr")).toBe(true);
  });
  it("does not treat other hosts or http downgrades as the same site", () => {
    expect(isSamePublicSite(new URL("https://shop.uinus.co.kr/"), "https://uinus.co.kr")).toBe(false);
    expect(isSamePublicSite(new URL("https://other.example/"), "https://uinus.co.kr")).toBe(false);
    expect(isSamePublicSite(new URL("http://uinus.co.kr/"), "https://uinus.co.kr")).toBe(false);
  });
  it("rejects a DNS answer set containing any private address", () => {
    expect(() => selectPublicAddress(["8.8.8.8", "127.0.0.1"])).toThrow(/사설 또는 예약/);
  });
  it("pins socket lookup to the already-approved address", async () => {
    const lookup = createPinnedLookup("8.8.8.8");
    const resolved = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      lookup("rebound.example", { family: 0, hints: 0 }, (error, address, family) => {
        if (error) reject(error);
        else if (typeof address !== "string" || family === undefined) reject(new Error("unexpected lookup result"));
        else resolve({ address, family });
      });
    });
    expect(resolved).toEqual({ address: "8.8.8.8", family: 4 });
    const all = await new Promise<{ address: string; family: number }[]>((resolve, reject) => {
      lookup("rebound.example", { family: 0, hints: 0, all: true }, (error, addresses) => {
        if (error) reject(error);
        else if (!Array.isArray(addresses)) reject(new Error("expected lookup address array"));
        else resolve(addresses);
      });
    });
    expect(all).toEqual([{ address: "8.8.8.8", family: 4 }]);
  });
});
