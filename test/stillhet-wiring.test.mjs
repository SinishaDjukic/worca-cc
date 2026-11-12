// test/stillhet-wiring.test.mjs — plans/rail/stillhet-wiring.md has a row for every module with actions and every model file
// with seeded figures, each with a known status. A module that gains a RailWould call, or a model file that is added, with no row fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = path.join(ROOT, 'ui/public/stillhet');
const doc = readFileSync(path.join(ROOT, 'plans/rail/stillhet-wiring.md'), 'utf8');
const walk = (d) => readdirSync(d).flatMap((n) => { const p = path.join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const sources = walk(SRC).map((p) => path.relative(ROOT, p)).filter((p) => p.endsWith('.js') && !/\/(components|graph)\.js$/.test(p));
const rows = doc.split('\n').filter((l) => l.startsWith('|') && /`ui\/public\/stillhet\//.test(l));
const rowFor = (file) => rows.find((r) => r.includes('`' + file + '`'));
const STATUS = /\|\s*(wire to|wired|wired \(partial\)|new: build it|add to the design first)\s*\|/;

test('every module that calls RailWould has an action row with a known status', () => {
  const missing = sources.filter((f) => /RailWould\(/.test(readFileSync(path.join(ROOT, f), 'utf8')) && !/(adapter|demo-actions)\.js$/.test(f)).filter((f) => !rowFor(f));
  assert.deepEqual(missing, []);
});

test('every model file and the world have a figure row with a known status', () => {
  const missing = sources.filter((f) => /(-model|world)\.js$/.test(f)).filter((f) => !rowFor(f));
  assert.deepEqual(missing, []);
});

test('every row of the actions and figures tables carries a known status', () => {
  for (const r of rows) assert.match(r, STATUS, r.slice(0, 80));
});

// One row per action and per seeded figure (tools/stillhet-wiring.mjs).
const W = await import('../tools/stillhet-wiring.mjs');

test('phrasesOf: a RailWould literal with every ${…} read as …, a concatenation ends in …, a computed phrase is named', () => {
  assert.deepEqual(W.phrasesOf("RailWould(`open ${a.b} in a new tab`); RailWould('run ' + x); RailWould(say); RailWould(`x ${{ a: 1 }.a} y`)"),
    ['open … in a new tab', 'run …', '(a phrase built from data)', 'x … y']);
});

test('check: an action or a figure with no row is reported, and so is a row with a status outside the three', () => {
  const doc = '# x\n\n## Action rows\n\n| `a › open` | wire to | y |\n| `a › copy` | maybe | y |\n\n## Figure rows\n\n| `m › F.x` | new: build it | y |\n';
  const r = W.check(doc, ['a › open', 'a › copy', 'a › gone'], ['m › F.x', 'm › F.y']);
  assert.deepEqual(r.actions, ['a › gone']);
  assert.deepEqual(r.figures, ['m › F.y']);
  assert.deepEqual(r.badStatus, ['| `a › copy` | maybe | y |']);
});

test('the real wiring file has a row for every action and seeded figure, the named counts among them', async () => {
  const figures = await W.figureIds();
  for (const n of W.NAMED_FIGURES) assert.ok(figures.includes(n), n);
  assert.deepEqual(W.check(doc, W.actionIds(), figures), { actions: [], figures: [], badStatus: [] });
});

test('actionIds: every `would` action of the library\'s run-state flow is an action id, its {names} kept', () => {
  const lib = W.actionIds().filter((id) => id.startsWith('design-system/components/run-state.mjs › '));
  const src = readFileSync(path.join(ROOT, 'ui/public/design-system/components/run-state.mjs'), 'utf8');
  assert.equal(lib.length, new Set([...src.matchAll(/\bwould: '([^']*)'/g)].map((m) => m[1])).size);
  assert.ok(lib.includes('design-system/components/run-state.mjs › open {pr} on GitHub'));
  assert.ok(lib.includes('design-system/components/run-state.mjs › open Settings › Tasks › Budget'));
});

test('the bar, the bell, the sidebar, the profile menu, Pulse and the world are wired, with no "Would"; partial only on the two named rows', () => {
  const live = doc.split('\n').filter((l) => /^\| `(bar|bell|sidebar|profile|pulse\/pulse\.js|pulse\/pulse-model\.js|shell\/world\.js) › /.test(l));
  assert.ok(live.length >= 30, 'the rows are read');
  for (const r of live) {
    assert.match(r, /^\| `[^`]+` \| wired( \(partial\))? \|/, r.slice(0, 90));
    assert.doesNotMatch(r, /Would/, r.slice(0, 90));
  }
  const partial = live.filter((r) => /\| wired \(partial\) \|/.test(r)).map((r) => r.match(/^\| `([^`]+)`/)[1]);
  assert.deepEqual(partial.sort(), ['bell › the Needs you rows', 'profile › the usage rings per harness']);
  for (const id of ['live/live-adapter.mjs › every source and frame', 'live/live-map.mjs › the shapes', 'profile › the interface mode', 'profile › Keep awake', 'profile › Away']) assert.ok(doc.includes('| `' + id + '` | wired |'), id);
});

test('the wiring tool accepts wired and wired (partial)', () => {
  const doc = '# x\n\n## Action rows\n\n| `a › open` | wired | y |\n\n## Figure rows\n\n| `m › F.x` | wired (partial) | y |\n';
  assert.deepEqual(W.check(doc, ['a › open'], ['m › F.x']), { actions: [], figures: [], badStatus: [] });
});
