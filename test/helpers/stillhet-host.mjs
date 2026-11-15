// test/helpers/stillhet-host.mjs — Stillhet's app host in jsdom, as test/stillhet-routes.test.mjs builds it: the real classic
// scripts in boot.js's order, without the generated bundles (the library comes from index.mjs). `adapter` stamps
// <html data-adapter>, as src/core/stillhet-shell.mjs does; `beforeScripts(w)` runs after the globals and before the scripts.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import * as R from '../../ui/public/design-system/components/index.mjs';

export const readStillhet = (p) => readFileSync(new URL('../../ui/public/stillhet/' + p, import.meta.url), 'utf8');
const boot = { module: { exports: {} } };
vm.runInNewContext(readStillhet('boot.js'), boot);
export const appScripts = () => boot.module.exports.list('app').scripts.filter((x) => !['components.js', 'graph.js'].includes(x));

export function stillhetHost({ adapter = '', railLocked = false, level = 'expert', hash = '#chat', search = '', fetch, beforeScripts, after } = {}) {
  const stamp = (adapter ? ` data-adapter="${adapter}"` : '') + (railLocked ? ' data-rail-locked="true"' : '');
  const dom = new JSDOM(`<!doctype html><html data-level="${level}"${stamp}><body><div class="app" id="worca"></div><div class="pz-app rail-layer" id="app"></div>${R.toast({})}</body></html>`, { runScripts: 'outside-only', url: `http://localhost/${search}${hash}`, pretendToBeVisual: true });
  const w = dom.window;
  if (after) after(() => w.close());   // the pages keep timers on the window
  w.RailUI = { ...R };
  w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.fetch = fetch || (async () => ({ ok: false, json: async () => ({}) }));
  if (beforeScripts) beforeScripts(w);
  for (const f of appScripts()) w.eval(readStillhet(f));
  return w;
}
