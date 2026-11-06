// Run: node plans/rail/prototype/gates/click-check.mjs [--small]
// Every control acts (docs/rail/gate.md). On every prototype page, in every case and tab, wide and narrow, it clicks each
// visible control, and each control a click opens (a menu's items), and fails one that changes nothing: not the page, the
// address, a field, the focus or the clipboard. A disabled control must say why in its tooltip. It finds pages, cases, tabs
// and sections by itself, so a new one is read without touching this file. --small: one width, every fifth case.
import { chromium } from 'playwright';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { writeAppCss } from './app-css.mjs';
import { writeComponentsJs } from './components-js.mjs';
import { writeTodayJs } from './today-js.mjs';

writeAppCss(); writeComponentsJs(); writeTodayJs();
const SMALL = process.argv.includes('--small');
const dir = fileURLToPath(new URL('..', import.meta.url));
const WIDTHS = SMALL ? [1280] : [1280, 375];
const issues = new Map(); let clicks = 0;
const add = (k, w) => { if (!issues.has(k)) issues.set(k, new Set()); issues.get(k).add(w); };

// Every control in the page's own area: the prototype's corner and captured pages are not the design.
const CONTROLS = `(() => {
  const SEL = 'button, a[href], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="radio"], [role="switch"], input[type="checkbox"], input[type="radio"], select, summary';
  const out = []; const seen = new Set();
  for (const e of document.querySelectorAll(SEL)) {
    if (e.closest('.mk-bar, .mk-intro, .mk-proposed, #route-today, .rail-capture, [data-capture]')) continue;
    if (!e.getClientRects().length || getComputedStyle(e).visibility === 'hidden') continue;
    const k = e.dataset.key || [...e.attributes].filter((a) => a.name.startsWith('data-') || a.name === 'id').map((a) => a.name + '=' + a.value).join('&') || (e.tagName + ':' + (e.getAttribute('aria-label') || e.textContent.trim().slice(0, 40)));
    if (seen.has(k)) continue; seen.add(k);
    if (e.matches('[aria-selected="true"], [aria-current], [aria-checked="true"][role="radio"], [aria-checked="true"][role="menuitemradio"], [aria-pressed="true"]')) continue;   // already chosen: choosing it again rightly does nothing
    out.push({ k, off: e.disabled || e.getAttribute('aria-disabled') === 'true', why: e.title || e.closest('[title]')?.title || '', name: (e.getAttribute('aria-label') || e.textContent.trim()).slice(0, 40), tag: e.tagName });
  }
  return out;
})()`;
const signature = `(() => { const fields = [...document.querySelectorAll('input, select, textarea')].map((x) => x.type === 'checkbox' || x.type === 'radio' ? x.checked : x.value).join('|');
  return document.body.innerHTML.length + '#' + document.body.textContent + '#' + [...document.querySelectorAll('[aria-expanded],[aria-checked],[aria-selected],[aria-pressed],[class]')].map((x) => (x.getAttribute('aria-expanded') || '') + (x.getAttribute('aria-checked') || '') + (x.getAttribute('aria-selected') || '') + (x.getAttribute('aria-pressed') || '') + x.className).join() + '#' + location.hash + '#' + fields + '#' + (document.activeElement?.dataset?.key || document.activeElement?.id || ''); })()`;
const clickKey = (k) => `(() => { const SEL = 'button, a[href], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="radio"], [role="switch"], input[type="checkbox"], input[type="radio"], select, summary';
  for (const e of document.querySelectorAll(SEL)) { if (!e.getClientRects().length) continue;
    const k = e.dataset.key || [...e.attributes].filter((a) => a.name.startsWith('data-') || a.name === 'id').map((a) => a.name + '=' + a.value).join('&') || (e.tagName + ':' + (e.getAttribute('aria-label') || e.textContent.trim().slice(0, 40)));
    if (k === ${JSON.stringify(k)}) { if (e.tagName === 'SELECT') { const o = [...e.options].find((x) => x.value !== e.value); if (o) { e.value = o.value; e.dispatchEvent(new Event('change', { bubbles: true })); } return true; } e.click(); return true; } }
  return false; })()`;

