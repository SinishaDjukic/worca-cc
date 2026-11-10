// test/ui-workflow-test-compare.test.mjs — Compare (board 5: C2, G3, G9, G15) and one example side by side (boards 6, 31:
// C10, C19, G2; board 29's side-by-side empty states), on board 5's numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderCompare, renderSideBySide, openWholeResult, sentCount, askMoreTries } from '../ui/public/workflows/test-compare.mjs';
import { serverName } from '../src/shared/workflow-tests/connector-name.mjs';
import { plainClaudeAiName } from '../src/core/workflow-tests/connectors.mjs';
import { compareModel } from '../src/shared/workflow-tests/compare.mjs';

const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const texts = (root, sel) => [...root.querySelectorAll(sel)].map((n) => n.textContent);
const SECTIONS = 'Has the sections Problem, Users, Success metric and Risks';
let nextId = 0;
const tries = (side, exampleId, marks, cost, ms) => [...marks].map((m) => ({
  id: (nextId += 1), side, exampleId, status: m === 'P' ? 'passed' : 'failed', costUsd: cost,
  verdict: { passed: m === 'P', basics: [], checks: [{ label: SECTIONS, met: m === 'P' }], facts: { durationMs: ms, sentBack: side === 'a' ? 2 : 1 } },
}));
const EX = [[1, 'Bulk invoice export', 'PPP', 'PFF'], [2, 'Unclear request: "dark mode please"', 'PFF', 'PPP'], [3, 'A feature we already have', 'FFF', 'PPF'],
  [4, 'Offline mode for the field app', 'PPP', 'PPP'], [5, 'Pricing page A/B test', 'PPF', 'PPF'], [6, 'Customer data export (GDPR)', 'PPP', 'PPP']];
const compare = (over = {}) => {
  const list = EX.flatMap(([id, , a, b]) => [...tries('a', id, a, 0.84, 370000), ...tries('b', id, b, 0.52, 280000)]);
  return {
    run: { id: 7, kind: 'compare', a: 4, b: 'draft', tries: 3, status: 'done', finishedAt: '2026-10-26T10:00:00Z', capUsd: 15, exampleIds: [1, 2, 3, 4, 5, 6] },
    title: 'Your v5 draft compared with v4', labels: { a: 'v4', b: 'v5 draft' }, examples: 6, costUsd: 10.26,
    model: compareModel({ examples: EX.map(([id, name]) => ({ id, name })), a: { label: 'v4' }, b: { label: 'v5 draft' }, tries: list }),
    changes: ['Draft brief: AI model opus → sonnet', 'New step Fact check'], fair: [], ...over,
  };
};
function boot(render, data, ctx = {}, actionsOver = {}) {
  const { window } = new JSDOM('<!doctype html><body><section id="root" tabindex="-1"></section></body>');
  const calls = [];
  const actions = new Proxy({}, { get: (_t, name) => actionsOver[name] || ((...args) => calls.push([name, ...args])) });
  const root = window.document.getElementById('root');
  const opts = { doc: window.document, now: Date.parse('2026-10-26T12:00:00Z'), ...ctx };
  render(root, data, actions, opts);
  return { root, calls, doc: window.document, win: window, again: (d, c = {}) => render(root, d, actions, { ...opts, ...c }) };
}
const tileRows = (root) => [...root.querySelectorAll('.wft-tile')].map((t) => [t.querySelector('.wft-tile-label > span').textContent,
  t.querySelector('.wft-tile-delta') ? t.querySelector('.wft-tile-delta').textContent : null, t.querySelector('.wft-tile-value').textContent, t.querySelector('.wft-tile-sub').textContent]);

test('board 5: the title and meta, In short with Look at it, five tiles', () => {
  const { root, calls } = boot(renderCompare, compare());
  assert.equal(root.querySelector('.wft-title').textContent, 'Your v5 draft compared with v4');
  assert.equal(root.querySelector('.wft-titles .hint').textContent, '6 examples, 3 tries each · ready 2 hours ago · cost $10.26');
  assert.deepEqual(texts(root, '.wft-crumbs .wft-acts button'), ['Test again']);
  assert.equal(root.querySelector('.wft-short p').textContent, `v5 draft is cheaper and faster, and better on 2 examples. It is worse on 1 example, Bulk invoice export: it missed "${SECTIONS}" (2 of 3 tries). It is sent back for fixes less often: 1 time a try, against 2. Its results also vary more from try to try. Look at Bulk invoice export before you share v5 draft.`);
  assert.equal(root.querySelector('.wft-short p b').textContent, 'Bulk invoice export');
  click([...root.querySelectorAll('.wft-short button')].find((b) => b.textContent === 'Look at it'));
  assert.deepEqual(calls, [['open', 1]]);
  assert.deepEqual(tileRows(root), [
    ['Tries passed', '2 more', '14 of 18', 'v4: 12 of 18'],
    ['Cost per try', '38% less', '$0.52', 'v4: $0.84'],
    ['Time per try', '1½ min less', '4 min 40 s', 'v4: 6 min 10 s'],
    ['Sent back for fixes', '1 fewer', '1.0×', 'per try, on average · v4: 2.0×'],
    ['Passed every try', null, '3 of 6', 'examples that passed in every try · v4: 3 of 6'],
  ]);
  assert.equal(root.querySelector('.wft-tile-note'), null, 'every example compared: the tiles count the same tries');
});

