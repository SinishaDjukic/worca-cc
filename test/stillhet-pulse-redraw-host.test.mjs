// test/stillhet-pulse-redraw-host.test.mjs — B2.8 (#1380, docs/rail/components.md `comp.patch-parts`): Pulse's shell draw
// touches only what changed. A draw that changes nothing writes nothing and fits no menu (F-a1-02); an opened menu or a
// window width change is still fitted; #route-settings is drawn by part, and a typed Settings dialog field keeps its
// value, caret and focus through any draw (comp.keep-open). The demo app host (as test/stillhet-pulse-app-host.test.mjs):
// the live host's Settings has no dialog with a typed field yet, and the demo one has the spend-limit dialog.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as R from '../ui/public/design-system/components/index.mjs';
import { readBudgets, checkBudget, countMutations } from './helpers/stillhet-perf.mjs';

const { budgets, exclusions } = readBudgets();
const read = (p) => readFileSync(new URL('../ui/public/stillhet/' + p, import.meta.url), 'utf8');
// #route-settings is shown, as the shell shows the route it is on (a field in a hidden one takes no focus)
const BODY = '<aside id="side-rail"><nav class="nav"></nav><div id="side-foot"></div></aside><span id="rail-pulse-slot"></span>'
  + `<div id="rail-strip"></div>${R.search({})}<section id="route-settings"></section><div class="pz-app rail-layer" id="app"></div>`;
const MENUS = '.pz-menu, .spick-menu, .rl-search-res';

/**
 * The demo app host. `vw` is the window's width (jsdom has none); a box sits at 100–300px plus its own `style.left`, as
 * in a browser, so a fitted menu stays fitted. `fits()` counts the menu measurements since the last call.
 */
function host() {
  const dom = new JSDOM(`<!doctype html><html data-level="expert"><body>${BODY}${R.toast({})}</body></html>`, { runScripts: 'outside-only', url: 'http://localhost/#chat' });
  const w = dom.window, d = w.document;
  after(() => w.close());   // pulse.js keeps timers on the window
  w.RailUI = { ...R };
  w.RailHost = { name: 'app', stillhetOn: () => true };
  w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const size = { vw: 1280 };
  Object.defineProperty(d.documentElement, 'clientWidth', { configurable: true, get: () => size.vw });
  let fits = 0;
  w.Element.prototype.getBoundingClientRect = function () {
    if (this.matches(MENUS)) fits++;
    const dx = parseFloat(this.style?.left || 0) || 0;
    return { left: 100 + dx, right: 300 + dx, top: 0, bottom: 0, width: 200, height: 0, x: 100 + dx, y: 0 };
  };
  w.RailShell = {
    owns: (who, t) => who === 'pulse' && !!t?.isConnected, go: () => {}, closeDrawer: () => {}, connReset: () => {}, closeSearch: () => {},
    pageContext: () => ({}), needs: () => null, locked: () => false, runActive: () => false, start: () => w.RailPulse.show('runs', '', 'chat'),
  };
  for (const f of ['adapter.js', 'runs/run-page-model.js', 'shell/world.js', 'pulse/pulse-model.js', 'settings/settings-model.js', 'settings/settings.js', 'pulse/pulse.js']) w.eval(read(f));
  return { w, d, size, fits: () => { const n = fits; fits = 0; return n; } };
}
const tick = () => new Promise((r) => setTimeout(r, 0));   // the keep-open watcher's microtask, and then some
const svdo = (d, key) => [...d.querySelectorAll('#route-settings [data-svdo]')].find((b) => b.dataset.svdo === key);
const BUDGET = 'runs/Spending/Budget/Change…';
/** Settings › Runs with the spend-limit dialog open, `text` typed into its Per run field, the caret at 1. */
async function typed(h, text = '12') {
  h.w.RailPulse.show('settings', 'runs');
  svdo(h.d, BUDGET).click();
  const f = h.d.getElementById('sv-f-perRun');
  assert.ok(f, 'the dialog\'s field is open');
  f.focus(); f.value = text; f.dispatchEvent(new h.w.Event('input', { bubbles: true })); f.setSelectionRange(1, 1);
  await tick();
  return f;
}
/** A Pulse menu open in the popover: the first picker there. */
function openMenu(h) {
  h.w.RailPulse.open('updates');
  const picker = h.d.querySelector('#app .pz-popover [data-menu]');
  assert.ok(picker, 'the popover has a picker');
  picker.click();
  assert.ok(h.d.querySelector('#app .pz-menu, #app .spick-menu'), 'its menu is open');
}

test('B2.8 F-a1-02: a no-change redraw with a Pulse menu open fits no menu', async () => {
  const h = host();
  openMenu(h);
  h.w.RailPulse.refresh(); h.fits();
  h.w.RailPulse.refresh(); h.w.RailPulse.refresh();
  assert.equal(h.fits(), 0, 'nothing changed: no menu measured');
});

