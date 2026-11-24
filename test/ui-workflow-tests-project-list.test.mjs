// test/ui-workflow-tests-project-list.test.mjs — workflow tests 3a: the Tests list with project examples (board 38), a past
// project run (board 38), first use and the refused rows (board 39), and the run page's ⋯ for a project run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderTestsPage } from '../ui/public/workflows/tests-view.mjs';
import { openPickRunDialog, openFromRunDialog, canUseAsExample } from '../ui/public/workflows/test-dialogs.mjs';

const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const texts = (root, sel) => [...root.querySelectorAll(sel)].map((n) => n.textContent);
const proj = (over = {}) => ({ key: 'worca-cc-1a2b3c4d', name: 'worca-cc', path: '/code/worca-cc', state: 'ok', startSha: 'abc1234'.padEnd(40, '0'),
  short: 'abc1234', startRef: 'main', startAt: '2026-10-28T09:00:00.000Z', changes: false, setupCmd: 'npm ci', behind: 0, ...over });
const ex = (id, name, over = {}) => ({ id, name, hasRequest: true, files: [], fromAt: null, note: null, tries: 3, basics: 4, checks: 1,
  cells: { 2: { passed: 3, total: 3, stale: false, past: null }, draft: { passed: 1, total: 3, stale: false, past: null } },
  project: proj(), ready: true, reason: null, readyText: null, ...over });
const overview = (over = {}) => ({
  workflowId: 'wf_fix', name: 'Fix a bug from a ticket', needsProject: true, ctx: { liveVersionNo: 2, latestVersionNo: 2 },
  columns: [{ use: 2, label: 'v2 · the team uses it' }, { use: 'draft', label: 'v3 draft · yours' }],
  examples: [
    ex(1, 'Ticket 482: invoice totals round wrong', { project: proj({ behind: 14 }) }),
    ex(2, 'Ticket 471: date filter ignores the time zone', { project: proj({ short: 'e9f2c47', changes: true }) }),
    ex(3, 'Ticket 497: export button does nothing', { project: null, ready: false, reason: 'pick-project', readyText: 'Ticket 497 is left out: pick its project first.', cells: { 2: null, draft: null } }),
  ],
  running: null, latest: null, pastRuns: [], ...over,
});
function boot(o) {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const actions = new Proxy({}, { get: () => () => {} });
  const root = window.document.getElementById('root');
  renderTestsPage(root, o, actions, { doc: window.document, dateText: () => '28 Oct', now: Date.parse('2026-10-28T12:00:00Z') });
  return { root, doc: window.document };
}

test('board 38: project examples in the list, the moved-on line, an example left out, the foot', () => {
  const { root } = boot(overview());
  const rows = [...root.querySelectorAll('.wft-row:not(.wft-row-head)')];
  assert.equal(rows[0].querySelector('.wft-ex > .hint').textContent, 'Request · worca-cc · from main · 28 Oct');   // U-T14 (F26): no commit id
  assert.equal(rows[0].querySelector('.wft-ex > .hint .code'), null);
  const moved = rows[0].querySelector('.wft-moved-line');
  assert.deepEqual([moved.querySelector('.badge').textContent, moved.querySelector('.badge').className], ['Moved on', 'badge amber']);
  assert.equal(moved.lastChild.textContent, 'The project has moved on: 14 newer commits on main since this start point.');
  assert.equal(rows[1].querySelector('.wft-ex > .hint').textContent, 'Request · worca-cc · from main · 28 Oct · with changes not committed yet');
  assert.equal(rows[2].querySelector('.wft-ex > .hint').textContent, 'Request only · no project yet, so it is left out of tests');
  assert.deepEqual(texts(rows[2], '.wft-res'), ['Pick a project first', 'Pick a project first']);
  assert.equal(root.querySelector('.wft-foot-start').textContent, 'Each example keeps its start point. Open an example and pick "Start from the latest" to move it to the newest commit. Both versions are then tried again from there.');
  assert.equal(root.querySelector('.wft-not-testable'), null, 'the D20 state is gone (D62)');
});

