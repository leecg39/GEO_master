// Frozen design-lint metric (frontend-design RSI, 2026-10-18).
// Do NOT edit after the baseline commit. Reuses the frozen a11y scan from ../../frontend/eval as a regression guard.
import fs from 'node:fs/promises';
import { prepare, scan, configs, routes } from '../../frontend/eval/browser.mjs';

export { configs, routes };

/** Runs inside the page. Returns raw design measurements for one route × config. */
export function designAudit() {
  const SCALE = [12, 14, 16, 18, 20, 24, 30, 36, 48, 60];
  const scopes = [...document.querySelectorAll('main, aside[data-theme-surface], header[data-theme-surface]')];
  const vw = innerWidth;
  const hiddenByAncestor = e => !!e.closest('[aria-hidden="true"], [inert], svg, dialog:not([open])');
  const boxOf = e => e.getBoundingClientRect();
  const isVisible = e => {
    const r = boxOf(e);
    if (r.width <= 1 || r.height <= 1) return false;
    if (r.right <= 0 || r.left >= vw) return false; // off-canvas drawers are intentionally hidden
    const cs = getComputedStyle(e);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  const all = [...new Set(scopes.flatMap(s => [s, ...s.querySelectorAll('*')]))].filter(e => !hiddenByAncestor(e) && isVisible(e));
  const ownText = e => [...e.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
  const textEls = all.filter(e => ownText(e).length);
  const textRects = e => {
    const rects = [];
    for (const n of ownText(e)) { const r = document.createRange(); r.selectNodeContents(n); rects.push(...[...r.getClientRects()].filter(x => x.width > 0.5)); }
    return rects;
  };
  const describe = e => (e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + ' "' + (e.textContent || e.getAttribute('aria-label') || e.getAttribute('placeholder') || '').trim().slice(0, 40) + '"');
  const px = v => Math.round(parseFloat(v) * 2) / 2;
  const frac = (pass, total) => (total ? (100 * pass) / total : 100);
  const distinctScore = (n, limit) => Math.max(0, 100 - 8 * Math.max(0, n - limit));

  // --- Typography ---
  const sizes = textEls.map(e => px(getComputedStyle(e).fontSize));
  const sizeSet = [...new Set(sizes)].sort((a, b) => a - b);
  const offScale = textEls.filter((e, i) => !SCALE.includes(sizes[i]));
  const tooSmall = textEls.filter((e, i) => sizes[i] < 12);
  const longText = textEls.filter(e => ownText(e).map(n => n.textContent.trim()).join(' ').length >= 60);
  const badLeading = longText.filter(e => { const cs = getComputedStyle(e); const fs = parseFloat(cs.fontSize); const lh = parseFloat(cs.lineHeight) || fs * 1.2; const ratio = lh / fs; return ratio < 1.35 || ratio > 1.85; });
  const tooWide = longText.filter(e => { const fs = parseFloat(getComputedStyle(e).fontSize); const w = Math.max(0, ...textRects(e).map(r => r.width)); return w / fs > 48; });
  const shortLabels = textEls.filter(e => e.childNodes.length === ownText(e).length && e.textContent.trim().length <= 14 && e.textContent.trim().length >= 2);
  const wrapped = shortLabels.filter(e => { const tops = new Set(textRects(e).map(r => Math.round(r.top / 4))); return tops.size > 1; });
  const main = document.querySelector('main');
  const hs = tag => [...(main?.querySelectorAll(tag) || [])].filter(isVisible).map(e => parseFloat(getComputedStyle(e).fontSize));
  const [h1s, h2s, h3s] = [hs('h1'), hs('h2'), hs('h3')];
  const hierarchy = h1s.length > 0 && Math.min(...h1s) >= 24 && (!h2s.length || Math.max(...h2s) < Math.min(...h1s)) && (!h3s.length || !h2s.length || Math.max(...h3s) <= Math.min(...h2s));

  // --- Spacing ---
  const spacing = [];
  const offGrid = [];
  for (const e of all) {
    const cs = getComputedStyle(e);
    const vals = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft, cs.marginTop, cs.marginBottom];
    if (cs.display.includes('flex') || cs.display.includes('grid')) vals.push(cs.rowGap, cs.columnGap);
    for (const raw of vals) {
      const v = Math.round(parseFloat(raw));
      if (!(v > 0)) continue;
      spacing.push(v);
      if (v >= 8 ? v % 4 !== 0 : ![1, 2, 4, 6].includes(v)) offGrid.push(describe(e) + ' ' + v);
    }
  }
  const spacingSet = new Set(spacing);

  // --- Color ---
  const textColors = new Set(textEls.map(e => getComputedStyle(e).color));
  const bgColors = new Set();
  const borderColors = new Set();
  const transparent = c => c === 'transparent' || /rgba\(.*,\s*0\)$/.test(c) || /\/\s*0\)$/.test(c);
  for (const e of all) {
    const cs = getComputedStyle(e);
    if (!transparent(cs.backgroundColor)) bgColors.add(cs.backgroundColor);
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) if (parseFloat(cs['border' + side + 'Width']) > 0 && cs['border' + side + 'Style'] !== 'none' && !transparent(cs['border' + side + 'Color'])) borderColors.add(cs['border' + side + 'Color']);
  }

  // --- Shape ---
  const radii = new Set();
  const shadows = new Set();
  for (const e of all) {
    const cs = getComputedStyle(e);
    const surface = !transparent(cs.backgroundColor) || parseFloat(cs.borderTopWidth) > 0;
    const r = parseFloat(cs.borderTopLeftRadius);
    const box = boxOf(e);
    if (surface && r > 0 && r < Math.min(box.width, box.height) / 2 - 0.5) radii.add(Math.round(r));
    if (cs.boxShadow && cs.boxShadow !== 'none') shadows.add(cs.boxShadow);
  }

  // --- Targets ---
  const mobile = vw < 640;
  const targets = all.filter(e => e.matches('a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=switch], [role=link]'));
  const inlineLink = e => e.tagName === 'A' && getComputedStyle(e).display === 'inline' && e.parentElement && [...e.parentElement.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
  const targetBox = e => { if (e.matches('input[type=checkbox], input[type=radio]')) { const l = e.closest('label') || (e.id && document.querySelector('label[for="' + CSS.escape(e.id) + '"]')); if (l) return boxOf(l); } return boxOf(e); };
  const smallTargets = [];
  const smallMobileTargets = [];
  let mobileTargetCount = 0;
  for (const e of targets) {
    if (inlineLink(e)) continue;
    const r = targetBox(e);
    if (r.width < 24 || r.height < 24) smallTargets.push(describe(e) + ` ${Math.round(r.width)}x${Math.round(r.height)}`);
    if (mobile) { mobileTargetCount++; if (r.height < 40 || r.width < 40) smallMobileTargets.push(describe(e) + ` ${Math.round(r.width)}x${Math.round(r.height)}`); }
  }
  const countedTargets = targets.filter(e => !inlineLink(e)).length;

  // --- Integrity ---
  const issues = [];
  for (const input of all.filter(e => e.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, select'))) {
    const r = boxOf(input);
    const cs = getComputedStyle(input);
    const left = r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
    const right = r.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
    const holder = input.parentElement?.parentElement || input.parentElement;
    for (const icon of holder ? holder.querySelectorAll('svg') : []) {
      if (icon.closest('button') || !icon.getClientRects().length) continue;
      const ir = icon.getBoundingClientRect();
      const vertical = ir.bottom > r.top + 2 && ir.top < r.bottom - 2;
      if (vertical && ir.right > left + 1 && ir.left < right - 1) issues.push('icon-overlap ' + describe(input));
    }
  }
  for (const e of textEls) {
    const cs = getComputedStyle(e);
    const lineClamp = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
    if (!lineClamp && ['hidden', 'clip'].includes(cs.overflowX) && e.scrollWidth > e.clientWidth + 1 && cs.textOverflow !== 'ellipsis') issues.push('clip-x ' + describe(e));
    if (!lineClamp && ['hidden', 'clip'].includes(cs.overflowY) && e.scrollHeight > e.clientHeight + 2) issues.push('clip-y ' + describe(e));
    const rects = textRects(e);
    if (!rects.length) continue;
    const minL = Math.min(...rects.map(x => x.left));
    const maxR = Math.max(...rects.map(x => x.right));
    let scrollable = false;
    let ellipsis = cs.textOverflow === 'ellipsis';
    let clipper = null;
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      const acs = getComputedStyle(a);
      if (['auto', 'scroll'].includes(acs.overflowX)) { scrollable = true; break; }
      if (['hidden', 'clip'].includes(acs.overflowX)) { if (acs.textOverflow === 'ellipsis') ellipsis = true; if (!clipper) clipper = a; }
    }
    if (scrollable || ellipsis) continue;
    if (clipper) { const cr = boxOf(clipper); if (minL < cr.left - 1 || maxR > cr.right + 1) { issues.push('clipped-by-ancestor ' + describe(e)); continue; } }
    if (minL < -1 || maxR > vw + 1) issues.push('off-viewport ' + describe(e));
  }
  if (document.documentElement.scrollWidth > vw + 1) issues.push('document-overflow ' + (document.documentElement.scrollWidth - vw));
  const uniqueIssues = [...new Set(issues)];

  const typography = {
    scale: frac(textEls.length - offScale.length, textEls.length),
    minSize: frac(textEls.length - tooSmall.length, textEls.length),
    leading: frac(longText.length - badLeading.length, longText.length),
    measure: frac(longText.length - tooWide.length, longText.length),
    wrap: frac(shortLabels.length - wrapped.length, shortLabels.length),
    hierarchy: hierarchy ? 100 : 0,
    distinctSizes: distinctScore(sizeSet.length, 6),
  };
  const spacingScore = { grid: frac(spacing.length - offGrid.length, spacing.length), distinct: distinctScore(spacingSet.size, 14) };
  const colorScore = { text: distinctScore(textColors.size, 8), background: distinctScore(bgColors.size, 10), border: distinctScore(borderColors.size, 6) };
  const shapeScore = { radii: distinctScore(radii.size, 4), shadows: distinctScore(shadows.size, 3) };
  const targetScore = { min24: frac(countedTargets - smallTargets.length, countedTargets), ...(mobile ? { mobile40: frac(mobileTargetCount - smallMobileTargets.length, mobileTargetCount) } : {}) };
  const integrityScore = { issues: Math.max(0, 100 - 10 * uniqueIssues.length) };

  return {
    axes: { typography, spacing: spacingScore, color: colorScore, shape: shapeScore, targets: targetScore, integrity: integrityScore },
    counts: { textEls: textEls.length, fontSizes: sizeSet, textColors: textColors.size, bgColors: bgColors.size, borderColors: borderColors.size, radii: [...radii].sort((a, b) => a - b), shadows: shadows.size, spacingValues: [...spacingSet].sort((a, b) => a - b), targets: countedTargets },
    samples: {
      offScale: offScale.slice(0, 12).map((e) => describe(e) + ' ' + px(getComputedStyle(e).fontSize)),
      tooSmall: tooSmall.slice(0, 12).map(describe),
      badLeading: badLeading.slice(0, 8).map(describe),
      tooWide: tooWide.slice(0, 8).map(describe),
      wrapped: wrapped.slice(0, 12).map(describe),
      offGrid: offGrid.slice(0, 12),
      smallTargets: smallTargets.slice(0, 12),
      smallMobileTargets: smallMobileTargets.slice(0, 12),
      issues: uniqueIssues.slice(0, 20),
    },
  };
}

async function settle(page) {
  await page.waitForFunction(() => document.getAnimations().filter(a => a.playState === 'running' && !(a.effect?.getTiming?.().iterations === Infinity)).length === 0, undefined, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(250);
}

export async function runDesign(page, { onlyRoutes = routes, onlyConfigs = configs, output, shots }) {
  await prepare(page);
  const rows = [];
  for (const config of onlyConfigs) for (const route of onlyRoutes) {
    const a11y = await scan(page, route, config);
    await settle(page);
    const design = await page.evaluate(designAudit);
    if (shots) await page.screenshot({ path: `${shots}/${(route === '/' ? 'home' : route.slice(1).replaceAll('/', '_'))}-${config.name}.png` });
    rows.push({ route, config: config.name, a11y: { logs: a11y.logs, domChecks: a11y.domChecks, visualChecks: a11y.visualChecks, contrastNodes: a11y.violations.find(v => v.id === 'color-contrast')?.nodes.length || 0 }, ...design });
    await fs.writeFile(output, JSON.stringify(rows, null, 2) + '\n');
    console.log(JSON.stringify({ route, config: config.name, issues: design.samples.issues.length, sizes: design.counts.fontSizes.length }));
  }
  return rows;
}
