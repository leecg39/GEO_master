import fs from 'node:fs/promises';
export const base = process.env.FRONTEND_BASE_URL || 'http://127.0.0.1:3100';
export const routes = JSON.parse(await fs.readFile(new URL('./test-routes.json', import.meta.url), 'utf8'));
export const configs = [ {name:'desktop-dark',width:1440,height:1000,theme:'dark'}, {name:'desktop-light',width:1440,height:1000,theme:'light'}, {name:'mobile',width:375,height:812,theme:'dark'}, {name:'small-mobile',width:320,height:740,theme:'dark'} ];
const axeSource = await fs.readFile(new URL('../../../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
export async function prepare(page) {
  await page.cdp('Page.addScriptToEvaluateOnNewDocument', {source:`window.__frontendLogs=[]; for(const level of ['error','warn']) { const original=console[level]; console[level]=function(...args){window.__frontendLogs.push({level,message:args.map(String).join(' ')});original.apply(console,args)} } window.addEventListener('error',e=>window.__frontendLogs.push({level:'error',message:e.message}));window.addEventListener('unhandledrejection',e=>window.__frontendLogs.push({level:'error',message:String(e.reason)}));`});
}
export async function ready(page) {
  await page.waitForSelector('main h1');
  await page.waitForFunction(() => !document.body.innerText.includes('SEMForge 확인 중') && !document.querySelector('select[aria-label="활성 프로젝트 선택"]')?.disabled);
  await page.evaluate(() => document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
}
export async function scan(page, route, config) {
  await page.cdp('Emulation.setDeviceMetricsOverride',{width:config.width,height:config.height,deviceScaleFactor:1,mobile:false});
  await page.goto(base + route);
  await ready(page);
  await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme},config.theme);
  await page.evaluate(axeSource);
  const data = await page.evaluate(async () => {
    const visible = e => !!e.getClientRects().length && getComputedStyle(e).visibility!=='hidden';
    const name = e => e.getAttribute('aria-label')?.trim() || (e.getAttribute('aria-labelledby')||'').split(' ').map(id=>document.getElementById(id)?.textContent).join('').trim() || Array.from(e.labels||[]).map(l=>l.textContent).join('').trim() || e.getAttribute('title');
    const fields = [...document.querySelectorAll('main input:not([type=hidden]),main select,main textarea')].filter(visible);
    const unnamed = fields.filter(e=>!name(e)).map(e=>({html:e.outerHTML.slice(0,400),placeholder:e.getAttribute('placeholder')}));
    const axe = await window.axe.run({include:[['main'],['aside[data-theme-surface]'],['header[data-theme-surface]']]},{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});
    const violations=axe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,html:n.html,summary:n.failureSummary}))}));
    const main = document.querySelector('main');
    const skip = [...document.querySelectorAll('a[href^="#"]')].some(e=>e.hash && document.querySelector(e.hash)===main);
    const nav = [...document.querySelectorAll('nav[aria-label="주요 메뉴"]')].find(visible);
    const current = !nav || !!nav.querySelector('a[aria-current="page"]');
    const badButtons = [...main.querySelectorAll('button')].filter(e=>visible(e)&& !name(e) && !e.textContent.trim()).map(e=>e.outerHTML.slice(0,250));
    return {title:document.title,heading:main.querySelector('h1')?.textContent,unnamed,badButtons,violations,logs:window.__frontendLogs||[],width:innerWidth,docWidth:document.documentElement.scrollWidth,
      domChecks:{main:document.querySelectorAll('main').length===1,heading:main.querySelectorAll('h1').length===1,title:!!document.title,fields:unnamed.length===0,buttons:badButtons.length===0,skip,current,axe:!violations.some(v=>v.id!=='color-contrast')},
      visualChecks:{overflow:document.documentElement.scrollWidth<=innerWidth+1,contrast:!violations.some(v=>v.id==='color-contrast')}
    };
  });
  return {route,config:config.name,...data};
}
export async function runPages(page,{onlyRoutes=routes,onlyConfigs=configs,output}) {
  await prepare(page);
  const rows=[];
  for(const config of onlyConfigs) for(const route of onlyRoutes) {
    const row=await scan(page,route,config);rows.push(row);
    await fs.writeFile(output,JSON.stringify(rows,null,2)+'\n');
    console.log(JSON.stringify({route,config:config.name,unnamed:row.unnamed.length,violations:row.violations.map(v=>[v.id,v.nodes.length]),overflow:row.docWidth-row.width,logs:row.logs.length}));
  }
  return rows;
}
