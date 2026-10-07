import fs from "node:fs";
import path from "node:path";

const origin = process.env.GEO_LOGIN_ORIGIN ?? "https://geo.soverin.cloud";
const output = "deploy/hostinger/evidence/login-guest/http-checks.json";
const checks = [];
function assert(value, label) {
  checks.push({ label, passed: Boolean(value) });
  if (!value) throw new Error(label);
}
async function request(route, status, options = {}) {
  const response = await fetch(origin + route, { ...options, redirect: "manual", signal: AbortSignal.timeout(25000) });
  assert(response.status === status, `${options.method ?? "GET"} ${route}: ${response.status} (expected ${status})`);
  assert(!response.headers.has("www-authenticate"), `${route}: no browser Basic Auth challenge`);
  return response;
}
function account(file) {
  return Object.fromEntries(fs.readFileSync(file, "utf8").trim().split("\n").map((line) => {
    const split = line.indexOf(": ");
    return [line.slice(0, split), line.slice(split + 2)];
  }));
}
async function login(user) {
  const response = await request("/api/auth/login", 303, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin }, body: new URLSearchParams({ username: user.Username, password: user.Password, next: "/" }) });
  const cookie = response.headers.get("set-cookie");
  assert(cookie?.startsWith("__Host-geo_session="), `${user.Username}: signed session cookie`);
  for (const attribute of ["HttpOnly", "Secure", "SameSite=lax", "Path=/"]) assert(cookie.includes(attribute), `${user.Username}: ${attribute}`);
  assert(response.headers.get("location") === "/", `${user.Username}: returns to dashboard`);
  return { cookie: cookie.split(";")[0] };
}
const admin = account(process.env.GEO_ADMIN_AUTH_FILE ?? ".gstack/deploy/geo.soverin.cloud/access.txt");
const guest = account(process.env.GEO_GUEST_AUTH_FILE ?? ".gstack/deploy/geo.soverin.cloud/guest-access.txt");
const form = await request("/login", 200);
assert((await form.text()).includes('action="/api/auth/login"'), "Public login renders a native form");
await request("/?login=1", 303);
await request("/settings", 303);
await request("/api/settings", 401);
await request("/api/settings", 401, { headers: { "x-geo-auth-user": "geo-admin", "x-geo-auth-secret": "forged" } });
await request("/api/auth/login", 403, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" }, body: "username=guest&password=wrong" });
const invalid = await request("/api/auth/login", 303, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin }, body: "username=guest&password=wrong" });
assert(invalid.headers.get("location")?.includes("error=invalid") && !invalid.headers.has("set-cookie"), "Wrong password never creates a session");

const guestHeaders = await login(guest);
const dashboard = await (await request("/", 200, { headers: guestHeaders })).text();
assert(dashboard.includes("GEO intelligence control room"), "Guest cookie opens dashboard instead of public preview");
for (const href of ["/settings", "/subscription", "/semforge", "/workspace"]) assert(!dashboard.includes(`href="${href}"`), `Guest SSR hides ${href}`);
for (const route of ["/audit", "/share", "/learn", "/api/projects", "/api/dashboard"]) await request(route, 200, { headers: guestHeaders });
const context = await (await request("/api/measurement-context", 200, { headers: guestHeaders })).json();
assert(Object.keys(context.settings).sort().join(",") === "apiKeys,brandName,category,repetitions", "Measurement context contains only required inputs");
assert(Object.values(context.settings.apiKeys).every((entry) => Object.keys(entry).join(",") === "configured"), "No key hints or credentials in measurement context");
for (const route of ["/settings", "/subscription", "/semforge", "/workspace", "/ai-seo", "/site-audit", "/position-tracking", "/analytics/overview", "/local-business", "/api/settings", "/api/workspace?download=1", "/api/workspace/backups", "/api/semforge/subscription", "/api/site-audit"]) await request(route, 403, { headers: guestHeaders });
for (const route of ["/api/settings", "/api/semforge/subscription/checkout", "/api/semforge/subscription/confirm", "/api/workspace/backups/1/restore"]) await request(route, 403, { method: route === "/api/settings" ? "PUT" : "POST", headers: { ...guestHeaders, "content-type": "application/json", origin }, body: ":invalid-json" });
await request("/api/settings", 403, { headers: { ...guestHeaders, "x-geo-auth-user": "geo-admin", "x-geo-auth-secret": "forged" } });
await request("/api/settings", 403, { headers: { authorization: "Basic " + Buffer.from(guest.Username + ":" + guest.Password).toString("base64") } });
await request("/api/projects", 403, { method: "POST", headers: { ...guestHeaders, "content-type": "application/json", origin: "https://evil.example" }, body: ":invalid-json" });
const script = dashboard.match(/<script[^>]+src="([^"]+)"/);
assert(Boolean(script), "Dashboard references compiled app scripts");
await request(script[1], 200, { headers: guestHeaders });
const adminHeaders = await login(admin);
for (const route of ["/", "/settings", "/subscription", "/semforge", "/api/settings"]) await request(route, 200, { headers: adminHeaders });
const subscription = await (await request("/api/semforge/subscription", 200, { headers: adminHeaders })).json();
assert(subscription.subscription.role === "admin" && subscription.subscription.active && subscription.subscription.accessSource === "admin", "Admin retains active SEMForge without payment");
const cleared = await request("/api/auth/logout", 303, { method: "POST", headers: { ...guestHeaders, origin } });
assert(cleared.headers.get("set-cookie")?.includes("Max-Age=0"), "Logout clears browser session");
await request("/api/projects", 401);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ origin, checkedAt: new Date().toISOString(), checks }, null, 2) + "\n");
console.log(JSON.stringify({ passed: checks.length, evidence: output }));
