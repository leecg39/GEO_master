// Frozen design score. Usage: node score.mjs <design-pages.json>
import fs from 'node:fs/promises';
const [pagesPath] = process.argv.slice(2);
const rows = JSON.parse(await fs.readFile(pagesPath, 'utf8'));
const weights = JSON.parse(await fs.readFile(new URL('../outer/metric_weights.json', import.meta.url), 'utf8'));
const mean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 100);
const axisNames = Object.keys(weights);
const axes = Object.fromEntries(axisNames.map(axis => [axis, mean(rows.map(r => mean(Object.values(r.axes[axis]))))]));
const sub = Object.fromEntries(axisNames.map(axis => [axis, Object.fromEntries(Object.keys(rows[0].axes[axis]).concat(Object.keys(rows.find(r => r.axes.targets.mobile40 !== undefined)?.axes[axis] || {})).filter((k, i, a) => a.indexOf(k) === i).map(k => [k, +mean(rows.map(r => r.axes[axis][k]).filter(v => v !== undefined)).toFixed(2)]))]));
const score = axisNames.reduce((s, axis) => s + axes[axis] * weights[axis], 0) / axisNames.reduce((s, a) => s + weights[a], 0);
const rate = a => (100 * a.filter(Boolean).length) / a.length;
const guard = {
  error: mean(rows.map(r => Math.max(0, 100 - 20 * r.a11y.logs.length))),
  dom: rate(rows.flatMap(r => Object.values(r.a11y.domChecks))),
  visual: rate(rows.flatMap(r => Object.values(r.a11y.visualChecks))),
  contrastNodes: rows.reduce((s, r) => s + r.a11y.contrastNodes, 0),
};
const worst = rows.map(r => ({ page: `${r.route} ${r.config}`, score: +(axisNames.reduce((s, a) => s + mean(Object.values(r.axes[a])) * weights[a], 0)).toFixed(2), issues: r.samples.issues.length })).sort((a, b) => a.score - b.score).slice(0, 8);
console.log(JSON.stringify({ pageConfigurations: rows.length, score: +score.toFixed(4), axes: Object.fromEntries(Object.entries(axes).map(([k, v]) => [k, +v.toFixed(2)])), sub, guard, integrityIssues: rows.reduce((s, r) => s + r.samples.issues.length, 0), worst }, null, 2));