// U-T5 (D5): the tiles and rows say only what is true.
const sameModel = (aMarks, bMarks, a, b, ex = [{ id: 1, name: 'X' }]) => compareModel({ examples: ex, a: { label: 'v4' }, b: { label: 'v5 draft' },
  tries: [...tries('a', 1, aMarks, a.cost, a.ms), ...tries('b', 1, bMarks, b.cost, b.ms)] });

test('U-T5: tiles say "about the same" under the threshold, never a raw 10% gap; Passed every try', () => {
  const m = sameModel('PPP', 'PPP', { cost: 1, ms: 40000 }, { cost: 1.05, ms: 44000 });
  const { root } = boot(renderCompare, compare({ examples: 1, model: m }));
  const rows = tileRows(root);
  assert.deepEqual([rows[1][1], rows[2][1], rows[3][1]], ['about the same', 'about the same', '1 fewer'], 'sent back: this helper sends A back 2 times, B once');
  assert.deepEqual(rows[2].slice(2), ['44 s', 'v4: 40 s']);
  assert.ok(!/slower|faster/.test(root.querySelector('.wft-short p').textContent));
  assert.deepEqual(rows[4], ['Passed every try', null, '1 of 1', 'examples that passed in every try · v4: 1 of 1']);
  const far = boot(renderCompare, compare({ examples: 1, model: sameModel('PPP', 'PPP', { cost: 0.0131, ms: 30000 }, { cost: 0.0328, ms: 45000 }) }));
  assert.deepEqual(tileRows(far.root).slice(1, 3), [['Cost per try', '150% more', '$0.0328', 'v4: $0.0131'], ['Time per try', '15 s more', '45 s', 'v4: 30 s']]);
});

test('Fix 3 (UI): no delta when too few tries; $0 baseline tile agrees with In short', () => {
  const few = sameModel('P', 'P', { cost: 1, ms: 20000 }, { cost: 3, ms: 20000 });
  const r1 = tileRows(boot(renderCompare, compare({ examples: 1, model: few })).root);
  assert.equal(r1[1][1], null);
  assert.equal(r1[2][1], null);
  const zero = sameModel('PPP', 'PPP', { cost: 0, ms: 20000 }, { cost: 0.5, ms: 20000 });
  const z = boot(renderCompare, compare({ examples: 1, model: zero }));
  assert.equal(tileRows(z.root)[1][1], 'more');
  assert.ok(/more expensive/.test(z.root.querySelector('.wft-short p').textContent));
});

test('U-T5: a row that fails on both versions says so and has no "Might be luck" or "Try 3 more"', () => {
  const m = sameModel('PFFFF', 'FFFFF', { cost: 1, ms: 20000 }, { cost: 1, ms: 20000 });
  const { root } = boot(renderCompare, compare({ examples: 1, model: m }));
  const row = root.querySelector('.wft-crow2:not(.is-head)');
  assert.equal(row.querySelector('.badge').textContent, 'Same');
  assert.equal(row.querySelector('.wft-why').textContent, `Fails on both versions: "${SECTIONS}" is missed most (9 of 10 tries). Look at the example or its checks.`);
  assert.equal(root.querySelectorAll('.wft-why button').length, 0);
  assert.ok(!/luck/i.test(root.textContent));
});

test('U-T2: tries made again after a problem in Worca are one more line of the fair comparison', () => {
  const one = boot(renderCompare, compare({ fair: ['Your draft changed after this test.'], madeAgain: 1 }));
  assert.deepEqual(texts(one.root, '.wft-fair'), ['Your draft changed after this test.', '1 try was made again after a problem in Worca. It is not counted.']);
  assert.ok(one.root.querySelectorAll('.wft-fair .ic').length === 2, 'with its alert icon, as every note');
  const two = boot(renderCompare, compare({ madeAgain: 2 }));
  assert.deepEqual(texts(two.root, '.wft-fair'), ['2 tries were made again after a problem in Worca. They are not counted.']);
  assert.deepEqual(texts(boot(renderCompare, compare({ madeAgain: 0 })).root, '.wft-fair'), []);
});

