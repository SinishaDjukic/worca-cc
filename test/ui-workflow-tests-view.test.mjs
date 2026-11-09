// test/ui-workflow-tests-view.test.mjs — the Tests page (canvas boards 1, 19, 26 and 29; C1, C8, C11, C14, G4, G13, G19).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderTestsPage, exampleHint, HOW_HIDDEN_KEY } from '../ui/public/workflows/tests-view.mjs';

const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const texts = (root, sel) => [...root.querySelectorAll(sel)].map((n) => n.textContent.trim());
const NOW = Date.parse('2026-10-26T12:00:00Z');
const dateText = () => '14 Oct';
const overview = (over = {}) => ({
  workflowId: 'wf_b', name: 'Product brief writer', ctx: { liveVersionNo: 4, latestVersionNo: 4 },
  columns: [{ use: 4, label: 'v4 · the team uses it' }, { use: 'draft', label: 'v5 draft · yours' }],
  examples: [
    { id: 1, name: 'Bulk invoice export', hasRequest: true, files: ['interviews-q3.md', 'support-tickets.csv'], fromAt: '2026-10-14T10:00:00Z', note: null,
      tries: 3, basics: 3, checks: 2, cells: { 4: { passed: 3, total: 3, stale: false, past: null }, draft: { passed: 1, total: 3, stale: false, past: null } } },
    { id: 2, name: 'Unclear request: "dark mode please"', hasRequest: true, files: [], fromAt: null, note: 'Worca should ask before writing',
      tries: 3, basics: 2, checks: 0, cells: { 4: { passed: 1, total: 3, stale: true, past: null }, draft: null } },
    { id: 3, name: 'Saved filters', hasRequest: false, files: ['usage.csv'], fromAt: null, note: null,
      tries: 3, basics: 2, checks: 0, cells: { 4: { passed: null, total: null, stale: false, past: 'not-good' }, draft: { passed: 0, total: 3, stale: false, past: null } } },
  ],
  running: null,
  latest: { runId: 7, title: 'Latest test: your v5 draft compared with v4', finishedAt: '2026-10-26T10:00:00Z', examples: 6, tries: 3, costUsd: 10.26,
    counts: { better: 2, worse: 1, same: 3 }, status: 'done', stopReason: null },
  pastRuns: [],
  ...over,
});
function boot(o, { storage = null, loading = false, error = null } = {}) {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const calls = [];
  const actions = new Proxy({}, { get: (_t, name) => (...args) => calls.push([name, ...args]) });
  const root = window.document.getElementById('root');
  renderTestsPage(root, o, actions, { doc: window.document, storage, loading, error, dateText, now: NOW });
  return { root, calls, doc: window.document };
}
const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };

test('the list: subtitle, the three buttons, How testing works, the latest test', () => {
  const { root, calls } = boot(overview());
  assert.equal(root.querySelector('.wft-head .subtitle').textContent, 'Test examples show what this workflow must do well. Before you share a change, try it on the examples and see what got better or worse.');
  assert.deepEqual(texts(root, '.wft-head .wft-acts button'), ['Add from a past run', 'New example', 'Test a version']);
  assert.ok(root.querySelector('.wft-head .wft-acts button.btn-primary').textContent === 'Test a version');
  assert.deepEqual(texts(root, '.wft-how .wft-step b'), ['Collect examples', 'Say what a good result needs', 'Test a new version']);
  assert.deepEqual(texts(root, '.wft-how .wft-step > div > span'), [
    'Real requests this workflow gets. Add one from a past run, or write one.',
    'Pick the Basics it must meet and add automatic checks, for example "has the sections Problem and Risks".',
    'Worca tries every example 3 times and shows what got better or worse.',
  ]);
  const latest = root.querySelector('.wft-latest');
  assert.equal(latest.querySelector('.wft-latest-title').textContent, 'Latest test: your v5 draft compared with v4');
  assert.equal(latest.querySelector('.hint').textContent, '2 hours ago · 6 examples, 3 tries each · cost $10.26');
  assert.deepEqual(texts(latest, '.badge'), ['2 better', '1 worse', '3 same']);
  assert.deepEqual([...latest.querySelectorAll('.badge')].map((b) => b.className), ['badge green', 'badge red', 'badge']);
  // U-T5 F30: a zero count is the plain badge, never green or red.
  const zero = boot(overview({ latest: { ...overview().latest, counts: { better: 0, worse: 0, same: 6 } } })).root.querySelector('.wft-latest');
  assert.deepEqual([...zero.querySelectorAll('.badge')].map((b) => b.className), ['badge', 'badge', 'badge']);
  click(latest);
  for (const b of root.querySelectorAll('.wft-head .wft-acts button')) click(b);
  assert.deepEqual(calls.map((c) => c[0]), ['openLatest', 'addFromRun', 'newExample', 'testVersion']);
  assert.equal(calls[0][1], 7);
  assert.match(root.querySelector('.wft-foot').textContent, /^Why 3 tries\? AI can give a different answer each time, so one good try can be luck\. A try passes when everything checked is met\.$/);
});

