// test/stillhet-pulse-app-host.test.mjs — pulse.js's clicks in the app host. The app serves <html data-level="…"> (dev's
// interface mode, src/core/index-html.mjs), so a click handler that matches a bare [data-level] with closest() catches every
// click on the page. The profile menu's Settings item must still reach RailShell.go('settings/').
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as R from '../ui/public/design-system/components/index.mjs';

const read = (p) => readFileSync(new URL('../ui/public/stillhet/' + p, import.meta.url), 'utf8');
const BODY = '<aside id="side-rail"><nav class="nav"></nav><div id="side-foot"></div></aside><span id="rail-pulse-slot"></span>'
  + '<div id="rail-strip"></div><section id="route-settings" hidden></section><div class="pz-app rail-layer" id="app"></div>';

function appHost() {
  const dom = new JSDOM(`<!doctype html><html data-level="expert"><body>${BODY}${R.toast({})}</body></html>`, { runScripts: 'outside-only', url: 'http://localhost/#chat' });
  const w = dom.window;
  after(() => w.close());   // pulse.js keeps timers on the window
  w.RailUI = { ...R };
  w.RailHost = { name: 'app', stillhetOn: () => true };
  w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const went = [];
  // a stub of shell.js's RailShell: only what pulse.js calls while it starts and answers these clicks
  w.RailShell = {
    owns: (who, t) => who === 'pulse' && !!t?.isConnected, go: (h) => went.push(h), closeDrawer: () => {}, connReset: () => {},
    pageContext: () => ({}), needs: () => null, locked: () => false, runActive: () => false, start: () => w.RailPulse.show('runs', '', 'chat'),
  };
  for (const f of ['adapter.js', 'runs/run-page-model.js', 'shell/world.js', 'pulse/pulse-model.js', 'settings/settings-model.js', 'settings/settings.js', 'pulse/pulse.js']) w.eval(read(f));
  return { w, went };
}

test('app host: the profile menu\'s Settings item goes to #settings/ although <html> carries data-level', () => {
  const { w, went } = appHost();
  w.document.querySelector('[data-acct]').click();
  const item = w.document.querySelector('[data-go="settings"]');
  assert.ok(item, 'the profile menu is open');
  item.click();
  assert.deepEqual(went, ['settings/']);
});

test('a repaint keeps a toast another page said (a refused Settings change says Not connected through the adapter)', () => {
  const { w } = appHost();
  w.RailAdapter.toast(w.RailAdapter.NOT_CONNECTED);
  w.RailPulse.open('now');   // Pulse repaints, with no toast of its own
  const t = w.document.querySelector('body > .rc-toast');
  assert.match(t.textContent, /Not connected to Worca yet\./);
  assert.ok(t.classList.contains('is-on'));
});

test('RailPulse.open(tab) shows the popover on that tab (the bell and #activity use it)', () => {
  const { w } = appHost();
  w.RailPulse.open('now');
  const pop = w.document.querySelector('#app .pz-popover');
  assert.ok(pop, 'the popover is open');
  assert.equal(pop.querySelector('[data-ptab="vitals"]').getAttribute('aria-selected'), 'true');
  w.RailPulse.open('updates');
  assert.equal(w.document.querySelector('#app .pz-popover [data-ptab="updates"]').getAttribute('aria-selected'), 'true');
});

test('the account menu closes when the page moves on (a hashchange): it never stays open over the next page', async () => {
  const { w } = appHost();
  w.document.querySelector('[data-acct]').click();
  assert.ok(w.document.querySelector('#app .acct-menu'), 'open');
  w.location.hash = '#runs';
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(w.document.querySelector('#app .acct-menu'), null, 'closed on navigation');
});

test('with no usage reading, Usage and costs wears an empty ring glyph and the dollar spend, never a percent (small.usage-rings)', () => {
  const { w } = appHost();
  w.PulseModel.rings = () => [];   // no provider reading: the same acctMenu draws demo and live
  w.document.querySelector('[data-acct]').click();
  const row = w.document.querySelector('[data-sub="usage"]');
  const ring = row.querySelector('.pz-mi-ring');
  assert.ok(ring, 'the ring glyph is drawn');
  assert.match(ring.getAttribute('style'), /--p:0;/, 'an empty track, no arc');
  assert.doesNotMatch(row.textContent, /%/);
  assert.match(row.textContent, /\$/);
});
