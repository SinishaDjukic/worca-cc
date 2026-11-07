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
      for (const s of document.querySelectorAll('#side-rail nav.nav button[data-nav] svg')) if (s.getAttribute('stroke-width') !== '1.8') out.push(['a sidebar icon not from the library', s.parentElement.dataset.nav]);
      if (view === 'settings' && document.querySelector('#side-rail').offsetParent && innerWidth > 1080 && !document.querySelector('#side-rail .side-menu')) out.push(['Settings without its menu', '']);
      const shown = view === 'run' ? '#route-run' : view === 'settings' ? '#route-settings' : view === 'runs' ? '#route-runs' : view === 'chat' ? '#route-chat' : view === 'schedules' || view === 'schedule' ? '#route-schedule' : '#route-today';
      if (!document.querySelector(shown).textContent.trim()) out.push(['an empty page', '']);
      return out;
    }, r);
    for (const [k, wh] of f) add(k, `${scheme}/${w}/${r}${wh ? ': ' + wh : ''}`);
    checks++;
  }
  // one mock: in every Pulse case the badge and the Runs list's Needs you agree (build.one-mock)
  await p.goto(`${URL_}#runs`); await p.waitForTimeout(100);
  for (const pc of await p.evaluate(() => [...document.querySelectorAll('#pulse-case option')].map((o) => o.value))) {
    const got = await p.evaluate((v) => { const s = document.getElementById('pulse-case'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('#runs-root [data-menu="show"]')?.click();
      const hint = document.querySelector('#runs-root [data-pick="show|needs"]')?.textContent.match(/\d+/)?.[0] || '0'; document.querySelector('#runs-root [data-menu="show"]')?.click(); return { list: +hint, badge: window.PulseModel && window.RailWorld.tops().filter((r) => r.section === 'needs').length, shown: +(document.querySelector('.pz-pulse-b .badge, .pz-pulse-b [class*="badge"]')?.textContent || 0) }; }, pc);
    if (got.list !== got.badge) add('the badge and the Runs list disagree', `${pc}: ${JSON.stringify(got)}`);
    checks++;
  }
  await p.evaluate(() => { const s = document.getElementById('pulse-case'); s.value = 'afternoon'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  // the journeys
  const step = async (name, fn, expect) => { const ok = await p.evaluate(fn); await p.waitForTimeout(120); const got = await p.evaluate(expect); if (!got) add('a journey breaks', `${scheme}/${w}: ${name}`); checks++; };
  await p.goto(`${URL_}#runs`); await p.evaluate(() => localStorage.removeItem('worca-rail.runs.view')); await p.reload(); await p.waitForTimeout(100);
  await step('the sentence changes the list', () => { document.querySelector('#runs-root [data-menu="by"]')?.click(); document.querySelector('#runs-root [data-pick="by|project"]')?.click(); }, () => /by project/.test(document.querySelector('#runs-root .list-sentence')?.textContent || ''));
  await step('a run row opens its run', () => document.querySelector('#runs-root [data-open="run:r1"]')?.click(), () => location.hash === '#run/question' && document.querySelector('#card .rc-heading')?.textContent === 'Add CSV export to billing');
  await step('the trail goes back to Runs, the sentence kept', () => document.querySelector('#card [data-key="crumb:0"]')?.click(), () => location.hash === '#runs' && !document.querySelector('#route-runs').hidden && /by project/.test(document.querySelector('#runs-root .list-sentence')?.textContent || ''));
  await step('the sentence back to state', () => { document.querySelector('#runs-root [data-menu="by"]')?.click(); document.querySelector('#runs-root [data-pick="by|state"]')?.click(); }, () => /by state/.test(document.querySelector('#runs-root .list-sentence')?.textContent || ''));
  await step('Pulse opens', () => document.querySelector('[data-pop]')?.click(), () => !!document.querySelector('.pz-popover'));
  await step('the profile menu opens', () => { document.body.click(); document.querySelector('[data-acct]')?.click(); }, () => !!document.querySelector('#app .acct-menu'));
  await step('the profile menu opens Settings', () => document.querySelector('#app [data-go="settings"]')?.click(), () => location.hash.startsWith('#settings') && !document.querySelector('#route-settings').hidden);
  if (w > 1080) {
    await step('a Settings section opens', () => document.querySelector('#side-rail [data-sset="runs"]')?.click(), () => location.hash === '#settings/runs' && [...document.querySelectorAll('#route-settings .pz-title')].find((t) => t.offsetParent)?.textContent === 'Tasks');
    await step('the house opens the places', () => document.querySelector('[data-bar-house]')?.click(), () => document.getElementById('side-rail').dataset.bar === 'home' && !!document.querySelector('#side-rail [data-nav="chat"]').offsetParent);
  }
  // the one bar: Chat's list is in it; a row opens its conversation, and a task opens from its tree (nav.one-bar)
  await p.goto(`${URL_}#chat`); await p.waitForTimeout(120);
  if (await p.evaluate(() => document.getElementById('side-rail').dataset.bar !== 'chat' || document.getElementById('bar-chat').hidden)) add('Chat\'s list is not in the bar', `${scheme}/${w}`);
  await step('a chat row opens its chat', () => document.querySelector('#bar-chat [data-open="chat:c2"]')?.click(), () => location.hash === '#chat/c2' && !!document.querySelector('#route-chat .convo') && !!document.querySelector('#bar-chat [data-row="chat:c2"].is-current'));
  await step('a task in the tree opens with its chat around it', () => document.querySelector('#bar-chat [data-open="task:t1"]')?.click(), () => location.hash === '#run/question' && document.getElementById('side-rail').dataset.bar === 'chat');
  await step('asking from a task goes to its chat', () => { const t = document.querySelector('#task-dock [data-composer-t]'); t.value = 'Why?'; document.querySelector('[data-dock-send]').click(); }, () => location.hash === '#chat/c1');
  // the hidden bar: a 56px strip with the work's summary, nothing sticking out; hover opens it over the page; a menu keeps it open
  if (w > 760) {
    await p.goto(`${URL_}#chat/c1`); await p.waitForTimeout(150);
    await p.evaluate(() => document.querySelector('[data-bar-hide]').click()); await p.mouse.move(w - 40, 400); await p.waitForTimeout(260);
    const strip = await p.evaluate(() => { const b0 = document.getElementById('side-rail').getBoundingClientRect(), r = { left: b0.left, width: (() => { const s = document.getElementById('side-rail'), m = /inset\(0px (-?[\d.]+)px/.exec(getComputedStyle(s).clipPath); return s.getBoundingClientRect().width - (m ? Math.max(0, +m[1]) : 0); })(), get right() { return this.left + this.width; } }, out = [...document.querySelectorAll('#side-rail *')].filter((e) => e.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) && e.getClientRects().length && (e.nodeName === 'svg' || [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))).filter((e) => { const b = e.getBoundingClientRect(); return b.width && (b.right > r.right + 1 || b.left < r.left - 1); }).map((e) => e.className || e.tagName); return { w: Math.round(r.width), mini: document.querySelectorAll('#bar-mini .bar-strip-i').length, out: [...new Set(out)].slice(0, 4) }; });
    if (strip.w !== 56 || !strip.mini || strip.out.length) add('the hidden bar is not a clean strip', `${scheme}/${w}: ${JSON.stringify(strip)}`);
    const left0 = await p.evaluate(() => Math.round(document.querySelector('.main').getBoundingClientRect().left));
    await p.mouse.move(20, 300); await p.waitForTimeout(80);
    if (await p.evaluate((x) => Math.round(document.querySelector('.main').getBoundingClientRect().left) !== x, left0)) add('the page moves while the hidden bar opens', `${scheme}/${w}`);
    await p.waitForTimeout(260);
    if (await p.evaluate(() => Math.round((() => { const s = document.getElementById('side-rail'), m = /inset\(0px (-?[\d.]+)px/.exec(getComputedStyle(s).clipPath); return s.getBoundingClientRect().width - (m ? Math.max(0, +m[1]) : 0); })()) < 264)) add('the hidden bar does not open under the pointer', `${scheme}/${w}`);
    if (await p.evaluate(() => !document.querySelector('#bar-head [data-bar-pin]'))) add('the opened strip cannot be kept open', `${scheme}/${w}`);
    await p.evaluate(() => document.querySelector('#bar-chat [data-menu^="row:chat:"]')?.click()); await p.mouse.move(w - 40, 400); await p.waitForTimeout(260);
    if (await p.evaluate(() => !!document.querySelector('#bar-chat .menu') && (() => { const s = document.getElementById('side-rail'), m = /inset\(0px (-?[\d.]+)px/.exec(getComputedStyle(s).clipPath); return s.getBoundingClientRect().width - (m ? Math.max(0, +m[1]) : 0); })() < 264)) add('the hidden bar closes over an open menu', `${scheme}/${w}`);
    await p.keyboard.press('Escape'); await p.evaluate(() => { document.getElementById('bar-show')?.click(); localStorage.removeItem('worca-rail.sidebar.collapsed'); });
    // the resize has a floor: dragged under it the bar keeps 264px; past the snap it hides
    await p.goto(`${URL_}#chat/c1`); await p.reload(); await p.waitForTimeout(150);
    const g = await p.evaluate(() => { const r = document.querySelector('.bar-grip').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 200 }; });
    await p.mouse.move(g.x, g.y); await p.mouse.down(); await p.mouse.move(230, g.y, { steps: 4 }); await p.mouse.up();
    const floor = await p.evaluate(() => Math.round(document.getElementById('side-rail').getBoundingClientRect().width));
    if (floor !== 264) add('the bar resizes under its floor', `${scheme}/${w}: ${floor}`);
    await p.mouse.move(g.x - 16, g.y); await p.mouse.down(); await p.mouse.move(120, g.y, { steps: 4 }); await p.mouse.up(); await p.mouse.move(w - 40, 400); await p.waitForTimeout(260);
    if (await p.evaluate(() => !document.getElementById('side-rail').classList.contains('is-strip'))) add('dragging past the floor does not hide the bar', `${scheme}/${w}`);
    await p.evaluate(() => { localStorage.removeItem('worca-rail.sidebar.collapsed'); localStorage.removeItem('worca-rail.bar.width'); }); await p.reload(); await p.waitForTimeout(120);
    checks += 5;
  }
  // the sidebar's width
  await p.goto(`${URL_}#runs`); await p.waitForTimeout(350);
  const sideW = await p.evaluate(() => Math.round(document.getElementById('side-rail').getBoundingClientRect().width));
  if (w > 760 && sideW !== 280) add('the sidebar has the wrong width', `${scheme}/${w}: ${sideW}`);
  if (w <= 760) {
    await step('the drawer opens', () => document.getElementById('mbar-menu').click(), () => document.body.classList.contains('nav-open') && getComputedStyle(document.getElementById('side-rail')).visibility === 'visible');
    await step('the drawer closes', () => document.getElementById('nav-scrim').click(), () => !document.body.classList.contains('nav-open') && getComputedStyle(document.getElementById('side-rail')).visibility === 'hidden');
  }
  // every list groups by date by default, and a date section folds and comes back
  await p.goto(`${URL_}#chat/c1`); await p.waitForTimeout(150);
  await step('the Chat list is by date', () => {}, () => /by\s*date/.test(document.querySelector('#bar-chat .list-sentence')?.textContent || '') && !!document.querySelector('#bar-chat [data-fold-section="day:today"]'));
  await step('a date section folds', () => document.querySelector('#bar-chat [data-fold-section="day:today"]').click(), () => !!document.querySelector('#bar-chat .list-group.is-shut [data-fold-section="day:today"]'));
  await step('and opens again', () => document.querySelector('#bar-chat [data-fold-section="day:today"]').click(), () => !document.querySelector('#bar-chat .list-group.is-shut'));
  // In view: from a row's ⋯ into the top bar; its mark opens it
  await p.goto(`${URL_}#chat/c1`); await p.waitForTimeout(150);
  await step('Keep in view puts a mark in the top bar', () => { document.querySelector('#bar-chat [data-menu="row:task:t1"]')?.click(); document.querySelector('#bar-chat [data-menu-pick="row:task:t1|in-view"]')?.click(); }, () => innerWidth <= 760 || !!document.querySelector('#in-view-slot [data-in-view="task:t1"]'));
  if (w > 760) await step('a mark in view opens its task', () => document.querySelector('#in-view-slot [data-in-view="task:t1"]')?.click(), () => location.hash === '#run/question');
  if (w > 760) {
    await step('a mark in view holds still', () => {}, () => [...document.querySelectorAll('.in-view .kind-mark')].every((m) => getComputedStyle(m).animationName === 'none'));
    await step('the eye on a task says it is in view', () => {}, () => document.querySelector('[data-keep-view]')?.getAttribute('aria-pressed') === 'true');
    await step('the eye takes it out of view', () => document.querySelector('[data-keep-view]').click(), () => !document.querySelector('#in-view-slot [data-in-view="task:t1"]') && document.querySelector('[data-keep-view]').getAttribute('aria-pressed') === 'false');
    await step('the eye keeps it in view again', () => document.querySelector('[data-keep-view]').click(), () => document.querySelectorAll('#in-view-slot .in-view-w').length === 2);
    await step('its card takes one out of view', () => document.querySelector('#in-view-slot .in-view-x').click(), () => document.querySelectorAll('#in-view-slot .in-view-w').length === 1);
    await step('In view lives only in the top bar', () => document.querySelector('#bar-head .bar-house')?.click(), () => !/\bIn view\b/.test(document.getElementById('bar-back')?.textContent || ''));
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
  await step('a place above the mode unlocks', () => document.querySelector('#route-today [data-unlock]')?.click(), () => RailUI.prefs.mode() === 'expert' && !document.querySelector('#route-today [data-unlock]'));
  await p.close();
}
// What lies over a page closes on a click outside and on Esc, at 1280 and 375 (panel.dismiss). Each entry opens one; a new
// overlay goes here. A click on the top bar's title is a click on nothing.
{
  const up = (s) => (p) => p.evaluate((x) => !!document.querySelector(x), s);
  const clicks = (...ss) => (p) => p.evaluate(async (list) => { for (const x of list) { document.querySelector(x)?.click(); await new Promise((r) => setTimeout(r, 30)); } }, ss);
  const OVER = [
    ['Pulse', 'runs', clicks('[data-pop]'), '.pz-popover'], ['Pulse on a run', 'run/ready', clicks('[data-pop]'), '.pz-popover'], ['Pulse on Settings', 'settings/general', clicks('[data-pop]'), '.pz-popover'],
    ['Pulse\'s sentence', 'runs', clicks('[data-pop]', '[data-menu="vitalsShow"]'), '.pz-popover .pz-menu'],
    ['the profile menu', 'runs', clicks('[data-acct]'), '#app .acct-menu'], ['Usage and costs', 'runs', clicks('[data-acct]', '[data-sub="usage"]'), '#app .pz-fly'],
    ['the Runs sentence', 'runs', clicks('#runs-root [data-menu="show"]'), '#runs-root .pz-menu'], ['the list\'s ⋯', 'runs', clicks('#runs-root [data-menu="tools"]'), '#runs-root .rc-pop > .menu'],
    ['a run row\'s ⋯', 'runs', clicks('#runs-root [data-menu="row:run:r1"]'), '#runs-root .rc-pop > .menu'], ['Add to group', 'runs', clicks('#runs-root [data-menu="row:run:r1"]', '#runs-root [data-menu-pick="row:run:r1|add-to-group"]'), '#runs-root .list-pop'],
    ['the Chats sentence', 'chat', clicks('#chats-root [data-menu="from"]'), '#chats-root .pz-menu'], ['Rename a chat', 'chat', clicks('#chats-root [data-menu="row:chat:c5"]', '#chats-root [data-menu-pick="row:chat:c5|rename"]'), '#chats-root .viewer-modal', '.viewer-modal'],
    ['a run page ⋯', 'run/ready', clicks('#card [data-menu="more"]'), '#card .rc-pop > .menu'], ['a run page ▾', 'run/ready', clicks('#card [data-menu="act"]'), '#card .rc-pop > .menu'], ['the labels editor', 'run/labelled', clicks('#card [data-menu="tags"]'), '#card .rc-list-ed'],
    ['Create PR', 'run/ready', clicks('#card [data-key="act-main"]'), '#card .viewer-modal', '.viewer-modal'],
    ['search results', 'runs', async (p) => { await p.evaluate(() => { document.getElementById('tsearch-open')?.click(); const i = document.querySelector('[data-search]'); i.value = 'web'; i.dispatchEvent(new Event('input', { bubbles: true })); }); }, '.rl-search-res'],
    ['a Settings picker', 'settings/runs', clicks('#route-settings .spick-b'), '.spick-menu'], ['a record\'s ⋯ in Settings', 'settings/models', clicks('#route-settings [data-menu^="svm"]'), '#route-settings .rc-pop > .menu'],
  ];
  for (const w of [1280, 375]) {
    const p = await b.newPage({ viewport: { width: w, height: 860 }, reducedMotion: 'reduce' });
    p.on('pageerror', (e) => add('script error', `over/${w}: ${e}`));
    for (const [name, route, open, sel, scrim] of OVER) {
      for (const how of ['click', 'esc']) {
        await p.goto(`${URL_}#${route}`); await p.reload(); await p.waitForTimeout(60);
        await open(p); await p.waitForTimeout(30);
        if (!(await up(sel)(p))) { add('an overlay did not open', `${w}: ${name}`); break; }
        const inside = await p.evaluate((s) => { const x = document.querySelector(s); (x.querySelector('.menu-h, .dlg-title, .panel-head') || x).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return !!document.querySelector(s); }, sel).catch(() => true);
        checks++;
        if (!inside) { add('a click inside closes it', `${w}: ${name}`); await open(p); await p.waitForTimeout(30); }
        if (how === 'click') await p.evaluate((s) => { const t = s ? document.querySelector(s) : document.getElementById('topnav-title'); t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }, scrim);
        else await p.keyboard.press('Escape');
        await p.waitForTimeout(40);
        if (await up(sel)(p)) add(how === 'click' ? 'an overlay stays after a click outside' : 'an overlay stays after Esc', `${w}: ${name}`);
        checks++;
      }
    }
    // one click: the first closes and the second opens; a real control still acts
    await p.goto(`${URL_}#runs`); await p.reload(); await p.waitForTimeout(60);
    await p.evaluate(() => document.querySelector('[data-pop]').click()); await p.evaluate(() => document.querySelector('[data-acct]').click()); await p.waitForTimeout(30);
    if (await up('.pz-popover')(p) || !(await up('#app .acct-menu')(p))) add('Pulse then the profile menu is not one click', `${w}`);
    await p.goto(`${URL_}#runs`); await p.reload(); await p.waitForTimeout(60);
    await p.evaluate(() => document.querySelector('#runs-root [data-menu="show"]').click()); await p.evaluate(() => document.querySelector('#runs-root [data-menu="by"]').click()); await p.waitForTimeout(30);
    if (await up('#runs-root [data-pick^="show|"]')(p) || !(await up('#runs-root [data-pick^="by|"]')(p))) add('one menu then another is not one click', `${w}`);
    // focus returns; a Dialog keeps what was typed; the strip and the side column stay
    await p.goto(`${URL_}#runs`); await p.reload(); await p.waitForTimeout(60);
    await p.evaluate(() => document.querySelector('[data-pop]').click()); await p.evaluate(() => document.getElementById('topnav-title').click()); await p.waitForTimeout(30);
    if (!(await p.evaluate(() => document.activeElement?.matches('[data-pop]')))) add('the focus does not return to what opened it', `${w}: Pulse`);
    await p.goto(`${URL_}#chat`); await p.reload(); await p.waitForTimeout(60);
    await p.evaluate(() => { if (innerWidth <= 760) document.getElementById('mbar-menu').click(); document.querySelector('#chats-root [data-menu="row:chat:c5"]').click(); document.querySelector('#chats-root [data-menu-pick="row:chat:c5|rename"]').click(); });
    await p.fill('[data-dlg-name]', 'Typed'); await p.evaluate(() => document.querySelector('#chats-root .viewer-modal').click()); await p.keyboard.press('Escape'); await p.waitForTimeout(30);
    if (!(await up('#chats-root .viewer-modal')(p))) add('a Dialog lost what was typed', `${w}`);
    if (w <= 760) {
      await p.goto(`${URL_}#runs`); await p.reload(); await p.waitForTimeout(60);
      await p.evaluate(() => document.getElementById('mbar-menu').click()); await p.evaluate(() => document.querySelector('.main').click()); await p.waitForTimeout(30);
      if (await p.evaluate(() => document.body.classList.contains('nav-open'))) add('the drawer stays after a click outside', `${w}`);
    }
    await p.goto(`${URL_}#runs`); await p.reload(); await p.waitForTimeout(60);
    await p.evaluate(() => { document.getElementById('topnav-ask').click(); document.getElementById('topnav-title').click(); }); await p.waitForTimeout(30);
    if (await p.evaluate(() => document.getElementById('ask-side').hidden)) add('Ask worca closed on a click outside', `${w}`);
    await p.close(); checks += 6;
  }
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
  const n0 = await p.evaluate(() => document.querySelectorAll('.pz-ava-wrap .usage-ring').length);
  await p.evaluate(() => { for (const x of ['claude', 'codex', 'copilot', 'gemini', 'openrouter']) window.RailUI.prefs.setConnected(x, false); }); await p.clock.runFor(50);
  if (!n0 || await p.evaluate(() => document.querySelectorAll('.pz-ava-wrap .usage-ring').length)) add('a disconnected provider keeps its ring', `${n0}`);
  if ((await tip()) !== 'No provider connected') add('nothing connected is not said', await tip());
  await p.close(); checks += 4;
}
await b.close();
console.log(`${checks} checks · ` + (issues.size ? '\n' + [...issues].map(([k, v]) => `${k}\n   ${v.join('\n   ')}`).join('\n') : 'no glitches found'));
process.exitCode = issues.size ? 1 : 0;
