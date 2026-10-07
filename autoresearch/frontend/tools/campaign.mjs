import fs from 'node:fs/promises';
import { prepare, scan, configs, routes } from '../eval/browser.mjs';

// Supplementary stable-state audit; it does not replace or alter the frozen score.
export async function campaign(page, outputDirectory) {
  await prepare(page);
  const raw = [], stable = [];
  for (const config of configs) for (const route of routes) {
    const row = await scan(page, route, config);
    raw.push(row);
    await fs.writeFile(`${outputDirectory}/final-pages.json`, JSON.stringify(raw, null, 2) + '\n');
    await page.waitForFunction(() => document.getAnimations().filter(a => a instanceof CSSTransition && a.playState === 'running').length === 0 && !document.querySelector('main .animate-spin'));
    const state = await page.evaluate(async () => {
      const result = await window.axe.run({include:[['main'],['aside[data-theme-surface]'],['header[data-theme-surface]']]}, {runOnly:{type:'tag', values:['wcag2a','wcag2aa','wcag21aa']}});
      return {width:innerWidth,docWidth:document.documentElement.scrollWidth,violations:result.violations.map(v => ({id:v.id,nodes:v.nodes.map(n => ({target:n.target,html:n.html,summary:n.failureSummary}))}))};
    });
    stable.push({route,config:config.name,...state});
    await fs.writeFile(`${outputDirectory}/final-stable-audit.json`, JSON.stringify(stable, null, 2) + '\n');
    console.log(JSON.stringify({route,config:config.name,raw:row.violations.map(v=>[v.id,v.nodes.length]),stable:state.violations.map(v=>[v.id,v.nodes.length])}));
  }
}
