// test/ui-workflow-test-project-run.test.mjs — workflow tests 3a: Test a version on a project (board 34) and the page while
// it runs (board 35): disk and time, the lock line, examples left out, the phases, the Now column, a setup that failed.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openTestVersionDialog } from '../ui/public/workflows/test-dialogs.mjs';
import { renderTestProgress } from '../ui/public/workflows/test-progress.mjs';

const GB = 2 ** 30;
const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const texts = (root, sel) => [...root.querySelectorAll(sel)].map((n) => n.textContent);
const side = (use, short, n) => ({ use, label: short, short, want: n, reusable: 0, reusableAt: null, perTryUsd: 1, savesUsd: 0 });
const plan = (over = {}) => ({
  a: side(2, 'v2', 15), b: side('draft', 'v3 draft', 15), examples: 5, tries: 3, perTryMs: 7 * 60000,   // 30 tries, 3 at once: 10 rounds of 7 minutes
  connectors: { mode: 'pretend', pretend: ['github'], off: [], scripts: [], quickScripts: [], engines: [] },
  project: { names: ['worca-cc'], leftOut: ['Ticket 497'], disk: { needBytes: 1.2 * GB, freeBytes: 48 * GB, enough: true, text: null }, setupCmd: 'npm ci', setupMs: 2 * 60000 },
  ...over,
});
function dialog(p = plan()) {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const examples = [1, 2, 3, 4, 5].map((id) => ({ id, name: `Ticket ${id}`, tries: 3, ready: true, projectName: 'worca-cc' }))
    .concat([{ id: 6, name: 'Ticket 497', tries: 3, ready: false, reason: 'pick-project', projectName: null }]);
  openTestVersionDialog({ doc: window.document, win: window, options: [{ use: 2, label: 'v2 · the team uses it' }, { use: 'draft', label: 'v3 draft · your changes' }],
    a: 2, b: 'draft', examples, dateText: () => '24 Oct', loadPlan: async () => p, onStart: async () => ({ ok: true }) });
  return window.document;
}

test('board 34: one project, disk and time, the lock line in both modes, an example left out', async () => {
  const doc = dialog();
  await tick(); await tick();
  assert.equal(doc.querySelector('#wft-tv-examples').options[0].textContent, 'All 5 · on worca-cc');
  assert.equal(doc.querySelector('.wft-tv-left').textContent, 'Ticket 497 is left out: pick its project first.');
  assert.deepEqual(texts(doc, '.wft-est-row.is-disk span, .wft-est-row.is-time span').slice(0, 2), ['Disk', 'Needs about 1.2 GB free while it runs · 48 GB free']);
  assert.equal(doc.querySelector('.wft-est-row.is-time').textContent, 'Timeabout 1 hour 10 minutes · setup npm ci takes about 2 minutes a try');
  assert.equal(doc.querySelector('.wft-est-row.is-time .code').textContent, 'npm ci');
  assert.equal(doc.querySelector('.wft-est-row.is-total span').textContent, 'Total');
  const lock = doc.querySelector('.wft-lock');
  assert.equal(lock.hidden, false);
  assert.equal(lock.querySelector('b').textContent, 'Tests never push, open pull requests or change your project.');
  assert.equal(lock.textContent, "Tests never push, open pull requests or change your project. Each try works in Worca's own copy of the project, which is deleted after the checks.");
  assert.equal(doc.querySelector('.wft-safe').hidden, true, 'P13: the lock line takes the shield line\'s place');
  doc.querySelector('#wft-tv-conn-real').checked = true;
  doc.querySelector('#wft-tv-conn-real').dispatchEvent(new doc.defaultView.Event('change'));
  await tick(); await tick();
  assert.match(doc.querySelector('#wft-tv-conn-real').closest('label').querySelector('.hint').textContent, / Pushes, pull requests and issues stay blocked\.$/);
  assert.equal(doc.querySelector('.wft-lock').hidden, false, 'with Real too');
});