test('B2.8 F-a1-02: opening a menu fits it in that draw; a width change re-fits on the next draw', async () => {
  const h = host();
  h.w.RailPulse.open('updates'); h.w.RailPulse.refresh(); h.fits();
  h.d.querySelector('#app .pz-popover [data-menu]').click();
  assert.ok(h.fits() > 0, 'the opened menu was fitted');
  h.w.RailPulse.refresh(); h.fits();   // drawn a second time, so its opening fade (is-in) is gone
  h.w.RailPulse.refresh();
  assert.equal(h.fits(), 0, 'nothing changed since: not measured again');
  h.size.vw = 260;
  h.w.RailPulse.refresh();
  assert.ok(h.fits() > 0, 'the window narrowed: re-fitted');
  const m = h.d.querySelector('#app .pz-menu, #app .spick-menu');
  assert.equal(m.style.left, '-56px', 'kept 16px inside the narrower window');
});

test('B2.8 F-a1-02: open search results and the Settings sidebar menu are not rewritten by a no-change redraw', async () => {
  const h = host();
  h.w.RailPulse.show('settings', 'runs');
  const q = h.d.querySelector('[data-search]');
  q.value = 'budget'; q.dispatchEvent(new h.w.Event('input', { bubbles: true }));
  const res = h.d.querySelector('[data-search-res]');
  assert.ok(res.querySelector('.rl-search-res'), 'results are open');
  h.w.RailPulse.refresh();
  const side = h.d.querySelector('#side-rail .rail-side-settings');
  const m = countMutations(h.w, h.d.body, exclusions);
  h.w.RailPulse.refresh(); h.w.RailPulse.refresh();
  const r = m.stop();
  const inSide = r.sample.filter((x) => /rail-side-settings|side-/.test(x));
  assert.equal(h.d.querySelector('#side-rail .rail-side-settings'), side);
  assert.deepEqual(inSide, [], 'the sidebar menu is not written');
  assert.equal(r.counted, 0, `no write at all: ${r.sample.join('\n')}`);
});

test('B2.8 pulse.js:773: a typed Settings dialog field keeps its value, caret and focus through RailPulse.refresh()', async () => {
  const h = host();
  await typed(h, '12');
  h.w.RailPulse.refresh(); await tick();
  const f = h.d.getElementById('sv-f-perRun');
  assert.equal(f.value, '12');
  assert.deepEqual([f.selectionStart, f.selectionEnd], [1, 1]);
  assert.equal(h.d.activeElement, f);
});

test('B2.8 comp.keep-open: after the field was carried, a second no-change redraw keeps the same input node', async () => {
  const h = host();
  await typed(h, '12');
  h.w.RailPulse.refresh(); await tick();
  const f = h.d.getElementById('sv-f-perRun');
  h.w.RailPulse.refresh(); await tick();
  assert.equal(h.d.getElementById('sv-f-perRun'), f, 'the same node');
  assert.equal(h.d.activeElement, f);
  h.w.RailPulse.show('settings', 'models'); await tick();
  h.w.RailPulse.show('settings', 'runs'); await tick();
  svdo(h.d, BUDGET).click(); await tick();
  assert.notEqual(h.d.getElementById('sv-f-perRun').value, '12', 'a route change carries nothing');
});

test('B2.8 C1 F-a1-02: a no-change Settings redraw makes no more DOM mutations than its budget', async (t) => {
  const h = host();
  await typed(h, '12');
  h.w.RailPulse.refresh(); await tick();
  const m = countMutations(h.w, h.d.body, exclusions);
  h.w.RailPulse.refresh(); await tick();
  const r = m.stop();
  t.diagnostic(`budget settingsNoChangeMutations: measured ${r.counted}, pinned ${budgets.settingsNoChangeMutations?.value} (${r.total} records)`);
  const c = checkBudget('settingsNoChangeMutations', r.counted, budgets);
  assert.ok(c.ok, `${c.message}\n${r.sample.join('\n')}`);
});

test('B2.8 F-a1-02: a Settings page that changed (a menu opened) still redraws by part and keeps #route-settings\' other nodes', async () => {
  const h = host();
  h.w.RailPulse.show('settings', 'runs');
  const rs = h.d.getElementById('route-settings'), page = rs.firstElementChild;
  const picker = rs.querySelector('[data-menu]');
  assert.ok(picker, 'the page has a picker');
  picker.click();
  assert.ok(rs.querySelector('.spick-menu, .pz-menu'), 'the menu is drawn');
  assert.notEqual(rs.firstElementChild, page, 'the changed page part was replaced');
  assert.equal(rs.querySelectorAll(':scope > .pz-page').length, 1, 'one page');
  const now = rs.firstElementChild;
  h.w.RailPulse.refresh();
  assert.equal(rs.firstElementChild, now, 'an unchanged page keeps its node');
});
