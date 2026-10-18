process.env.FRONTEND_BASE_URL = "http://127.0.0.1:3002";
const { prepare, scan, configs } = await import("/Users/user01/Desktop/GEO_master/autoresearch/frontend/eval/browser.mjs");
const task = await taskSpace(54); const page = task.page("p1");
await prepare(page);
const out = [];
for (const [route, cfg] of globalThis.PROBE) {
  const r = await scan(page, route, configs.find(c => c.name === cfg));
  await page.waitForTimeout(1500);
  const stable = await page.evaluate(async () => (await window.axe.run({include:[['main'],['aside[data-theme-surface]'],['header[data-theme-surface]']]},{runOnly:{type:'rule',values:['color-contrast']}})).violations.flatMap(v => v.nodes.map(n => n.html.slice(0, 120) + ' :: ' + n.failureSummary.split('\n')[1]?.slice(0, 140))));
  out.push({ route, cfg, immediate: r.violations.find(v => v.id === 'color-contrast')?.nodes.length || 0, stable: stable.length, sample: stable.slice(0, 3) });
}
console.log(JSON.stringify(out, null, 1));