test('board 34 aside: too little disk refuses, with Start disabled', async () => {
  const doc = dialog(plan({ project: { names: ['worca-cc'], leftOut: [], setupCmd: null, setupMs: null,
    disk: { needBytes: 1.2 * GB, freeBytes: 0.9 * GB, enough: false, text: 'Not enough free disk to start. This test needs about 1.2 GB free, and this computer has 0.9 GB free. Free up at least 0.3 GB, or pick fewer examples.' } } }));
  await tick(); await tick();
  const refuse = doc.querySelector('.wft-refuse');
  assert.equal(refuse.getAttribute('role'), 'alert');
  assert.equal(refuse.textContent, 'Not enough free disk to start. This test needs about 1.2 GB free, and this computer has 0.9 GB free. Free up at least 0.3 GB, or pick fewer examples.');
  const ok = doc.querySelector('.wft-dlg-ok');
  assert.deepEqual([ok.textContent, ok.disabled], ['Start 30 tries', true]);
});

const progress = (over = {}) => ({
  run: { id: 9, kind: 'compare', status: 'running', stopReason: null, stopDetail: null, tries: 3, a: 2, b: 'draft', exampleIds: [1, 2] },
  title: 'Testing your v3 draft', done: 7, total: 30, costUsd: 7.2, estimateUsd: 31, capUsd: 40, minutesLeft: 55, takenMs: null,
  quick: { status: 'passed' },
  rows: [
    { exampleId: 1, name: 'Ticket 482', label: 'v2', dots: ['passed', 'running', 'waiting'], summary: 'Trying 2 of 3',
      now: { tryNo: 2, phase: 'checking', checking: 'npm test', setupCmd: 'npm ci', startedMs: Date.now() - 60000 } },
    { exampleId: 1, name: 'Ticket 482', label: 'v3 draft', dots: ['running', 'waiting', 'waiting'], summary: 'Trying 1 of 3',
      now: { tryNo: 1, phase: 'working', checking: null, setupCmd: 'npm ci', startedMs: Date.now() - 6 * 60000 } },
    { exampleId: 2, name: 'Ticket 471', label: 'v2', dots: ['running', 'waiting', 'waiting'], summary: 'Trying 1 of 3',
      now: { tryNo: 1, phase: 'setup', checking: null, setupCmd: 'npm ci', startedMs: Date.now() } },
    { exampleId: 2, name: 'Ticket 471', label: 'v3 draft', dots: ['waiting', 'waiting', 'waiting'], summary: 'Waiting', now: null },
  ],
  project: { phases: { exampleName: 'Ticket 482', label: 'v3 draft', tryNo: 1, phase: 'working', start: { ref: 'main', short: 'abc1234', at: '2026-10-28T09:00:00.000Z' }, setupCmd: 'npm ci' },
    disk: { inUseBytes: 0.9 * GB, needBytes: 1.2 * GB, freeBytes: 47 * GB }, setupStop: null },
  ...over,
});
function page(p = progress(), actions = {}) {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const root = window.document.getElementById('root');
  const calls = [];
  renderTestProgress(root, p, { back() {}, stop() {}, continue: (c) => calls.push(['continue', c]), open() {}, editExample: (id) => calls.push(['edit', id]), ...actions },
    { doc: window.document, dateText: () => '28 Oct' });
  return { root, calls, doc: window.document };
}

test('board 35: disk in use, what happens in each try, the Now column', () => {
  const { root } = page();
  const disk = [...root.querySelectorAll('.wft-fact')].find((f) => f.firstChild.textContent === 'Disk in use');
  assert.deepEqual(texts(disk, 'span, b'), ['Disk in use', '0.9 GB', 'of about 1.2 GB · 47 GB free']);
  assert.equal(root.querySelector('.wft-phases h2').textContent, 'What happens in each try');
  assert.deepEqual(texts(root, '.wft-ph b'), ['Preparing a copy of the project', 'Running setup', 'Working', 'Checking']);
  assert.deepEqual(texts(root, '.wft-ph .s'), ['From main at abc1234 · 28 Oct', 'npm ci', 'The workflow does its work', 'The checks run, then the copy is deleted']);
  assert.deepEqual([...root.querySelectorAll('.wft-ph')].map((li) => li.className), ['wft-ph is-done', 'wft-ph is-done', 'wft-ph is-now', 'wft-ph']);
  assert.equal(root.querySelector('.wft-phases > .hint').textContent, 'Shown for Ticket 482, v3 draft, try 1. Up to three tries run at once, each in its own copy of the project.');
  assert.equal(root.querySelector('.wft-prow.is-head').lastChild.textContent, 'Now');
  const nows = [...root.querySelectorAll('.wft-prow:not(.is-head)')].map((r) => r.lastChild.textContent);
  assert.deepEqual(nows, ['Try 2 · Checkingrunning npm test', 'Try 1 · Workingfor 6 minutes', 'Try 1 · Running setupnpm ci', 'Waiting']);
});

