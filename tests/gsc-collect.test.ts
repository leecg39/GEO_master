import { describe, expect, it } from "vitest";
import {
  classifyUpload,
  exportFileName,
  isGoogleLoginUrl,
  launchdPlist,
  lockIsStale,
  parseCollectConfig,
  performanceUrl,
  propertyMismatch,
  uploadBody,
  validateDownload,
} from "../scripts/gsc-collect/lib.mjs";

const HOME = "/Users/tester";
const property = { label: "TikTok @userv6z8w49gz5", resourceId: "sc-creator-profile:tiktok.com/user/userv6z8w49gz5" };

describe("parseCollectConfig", () => {
  it("applies safe defaults and expands ~ paths outside the repository", () => {
    const config = parseCollectConfig({ properties: [property] }, { homeDir: HOME });
    expect(config).toMatchObject({
      appUrl: "http://127.0.0.1:3000",
      profileDir: `${HOME}/.geo-master/gsc-chrome-profile`,
      outDir: `${HOME}/.geo-master/gsc-exports`,
      schedule: { hour: 9, minute: 0 },
      headless: true,
      properties: [property],
    });
    expect(parseCollectConfig({ headless: false, properties: [property] }, { homeDir: HOME }).headless).toBe(false);
  });

  it("rejects empty or duplicate properties and malformed resource ids", () => {
    expect(() => parseCollectConfig({ properties: [] }, { homeDir: HOME })).toThrow();
    expect(() => parseCollectConfig({ properties: [property, { ...property }] }, { homeDir: HOME })).toThrow(/중복/);
    expect(() => parseCollectConfig({ properties: [{ label: "x", resourceId: "javascript:alert(1)" }] }, { homeDir: HOME })).toThrow();
    expect(() => parseCollectConfig({ properties: [{ label: "", resourceId: property.resourceId }] }, { homeDir: HOME })).toThrow();
  });

  it("only uploads to a loopback app unless a remote app is explicitly allowed", () => {
    expect(() => parseCollectConfig({ appUrl: "https://geo.example.com", properties: [property] }, { homeDir: HOME })).toThrow(/로컬/);
    expect(parseCollectConfig({ appUrl: "https://geo.example.com", allowRemoteApp: true, properties: [property] }, { homeDir: HOME }).appUrl).toBe("https://geo.example.com");
    expect(() => parseCollectConfig({ appUrl: "http://user:pw@127.0.0.1:3000", properties: [property] }, { homeDir: HOME })).toThrow();
    expect(() => parseCollectConfig({ appUrl: "file:///etc/passwd", properties: [property] }, { homeDir: HOME })).toThrow();
    expect(parseCollectConfig({ appUrl: "http://localhost:3101/", properties: [property] }, { homeDir: HOME }).appUrl).toBe("http://localhost:3101");
  });

  it("rejects unknown keys so typos do not silently fall back to defaults", () => {
    expect(() => parseCollectConfig({ propertys: [property] }, { homeDir: HOME })).toThrow();
  });
});

describe("console navigation helpers", () => {
  it("builds the performance URL with an encoded resource id", () => {
    expect(performanceUrl(property.resourceId)).toBe(
      "https://search.google.com/search-console/performance/search-analytics?resource_id=sc-creator-profile%3Atiktok.com%2Fuser%2Fuserv6z8w49gz5",
    );
    expect(performanceUrl("sc-domain:example.com", "http://127.0.0.1:4010")).toBe(
      "http://127.0.0.1:4010/search-console/performance/search-analytics?resource_id=sc-domain%3Aexample.com",
    );
  });

  it("recognises Google sign-in and the logged-out Search Console landing page", () => {
    expect(isGoogleLoginUrl("https://accounts.google.com/v3/signin/identifier?continue=x")).toBe(true);
    expect(isGoogleLoginUrl("https://search.google.com/search-console/about")).toBe(true);
    expect(isGoogleLoginUrl("https://search.google.com/search-console/performance/search-analytics?resource_id=x")).toBe(false);
    expect(isGoogleLoginUrl("http://127.0.0.1:4010/search-console/about?hl=ko")).toBe(true);
    expect(isGoogleLoginUrl("https://accounts.google.com.evil.example/x")).toBe(false);
    expect(isGoogleLoginUrl("not a url")).toBe(false);
  });

  it("detects when the console shows a different property than requested", () => {
    expect(propertyMismatch(performanceUrl(property.resourceId), property.resourceId)).toBe(false);
    expect(propertyMismatch("https://search.google.com/search-console/performance/search-analytics?resource_id=sc-domain%3Aother.com", property.resourceId)).toBe(true);
    expect(propertyMismatch("https://search.google.com/search-console", property.resourceId)).toBe(true);
  });
});