test('the examples table: columns, hints, what is checked, results with dots, the ⋯ menu', () => {
  const { root, calls } = boot(overview());
  assert.deepEqual(texts(root, '.wft-row-head > span'), ['Example', 'What is checked', 'v4 · the team uses it', 'v5 draft · yours', '']);
  const rows = [...root.querySelectorAll('.wft-row:not(.wft-row-head)')];
  assert.deepEqual(rows.map((r) => r.querySelector('.wft-ex .hint').textContent), [
    'Request + interviews-q3.md, support-tickets.csv · from a run on 14 Oct',
    'Request only · Worca should ask before writing',
    'No request yet',
  ]);
  assert.deepEqual(rows.map((r) => texts(r, '.wft-kind')), [['Basics 3', 'Automatic 2'], ['Basics 2'], ['Basics 2']]);
  assert.deepEqual(rows.map((r) => texts(r, '.wft-res')), [
    ['3 of 3 passed', '1 of 3 passed'],
    ['1 of 3 passed · before a change', 'Not tried'],
    ['Not good · a past run', '0 of 3 passed'],
  ]);
  assert.deepEqual([...rows[0].querySelectorAll('.wft-dot')].map((d) => d.className), ['wft-dot ok', 'wft-dot mix']);
  assert.ok(rows[2].querySelectorAll('.wft-res')[1].classList.contains('is-bad'));
  assert.ok(rows[2].querySelectorAll('.wft-res')[0].classList.contains('is-bad'), 'a past "not good" reads red (board 26)');
  assert.equal(root.querySelector('.wft-latest .hint .code').textContent, '$10.26');
  click(rows[1].querySelector('.wft-ex-open'));
  const more = rows[0].querySelector('.wft-more');
  assert.equal(more.getAttribute('aria-label'), 'More for Bulk invoice export');
  assert.deepEqual([more.textContent, !!more.querySelector('svg')], ['', true], 'an icon, not a glyph (design system)');
  click(more);
  assert.deepEqual([calls[0], calls[1][0], calls[1][2].id], [['openExample', 2], 'exampleMenu', 1]);
});

test('How testing works hides for good when the storage works, and never breaks when it does not', () => {
  const store = memory();
  const a = boot(overview(), { storage: store });
  click([...a.root.querySelectorAll('.wft-how button')].find((b) => b.textContent === 'Hide'));
  assert.equal(a.root.querySelector('.wft-how'), null);
  assert.equal(store.m.get(HOW_HIDDEN_KEY), '1');
  assert.equal(boot(overview(), { storage: store }).root.querySelector('.wft-how'), null);
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  const b = boot(overview(), { storage: broken });
  assert.ok(b.root.querySelector('.wft-how'));
  click([...b.root.querySelectorAll('.wft-how button')].find((x) => x.textContent === 'Hide'));
  assert.equal(b.root.querySelector('.wft-how'), null);
});

test('a running test shows above the latest one (G13), and no second test can start (G19, board 26)', () => {
  const { root, calls } = boot(overview({ running: { runId: 9, title: 'Testing your v5 draft', done: 7, total: 18 } }));
  const testBtn = root.querySelector('.wft-head .wft-acts button.btn-primary');
  assert.deepEqual([testBtn.textContent, testBtn.disabled, testBtn.getAttribute('aria-describedby')], ['Test a version', true, 'wft-busy']);
  assert.equal(root.querySelector('#wft-busy').textContent, 'A test of this workflow is running. Wait for it, or stop it first.');
  const card = root.querySelector('.wft-running');
  assert.equal(card.querySelector('.wft-latest-title').textContent, 'Testing your v5 draft · 7 of 18 tries done');
  assert.equal(card.querySelector('.wft-link').textContent, 'See progress');
  assert.equal(card.querySelector('.wft-run-dot').getAttribute('aria-hidden'), 'true', 'the peach running dot (board 26)');
  click(card);
  assert.deepEqual(calls, [['openRun', 9]]);
});