test('board 5: by example (G9), why, might be luck with Try 3 more (G15), what you changed, a fair comparison', () => {
  const { root, calls } = boot(renderCompare, compare({ fair: ['Your draft changed after this test.'] }));
  assert.equal(root.querySelector('.wft-by-title').textContent, 'By example');
  assert.equal(root.querySelectorAll('.wft-by [role="tablist"]').length, 0, 'no one-tab switch');
  assert.deepEqual(texts(root, '.wft-crow2.is-head > span'), ['Example', 'v4 passed', 'v5 draft passed', 'Result']);
  const rows = [...root.querySelectorAll('.wft-crow2:not(.is-head)')];
  assert.deepEqual(rows.map((r) => r.querySelector('.badge').textContent), ['Worse', 'Better', 'Better', 'Same', 'Same', 'Same']);
  assert.deepEqual(rows.map((r) => [...r.querySelectorAll('.wft-res')].map((x) => x.textContent)).slice(0, 2), [['3 of 3', '1 of 3'], ['1 of 3', '3 of 3']]);
  assert.equal(rows[0].querySelector('.wft-why').textContent, `v5 draft missed "${SECTIONS}" (2 of 3 tries)`);
  click(rows[2].querySelector('.wft-ex-open'));
  assert.deepEqual(texts(root, '.wft-changes .wft-chg'), ['Draft brief: AI model opus → sonnet', 'New step Fact check']);
  assert.equal(root.querySelector('.wft-changes h2').textContent, 'What you changed since v4');
  assert.equal(root.querySelector('.wft-changes > p.hint').textContent, 'A fair comparison. Both versions were tried on the same 6 examples and checked the same way. If that changes, for example after an example is edited, Worca says so here.');
  assert.deepEqual(texts(root, '.wft-fair'), ['Your draft changed after this test.']);
  assert.ok(root.querySelector('.wft-fair .ic'), 'board 29: each note has its alert icon');
  assert.equal([...root.querySelectorAll('.wft-changes button')].length, 0, 'G3: no "Show both versions on the canvas"');
  const luckList = [...tries('a', 1, 'PPF', 0.5, 1000), ...tries('b', 1, 'PPP', 0.5, 1000)];
  const luck = boot(renderCompare, compare({ examples: 1, model: compareModel({ examples: [{ id: 1, name: 'X' }], a: { label: 'v4' }, b: { label: 'v5 draft' }, tries: luckList }) }));
  const why = luck.root.querySelector('.wft-why');
  assert.equal(why.textContent, 'Might be luck: only 3 tries. Try 3 more');
  click(why.querySelector('button'));
  assert.deepEqual([calls, luck.calls], [[['open', 3]], [['tryMore', 1]]]);
  const full = boot(renderCompare, compare({ examples: 1, run: { ...compare().run, tries: 10 },
    model: compareModel({ examples: [{ id: 1, name: 'X' }], a: { label: 'v4' }, b: { label: 'v5 draft' }, tries: luckList }) }));
  assert.deepEqual([full.root.querySelector('.wft-why').textContent, full.root.querySelectorAll('.wft-why button').length],
    ['Might be luck: only 3 tries.', 0], 'at 10 tries a test can try no more: the note stays, the button goes');
  const none = boot(renderCompare, compare({ changes: [] }));
  assert.equal(none.root.querySelector('.wft-nochange').textContent, 'No steps or settings changed.', 'board 29');
});

test('a test stopped before every example was compared: no In short when nothing compares, the passed tile says what it counts', () => {
  const list = [...tries('a', 1, 'PP', 0.84, 370000), ...tries('b', 1, 'PP', 0.52, 280000), ...tries('a', 2, 'P', 0.84, 370000)];
  const model = compareModel({ examples: [{ id: 1, name: 'Bulk' }, { id: 2, name: 'GDPR' }], a: { label: 'v4' }, b: { label: 'v5 draft' }, tries: list });
  const stopped = boot(renderCompare, compare({ examples: 2, model, run: { ...compare().run, status: 'stopped', exampleIds: [1, 2] } }));
  assert.equal(stopped.root.querySelector('.wft-titles .hint').textContent, '2 examples, 3 tries each · stopped early · cost $10.26');
  const passedTile = stopped.root.querySelector('.wft-tile');
  assert.deepEqual(tileRows(stopped.root)[0], ['Tries passed', '1 fewer', '2 of 2', 'v4: 3 of 3']);
  assert.equal(passedTile.querySelector('.wft-tile-note').textContent, 'Counts every finished try.');
  assert.equal(stopped.root.querySelectorAll('.wft-tile-note').length, 1, 'under that tile only');
  const rows = [...stopped.root.querySelectorAll('.wft-crow2:not(.is-head)')];
  assert.deepEqual([...rows[1].querySelectorAll('.wft-res')].map((x) => x.textContent), ['1 of 1', 'Not tried']);
  const nothing = compareModel({ examples: [{ id: 1, name: 'Bulk' }], a: { label: 'v4' }, b: { label: 'v5 draft' }, tries: tries('a', 1, 'P', 0.84, 1000) });
  const early = boot(renderCompare, compare({ examples: 1, model: nothing, run: { ...compare().run, status: 'stopped' } }));
  assert.equal(early.root.querySelector('.wft-short'), null, 'nothing comparable: no In short');
  assert.deepEqual(tileRows(early.root).slice(1, 3).map((t) => t.slice(1)), [[null, '—', 'v4: —'], [null, '—', 'v4: —']], 'no compared try: no average');
});