describe("downloads and uploads", () => {
  it("names files safely with a stable resource identity and run date", () => {
    const file = exportFileName("TikTok @userv6z8w49gz5", "2026-10-08", property.resourceId);
    expect(file).toMatch(/^tiktok-userv6z8w49gz5-[a-f0-9]{64}-2026-10-08\.xlsx$/);
    expect(exportFileName("../../etc/passwd", "2026-10-08", property.resourceId)).toMatch(/^etc-passwd-/);
    expect(exportFileName("인스타그램 공식", "2026-10-08", property.resourceId)).toMatch(/^인스타그램-공식-/);
    expect(exportFileName("@@@", "2026-10-08", property.resourceId)).toMatch(/^property-/);
    expect(exportFileName("IG @foo", "2026-10-08", "sc-domain:a.com"))
      .not.toBe(exportFileName("IG foo", "2026-10-08", "sc-domain:b.com"));
  });

  it("accepts only non-empty zip files within the import size limit", () => {
    expect(() => validateDownload(new Uint8Array([0x50, 0x4b, 3, 4]))).not.toThrow();
    expect(() => validateDownload(new Uint8Array())).toThrow(/비어/);
    expect(() => validateDownload(new TextEncoder().encode("<html>login</html>"))).toThrow(/xlsx/);
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big[0] = 0x50; big[1] = 0x4b;
    expect(() => validateDownload(big)).toThrow(/2MB/);
  });

  it("builds the same JSON body the import screen sends", () => {
    expect(uploadBody("a.xlsx", "IG", new Uint8Array([1, 2, 3]))).toEqual({ fileName: "a.xlsx", propertyLabel: "IG", contentBase64: "AQID" });
  });

  it("classifies import API responses without treating errors as success", () => {
    expect(classifyUpload(201, { import: { id: 7, hasData: true }, duplicate: false, warning: null })).toEqual({ status: "imported", importId: 7, hasData: true, warning: null });
    expect(classifyUpload(200, { import: { id: 7, hasData: false }, duplicate: true, warning: "w" })).toEqual({ status: "duplicate", importId: 7, hasData: false, warning: "w" });
    expect(classifyUpload(401, { error: "로그인이 필요합니다.", code: "AUTH_REQUIRED" })).toEqual({ status: "failed", error: "AUTH_REQUIRED: 로그인이 필요합니다." });
    expect(classifyUpload(200, { unexpected: true })).toEqual({ status: "failed", error: "예상하지 못한 응답 형식(HTTP 200)" });
  });
});

describe("lockIsStale", () => {
  it("treats a lock as stale only when its recorded process is gone", () => {
    const alive = (pid: number) => pid === 4242;
    expect(lockIsStale("4242", alive)).toBe(false);
    expect(lockIsStale("9999", alive)).toBe(true);
    expect(lockIsStale("", alive)).toBe(true);
    expect(lockIsStale("not-a-pid", alive)).toBe(true);
    expect(lockIsStale("-1", alive)).toBe(true);
  });
});

describe("launchdPlist", () => {
  it("renders an escaped LaunchAgent that runs the collector daily", () => {
    const plist = launchdPlist({
      label: "com.geo-master.gsc-collect", nodePath: "/usr/local/bin/node", scriptPath: "/repo/scripts/gsc-console-collect.mjs",
      configPath: "/repo/a&b.json", workingDir: "/repo", logDir: "/Users/tester/.geo-master/logs", hour: 9, minute: 5,
    });
    expect(plist).toContain("<string>com.geo-master.gsc-collect</string>");
    expect(plist).toContain("<string>/repo/a&amp;b.json</string>");
    expect(plist).toMatch(/<key>Hour<\/key>\s*<integer>9<\/integer>/);
    expect(plist).toMatch(/<key>Minute<\/key>\s*<integer>5<\/integer>/);
    expect(plist).not.toContain("RunAtLoad");
  });
});
