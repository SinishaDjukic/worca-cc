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