test('Try 3 more and Test again stay busy across repaints until their action answers; the focus keeps its button', async () => {
  const pending = [];
  let posts = 0;
  const luckList = [...tries('a', 1, 'PPF', 0.5, 1000), ...tries('b', 1, 'PPP', 0.5, 1000)];
  const data = compare({ examples: 1, model: compareModel({ examples: [{ id: 1, name: 'X' }], a: { label: 'v4' }, b: { label: 'v5 draft' }, tries: luckList }) });
  const b = boot(renderCompare, data, {}, { tryMore: () => { posts += 1; return new Promise((r, j) => pending.push({ r, j })); } });
  const more = () => b.root.querySelector('.wft-why button');
  more().focus();
  click(more());
  assert.equal(more().disabled, true);
  b.again(data);
  assert.equal(more().disabled, true, 'the repainted Try 3 more is still busy');
  click(more());
  assert.equal(posts, 1, 'one post per click');
  pending.shift().j(new Error('boom'));   // a thrown action gives the button back too
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(more().disabled, false);
  assert.equal(more().dataset.focusKey, 'wft-cmp-more-1');
  more().focus();
  b.again(data);
  assert.equal(b.doc.activeElement, more(), 'a repaint keeps the focus on Try 3 more');
  const again = () => [...b.root.querySelectorAll('.wft-acts button')].find((x) => x.textContent === 'Test again');
  assert.equal(again().dataset.focusKey, 'wft-cmp-again');
});

test('Try 3 more on two examples: each button is busy on its own, and each answer gives back only its own button', async () => {
  const pending = [];
  const list = [1, 2].flatMap((id) => [...tries('a', id, 'PPF', 0.5, 1000), ...tries('b', id, 'PPP', 0.5, 1000)]);
  const data = compare({ examples: 2, model: compareModel({ examples: [{ id: 1, name: 'X' }, { id: 2, name: 'Y' }], a: { label: 'v4' }, b: { label: 'v5 draft' }, tries: list }) });
  const b = boot(renderCompare, data, {}, { tryMore: () => new Promise((r) => pending.push(r)) });
  const more = () => [...b.root.querySelectorAll('.wft-why button')];
  click(more()[0]);
  click(more()[1]);
  assert.deepEqual(more().map((x) => x.disabled), [true, true]);
  pending.shift()();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(more().map((x) => x.disabled), [false, true]);
  b.again(data);
  assert.deepEqual(more().map((x) => x.disabled), [false, true], 'and across a repaint');
});

const tv = (id, met) => ({ tryId: id, status: met ? 'passed' : 'failed', name: 'brief.md', text: `## Success metric\nTry ${id}`, truncated: id === 12,
  connectors: 'pretend', wouldHaveSent: [], answeredReads: [],
  verdict: { basics: [{ key: 'noError', label: 'Finishes without an error', met: true, value: 'Met' }, { key: 'maxCostUsd', label: 'Costs at most $1.50', met: true, value: id > 10 ? '$0.49' : '$0.86' }],
    checks: [{ id: 'c_1', label: 'Length is 400 to 900 words', met: true, value: id > 10 ? '518 words' : '742 words' }, { id: 'c_2', label: SECTIONS, met, value: met ? 'Met' : 'Missing Risks' }] } });
const side = (over = {}) => ({
  run: { id: 7, kind: 'compare' }, compareTitle: 'Your v5 draft compared with v4', example: { id: 1, name: 'Bulk invoice export' },
  labels: { a: 'v4', b: 'v5 draft' }, row: { a: { passed: 3, total: 3 }, b: { passed: 1, total: 3 }, result: 'worse' }, connectors: 'pretend',
  tries: [{ n: 1, a: tv(1, true), b: tv(11, true) }, { n: 2, a: tv(2, true), b: tv(12, false) }, { n: 3, a: tv(3, true), b: tv(13, false) }], ...over,
});

test('board 6: the example, Try 1–3, what each version wrote, what was checked in that try', () => {
  const { root, calls } = boot(renderSideBySide, side(), { tryIndex: 1 });
  assert.equal(root.querySelector('.wft-crumb').textContent, 'Your v5 draft compared with v4');
  assert.deepEqual([root.querySelector('.wft-title').textContent, root.querySelector('.wft-detail-name .badge').className], ['Bulk invoice export', 'badge red']);
  assert.equal(root.querySelector('.wft-titles > .hint').textContent, 'v4 passed 3 of 3 tries · v5 draft passed 1 of 3');
  assert.deepEqual([...root.querySelectorAll('[role="tab"]')].map((t) => [t.textContent, t.getAttribute('aria-selected')]), [['Try 1', 'false'], ['Try 2', 'true'], ['Try 3', 'false']]);
  assert.deepEqual(texts(root, '.wft-outs .wft-out-card h2'), ['What v4 wrote', 'What v5 draft wrote']);
  assert.deepEqual(texts(root, '.wft-out'), ['## Success metric\nTry 2', '## Success metric\nTry 12']);
  assert.equal(texts(root, '.wft-outs .hint').includes('Shortened here: read the whole result.'), true);
  const table = root.querySelector('.wft-checked');
  assert.equal(table.getAttribute('aria-label'), 'What was checked in try 2');
  assert.deepEqual(texts(table, '.wft-crow.is-head > span'), ['What was checked', 'v4 · try 2', 'v5 draft · try 2']);
  assert.deepEqual(texts(table, '.wft-crow-grp'), ['Basics', 'Automatic checks']);
  assert.deepEqual([...table.querySelectorAll('.wft-crow:not(.is-head)')].map((r) => [...r.children].map((c) => c.textContent)), [
    ['Finishes without an error', 'Met', 'Met'], ['Costs at most $1.50', '$0.86', '$0.49'],
    ['Length is 400 to 900 words', '742 words', '518 words'], [SECTIONS, 'Met', 'Missing Risks']]);
  click([...root.querySelectorAll('[role="tab"]')][0]);
  click([...root.querySelectorAll('.wft-outs button')].find((b, i) => i === 1));
  click(root.querySelector('.wft-crumb'));
  assert.deepEqual(calls, [['pick', 0], ['readWhole', 12, 'What v5 draft wrote'], ['back']]);
});