test('first use: past runs to start from, ticked newest first, then Add N examples (board 19, C11, G4)', () => {
  const runs = [
    { pipelineId: 'p1', title: 'Bulk invoice export', at: '2026-10-14T10:00:00Z', status: 'done', files: 2, sameAs: null },
    { pipelineId: 'p2', title: 'Saved filters for reports', at: '2026-10-14T09:00:00Z', status: 'error', files: 1, sameAs: null },
    { pipelineId: 'p3', title: 'Offline mode', at: '2026-10-09T09:00:00Z', status: 'stopped', files: 0, sameAs: null },
    { pipelineId: 'p4', title: 'Export to PDF, again', at: '2026-10-08T09:00:00Z', status: 'done', files: 0, sameAs: 'Bulk invoice export' },
  ];
  const { root, calls } = boot(overview({ examples: [], latest: null, pastRuns: runs }));
  assert.equal(root.querySelector('.wft-title').textContent, 'Test this workflow before you change it');
  assert.equal(root.querySelector('.wft-first-head .subtitle').textContent, 'Test examples are real requests with a note on what a good result needs. Once you have a few, every change can be tried on them, so you see what got better or worse before your team does.');
  assert.equal(texts(root, '.wft-how .wft-step > div > span')[0], 'Real requests this workflow gets. Start below with past runs.');
  assert.equal(root.querySelectorAll('.wft-how button').length, 0, 'no Hide on first use');
  assert.deepEqual([root.querySelector('.wft-how h2'), root.querySelector('.wft-how').getAttribute('aria-label')], [null, 'How testing works'], 'board 19: no heading');
  assert.equal(root.querySelector('.wft-pick > .hint').textContent, 'Worca found 4 recent runs of Product brief writer. Pick different kinds of requests, and include ones where the result was not good: they show what must improve.');
  const rows = [...root.querySelectorAll('.wft-pick-row')];
  assert.deepEqual(rows.map((r) => r.querySelector('.wft-pick-text').textContent), [
    'Bulk invoice export · 14 Oct · 2 files', 'Saved filters for reports · 14 Oct · 1 file', 'Offline mode · 14 Oct',
    'Export to PDF, again · 14 Oct · the same request as "Bulk invoice export"']);
  assert.deepEqual(rows.map((r) => r.querySelector('.badge').textContent), ['Finished', 'Failed', 'Stopped', 'Same request as another']);
  assert.deepEqual(rows.map((r) => r.querySelector('input').checked), [true, true, true, false]);
  assert.ok(rows.every((r) => r.querySelector('input').classList.contains('wft-pick-box')), 'the listed picker token (ui-shared-controls)');
  const add = root.querySelector('.wft-first-foot .btn-primary');
  assert.equal(add.textContent, 'Add 3 examples');
  const box = rows[1].querySelector('input');
  box.checked = false; box.dispatchEvent(new box.ownerDocument.defaultView.Event('change'));
  assert.equal(add.textContent, 'Add 2 examples');
  click(add);
  click(root.querySelector('.wft-first-foot .wft-linkbtn'));
  assert.deepEqual(calls, [['addPastRuns', ['p1', 'p3']], ['newExample']]);
  assert.equal(root.querySelector('.wft-first-foot .hint').textContent, '3 to 10 examples are a good start. You add what a good result needs in the next step. Or write an example yourself');
});

test('a workflow that needs a project (3a D62, replaces D20 / C8), loading and errors', () => {
  const np = boot(overview({ needsProject: true }));
  assert.equal(np.root.querySelector('.wft-not-testable'), null, 'D62: a workflow that needs a project is testable');
  assert.ok(np.root.querySelector('.wft-table'), 'it shows the list, not a refusal');
  assert.doesNotMatch(np.root.textContent, /without a project/);
  assert.equal(boot(null, { loading: true }).root.textContent, 'Reading the tests…');
  assert.match(boot(null, { error: 'Save the workflow first: tests belong to a saved workflow.' }).root.textContent, /Save the workflow first: tests belong to a saved workflow\./);
  assert.equal(exampleHint({ hasRequest: true, files: [], fromAt: null, note: null }), 'Request only');
});

test('first use with no past run (board 29): the sentence, and Add 0 examples is disabled', () => {
  const { root } = boot(overview({ examples: [], latest: null, pastRuns: [] }));
  assert.equal(root.querySelector('.wft-pick > .hint').textContent, 'Worca found no runs of Product brief writer yet. Write an example yourself, or run the workflow once and come back.');
  assert.equal(root.querySelectorAll('.wft-pick-row').length, 0);
  const add = root.querySelector('.wft-first-foot .btn-primary');
  assert.deepEqual([add.textContent, add.disabled], ['Add 0 examples', true]);
});