test('board 35: the test stopped because the setup step failed', () => {
  const p = progress({
    run: { id: 9, kind: 'compare', status: 'stopped', stopReason: 'setup', stopDetail: 'The setup step failed: npm ci ended with an error.', tries: 3, a: 2, b: 'draft', exampleIds: [1] },
    done: 0, costUsd: 0, takenMs: 60000,
    rows: [{ exampleId: 1, name: 'Ticket 482', label: 'v2', dots: ['stopped', 'waiting', 'waiting'], summary: 'Not finished · 0 of 3 tried', now: null }],
    project: { phases: null, disk: null, setupStop: { cmd: 'npm ci', tail: '> npm ci\nnpm error code EUSAGE', exampleId: 1, exampleName: 'Ticket 482', label: 'v2', tryNo: 1 } },
  });
  const { root, calls } = page({ ...p, project: { ...p.project, disk: { inUseBytes: 0, needBytes: 1.2 * GB, freeBytes: 48 * GB } } });
  assert.equal(root.querySelector('.wft-pill').textContent, 'Stopped · 0 of 30 tries done');
  assert.ok(![...root.querySelectorAll('.wft-fact')].some((f) => f.firstChild.textContent === 'Disk in use'), 'P15: the copies are gone once it stopped');
  assert.equal(root.querySelector('.wft-phases'), null);
  assert.deepEqual(texts(root, '.wft-acts button'), ['Edit the example', 'Try again']);
  const box = root.querySelector('.wft-stopbox');
  assert.equal(box.getAttribute('role'), null, 'Fix 1: the polite live line says it once, not an alert on every repaint');
  assert.equal(root.querySelector('.wft-pg-live').textContent, 'Stopped · 0 of 30 tries done. The setup step failed: npm ci ended with an error.');
  assert.equal(box.textContent, 'The setup step failed: npm ci ended with an error. The test stopped, and no try counts as failed.');
  assert.equal(box.querySelector('b .code').textContent, 'npm ci');
  assert.equal(root.querySelector('.wft-setup-hint').textContent, "Setup gets the project ready before the workflow starts, so a problem there is not the workflow's fault. Cost: $0.00.");
  const see = [...root.querySelectorAll('button')].find((b) => b.textContent === 'See the setup output');
  assert.equal(see.getAttribute('aria-expanded'), 'false');
  assert.equal(root.querySelector('.wft-outlog').hidden, true);
  click(see);
  assert.equal(root.querySelector('.wft-outlog').hidden, false);
  assert.equal(root.querySelector('.wft-outlog').textContent, '> npm ci\nnpm error code EUSAGE');
  assert.equal(root.querySelector('.wft-setup-where').textContent, 'Ticket 482, v2, try 1');
  assert.equal(root.querySelector('.wft-setup-fix').textContent, 'Fix the setup in the example, or in the project, then try again.');
  click([...root.querySelectorAll('button')].find((b) => b.textContent === 'Edit the example'));
  click([...root.querySelectorAll('button')].find((b) => b.textContent === 'Try again'));
  assert.deepEqual(calls, [['edit', 1], ['continue', null]]);
});