test('board 6: the arrow keys move between the tries; a repaint keeps the focus on the picked tab and says which try shows', () => {
  const b = boot(renderSideBySide, side(), { tryIndex: 1 });
  const tabs = () => [...b.root.querySelectorAll('[role="tab"]')];
  assert.deepEqual(tabs().map((t) => t.tabIndex), [-1, 0, -1], 'one tab stop');
  const key = (el, k) => el.dispatchEvent(new b.win.KeyboardEvent('keydown', { key: k, bubbles: true }));
  key(tabs()[1], 'ArrowRight');
  key(tabs()[1], 'ArrowLeft');
  key(tabs()[0], 'ArrowLeft');
  assert.deepEqual(b.calls, [['pick', 2], ['pick', 0], ['pick', 2]], 'it wraps round');
  tabs()[2].focus();
  b.again(side(), { tryIndex: 2 });
  assert.equal(b.doc.activeElement, tabs()[2]);
  const live = b.root.querySelector('.wft-sbs-live');
  assert.deepEqual([live.getAttribute('aria-live'), live.textContent], ['polite', 'Try 3 of 3']);
});

test('board 6 (Task 14 fix 1): the arrow keys keep going when every pick repaints; the focus follows the picked tab', () => {
  const four = side({ tries: [1, 2, 3, 4].map((n) => ({ n, a: tv(n, true), b: tv(n + 10, true) })) });
  const { window } = new JSDOM('<!doctype html><body><section id="root" tabindex="-1"></section></body>');
  const doc = window.document;
  const root = doc.getElementById('root');
  const picked = [];
  const actions = { back() {}, readWhole() {}, pick(k) { picked.push(k); renderSideBySide(root, four, actions, { doc, tryIndex: k }); } };
  renderSideBySide(root, four, actions, { doc, tryIndex: 0 });
  const tabs = () => [...root.querySelectorAll('[role="tab"]')];
  tabs()[0].focus();
  const press = (k) => doc.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true }));
  press('ArrowRight');
  press('ArrowRight');
  assert.deepEqual(picked, [1, 2]);
  assert.equal(doc.activeElement, tabs()[2]);
  assert.deepEqual([doc.activeElement.tabIndex, doc.activeElement.getAttribute('aria-selected')], [0, 'true']);
  press('End');
  press('ArrowRight');
  assert.deepEqual([picked, tabs().indexOf(doc.activeElement)], [[1, 2, 3, 0], 0], 'End, then round to the first');
});

test('board 6 (Task 14 fix 4): Read the whole result is busy per try, so another try\'s button is free meanwhile', async () => {
  const pending = [];
  const b = boot(renderSideBySide, side(), { tryIndex: 0 }, { readWhole: () => new Promise((r) => pending.push(r)) });
  const readB = () => [...b.root.querySelectorAll('.wft-outs button')][1];
  click(readB());
  assert.equal(readB().disabled, true);
  b.again(side(), { tryIndex: 1 });
  assert.equal(readB().disabled, false, 'try 2\'s button is not the one out');
  b.again(side(), { tryIndex: 0 });
  assert.equal(readB().disabled, true, 'back on try 1: still busy');
  pending.shift()();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(readB().disabled, false);
});

test('the reason a try failed shows as it comes (a sentence), under what was checked', () => {
  const s = side();
  s.tries[1].b = { ...s.tries[1].b, verdict: { ...s.tries[1].b.verdict, basics: [{ key: 'noError', label: 'Finishes without an error', met: false, value: 'Not met',
    detail: 'A step failed: Planner: the model answered nothing.' }] } };
  const { root } = boot(renderSideBySide, s, { tryIndex: 1 });
  assert.deepEqual(texts(root, '.wft-detail-why'), ['v5 draft: A step failed: Planner: the model answered nothing.']);
});

test('board 29: no finished try of this example, and a try that left no result', () => {
  const empty = boot(renderSideBySide, side({ tries: [], row: { a: { passed: 0, total: 0 }, b: { passed: 0, total: 0 }, result: null } }));
  assert.equal(empty.root.querySelector('.wft-crumb').textContent, 'Your v5 draft compared with v4');
  assert.equal(empty.root.querySelector('.wft-title').textContent, 'Bulk invoice export');
  assert.deepEqual(texts(empty.root, '.wft-empty-sbs'), ['No finished try of this example in this test.']);
  assert.equal(empty.root.querySelector('.wft-outs'), null);
  const s = side();
  s.tries[0].a = { ...s.tries[0].a, text: null, truncated: false };
  const noText = boot(renderSideBySide, s, { tryIndex: 0 });
  const cards = [...noText.root.querySelectorAll('.wft-out-card')];
  assert.deepEqual(cards.map((c) => [...c.querySelectorAll('button')].map((x) => x.textContent)), [[], ['Read the whole result']], 'nothing to read: no button');
  assert.equal(cards[0].querySelector('.hint').textContent, 'This try left no result.');
  s.tries[0].a = null;
  const oneSide = boot(renderSideBySide, s, { tryIndex: 0 });
  assert.equal(oneSide.root.querySelector('.wft-out-card .hint').textContent, 'No try of this version here.');
});

