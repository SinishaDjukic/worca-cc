// Run: node plans/rail/prototype/gates/worca-sweep.mjs
// The one Worca's gate (index.html): today's shell and pages with Wave 1 in them. Every route, at 1280, 760 and 375px,
// in both themes: no script error, no sideways scroll, the top bar one row, one way back at a time, the sidebar marking
// where you are. Then the journeys between the pieces: a run row opens its run (same title), the trail goes back to
// Runs with its sentence kept, Pulse opens, the profile menu opens Settings, a Settings section opens, Back to Worca gives the sidebar back; the
// sidebar's three widths (narrow.nav), the side column's three tiers (panel.side-column), and a deep link above the mode.
// The run page and Pulse keep their own gates (run-page-sweep, pulse-sweep, ds-check); this one checks how they join.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { writeAppCss } from './app-css.mjs';
import { writeComponentsJs } from './components-js.mjs';
import { writeTodayJs } from './today-js.mjs';
writeAppCss(); writeComponentsJs(); writeTodayJs();
const URL_ = 'file://' + fileURLToPath(new URL('../index.html', import.meta.url));
global.window = {}; await import('../settings/settings-model.js');
const SECTIONS = window.SettingsModel.GROUPS.flatMap((g) => g.items);
// Every route, read from the pages themselves: a new capture, run case or Settings section is checked without touching this file.
const TODAY = Object.keys(JSON.parse(readFileSync(fileURLToPath(new URL('../today/pages.json', import.meta.url)), 'utf8')));
const issues = new Map(); const add = (k, w) => { if (!issues.has(k)) issues.set(k, []); if (issues.get(k).length < 12) issues.get(k).push(w); };
const b = await chromium.launch({ channel: 'chrome' });
const scout = await b.newPage(); await scout.goto(URL_);
const RUNS = await scout.evaluate(() => window.RunCardModel.cases.map((c) => c.id)); await scout.close();
const ROUTES = ['runs', ...TODAY, ...RUNS.map((c) => 'run/' + c), ...SECTIONS.map((s) => 'settings/' + s)];
let checks = 0;
for (const scheme of ['light', 'dark']) for (const w of [1280, 900, 760, 375]) {
  const p = await b.newPage({ viewport: { width: w, height: 860 }, colorScheme: scheme, reducedMotion: 'reduce' });
  p.on('pageerror', (e) => add('script error', `${scheme}/${w}: ${e}`));
  for (const r of ROUTES) {
    await p.goto(`${URL_}#${r}`); await p.waitForTimeout(80);
    const f = await p.evaluate((r) => {
      const out = [];
      if (document.documentElement.scrollWidth > innerWidth + 1) out.push(['sideways scroll', '']);
      const bar = document.querySelector('#topnav'); const bb = bar.getBoundingClientRect();
      for (const x of bar.querySelectorAll('button, input')) { if (!x.offsetParent) continue; const xr = x.getBoundingClientRect(); if (xr.top < bb.top - 1 || xr.bottom > bb.bottom + 1) out.push(['the top bar is not one row', (x.getAttribute('aria-label') || x.textContent.trim()).slice(0, 24)]); }
      const backs = [...document.querySelectorAll('#route-settings .rl-back, #side-rail .side-back, #card .rc-crumbs')].filter((x) => x.offsetParent);
      if (backs.length > 1) out.push(['two ways back shown', backs.map((x) => x.className).join(' + ')]);
      const view = r.split('/')[0], place = view === 'run' ? 'runs' : view;
      const cur = document.querySelector('#side-rail nav.nav [aria-current="page"]');
      const locked = !!document.querySelector('#route-today [data-unlock]');
      if (view !== 'settings' && !locked && document.querySelector('#side-rail').offsetParent && (!cur || cur.dataset.nav !== place)) out.push(['the sidebar does not mark the place', `${place} (marked: ${cur ? cur.dataset.nav : 'none'})`]);
      if (view === 'settings' && document.querySelector('#side-rail').offsetParent && innerWidth > 1080 && !document.querySelector('#side-rail .side-menu')) out.push(['Settings without its menu', '']);
      const shown = view === 'run' ? '#route-run' : view === 'settings' ? '#route-settings' : view === 'runs' ? '#route-runs' : '#route-today';
      if (!document.querySelector(shown).textContent.trim()) out.push(['an empty page', '']);
      return out;
    }, r);
    for (const [k, wh] of f) add(k, `${scheme}/${w}/${r}${wh ? ': ' + wh : ''}`);
    checks++;
  }
  // the journeys
  const step = async (name, fn, expect) => { const ok = await p.evaluate(fn); await p.waitForTimeout(120); const got = await p.evaluate(expect); if (!got) add('a journey breaks', `${scheme}/${w}: ${name}`); checks++; };
  await p.goto(`${URL_}#runs`); await p.waitForTimeout(100);
  await step('the sentence changes the list', () => { document.querySelector('#runs-root [data-menu="by"]')?.click(); document.querySelector('#runs-root [data-pick="by|day"]')?.click(); }, () => /by day/.test(document.querySelector('#runs-root .list-sentence')?.textContent || ''));
  await step('a run row opens its run', () => document.querySelector('#runs-root [data-open="run:r1"]')?.click(), () => location.hash === '#run/question' && document.querySelector('#card .rc-heading')?.textContent === 'Add CSV export to billing');
  await step('the trail goes back to Runs, the sentence kept', () => document.querySelector('#card [data-key="crumb:0"]')?.click(), () => location.hash === '#runs' && !document.querySelector('#route-runs').hidden && /by day/.test(document.querySelector('#runs-root .list-sentence')?.textContent || ''));
  await step('the sentence back to state', () => { document.querySelector('#runs-root [data-menu="by"]')?.click(); document.querySelector('#runs-root [data-pick="by|state"]')?.click(); }, () => /by state/.test(document.querySelector('#runs-root .list-sentence')?.textContent || ''));
  await step('Pulse opens', () => document.querySelector('[data-pop]')?.click(), () => !!document.querySelector('.pz-popover'));
  await step('the profile menu opens', () => { document.body.click(); document.querySelector('[data-acct]')?.click(); }, () => !!document.querySelector('#app .acct-menu'));
  await step('the profile menu opens Settings', () => document.querySelector('#app [data-go="settings"]')?.click(), () => location.hash.startsWith('#settings') && !document.querySelector('#route-settings').hidden);
  if (w > 1080) {
    await step('a Settings section opens', () => document.querySelector('#side-rail [data-sset="runs"]')?.click(), () => location.hash === '#settings/runs' && [...document.querySelectorAll('#route-settings .pz-title')].find((t) => t.offsetParent)?.textContent === 'Runs');
    await step('Back to Worca gives the sidebar back', () => document.querySelector('#side-rail .side-back')?.click(), () => !document.querySelector('#side-rail .side-menu') && !!document.querySelector('#side-rail [data-nav="runs"]'));
  }
  // the Chats column: beside the conversation above 1080px, over it to 761px, the window below (panel.side-column)
  await p.goto(`${URL_}#chat`); await p.waitForTimeout(120);
  const cc = await p.evaluate(() => { const c = document.getElementById('chats-col').getBoundingClientRect(), m = document.querySelector('.main').getBoundingClientRect(); return { w: c.width, left: c.left, main: m.left, shown: !document.getElementById('chats-col').hidden }; });
  if (!cc.shown || (w > 1080 ? cc.main < cc.left + cc.w - 1 : w > 760 ? cc.main > cc.left + 1 : cc.w !== w)) add('the Chats column is on the wrong tier', `${scheme}/${w}: ${JSON.stringify(cc)}`);
  await step('a chat row opens its chat', () => document.querySelector('#chats-col [data-open="chat:c2"]')?.click(), () => location.hash === '#chat/c2' && (innerWidth <= 760 ? document.getElementById('chats-col').hidden : !!document.querySelector('#chats-col [data-row="chat:c2"].is-current')));
  // the sidebar's width
  await p.goto(`${URL_}#runs`); await p.waitForTimeout(350);
  const sideW = await p.evaluate(() => Math.round(document.getElementById('side-rail').getBoundingClientRect().width));
  if (w > 1080 ? sideW !== 224 : w > 760 ? sideW !== 60 : false) add('the sidebar has the wrong width', `${scheme}/${w}: ${sideW}`);
  if (w <= 760) {
    await step('the drawer opens', () => document.getElementById('mbar-menu').click(), () => document.body.classList.contains('nav-open') && getComputedStyle(document.getElementById('side-rail')).visibility === 'visible');
    await step('the drawer closes', () => document.getElementById('nav-scrim').click(), () => !document.body.classList.contains('nav-open') && getComputedStyle(document.getElementById('side-rail')).visibility === 'hidden');
  }
  // the side column: push, cover, window; closes at once
  await p.evaluate(() => document.getElementById('topnav-ask').click()); await p.waitForTimeout(250);
  const ask = await p.evaluate(() => ({ w: document.getElementById('ask-side').getBoundingClientRect().width, main: document.querySelector('.main').getBoundingClientRect().width, mainAlone: innerWidth - document.getElementById('side-rail').getBoundingClientRect().width }));
  if (w > 1080 ? ask.main > ask.mainAlone - ask.w + 1 : w > 760 ? ask.main < ask.mainAlone - 1 : ask.w !== w) add('the side column is on the wrong tier', `${scheme}/${w}: ${JSON.stringify(ask)}`);
  await step('the side column closes', () => document.querySelector('[data-ask-close]').click(), () => document.getElementById('ask-side').hidden);
  // a deep link above the mode: one line and its one way on; the search says the same
  await p.evaluate(() => RailUI.prefs.setMode('simple'));
  await p.evaluate(() => { location.hash = 'schedules'; }); await p.waitForTimeout(100);
  if (await p.evaluate(() => !document.querySelector('[data-nav="schedules"]').hidden)) add('the sidebar ignores the mode', `${scheme}/${w}`);
  await step('a place above the mode unlocks', () => document.querySelector('#route-today [data-unlock]')?.click(), () => RailUI.prefs.mode() === 'advanced' && !document.querySelector('#route-today [data-unlock]'));
  await p.close();
}
// Usage: live, connected providers only, every minute (docs/rail/small-rules.md).
{
  const p = await b.newPage({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  await p.clock.install(); await p.goto(`${URL_}#runs`); await p.clock.runFor(200);
  const tip = () => p.evaluate(() => document.querySelector('.pz-ava-wrap')?.title || '');
  const t0 = await tip();
  if (!/^Weekly · Claude Code: 31%\nResets /m.test(t0) && !/· .+: \d+%\nResets /.test(t0)) add('a ring does not say what it shows', t0);
  if (/Spend/.test(t0)) add('money on a ring', t0);
  await p.clock.runFor(60_000); await p.waitForTimeout(50);
  if (await tip() === t0) add('usage did not refresh after a minute', t0);
  const n0 = await p.evaluate(() => document.querySelectorAll('.pz-ava-wrap .pz-gring').length);
  await p.evaluate(() => { for (const x of ['claude', 'codex', 'copilot', 'gemini', 'openrouter']) window.RailUI.prefs.setConnected(x, false); }); await p.clock.runFor(50);
  if (!n0 || await p.evaluate(() => document.querySelectorAll('.pz-ava-wrap .pz-gring').length)) add('a disconnected provider keeps its ring', `${n0}`);
  if ((await tip()) !== 'No provider connected') add('nothing connected is not said', await tip());
  await p.close(); checks += 4;
}
await b.close();
console.log(`${checks} checks · ` + (issues.size ? '\n' + [...issues].map(([k, v]) => `${k}\n   ${v.join('\n   ')}`).join('\n') : 'no glitches found'));
process.exitCode = issues.size ? 1 : 0;
