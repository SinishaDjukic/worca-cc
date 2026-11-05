// Run: node plans/rail/prototype/gates/worca-sweep.mjs
// The one Worca's gate (index.html): today's shell and pages with Wave 1 in them. Every route, at 1280, 760 and 375px,
// in both themes: no script error, no sideways scroll, the top bar one row, one way back at a time, the sidebar marking
// where you are. Then the journeys between the pieces: a run row opens its run (same title), the trail goes back to
// Runs, Pulse opens, the profile menu opens Settings, a Settings section opens, Back to Worca gives the sidebar back.
// The run page and Pulse keep their own gates (run-page-sweep, pulse-sweep, ds-check); this one checks how they join.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { writeAppCss } from './app-css.mjs';
import { writeComponentsJs } from './components-js.mjs';
import { writeTodayJs } from './today-js.mjs';
writeAppCss(); writeComponentsJs(); writeTodayJs();
const URL_ = 'file://' + fileURLToPath(new URL('../index.html', import.meta.url));
global.window = {}; await import('../settings/settings-model.js');
const SECTIONS = window.SettingsModel.GROUPS.flatMap((g) => g.items);
const TODAY = ['chat', 'runs', 'schedules', 'stats', 'team-metrics', 'workflows', 'requirements', 'projects', 'workspaces', 'marketplace'];
const RUNS = ['question', 'gate', 'working', 'checks', 'ready', 'feature', 'chain'];
const ROUTES = [...TODAY, ...RUNS.map((c) => 'run/' + c), ...SECTIONS.map((s) => 'settings/' + s)];
const issues = new Map(); const add = (k, w) => { if (!issues.has(k)) issues.set(k, []); if (issues.get(k).length < 12) issues.get(k).push(w); };
const b = await chromium.launch({ channel: 'chrome' });
let checks = 0;
for (const scheme of ['light', 'dark']) for (const w of [1280, 760, 375]) {
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
      if (view !== 'settings' && document.querySelector('#side-rail').offsetParent && (!cur || cur.dataset.nav !== place)) out.push(['the sidebar does not mark the place', `${place} (marked: ${cur ? cur.dataset.nav : 'none'})`]);
      if (view === 'settings' && document.querySelector('#side-rail').offsetParent && innerWidth > 760 && !document.querySelector('#side-rail .side-menu')) out.push(['Settings without its menu', '']);
      const shown = view === 'run' ? '#route-run' : view === 'settings' ? '#route-settings' : '#route-today';
      if (!document.querySelector(shown).textContent.trim()) out.push(['an empty page', '']);
      return out;
    }, r);
    for (const [k, wh] of f) add(k, `${scheme}/${w}/${r}${wh ? ': ' + wh : ''}`);
    checks++;
  }
  // the journeys
  const step = async (name, fn, expect) => { const ok = await p.evaluate(fn); await p.waitForTimeout(120); const got = await p.evaluate(expect); if (!got) add('a journey breaks', `${scheme}/${w}: ${name}`); checks++; };
  await p.goto(`${URL_}#runs`); await p.waitForTimeout(100);
  await step('a run row opens its run', () => document.querySelector('[data-rail-run="question"] .runs-row')?.click(), () => location.hash === '#run/question' && document.querySelector('#card .rc-heading')?.textContent === 'Add CSV export to billing');
  await step('the trail goes back to Runs', () => document.querySelector('#card [data-key="crumb:0"]')?.click(), () => location.hash === '#runs' && !document.querySelector('#route-today').hidden);
  await step('Pulse opens', () => document.querySelector('[data-pop]')?.click(), () => !!document.querySelector('.pz-popover'));
  await step('the profile menu opens', () => { document.body.click(); document.querySelector('[data-acct]')?.click(); }, () => !!document.querySelector('#app .acct-menu'));
  await step('the profile menu opens Settings', () => document.querySelector('#app [data-go="settings"]')?.click(), () => location.hash.startsWith('#settings') && !document.querySelector('#route-settings').hidden);
  if (w > 760) {
    await step('a Settings section opens', () => document.querySelector('#side-rail [data-sset="runs"]')?.click(), () => location.hash === '#settings/runs' && [...document.querySelectorAll('#route-settings .pz-title')].find((t) => t.offsetParent)?.textContent === 'Runs');
    await step('Back to Worca gives the sidebar back', () => document.querySelector('#side-rail .side-back')?.click(), () => !document.querySelector('#side-rail .side-menu') && !!document.querySelector('#side-rail [data-nav="runs"]'));
  }
  await p.close();
}
await b.close();
console.log(`${checks} checks · ` + (issues.size ? '\n' + [...issues].map(([k, v]) => `${k}\n   ${v.join('\n   ')}`).join('\n') : 'no glitches found'));
process.exitCode = issues.size ? 1 : 0;