test('G2: Try it once now shows one column; the whole result opens in a dialog', () => {
  const once = side({ run: { id: 8, kind: 'once' }, labels: { a: null, b: 'Your draft' }, row: { a: { passed: 0, total: 0 }, b: { passed: 1, total: 1 }, result: null },
    tries: [{ n: 1, a: null, b: tv(21, true) }] });
  const { root, doc, win } = boot(renderSideBySide, once, { tryIndex: 0 });
  assert.equal(root.querySelector('.wft-crumb').textContent, 'Tests');
  assert.equal(root.querySelector('.wft-detail-name .badge'), null);
  assert.equal(root.querySelector('.wft-titles > .hint').textContent, 'Your draft passed 1 of 1 try');
  assert.equal(root.querySelectorAll('[role="tab"]').length, 0);
  assert.ok(root.querySelector('.wft-outs').classList.contains('is-one'));
  assert.deepEqual(texts(root, '.wft-outs .wft-out-card h2'), ['What your draft wrote']);
  assert.deepEqual(texts(root, '.wft-checked .wft-crow.is-head > span'), ['What was checked', 'Your draft · try 1']);
  openWholeResult({ doc, win, title: 'What v5 draft wrote', name: 'brief.md', text: '# Brief\n\nAll of it.' });
  assert.equal(doc.querySelector('#mk-dialog-title').textContent, 'What v5 draft wrote');
  assert.equal(doc.querySelector('.wft-whole').textContent, '# Brief\n\nAll of it.');
  click([...doc.querySelectorAll('.mk-dialog-foot button')].find((b) => b.textContent === 'Close'));
  assert.equal(doc.querySelector('#mk-dialog'), null);
});

test('board 31: pretend at the top, what each try would have sent, nothing, the reads, and a real test (C19, N3)', () => {
  const slack = { server: 'slack_team', tool: 'post a message', toolId: 'post_message', noun: 'message', to: '#product',
    preview: 'Brief ready: Bulk invoice export', full: 'Brief ready: Bulk invoice export\nGoal: fewer tickets.' };
  const jira = { server: 'jira', tool: 'create an issue', toolId: 'create_issue', noun: 'issue', to: null,
    preview: 'Bulk invoice export: brief', full: 'Title: Bulk invoice export: brief' };
  const s = side();
  s.tries[1].a = { ...s.tries[1].a, wouldHaveSent: [slack] };
  s.tries[1].b = { ...s.tries[1].b, wouldHaveSent: [slack, jira], answeredReads: [{ server: 'jira', n: 1 }] };
  const { root } = boot(renderSideBySide, s, { tryIndex: 1 });
  assert.equal(root.querySelector('.wft-page > .wft-mode').textContent, 'Connectors: pretend. Nothing was posted or sent.');
  const cards = [...root.querySelectorAll('.wft-sent')];
  assert.deepEqual(cards.map((c) => c.querySelector('h2').textContent), ['Would have sent', 'Would have sent']);
  assert.deepEqual(cards.map((c) => c.querySelector('.wft-sent-head .hint').textContent), ['1 message', '1 message, 1 issue']);
  assert.deepEqual([...cards[1].querySelectorAll('.wft-call summary')].map((x) => x.textContent),
    ['Slack team · post a message · to #product: "Brief ready: Bulk invoice export"', 'Jira · create an issue · "Bulk invoice export: brief"']);
  assert.equal(cards[1].querySelector('.wft-call-full').textContent, 'Full text · to #productBrief ready: Bulk invoice export\nGoal: fewer tickets.');
  assert.equal(cards[1].querySelector('.wft-sent-foot').textContent, 'Worca also answered 1 request in Jira: it came back empty.');
  assert.deepEqual([sentCount([slack, slack, jira]), sentCount([{ ...jira, noun: 'search' }, { ...jira, noun: 'search' }])], ['2 messages, 1 issue', '2 searches']);
  const none = boot(renderSideBySide, side(), { tryIndex: 0 });
  assert.deepEqual(texts(none.root, '.wft-sent-foot'), ['Nothing would have been sent.', 'Nothing would have been sent.']);
  const realSide = side({ connectors: 'real' });
  realSide.tries = realSide.tries.map((t) => ({ ...t, a: { ...t.a, connectors: 'real', wouldHaveSent: null }, b: { ...t.b, connectors: 'real', wouldHaveSent: null } }));
  const real = boot(renderSideBySide, realSide, { tryIndex: 0 });
  assert.equal(real.root.querySelector('.wft-page > .wft-mode'), null, 'no pretend note');
  assert.equal(real.root.querySelectorAll('.wft-sent').length, 0);
  assert.deepEqual(texts(real.root, '.wft-sent-real'), ['Connectors: real. This try used your real connectors.', 'Connectors: real. This try used your real connectors.']);
});

