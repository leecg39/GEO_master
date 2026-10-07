import fs from 'node:fs/promises';
const [pagesPath,formsPath]=process.argv.slice(2);
const pages=JSON.parse(await fs.readFile(pagesPath,'utf8'));
const forms=JSON.parse(await fs.readFile(formsPath,'utf8'));
const weights=JSON.parse(await fs.readFile(new URL('../outer/metric_weights.json',import.meta.url),'utf8'));
const rate=a=>100*a.filter(Boolean).length/a.length;
const scores={error:pages.reduce((s,r)=>s+Math.max(0,100-20*r.logs.length),0)/pages.length,dom:rate(pages.flatMap(r=>Object.values(r.domChecks))),form:rate(forms.map(r=>r.pass)),visual:rate(pages.flatMap(r=>Object.values(r.visualChecks)))};
console.log(JSON.stringify({pageConfigurations:pages.length,interactionChecks:forms.length,scores,score:Object.entries(scores).reduce((s,[k,v])=>s+v*weights[k],0),failures:{logs:pages.reduce((s,r)=>s+r.logs.length,0),unnamed:pages.reduce((s,r)=>s+r.unnamed.length,0),contrastNodes:pages.reduce((s,r)=>s+(r.violations.find(v=>v.id==='color-contrast')?.nodes.length||0),0),overflow:pages.filter(r=>!r.visualChecks.overflow).map(r=>[r.route,r.config]),interactions:forms.filter(r=>!r.pass).map(r=>r.id)}},null,2));
