// test/stillhet-boot.test.mjs — ui/public/stillhet/boot.js: the one ordered list of scripts and stylesheets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = new URL('../ui/public/stillhet/', import.meta.url).pathname;
// boot.js is a classic script; without a document it exports its list through `module`, which a vm context supplies
const sandbox = { module: { exports: {} } };
vm.runInNewContext(readFileSync(DIR + 'boot.js', 'utf8'), sandbox);
const list = (h) => JSON.parse(JSON.stringify(sandbox.module.exports.list(h)));
const GENERATED = new Set(['components.js', 'graph.js', 'app.css']);   // tools/stillhet-build.mjs writes these
const local = (f) => !f.startsWith('/') && !f.startsWith('../') && !GENERATED.has(f);

for (const host of ['app', 'prototype']) {
  test(`${host} host: no duplicates, and every file the list names exists`, () => {
    const { styles, scripts } = list(host);
    assert.equal(new Set(scripts).size, scripts.length);
    assert.equal(new Set(styles).size, styles.length);
    for (const f of [...styles, ...scripts].filter(local)) assert.ok(existsSync(DIR + f), f);
    assert.ok(existsSync(join(DIR, '../workflows/node-graph.css')));
  });
}

test('the hosts differ only in their host script and stylesheet: the app takes /style.css, the prototype the built app.css', () => {
  const app = list('app'), proto = list('prototype');
  assert.deepEqual(app.scripts.filter((f) => f.startsWith('host-')), ['host-app.js']);
  assert.deepEqual(proto.scripts.filter((f) => f.startsWith('host-')), ['host-prototype.js']);
  assert.deepEqual(proto.scripts.filter((f) => f.startsWith('demo/')), ['demo/demo-actions.js']);
  assert.equal(app.styles[0], '/style.css');
  assert.equal(proto.styles[0], 'app.css');
  const shared = (f) => !f.startsWith('host-') && !f.startsWith('demo/');
  assert.deepEqual(app.scripts.filter(shared), proto.scripts.filter(shared));
  assert.equal(app.scripts.some((f) => /demo/.test(f)), false, 'the app host never loads demo files');
});

test('every page script under ui/public/stillhet/ is loaded by the list, once', () => {
  const loaded = new Set(list('prototype').scripts);
  const found = [];
  for (const d of readdirSync(DIR).filter((n) => statSync(DIR + n).isDirectory())) {
    for (const f of readdirSync(DIR + d).filter((n) => n.endsWith('.js'))) found.push(`${d}/${f}`);
  }
  const skipped = found.filter((f) => !loaded.has(f));
  assert.deepEqual(skipped, ['graph/graph-entry.mjs'].filter(() => false), `not loaded: ${skipped}`);
});

test('a route\'s page file exists once: no name is shared between plans/rail/prototype/ and ui/public/stillhet/', () => {
  const walk = (d, base = d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name), base) : [join(d, e.name).slice(base.length)]));
  const proto = new Set(walk(new URL('../plans/rail/prototype/', import.meta.url).pathname).filter((f) => !f.startsWith('gates/') && !f.startsWith('today/')));
  const shared = walk(DIR).filter((f) => proto.has(f));
  assert.deepEqual(shared, []);
});

test('the prototype host: setStillhet(false) answers { ok: true } and stillhetOn() then agrees with the repainted slot', async (t) => {
  const { JSDOM } = await import('jsdom');
  const w = new JSDOM('<body></body>', { runScripts: 'outside-only', url: 'http://localhost/' }).window;
  t.after(() => w.close());
  w.matchMedia = () => ({ matches: false });
  w.eval(readFileSync(DIR + 'host-prototype.js', 'utf8'));
  assert.equal(w.RailHost.stillhetOn(), true);
  assert.deepEqual({ ...w.RailHost.setStillhet(false) }, { ok: true });
  assert.equal(w.RailHost.stillhetOn(), false);
});

// gate G F-G-fid-16: the prototype opened from file:// (the compare's way) must not import a module: Chrome blocks it and
// logs a console error on every page. Served over http (the app, a local server) the demo kind reads the run options words.
function demoAdapterImports(protocol) {
  let imported = 0; const timers = [];
  const win = { RailHost: { name: 'prototype' }, addEventListener() {} };
  const doc = { documentElement: { getAttribute: () => null }, readyState: 'complete', currentScript: { src: `${protocol}//x/ui/public/stillhet/adapter.js` }, querySelector: () => null };
  vm.runInNewContext(readFileSync(DIR + 'adapter.js', 'utf8'), { window: win, document: doc, location: { protocol }, setTimeout: (fn) => { timers.push(fn); return 0; }, clearTimeout() {}, Promise });
  win.RailAdapter.importRunOptions = () => { imported++; return Promise.resolve({}); };
  for (const fn of timers) fn();
  return imported;
}
test('F-G-fid-16: the demo kind imports no module from file://; over http it reads the run options words', () => {
  assert.equal(demoAdapterImports('file:'), 0, 'file://: no module import (Chrome blocks it)');
  assert.equal(demoAdapterImports('http:'), 1, 'http: the words are read');
});
