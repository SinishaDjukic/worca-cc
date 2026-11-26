// test/ui-shape-show-order.test.mjs — Shaper small runs slice 10 (R-ux-3, R-qa-3): when the feature page offers
// "Show order" (showOrderOffered, beside the run order layout), and the styles and design-system rows of the toggle.
// Literal featureView slice rows: no database, no server. The module is imported inside each test, so each behaviour
// fails on its own until it exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SIXTEEN_RUN_LINKS } from './helpers/shape-sixteen-runs.mjs';
import { cssRules } from './helpers/css-rules.mjs';

const load = () => import('../ui/public/shape/run-order-map.mjs');
const offered = async (slices) => (await load()).showOrderOffered(slices);

/** Slice rows from `[run, buildsOn]` pairs; `done` run numbers are finished, every other run is planned. */
const rows = (pairs, done = []) => pairs.map(([index, buildsOn]) => ({ index, title: `Run ${index}`, kind: null,
  buildsOn: [...buildsOn], state: done.includes(index) ? 'done' : 'planned' }));
const SIXTEEN = SIXTEEN_RUN_LINKS.map(({ run, dependsOn }) => [run, dependsOn]);
const FOUR_BRANCHING = [[1, []], [2, [1]], [3, [1]], [4, [2, 3]]];
const chain = (n, from = 1) => Array.from({ length: n }, (_, i) => [from + i, i ? [from + i - 1] : []]);

// ---- the threshold (D2, D3) -----------------------------------------------------------------------------------------
test('showOrderOffered: it needs at least SHOW_ORDER_MIN_RUNS = 5 runs', async () => {
  assert.equal((await load()).SHOW_ORDER_MIN_RUNS, 5);
});

test('showOrderOffered: the 16-run feature is offered', async () => {
  assert.equal(await offered(rows(SIXTEEN)), true);
});

test('showOrderOffered: a 4-run branching feature is not offered', async () => {
  assert.equal(await offered(rows(FOUR_BRANCHING)), false);
});

test('showOrderOffered: a 6-run plain chain is not offered', async () => {
  const six = rows(chain(6));
  assert.equal(await offered(six), false);
  assert.equal(await offered([3, 0, 5, 1, 4, 2].map((i) => six[i])), false, 'the same rows shuffled');
});

test('showOrderOffered: 5 runs with one join is offered; 5 runs in a chain is not', async () => {
  assert.equal(await offered(rows([[1, []], [2, []], [3, [1, 2]], [4, [3]], [5, [4]]])), true, 'run 3 joins runs 1 and 2');
  assert.equal(await offered(rows(chain(5))), false);
});

test('showOrderOffered: no links, or two separate chains, is not offered', async () => {
  assert.equal(await offered(rows([1, 2, 3, 4, 5, 6].map((i) => [i, []]))), false, 'no links');
  assert.equal(await offered(rows([...chain(3), ...chain(3, 4)])), false, 'chains 1-2-3 and 4-5-6');
});

test('showOrderOffered: a fork (two runs on one) is offered', async () => {
  assert.equal(await offered(rows([[1, []], [2, [1]], [3, [1]], [4, [3]], [5, [4]]])), true);
});

test('showOrderOffered: unknown builds-on indexes and duplicates are ignored', async () => {
  assert.equal(await offered(rows([[1, []], [2, [1]], [3, [2, 2]], [4, [3]], [5, [4]]])), false, '[2, 2] is one link');
  assert.equal(await offered(rows([[1, []], [2, [1]], [3, [2, 99]], [4, [3]], [5, [4, 99]]])), false, '99 is no run');
});

test('showOrderOffered: the 5 runs are distinct run numbers', async () => {
  const four = rows(FOUR_BRANCHING);
  assert.equal(await offered([...four, { ...four[3] }, { ...four[2] }]), false, '6 rows, 4 runs');
  assert.equal(await offered(rows(FOUR_BRANCHING).concat({ title: 'no index', buildsOn: [1, 2] })), false,
    'a row without an integer index is not a run');
});