test('board 39: first use of a workflow that changes a project; a Folder and a workspace run are listed, disabled', () => {
  const none = boot(overview({ examples: [], pastRuns: [] }));
  assert.equal(none.root.querySelector('.wft-pick > .hint').textContent, 'Worca found no runs of Fix a bug from a ticket yet. Run it once on a project to get a first result, or write an example yourself.');
  const some = boot(overview({ examples: [], pastRuns: [
    { pipelineId: 'aaaa0001', title: 'Fix: invoice totals round wrong', at: '2026-10-28T09:00:00Z', status: 'done', files: 0, sameAs: null, project: 'worca-cc', refusal: null, refusalText: null },
    { pipelineId: 'aaaa0002', title: 'Fix: broken link on the help page', at: '2026-10-18T09:00:00Z', status: 'done', files: 0, sameAs: null, project: 'docs-site', refusal: 'folder',
      refusalText: "This run worked on a Folder project. Folder projects can't be tested yet." }] }));
  const boxes = [...some.root.querySelectorAll('.wft-pick-box')];
  assert.deepEqual(boxes.map((b) => [b.checked, b.disabled]), [[true, false], [false, true]]);
  assert.equal(some.root.querySelector('.wft-pick-why').textContent, "This run worked on a Folder project. Folder projects can't be tested yet.");
  assert.match(some.root.querySelectorAll('.wft-pick-row')[0].textContent, /worca-cc · 28 Oct/);
});

test('board 38/39: the picker: a project run\'s title, badge and sub-line; refused runs disabled with why; none', async () => {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const doc = window.document;
  const picked = [];
  openPickRunDialog({ doc, win: window, workflowName: 'Fix a bug from a ticket', needsProject: true, dateText: () => '28 Oct', onPick: (id) => picked.push(id), runs: [
    { pipelineId: 'aaaa0001', title: 'Fix: invoice totals round wrong', at: 'x', status: 'done', project: 'worca-cc', refusal: null },
    { pipelineId: 'aaaa0003', title: 'Fix: login fails in the app and the API', at: 'x', status: 'done', project: 'mobile-app, api', refusal: 'workspace',
      refusalText: "This run worked on several projects. Workflows on several projects can't be tested yet." }] });
  const rows = [...doc.querySelectorAll('.wft-pick-row')];
  assert.deepEqual(texts(rows[0], '.wft-pick-top b, .wft-pick-top .badge, .wft-pick-sub'), ['Fix: invoice totals round wrong', 'Finished', 'worca-cc · 28 Oct']);
  assert.equal(rows[1].querySelector('input').disabled, true);
  assert.equal(rows[1].querySelector('.wft-pick-why').textContent, "This run worked on several projects. Workflows on several projects can't be tested yet.");
  rows[0].querySelector('input').checked = true;
  click([...doc.querySelectorAll('.mk-dialog button')].find((b) => b.textContent === 'Next'));
  await tick();
  assert.deepEqual(picked, ['aaaa0001']);
  const { window: w2 } = new JSDOM('<!doctype html><body></body>');
  openPickRunDialog({ doc: w2.document, win: w2, workflowName: 'Fix a bug from a ticket', needsProject: true, runs: [], dateText: () => '', onPick() {} });
  assert.equal(w2.document.querySelector('.mk-dialog-body > .hint').textContent, 'Worca found no runs of Fix a bug from a ticket yet. Run it once on a project to get a first result, or write an example yourself.');
});

