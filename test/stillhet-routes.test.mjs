// test/stillhet-routes.test.mjs — RailShell.routes() (ui/public/stillhet/shell/shell.js), the route list the compare tool
// walks (tools/stillhet-compare.mjs deepRoutes). The app host's real scripts run in jsdom, in boot.js's order, without the
// generated bundles (the library comes from index.mjs).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import * as R from '../ui/public/design-system/components/index.mjs';

const read = (p) => readFileSync(new URL('../ui/public/stillhet/' + p, import.meta.url), 'utf8');
const boot = { module: { exports: {} } };
vm.runInNewContext(read('boot.js'), boot);

function appHost() {
  const dom = new JSDOM(`<!doctype html><html data-level="expert"><body><div class="app" id="worca"></div><div class="pz-app rail-layer" id="app"></div>${R.toast({})}</body></html>`, { runScripts: 'outside-only', url: 'http://localhost/#chat', pretendToBeVisual: true });
  const w = dom.window;
  after(() => w.close());   // the pages keep timers on the window
  w.RailUI = { ...R };
  w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.fetch = async () => ({ ok: false, json: async () => ({}) });
  for (const f of boot.module.exports.list('app').scripts.filter((x) => !['components.js', 'graph.js'].includes(x))) w.eval(read(f));
  return w;
}

test('RailShell.routes(): every place, every Settings section, every run-page case; each address once', () => {
  const w = appHost();
  const routes = [...w.RailShell.routes()];
  assert.equal(new Set(routes).size, routes.length, 'no duplicate address');
  assert.deepEqual([...routes].sort(), routes, 'sorted');
  const places = [...w.document.querySelectorAll('#side-rail nav.nav [data-nav]')].map((b) => b.dataset.nav);
  assert.ok(places.length >= 9, 'the sidebar drew its places');
  for (const p of [...places, 'pulse']) assert.ok(routes.includes(p), `place ${p}`);
  for (const k of Object.keys(w.SettingsModel.SECTIONS)) assert.ok(routes.includes(`settings/${k}`), `settings/${k}`);
  for (const c of w.RunCardModel.cases) assert.ok(routes.includes(`run/${c.id}`), `run/${c.id}`);
  assert.ok(routes.some((h) => h.startsWith('chat/')) && routes.some((h) => h.startsWith('schedule/')), 'chats and schedules');
});
