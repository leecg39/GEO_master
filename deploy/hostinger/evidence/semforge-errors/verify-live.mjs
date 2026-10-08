// One-time production verification for the observed expired-plan / zero-credit incident.
// Uses the existing admin credentials without printing or saving them.
// Runs one measurement request per individual provider surface.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin = 'https://geo.soverin.cloud';
const domain = 'axbridge.soverin.cloud';
const dir = 'deploy/hostinger/evidence/semforge-errors';
const checks = [];
const reports = {};
const account = Object.fromEntries(fs.readFileSync('.gstack/deploy/geo.soverin.cloud/access.txt', 'utf8').trim().split('\n').map(line => {
  const split = line.indexOf(': ');
  return [line.slice(0, split), line.slice(split + 2)];
}));
const headers = { authorization: 'Basic ' + Buffer.from(account.Username + ':' + account.Password).toString('base64'), origin, 'content-type': 'application/json' };
async function request(route, status = 200, method = 'GET', body) {
  const response = await fetch(origin + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(45000) });
  assert.equal(response.status, status, `${method} ${route}`);
  checks.push(`${method} ${route}: ${status}`);
  return response;
}
async function json(route, status = 200, method = 'GET', body) { return (await request(route, status, method, body)).json(); }
function check(value, label) { assert.ok(value, label); checks.push(label); }
function providerReport(report, expectedSkipped) {
  check(report.collected === 0 && report.failed === 1 && report.skipped === expectedSkipped, 'one failed request; remaining keywords skipped');
  check(report.blockingError?.code === 'TALORDATA_PLAN_EXPIRED', 'actual provider account expiration classified');
  check(report.outcomes.every(item => item.errorCode === 'TALORDATA_PLAN_EXPIRED'), 'all outcomes carry the actionable cause');
}
try {
  const project = (await json('/api/projects?limit=1')).activeProject;
  check(project.id === 3 && project.domain === domain, 'original AX bridge project is active');
  for (const route of ['/semforge', '/ai-seo', '/site-audit', '/position-tracking', '/analytics/overview', '/local-business']) await request(route);
  const aiBefore = (await json(`/api/ai-seo/overview?domain=${domain}`)).overview;
  const ai = (await json('/api/ai-seo/collect', 200, 'POST', { domain })).report;
  providerReport(ai, 4);
  const aiAfter = (await json(`/api/ai-seo/overview?domain=${domain}`)).overview;
  assert.deepEqual(aiAfter.queries, aiBefore.queries);
  check(true, 'failed AI collection preserves existing query snapshots');
  reports.aiSeo = ai;

  const positionBefore = (await json('/api/position-tracking')).campaigns.find(c => c.domain === domain);
  check(Boolean(positionBefore), 'existing position campaign found');
  const ranking = (await json(`/api/position-tracking?campaignId=${positionBefore.id}`, 200, 'PATCH', {})).report;
  providerReport(ranking, 2);
  check(ranking.visibility === null, 'failed ranking report does not present a new 0% measurement');
  const positionAfter = (await json('/api/position-tracking')).campaigns.find(c => c.id === positionBefore.id);
  assert.deepEqual(positionAfter, positionBefore);
  check(true, 'position visibility and last update are preserved');
  reports.position = ranking;

  const mapBefore = (await json('/api/local-business')).overview.campaigns.find(c => c.businessName === project.brandName);
  check(Boolean(mapBefore), 'existing local campaign found');
  const map = (await json(`/api/local-business?campaignId=${mapBefore.id}`, 200, 'PATCH', {})).report;
  providerReport(map, 2);
  check(map.visibility === null, 'failed local report does not present a new 0% measurement');
  const mapAfter = (await json('/api/local-business')).overview.campaigns.find(c => c.id === mapBefore.id);
  assert.deepEqual(mapAfter, mapBefore);
  check(true, 'local visibility and last update are preserved');
  reports.local = map;

  const site = (await json('/api/site-audit')).campaigns.find(c => c.domain === domain);
  check(Boolean(site), 'existing site audit campaign found');
  const siteBefore = (await json(`/api/site-audit?id=${site.id}`)).overview;
  const firecrawl = await json(`/api/site-audit?id=${site.id}`, 503, 'PATCH', {});
  check(firecrawl.code === 'FIRECRAWL_CREDITS_EXHAUSTED', 'Firecrawl insufficient credits reported accurately');
  const siteAfter = (await json(`/api/site-audit?id=${site.id}`)).overview;
  assert.deepEqual(siteAfter.campaign, siteBefore.campaign);
  assert.deepEqual(siteAfter.briefing, siteBefore.briefing);
  check(true, 'site health, last successful run and pages are preserved');
  reports.siteAudit = firecrawl;
  await json(`/api/analytics/overview?domain=${domain}`);

  const preview = await fetch(origin + '/', { signal: AbortSignal.timeout(20000) });
  check(preview.status === 200 && (await preview.text()).includes('og/geo-master-20261007.jpg'), 'anonymous social preview remains available');
  const unauthorized = await fetch(origin + '/api/site-audit', { redirect: 'manual', signal: AbortSignal.timeout(20000) });
  check(unauthorized.status === 401, 'measurement data still requires authentication');
} finally {
  fs.writeFileSync(`${dir}/http-checks.json`, JSON.stringify({ checkedAt: new Date().toISOString(), origin, domain, checks, reports }, null, 2) + '\n');
}
console.log(JSON.stringify({ passed: checks.length, evidence: `${dir}/http-checks.json` }));