async function sweep(p, where, reset, seen) {
  const walk = async (path, depth) => {
    await reset(); for (const k of path) await p.evaluate(clickKey(k));
    const list = await p.evaluate(CONTROLS);
    let before = new Set();
    if (path.length) { await reset(); for (const k of path.slice(0, -1)) await p.evaluate(clickKey(k)); before = new Set((await p.evaluate(CONTROLS)).map((c) => c.k)); }
    for (const c of list) {
      if (before.has(c.k) || path.includes(c.k)) continue;
      const id = path.join('>') + '>' + c.k;
      if (seen.has(id)) continue; seen.add(id);
      if (c.off) { if (!c.why) add('a disabled control that does not say why', `${where}: ${c.name}`); continue; }
      await reset(); for (const k of path) await p.evaluate(clickKey(k));
      const a = await p.evaluate(signature);
      clicks++;
      if (!(await p.evaluate(clickKey(c.k)))) continue;
      await p.waitForTimeout(12);
      const bb = await p.evaluate(signature);
      if (a === bb) add('a dead control', `${where}: ${c.name || c.k}`);
      else if (depth > 0 && c.tag !== 'A' && await p.evaluate(`[...document.querySelectorAll('.menu, [role="menu"], [role="dialog"]')].some((x) => x.getClientRects().length)`)) await walk([...path, c.k], depth - 1);
    }
  };
  await walk([], 1);
}

const b = await chromium.launch({ channel: 'chrome' });
const HTML = readdirSync(dir).filter((f) => f.endsWith('.html') && f !== 'components.html');
for (const w of WIDTHS) {
  for (const page of HTML) {
    const p = await b.newPage({ viewport: { width: w, height: 900 }, reducedMotion: 'reduce', permissions: [] });
    p.on('pageerror', (e) => add('script error', `${page} ${w}: ${e.message}`));
    const url = 'file://' + dir + page;
    await p.goto(url); await p.waitForTimeout(50);
    const cases = await p.evaluate(() => [...document.querySelectorAll('#case option')].map((o) => o.value));
    if (cases.length) {
      const list = SMALL ? cases.filter((_, i) => i % 5 === 0) : cases;
      for (const c of list) {
        const other = cases[(cases.indexOf(c) + 1) % cases.length];
        await p.selectOption('#case', c);
        const tabs = await p.$$eval('.rc-tabs .tab', (x) => x.map((e) => e.dataset.tab));
        const seen = new Set();   // a control shared by a case's tabs counts once
        for (const t of tabs.length ? tabs : ['']) {
          await sweep(p, `${page} ${w} ${c}${t ? '/' + t : ''}`, async () => { await p.selectOption('#case', other); await p.selectOption('#case', c); if (t) await p.evaluate((x) => document.querySelector(`.tab[data-tab="${x}"]`)?.click(), t); }, seen);
        }
      }
    } else {
      // The one Worca: the shell on one place (captured pages are not the design), and every section of Settings.
      const routes = await p.evaluate(() => (window.SettingsModel ? ['runs', ...window.SettingsModel.GROUPS.flatMap((g) => g.items).map((s) => 'settings/' + s)] : ['']));
      const list = SMALL ? routes.filter((_, i) => i % 5 === 0) : routes;
      for (const r of list) { const seen = new Set(); await sweep(p, `${page} ${w} #${r}`, async () => { await p.evaluate((x) => { location.hash = x; }, r); await p.reload(); }, seen); }
    }
    await p.close();
  }
}
await b.close();
console.log(`${clicks} clicks · ` + (issues.size ? '\n' + [...issues].map(([k, v]) => `${k} (${v.size})\n   ${[...v].slice(0, 30).join('\n   ')}`).join('\n') : 'every control acts'));
process.exitCode = issues.size ? 1 : 0;