test('board 35: a just-started test uses no disk yet; a Part 2 example keeps its So far column', () => {
  const p = progress();
  const { root } = page({ ...p, project: { ...p.project, disk: { inUseBytes: 0, needBytes: 1.2 * GB, freeBytes: 48 * GB } } });
  const disk = [...root.querySelectorAll('.wft-fact')].find((f) => f.firstChild.textContent === 'Disk in use');
  assert.equal(disk.querySelector('b').textContent, '0 GB');
  assert.equal(root.querySelector('.wft-ph.is-now').getAttribute('aria-current'), 'step');
  const part2 = page({ ...p, project: null, rows: p.rows.map((r) => ({ ...r, now: null })) }).root;
  assert.equal(part2.querySelector('.wft-prow.is-head').lastChild.textContent, 'So far');
  assert.equal(part2.querySelector('.wft-phases'), null);
  assert.ok(!part2.textContent.includes('Preparing a copy of the project'), 'never for an example without a project');
});

test('board 35: the setup output stays open across a repaint', () => {
  const p = progress({
    run: { id: 9, kind: 'compare', status: 'stopped', stopReason: 'setup', stopDetail: 'The setup step failed: npm ci ended with an error.', tries: 3, a: 2, b: 'draft', exampleIds: [1] },
    done: 0, costUsd: 0, takenMs: 60000, rows: [],
    project: { phases: null, disk: null, setupStop: { cmd: 'npm ci', tail: 'x', exampleId: 1, exampleName: 'Ticket 482', label: 'v2', tryNo: 1 } },
  });
  const { root, doc } = page(p);
  click([...root.querySelectorAll('button')].find((b) => b.textContent === 'See the setup output'));
  renderTestProgress(root, p, { back() {}, stop() {}, continue() {}, open() {}, editExample() {} }, { doc });
  assert.equal(root.querySelector('.wft-outlog').hidden, false);
  assert.equal([...root.querySelectorAll('button')].find((b) => b.textContent === 'See the setup output').getAttribute('aria-expanded'), 'true');
});

test('board 34: Part 2 examples (no project): "All N", no lock line, the shield line, Total with the minutes', async () => {
  const p = plan({ project: null });
  const { window } = new JSDOM('<!doctype html><body></body>');
  openTestVersionDialog({ doc: window.document, win: window, options: [{ use: 2, label: 'v2' }, { use: 'draft', label: 'v3 draft' }], a: 2, b: 'draft',
    examples: [{ id: 1, name: 'A', tries: 3 }, { id: 2, name: 'B', tries: 3 }], dateText: () => '', loadPlan: async () => p, onStart: async () => ({ ok: true }) });
  await tick(); await tick();
  const doc = window.document;
  assert.equal(doc.querySelector('#wft-tv-examples').options[0].textContent, 'All 2');
  assert.equal(doc.querySelector('.wft-lock').hidden, true);
  assert.equal(doc.querySelector('.wft-safe').hidden, false);
  assert.equal(doc.querySelector('.wft-tv-left').hidden, true);
  assert.equal(doc.querySelector('.wft-est-row.is-disk'), null);
  assert.match(doc.querySelector('.wft-est-row.is-total span').textContent, /^Total · ready in about \d+ minutes$/);
});

// ── Task 11 review, Fix 1 ──
function openWith(examples, p = plan()) {
  const { window } = new JSDOM('<!doctype html><body></body>');
  let asked = 0;
  openTestVersionDialog({ doc: window.document, win: window, options: [{ use: 2, label: 'v2' }, { use: 'draft', label: 'v3 draft' }], a: 2, b: 'draft',
    examples, dateText: () => '', loadPlan: async () => { asked += 1; return p; }, onStart: async () => ({ ok: true }) });
  return { doc: window.document, asked: () => asked };
}