test('a connector by its plain name (one shared helper): no claude.ai prefix, no underscores, a capital first letter', () => {
  assert.deepEqual(['jira', 'slack_team', 'claude_ai_Google_Drive', 'claude.ai Gmail', 'GitHub', ''].map(serverName),
    ['Jira', 'Slack team', 'Google Drive', 'Gmail', 'GitHub', 'a connector']);
  assert.deepEqual(['claude.ai Google Drive', 'claude_ai_gmail', 'claude.ai '].map(plainClaudeAiName), ['Google Drive', 'Gmail', 'claude.ai '],
    'the server\'s claude.ai names build on it, and keep the raw name when nothing is left');
  const ui = readFileSync(new URL('../ui/public/workflows/test-compare.mjs', import.meta.url), 'utf8');
  assert.ok(!/CLAUDE_AI_RE\s*=/.test(ui), 'no copy of the rule in the page');
});

test('app.js: Compare and side by side are wired; Task 10\'s "comes in a later step" page is gone', () => {
  const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  // assert.ok, not assert.match: a failure would print all of app.js.
  assert.ok(!app.includes('This page comes in a later step.'), 'the stub is gone');
  assert.ok(/import \{ renderCompare, renderSideBySide, openWholeResult, askMoreTries \} from '\.\/workflows\/test-compare\.mjs';/.test(app));
  assert.ok(/wftCall\('GET', `\$\{base\}\/compare`\)/.test(app) && /wftCall\('GET', `\$\{base\}\/examples\/\$\{wft\.exampleId\}`\)/.test(app), 'the two reads');
  assert.ok(/connectors: run\.connectors/.test(app), 'Try 3 more keeps the test\'s connectors choice');
});

// Browser check M1: "What v1 wrote" is the board's rendered excerpt, through the app's sandboxed markdown renderer.
async function realMarkdown(doc) {
  const { createMarkdownRenderer } = await import('../ui/public/ask-markdown.mjs');
  const r = createMarkdownRenderer({ doc, load: async () => ({ marked: (await import('marked')).marked, createDOMPurify: (await import('dompurify')).default }), hljsLoader: null });
  assert.equal(await r.ensure(), true);
  return (text, mount) => {
    const out = r.render(text);
    if (out.kind === 'md') { mount.classList.add('ask-md'); mount.replaceChildren(out.frag); } else mount.textContent = text;
  };
}

test('board 6/31 (M1): what each version wrote is rendered markdown, sanitized; without a renderer it stays text', async () => {
  const { window } = new JSDOM('<!doctype html><body><section id="root" tabindex="-1"></section></body>');
  const doc = window.document;
  const root = doc.getElementById('root');
  const renderMarkdown = await realMarkdown(doc);
  const evil = '## Success metric\n\nCut tickets by **60%**.\n\n<img src=x onerror="window.pwned=1"><script>window.pwned=2</script>\n\n[x](javascript:alert(1))';
  const s = side({ tries: [{ n: 1, a: { ...tv(1, true), text: evil }, b: tv(11, true) }] });
  renderSideBySide(root, s, { back() {}, readWhole() {}, pick() {} }, { doc, tryIndex: 0, renderMarkdown });
  const [a, b] = [...root.querySelectorAll('.wft-out')];
  assert.ok(a.classList.contains('ask-md'));
  assert.equal(a.querySelector('h2').textContent, 'Success metric');
  assert.equal(a.querySelector('p strong').textContent, '60%');
  assert.equal(a.querySelector('script, img, [onerror]'), null, 'no raw HTML gets through');
  assert.equal(a.querySelector('a') ? a.querySelector('a').getAttribute('href') : null, null, 'no javascript: link');
  assert.equal(window.pwned, undefined);
  assert.deepEqual([b.querySelector('h2').textContent, b.querySelector('p').textContent], ['Success metric', 'Try 11']);
  const plain = boot(renderSideBySide, side(), { tryIndex: 0 });
  assert.deepEqual(texts(plain.root, '.wft-out'), ['## Success metric\nTry 1', '## Success metric\nTry 11'], 'no renderer: the text as it is');
  // Read the whole result renders it the same way.
  openWholeResult({ doc, win: window, title: 'What v4 wrote', name: 'brief.md', text: evil, renderMarkdown });
  const whole = doc.querySelector('.wft-whole');
  assert.deepEqual([whole.tagName, whole.classList.contains('ask-md'), whole.querySelector('h2').textContent], ['DIV', true, 'Success metric']);
  assert.equal(whole.querySelector('script, img'), null);
});

