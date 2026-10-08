import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { load } from "cheerio";
import sharp from "sharp";

const origin = process.env.GEO_PREVIEW_ORIGIN ?? "https://geo.soverin.cloud";
const authFile = process.env.GEO_PREVIEW_AUTH_FILE ?? ".gstack/deploy/geo.soverin.cloud/access.txt";
const evidenceDirectory = "deploy/hostinger/evidence/social-preview";
const checks = [];

function assert(condition, label) {
  checks.push({ label, passed: Boolean(condition) });
  if (!condition) throw new Error(label);
}

async function request(route, status, options = {}) {
  const response = await fetch(origin + route, {
    ...options,
    redirect: "manual",
    signal: AbortSignal.timeout(25000),
  });
  assert(response.status === status, `${options.method ?? "GET"} ${route}: ${response.status} (expected ${status})`);
  return response;
}

const preview = await request("/", 200);
assert(preview.headers.get("content-type")?.includes("text/html"), "Public root is HTML");
assert(preview.headers.get("cache-control")?.includes("no-store"), "Public root is not cached across auth states");
assert(!preview.headers.has("www-authenticate"), "Public root does not request a crawler login");
const publicHtml = await preview.text();
const $ = load(publicHtml);
const meta = (key) => $(`head meta[property="${key}"], head meta[name="${key}"]`).attr("content");
assert(meta("og:title")?.startsWith("GEO Master"), "OG title is in the initial HTML head");
assert(meta("og:description")?.includes("응답 점유율"), "OG description is present");
assert(meta("og:url") === origin + "/", "Canonical OG URL is the public root");
assert(meta("twitter:card") === "summary_large_image", "Twitter large image card is configured");
assert($("script").length === 0, "Public preview has no application scripts or hydration payload");
assert($('a[href="/login"]').length > 0, "Public landing links to the login form");
assert(publicHtml.includes("무료 · GEO 측정") && publicHtml.includes("SEMForge Pro"), "Public landing separates the free GEO and paid SEMForge plans");
await request("/", 200, { method: "HEAD" });
await request("/?v=20261007", 200);
await request("/link-preview.html", 200);

for (const userAgent of ["kakaotalk-scrap/1.0", "facebookexternalhit/1.1", "Twitterbot/1.0", "Slackbot-LinkExpanding 1.0", "TelegramBot", "Discordbot"]) {
  const response = await request("/", 200, { headers: { "user-agent": userAgent } });
  assert(await response.text() === publicHtml, `${userAgent} receives only the same public preview`);
}

for (const [key, width, height] of [["og:image", 1200, 630], ["twitter:image", 1280, 720]]) {
  const url = new URL(meta(key));
  assert(url.origin === origin && url.protocol === "https:", `${key} has an absolute HTTPS URL`);
  const response = await request(url.pathname, 200);
  assert(response.headers.get("content-type")?.includes("image/jpeg"), `${key} is served as JPEG`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const info = await sharp(bytes).metadata();
  assert(info.width === width && info.height === height, `${key} is ${width}×${height}`);
  assert(bytes.length < 5 * 1024 * 1024, `${key} is below 5 MiB`);
  assert(bytes.equals(fs.readFileSync(path.join("public", url.pathname))), `${key} matches the approved local artwork`);
  await request(url.pathname, 200, { method: "HEAD" });
}

for (const route of ["/?login=1", "/audit", "/settings", "/workspace", "/api/dashboard", "/api/projects", "/api/settings", "/api/workspace", "/api/semforge/subscription", "/og/unlisted.jpg"]) {
  await request(route, route.startsWith("/api/") ? 401 : 303);
}
for (const route of ["/", "/link-preview.html", "/og/geo-master-20261007.jpg", "/api/projects"]) {
  await request(route, 401, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
}
await request("/", 303, { headers: { authorization: "Basic " + Buffer.from("geo-admin:incorrect").toString("base64") } });
const forged = { "x-geo-auth-user": "geo-admin", "x-geo-auth-secret": "forged", "x-original-url": "/api/settings", "x-forwarded-uri": "/api/settings" };
assert(await (await request("/", 200, { headers: forged })).text() === publicHtml, "Forged identity headers cannot turn the public preview into private data");
await request("/api/settings", 401, { headers: forged });

let authenticatedChecks = false;
if (fs.existsSync(authFile)) {
  const account = Object.fromEntries(fs.readFileSync(authFile, "utf8").trim().split("\n").map((line) => {
    const separator = line.indexOf(": ");
    return [line.slice(0, separator), line.slice(separator + 2)];
  }));
  const headers = { authorization: "Basic " + Buffer.from(account.Username + ":" + account.Password).toString("base64") };
  const dashboard = await (await request("/", 200, { headers })).text();
  assert(/GEO intelligence control room/i.test(dashboard), "Authenticated root still renders the dashboard");
  const authMeta = load(dashboard);
  assert(authMeta('meta[property="og:image"]').attr("content") === meta("og:image"), "Authenticated app has the same OG metadata");
  await request("/?login=1", 200, { headers });
  for (const route of ["/audit", "/settings", "/api/dashboard", "/api/semforge/subscription"]) await request(route, 200, { headers });
  await request("/api/projects", 403, { method: "POST", headers: { ...headers, origin: "https://example.org", "content-type": "application/json" }, body: "{}" });
  const projects = await (await request("/api/projects", 200, { headers })).text();
  const hashFile = ".gstack/deploy/geo.soverin.cloud/social-preview-projects-before.sha256";
  if (process.env.GEO_VERIFY_PROJECT_SNAPSHOT === "1" && fs.existsSync(hashFile)) assert(createHash("sha256").update(projects).digest("hex") === fs.readFileSync(hashFile, "utf8").trim(), "Project data matches the pre-deployment snapshot");
  authenticatedChecks = true;
}

fs.mkdirSync(evidenceDirectory, { recursive: true });
fs.writeFileSync(path.join(evidenceDirectory, "checks.json"), JSON.stringify({ origin, checkedAt: new Date().toISOString(), authenticatedChecks, checks }, null, 2) + "\n");
console.log(JSON.stringify({ passed: checks.length, authenticatedChecks, evidence: path.join(evidenceDirectory, "checks.json") }));