test('showOrderOffered: all done keeps the answer', async () => {
  const all = SIXTEEN.map(([run]) => run);
  assert.equal(await offered(rows(SIXTEEN, all)), true);
  assert.equal(await offered(rows(SIXTEEN).map(({ index, buildsOn }) => ({ index, buildsOn }))), true,
    'only index and buildsOn are read');
  assert.equal(await offered(rows(chain(6), [1, 2, 3, 4, 5, 6])), false);
});

test('showOrderOffered: bad input', async () => {
  const { showOrderOffered } = await load();
  for (const bad of [null, undefined, {}, [], 'runs', 7, [null, 7, 'x'], [{}, {}, {}, {}, {}, {}]]) {
    assert.equal(showOrderOffered(bad), false, JSON.stringify(bad));
  }
  const odd = rows(chain(6)).map((s, i) => ({ ...s, buildsOn: [null, 'x', 3, {}, undefined, 7][i] }));
  assert.equal(showOrderOffered(odd), false, 'a buildsOn that is no list is no link');
});

// ---- styles (D9, D10; direction d8cc388ff: the hint and the map's run numbers in --ink-2) ---------------------------
const shapeCss = () => readFileSync(new URL('../ui/public/shape/shape-it.css', import.meta.url), 'utf8');
/** The rules of shape-it.css whose selector list names the class `cls`. */
function rulesFor(cls) {
  const own = new RegExp(`\\.${cls}(?![\\w-])`);
  const found = cssRules(shapeCss()).filter((r) => r.sel.split(',').some((s) => own.test(s)));
  assert.ok(found.length, `shape-it.css has a .${cls} rule`);
  return found;
}
/** Every value the rules declare for `prop`. */
const declared = (rules, prop) => rules.flatMap((r) => [...r.body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'g'))]
  .map((m) => m[1].trim()));

test('Show order styles: the hint is caption size in --ink-2, as in the mock', () => {
  const rules = rulesFor('gpage-order-hint');
  assert.deepEqual(declared(rules, 'color'), ['var(--ink-2)']);
  assert.match(rules.map((r) => r.body).join(';'), /var\(--fs-caption\)/);
});

test('Show order styles: the map\'s run numbers are --ink-2', () => {
  assert.deepEqual(declared(rulesFor('rom-n'), 'color'), ['var(--ink-2)']);
});

test('Show order styles: the toggle bar is right-aligned, with no new colour and no motion', () => {
  const bar = rulesFor('gpage-order-bar');
  assert.deepEqual(declared(bar, 'display'), ['flex']);
  assert.deepEqual(declared(bar, 'justify-content'), ['flex-end']);
  rulesFor('gpage-order');
  for (const r of cssRules(shapeCss()).filter((x) => x.sel.includes('.gpage-order'))) {
    assert.doesNotMatch(r.body, /(?:^|;)\s*(?:transition|animation)[\w-]*\s*:/, `${r.sel}: still`);
    assert.doesNotMatch(r.body, /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|hsl)a?\(/, `${r.sel}: tokens only`);
  }
});

// ---- the design system (D10, Step 4) --------------------------------------------------------------------------------
const designDoc = () => readFileSync(new URL('../docs/design-system.md', import.meta.url), 'utf8');
const tableRow = (cls) => designDoc().split('\n').find((l) => l.startsWith('|') && l.includes(`\`.${cls}\``)) || '';

test('Show order design system: the five classes have rows, and the map\'s number row reads --ink-2', () => {
  for (const cls of ['gpage-order', 'gpage-order-bar', 'gpage-order-toggle', 'gpage-order-body', 'gpage-order-hint']) {
    assert.ok(tableRow(cls), `docs/design-system.md has a row for .${cls}`);
  }
  assert.match(tableRow('gpage-order-hint'), /--ink-2/);
  const number = tableRow('rom-n');
  assert.match(number, /--ink-2/);
  assert.doesNotMatch(number, /--ink-3/);
});

test('Show order design system: it says where the map is placed', () => {
  const para = designDoc().split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' '))
    .find((p) => p.includes('Show order') && p.includes('Hide order')) || '';
  assert.ok(para, 'a paragraph that names Show order and Hide order');
  for (const term of [/Runs tab/, /\bclosed\b/i, /\b(?:5|five)\b/i]) assert.match(para, term);
});