test('a past "Good" verdict, a test stopped early, and one column when no version is in use', () => {
  const ex = overview().examples[0];
  const { root } = boot(overview({
    columns: [{ use: 'draft', label: 'Your draft' }],
    examples: [{ ...ex, cells: { draft: { passed: null, total: null, stale: false, past: 'good' } } }],
    latest: { ...overview().latest, status: 'stopped', stopReason: 'cap' },
  }));
  const cell = root.querySelector('.wft-row:not(.wft-row-head) .wft-res');
  assert.deepEqual([cell.textContent, cell.querySelector('.wft-dot').className, cell.classList.contains('is-bad')], ['Good · a past run', 'wft-dot ok', false]);
  assert.deepEqual(texts(root, '.wft-latest .badge'), ['2 better', '1 worse', '3 same', 'Stopped early']);
  assert.ok(root.querySelector('.wft-grid').classList.contains('is-one'));
  assert.deepEqual(texts(root, '.wft-row-head > span'), ['Example', 'What is checked', 'Your draft', '']);
});

test('Add N examples: one post at a time (a double click adds once), and the button comes back after a refusal', async () => {
  const runs = [{ pipelineId: 'p1', title: 'Bulk invoice export', at: '2026-10-14T10:00:00Z', status: 'done', files: 0, sameAs: null }];
  const { window } = new JSDOM('<!doctype html><body><section id="root" tabindex="-1"></section></body>');
  let posts = 0;
  let answer;
  const actions = { addPastRuns: () => { posts += 1; return new Promise((r) => { answer = r; }); }, newExample() {} };
  const root = window.document.getElementById('root');
  renderTestsPage(root, overview({ examples: [], latest: null, pastRuns: runs }), actions, { doc: window.document, dateText, now: NOW });
  const add = root.querySelector('.wft-first-foot .btn-primary');
  click(add);
  click(add);
  assert.equal(posts, 1, 'the second click waits for the first post');
  assert.equal(add.disabled, true);
  answer({ ok: false, error: 'no' });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual([add.disabled, add.textContent], [false, 'Add 1 example']);
});

test('the focus stays on the page (inside the canvas-keys fence): after Hide, and after a repaint that took the focused control', () => {
  const { window } = new JSDOM('<!doctype html><body><section id="root" tabindex="-1"></section><button id="out">x</button></body>');
  const doc = window.document;
  const root = doc.getElementById('root');
  const actions = new Proxy({}, { get: () => () => {} });
  const opts = { doc, storage: null, dateText, now: NOW };
  renderTestsPage(root, overview(), actions, opts);
  const hide = [...root.querySelectorAll('.wft-how button')].find((b) => b.textContent === 'Hide');
  hide.focus();
  click(hide);
  assert.equal(doc.activeElement, root, 'Hide took the focused button away: the page holds the focus');
  root.querySelector('.wft-ex-open').focus();
  renderTestsPage(root, overview(), actions, opts);
  assert.equal(doc.activeElement, root, 'a repaint keeps the focus inside the page');
  doc.getElementById('out').focus();
  renderTestsPage(root, overview(), actions, opts);
  assert.equal(doc.activeElement.id, 'out', 'a repaint never takes the focus from outside the page');
});

// Browser check H1: at 390px the result columns were cut off. On a phone each row stacks and each result names its column.
test('the examples table: each result cell names its column, for the stacked phone layout (H1)', async () => {
  const { readStyleCss } = await import('../src/core/read-style-css.mjs');
  const css = readStyleCss();
  assert.ok(/@media \(max-width:700px\)\{[^\n]*\.wft-row\{[^}]*min-width:0/.test(css), 'no fixed table width on a phone');
  assert.ok(/\.wft-row \[data-label\]::before\{content:attr\(data-label\)/.test(css));
  assert.ok(/\.wft-crow2 \[data-label\]::before\{content:attr\(data-label\)/.test(css), 'Compare By example too');
  assert.ok(/\.wft-crow \[data-label\]::before\{content:attr\(data-label\)/.test(css), 'and What was checked (H2)');
});

test('H1: every result cell carries its column name as data-label', () => {
  const { root } = boot(overview());
  const rows = [...root.querySelectorAll('.wft-row:not(.wft-row-head)')];
  assert.deepEqual(rows.map((r) => [...r.querySelectorAll('[data-label]')].map((c) => c.dataset.label)),
    rows.map(() => ['v4 · the team uses it', 'v5 draft · yours']));
  assert.ok(rows.every((r) => [...r.querySelectorAll('[data-label]')].every((c) => c.classList.contains('wft-res'))));
});