test('app.js hands the side by side and Read the whole result the sandboxed renderer (M1)', () => {
  const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  // 3a (Task 12) passes the project diff context after the renderer: patches, picked, dateText.
  assert.ok(/renderSideBySide\(root, wft\.data, wftDetailActions\(\), \{ doc: document, tryIndex: wft\.tryIndex \|\| 0, renderMarkdown: wftMarkdown[,\s]/.test(app));
  assert.ok(/openWholeResult\(\{ doc: document, win: window, title, name: r\.data\.name, text: r\.data\.text, renderMarkdown: wftMarkdown \}\)/.test(app));
  assert.ok(/function wftMarkdown\(text, mount\) \{\s*const out = hdMarkdown\.render\(text\);/.test(app), 'hdMarkdown: marked + DOMPurify (ask-markdown.mjs)');
});

test('H1/H2: on a phone the By example and What was checked rows stack; each cell names its column', () => {
  const c = boot(renderCompare, compare());
  const rows = [...c.root.querySelectorAll('.wft-crow2:not(.is-head)')];
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.deepEqual([...r.querySelectorAll('[data-label]')].map((x) => x.dataset.label), ['v4 passed', 'v5 draft passed']);
    assert.ok(r.querySelector('.wft-crow2-res .badge, .wft-crow2-res .hint'), 'the result has its own cell');
  }
  const s = boot(renderSideBySide, side(), { tryIndex: 1 });
  const checked = [...s.root.querySelectorAll('.wft-crow:not(.is-head)')];
  assert.ok(checked.length > 0);
  for (const r of checked) assert.deepEqual([...r.querySelectorAll('[data-label]')].map((x) => x.dataset.label), ['v4 · try 2', 'v5 draft · try 2']);
  const once = boot(renderSideBySide, side({ run: { id: 7, kind: 'once' }, labels: { a: null, b: 'v5 draft' } }), { tryIndex: 0 });
  assert.deepEqual([...once.root.querySelectorAll('.wft-crow:not(.is-head)')][0].querySelectorAll('[data-label]').length, 1);
});

// U-T6 (F12, D6): Try 3 more asks first, with the estimate; nothing is posted unless the person confirms.
const planSide = (use, want, reusable, perTryUsd) => ({ use, want, reusable, perTryUsd });
const askOf = async ({ run = {}, plan, ok = true } = {}) => {
  const q = []; const asked = [];
  const out = await askMoreTries({ run: { id: 7, a: 4, b: 'draft', tries: 3, capUsd: 15, connectors: 'real', ...run }, labels: { a: 'v4', b: 'v5 draft' },
    exampleId: 2, exampleName: 'Bulk invoice export',
    loadPlan: async (p) => { q.push(p); return plan === undefined ? { a: planSide(4, 6, 3, 0.5), b: planSide('draft', 6, 3, 0.5), perTryMs: 1000 } : plan; },
    confirm: async (o) => { asked.push(o); return ok; } });
  return { out, q, asked };
};

test('U-T6: Try 3 more reads the plan for 3 more tries on this example, then asks with the cost', async () => {
  const { out, q, asked } = await askOf();
  assert.deepEqual(q, [{ a: '4', b: 'draft', examples: '2', tries: '6', connectors: 'real' }]);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].title, 'Try Bulk invoice export 3 more times?');
  assert.equal(asked[0].message, '6 more tries of v5 draft and v4: about $3.00. The test stops if the cost goes over $15.00.');
  assert.equal(asked[0].confirmLabel, 'Start 6 tries');
  assert.equal(asked[0].cancelLabel, 'Cancel');
  assert.deepEqual(out, { tries: 6, capUsd: 15 });
});

test('U-T6: Cancel gives nothing back, so nothing is posted', async () => {
  assert.equal((await askOf({ ok: false })).out, null);
});

test('U-T6: a cost that would pass the test\'s cap uses the dialog default, and the answer carries it', async () => {
  const { out, asked } = await askOf({ run: { capUsd: 2 } });
  assert.equal(asked[0].message, '6 more tries of v5 draft and v4: about $3.00. The test stops if the cost goes over $5.00.');
  assert.deepEqual(out, { tries: 6, capUsd: 5 });
});

test('U-T6: an unknown cost says so, keeps the test\'s cap, and an unreadable plan is the same', async () => {
  const noPrice = { a: planSide(4, 6, 3, null), b: planSide('draft', 6, 3, null) };
  for (const plan of [noPrice, null]) {
    const { out, asked } = await askOf({ plan });
    assert.equal(asked[0].message, '6 more tries of v5 draft and v4: the cost is not known yet. The test stops if the cost goes over $15.00.');
    assert.deepEqual(out, { tries: 6, capUsd: 15 });
  }
});

test('U-T6: grammar for one try, and the ten-try ceiling', async () => {
  const one = await askOf({ run: { a: null, tries: 9 }, plan: { a: null, b: planSide('draft', 10, 9, 0.5) } });
  assert.equal(one.asked[0].message, '1 more try of v5 draft: about $0.50. The test stops if the cost goes over $15.00.');
  assert.equal(one.asked[0].confirmLabel, 'Start 1 try');
  assert.deepEqual(one.q, [{ b: 'draft', examples: '2', tries: '10', connectors: 'real' }]);
  assert.equal(one.out.tries, 10);
});

test('U-T6: without a plan the count is the extra tries on each version', async () => {
  const { asked } = await askOf({ plan: null, run: { a: null, tries: 3 } });
  assert.equal(asked[0].message, '3 more tries of v5 draft: the cost is not known yet. The test stops if the cost goes over $15.00.');
  assert.equal(asked[0].confirmLabel, 'Start 3 tries');
});