test('board 38: use a project run as a test example: where it starts, its setup, and what is sent', async () => {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const doc = window.document;
  const sent = [];
  const past = { pipelineId: 'aaaa0001', workflowId: 'wf_fix', workflowName: 'Fix a bug from a ticket', title: 'Ticket 482: invoice totals round wrong',
    request: 'Ticket 482', files: [], qa: [{ question: 'Should old invoices change too?', answer: 'No.' }], use: 2, useLabel: 'v2', testable: true, reason: null,
    project: { key: 'worca-cc-1a2b3c4d', name: 'worca-cc', startSha: 'abc1234'.padEnd(40, '0'), short: 'abc1234', startRef: 'main', startAt: '2026-10-28T09:00:00Z', setupCmd: 'npm ci' } };
  openFromRunDialog({ doc, win: window, past, dateText: () => '28 Oct', onSubmit: async (b) => { sent.push(b); return { ok: true }; } });
  assert.equal(doc.querySelector('.wft-fr-intro').textContent, 'Worca keeps the request and where the run started, so every new version of Fix a bug from a ticket can be tried on exactly the same thing.');
  const box = doc.querySelector('.wft-startbox');
  assert.deepEqual(texts(box, ':scope > span'), ['Where it starts', 'Starts from where this run started: main · 28 Oct',
    "Project: worca-cc · Changes that were not committed: none. Runs always start from a commit. Each try works in Worca's own copy of the project."]);
  assert.equal(box.querySelector('b').textContent, 'main');
  assert.equal(doc.querySelector('#wft-fr-setup').value, 'npm ci');
  assert.equal(doc.querySelector('#wft-fr-setup').closest('.field').querySelector('.hint').textContent, "Filled in from the project's setup.");
  click([...doc.querySelectorAll('.mk-dialog button')].find((b) => b.textContent === 'Add example'));
  await tick();
  assert.equal(sent[0].setupCmd, 'npm ci');
});

test('the run page ⋯ offers Use as test example for a single-project git run too, never a workspace run', () => {
  const base = { flag: true, status: 'done', templateId: 'wf_fix', reserved: false };
  assert.equal(canUseAsExample({ ...base, noProject: false, projectRun: true }), true);
  assert.equal(canUseAsExample({ ...base, noProject: false, projectRun: false }), false);
  assert.equal(canUseAsExample({ ...base, noProject: true }), true);
});

// ── Beyond the brief: the states the boards do not draw, a11y of the refused rows, and Part 2 rows left alone ──

test('P33: an example left out for another reason says why in its row, and its columns read "Can\'t be tried yet"', () => {
  const missing = "Worca can't find worca-cc in /code/worca-cc. Move the folder back, or pick where it is now. The start point is kept.";
  const { root } = boot(overview({ examples: [ex(4, 'Ticket 500: slow export', { project: proj({ state: 'missing', behind: null }), ready: false, reason: 'missing', readyText: missing })] }));
  const row = root.querySelector('.wft-row:not(.wft-row-head)');
  assert.equal(row.querySelector('.wft-ex > .hint').textContent, 'Request · worca-cc · from main · 28 Oct');
  assert.equal(row.querySelector('.wft-left-line').textContent, missing);
  assert.deepEqual(texts(row, '.wft-res'), ["Can't be tried yet", "Can't be tried yet"]);
  assert.deepEqual([...row.querySelectorAll('.wft-res')].map((n) => n.dataset.label), ['v2 · the team uses it', 'v3 draft · yours'], 'each still names its column on a phone');
  assert.equal(row.querySelector('.wft-moved-line'), null);
});

test('board 38: no moved-on line when the start point is current or has no branch; no start-point foot without a project example', () => {
  const { root } = boot(overview({ examples: [ex(1, 'A', { project: proj({ behind: 0 }) }), ex(2, 'B', { project: proj({ behind: 3, startRef: null }) })] }));
  assert.equal(root.querySelectorAll('.wft-moved-line').length, 0);
  assert.ok(root.querySelector('.wft-foot-start'));
  const plain = boot(overview({ needsProject: false, examples: [ex(1, 'A', { project: null })] }));
  assert.equal(plain.root.querySelector('.wft-foot-start'), null);
  assert.equal(plain.root.querySelector('.wft-ex > .hint').textContent, 'Request only', "Part 2's hint for an example without a project");
  assert.deepEqual(texts(plain.root, '.wft-res'), ['3 of 3 passed', '1 of 3 passed']);
});