test('Fix 1 (P28): no example can be tried: "All 0", nothing planned, Start disabled and described by the note', async () => {
  const { doc, asked } = openWith([{ id: 1, name: 'Ticket 497', tries: 3, ready: false, reason: 'pick-project' },
    { id: 2, name: 'Ticket 471', tries: 3, ready: false, reason: 'missing' }]);
  await tick(); await tick();
  assert.equal(doc.querySelector('#wft-tv-examples').options[0].textContent, 'All 0');
  assert.equal(asked(), 0, 'no plan: an empty list would plan every example');
  const note = doc.querySelector('.wft-tv-note');
  assert.equal(note.textContent, 'Nothing to try yet: every example is left out. Fix them in the Tests list, then test again.');
  assert.ok(!note.textContent.includes('both versions have results'));
  const ok = doc.querySelector('.wft-dlg-ok');
  assert.deepEqual([ok.textContent, ok.disabled, ok.getAttribute('aria-describedby')], ['Start', true, note.id]);
  assert.equal(doc.querySelector('.wft-est').hidden, true);
  assert.equal(doc.querySelector('#wft-tv-cap').closest('.field').hidden, true);
  assert.equal(doc.querySelector('.wft-tv-left').textContent,
    'Ticket 497 is left out: pick its project first. Ticket 471 is left out: it cannot be tried yet. See the Tests list.');
  // Only the selects, "All 0" with its hint, the note and the disabled Start stay: no tries, connectors or quick check.
  assert.equal(doc.querySelector('.wft-tv-tries').hidden, true);
  assert.equal(doc.querySelector('#wft-tv-quick').closest('.wft-tv-chk').hidden, true);
  assert.equal(doc.querySelector('#wft-tv-conn-pretend').closest('fieldset').hidden, true);
  assert.equal(doc.querySelector('.wft-lock').hidden, true);
  assert.equal(doc.querySelector('.wft-safe').hidden, true);
  assert.equal(doc.querySelector('.wft-tv-left').hidden, false);
  assert.equal(doc.querySelector('#wft-tv-examples').closest('.field').hidden, false);
});

test('Fix 1 (P27): left out by reason; the plan\'s reasons for the other version; the disk alert describes Start', async () => {
  const examples = [{ id: 1, name: 'Ticket 482', tries: 3, ready: true, projectName: 'worca-cc' },
    { id: 2, name: 'Ticket 490', tries: 3, ready: false, reason: 'not-registered' }];
  const p = plan({ project: { names: ['worca-cc'], leftOut: ['Ticket 466'], leftOutWhy: [{ name: 'Ticket 466', reason: 'pick-project' }],
    setupCmd: null, setupMs: null, disk: { needBytes: 1.2 * GB, freeBytes: 0.9 * GB, enough: false, text: 'Not enough free disk to start.' } } });
  const { doc } = openWith(examples, p);
  await tick(); await tick();
  assert.equal(doc.querySelector('.wft-tv-left').textContent,
    'Ticket 466 is left out: pick its project first. Ticket 490 is left out: it cannot be tried yet. See the Tests list.');
  assert.equal(doc.querySelector('.wft-dlg-ok').getAttribute('aria-describedby'), 'wft-tv-refuse');
});

test('Fix 1: "for N minutes" repaints once a minute while a try works; a newer paint or another page ends it', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  try {
    const p = progress({ rows: [{ exampleId: 1, name: 'Ticket 482', label: 'v3 draft', dots: ['running'], summary: 'Trying 1 of 1',
      now: { tryNo: 1, phase: 'working', checking: null, setupCmd: null, startedMs: 1_000_000 - 6 * 60000 } }] });
    const { root } = page(p);
    const cell = () => root.querySelector('.wft-prow:not(.is-head)').lastChild.textContent;
    assert.equal(cell(), 'Try 1 · Workingfor 6 minutes');
    mock.timers.tick(60000);
    assert.equal(cell(), 'Try 1 · Workingfor 7 minutes');
    mock.timers.tick(60000);
    assert.equal(cell(), 'Try 1 · Workingfor 8 minutes');
    root.replaceChildren();   // the page closed
    mock.timers.tick(60000);
    assert.equal(root.children.length, 0, 'no repaint over another page');
    const quiet = page(progress({ rows: [{ exampleId: 1, name: 'A', label: null, dots: ['running'], summary: 'Trying', now: { tryNo: 1, phase: 'setup', setupCmd: 'npm ci', checking: null, startedMs: 1 } }] }));
    const before = quiet.root.querySelector('.wft-progress');
    mock.timers.tick(60000);
    assert.equal(quiet.root.querySelector('.wft-progress'), before, 'nothing working: no timer');
  } finally { mock.timers.reset(); }
});