test('board 39 a11y: a refused run is disabled, aria-disabled and described by its reason; a checked refused box is never added', () => {
  const calls = [];
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const root = window.document.getElementById('root');
  const actions = new Proxy({}, { get: (_t, n) => (...a) => calls.push([n, ...a]) });
  renderTestsPage(root, overview({ examples: [], pastRuns: [
    { pipelineId: 'aaaa0002', title: 'Fix: broken link', at: 'x', status: 'done', files: 0, sameAs: null, project: 'docs-site', refusal: 'folder',
      refusalText: "This run worked on a Folder project. Folder projects can't be tested yet." },
    { pipelineId: 'aaaa0001', title: 'Fix: invoice totals', at: 'x', status: 'done', files: 0, sameAs: null, project: 'worca-cc', refusal: null, refusalText: null }] }),
  actions, { doc: window.document, dateText: () => '28 Oct' });
  const [refused, fine] = [...root.querySelectorAll('.wft-pick-box')];
  assert.equal(refused.getAttribute('aria-disabled'), 'true');
  assert.equal(root.querySelector(`#${refused.getAttribute('aria-describedby')}`).textContent, "This run worked on a Folder project. Folder projects can't be tested yet.");
  assert.ok(refused.closest('.wft-pick-row').classList.contains('is-refused'));
  assert.equal(fine.hasAttribute('aria-disabled'), false);
  refused.checked = true;   // a script or an old browser ticks it anyway
  refused.dispatchEvent(new window.Event('change'));
  const add = root.querySelector('.wft-first-foot .btn-primary');
  assert.equal(add.textContent, 'Add 1 example');
  click(add);
  assert.deepEqual(calls, [['addPastRuns', ['aaaa0001']]]);
});

test("the picker: a refused radio is described by its reason and never picked; a run without a project keeps Part 2's one line", async () => {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const doc = window.document;
  const picked = [];
  openPickRunDialog({ doc, win: window, workflowName: 'Fix a bug from a ticket', needsProject: true, dateText: () => '28 Oct', onPick: (id) => picked.push(id), runs: [
    { pipelineId: 'aaaa0003', title: 'Fix: login', at: 'x', status: 'done', project: 'mobile-app, api', refusal: 'workspace',
      refusalText: "This run worked on several projects. Workflows on several projects can't be tested yet." },
    { pipelineId: 'aaaa0004', title: 'Brief: Q3', at: 'x', status: 'error', project: null, refusal: null }] });
  const rows = [...doc.querySelectorAll('.wft-pick-row')];
  const radio = rows[0].querySelector('input');
  assert.equal(radio.getAttribute('aria-disabled'), 'true');
  assert.equal(doc.getElementById(radio.getAttribute('aria-describedby')).textContent, "This run worked on several projects. Workflows on several projects can't be tested yet.");
  assert.equal(rows[1].textContent, 'Brief: Q3 · 28 Oct · Failed', "Part 2's row (C11)");
  assert.equal(rows[1].querySelector('.wft-pick-top'), null);
  radio.checked = true;
  click([...doc.querySelectorAll('.mk-dialog button')].find((b) => b.textContent === 'Next'));
  await tick();
  assert.deepEqual(picked, []);
  assert.equal(doc.querySelector('.wft-dlg-error').textContent, 'Pick a run first.');
});

test("a past run without a project: no start box, no setup, and no setupCmd in what is sent (Part 2's dialog)", async () => {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const doc = window.document;
  const sent = [];
  const past = { pipelineId: 'p1', workflowId: 'wf_b', workflowName: 'Product brief writer', title: 'Q3 deck', request: 'Make it.', files: [], qa: [],
    use: 4, useLabel: 'v4', testable: true, reason: null, project: null };
  openFromRunDialog({ doc, win: window, past, onSubmit: async (b) => { sent.push(b); return { ok: true }; } });
  assert.equal(doc.querySelector('.wft-fr-intro').textContent, 'Worca keeps the request and files, so every new version of Product brief writer can be tried on exactly the same thing.');
  assert.equal(doc.querySelector('.wft-startbox'), null);
  assert.equal(doc.querySelector('#wft-fr-setup'), null);
  click([...doc.querySelectorAll('.mk-dialog button')].find((b) => b.textContent === 'Add example'));
  await tick();
  assert.equal('setupCmd' in sent[0], false);
});

test("board 38: a cleared setup sends '' (no setup, Fix 1); the dialog body keeps board 38's order", async () => {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const doc = window.document;
  const sent = [];
  const past = { pipelineId: 'aaaa0001', workflowId: 'wf_fix', workflowName: 'Fix a bug from a ticket', title: 'Ticket 482', request: 'Ticket 482', files: [], qa: [],
    use: 2, useLabel: 'v2', testable: true, reason: null,
    project: { key: 'k', name: 'worca-cc', startSha: 'abc1234'.padEnd(40, '0'), short: 'abc1234', startRef: null, startAt: 'x', setupCmd: null } };
  openFromRunDialog({ doc, win: window, past, dateText: () => '28 Oct', onSubmit: async (b) => { sent.push(b); return { ok: true }; } });
  const kids = [...doc.querySelector('.mk-dialog-body').children].map((n) => n.className.split(' ')[0]);
  assert.deepEqual(kids.slice(0, 5), ['wft-fr-intro', 'field', 'wft-startbox', 'wft-keep', 'wft-dev']);
  assert.equal(doc.querySelector('.wft-startbox b').textContent, 'a commit', 'no branch recorded: never the commit id (U-T14, F26)');
  assert.equal(doc.querySelector('#wft-fr-setup').value, '');
  click([...doc.querySelectorAll('.mk-dialog button')].find((b) => b.textContent === 'Add example'));
  await tick();
  assert.equal(sent[0].setupCmd, '', "'' = no setup; the server keeps the project's own only when setupCmd is left out");
});

test('Fix 1: a project example keeps the run it came from and its note after its start point; first use counts the runs it cannot use', () => {
  const { root } = boot(overview({ examples: [ex(1, 'A', { fromAt: '2026-10-28T09:00:00Z', note: 'Worca should ask first', project: proj({ changes: true }) })] }));
  assert.equal(root.querySelector('.wft-ex > .hint').textContent,
    'Request · worca-cc · from main · 28 Oct · with changes not committed yet · from a run on 28 Oct · Worca should ask first');
  const run = (id, refusal) => ({ pipelineId: id, title: id, at: 'x', status: 'done', files: 0, sameAs: null, project: 'worca-cc', refusal,
    refusalText: refusal ? "This run worked on a Folder project. Folder projects can't be tested yet." : null });
  const some = boot(overview({ examples: [], pastRuns: [run('a', null), run('b', 'folder'), run('c', 'folder')] }));
  assert.equal(some.root.querySelector('.wft-pick > .hint').textContent,
    "Worca found 3 recent runs of Fix a bug from a ticket (2 can't be used yet). Pick different kinds of requests, and include ones where the result was not good: they show what must improve.");
  const fine = boot(overview({ examples: [], pastRuns: [run('a', null)] }));
  assert.match(fine.root.querySelector('.wft-pick > .hint').textContent, /^Worca found 1 recent run of Fix a bug from a ticket\. Pick/);
});

test('U-T14 (F26): the list and the "use this run" dialog read "{branch} · {date} · "{commit subject}"", never a commit id', () => {
  const { root } = boot(overview({ examples: [ex(1, 'A', { project: proj({ subject: 'Fix the date filter' }) })] }));
  assert.equal(root.querySelector('.wft-ex > .hint').textContent, 'Request · worca-cc · from main · 28 Oct · "Fix the date filter"');
  const { window } = new JSDOM('<!doctype html><body></body>');
  const past = { pipelineId: 'aaaa0001', workflowId: 'wf_fix', workflowName: 'Fix a bug from a ticket', title: 'Ticket 482', request: 'Ticket 482', files: [], qa: [], use: 2, useLabel: 'v2',
    testable: true, reason: null, project: { key: 'k', name: 'worca-cc', startSha: 'abc1234'.padEnd(40, '0'), short: 'abc1234', startRef: 'main', startAt: '2026-10-28T09:00:00Z', subject: 'Fix the date filter', setupCmd: null } };
  openFromRunDialog({ doc: window.document, win: window, past, dateText: () => '28 Oct', onSubmit: async () => ({ ok: true }) });
  assert.equal(window.document.querySelector('.wft-startbox').textContent.includes('abc1234'), false);
  assert.match(window.document.querySelector('.wft-startbox').textContent, /Starts from where this run started: main · 28 Oct · "Fix the date filter"/);
});
