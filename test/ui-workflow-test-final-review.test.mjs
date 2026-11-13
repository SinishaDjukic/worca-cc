// test/ui-workflow-test-final-review.test.mjs — workflow tests 3a, the final review's UI and docs items: the setup hint after
// a change, the lock line before the plan loads (M1), labels inside sentences (M2), a pick-project example's summary (M3),
// monospace fields (M4), a command check in code (M5), the diff cache (M6), one start-point helper (M7), "1 try" (M8), the
// setup note without a setup (M9), the footer after a setup stop, and the docs' limits line (M10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { readStyleCss } from '../src/core/read-style-css.mjs';
import { openTestVersionDialog, openFromRunDialog } from '../ui/public/workflows/test-dialogs.mjs';
import { renderTestProgress } from '../ui/public/workflows/test-progress.mjs';
import { renderTestsPage } from '../ui/public/workflows/tests-view.mjs';
import { renderSideBySide } from '../ui/public/workflows/test-compare.mjs';
import { startInto } from '../ui/public/workflows/test-ui.mjs';
import * as t from '../src/shared/workflow-tests/project-text.mjs';

const GB = 2 ** 30;
const tick = () => new Promise((r) => setTimeout(r, 0));
const texts = (root, sel) => [...root.querySelectorAll(sel)].map((n) => n.textContent);
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('the setup hint after a change names no example: the draft or a version may be what changed', () => {
  assert.equal(t.SETUP_EDITED_HINT, 'Something this test uses changed since it started (an example or a version). Start a new test to try it again.');
});

test('M2: a label inside a sentence: "your draft", never "Your draft", in the phases line and the setup line', () => {
  assert.equal(t.inSentence('Your draft'), 'your draft');
  assert.equal(t.inSentence('v3 draft'), 'v3 draft');
  assert.equal(t.phasesShownFor('Ticket 482', 'Your draft', 1), 'Shown for Ticket 482, your draft, try 1. Up to three tries run at once, each in its own copy of the project.');
  assert.equal(t.setupWhere('Ticket 482', 'Your draft', 1), 'Ticket 482, your draft, try 1');
});

const side = (use, short, n) => ({ use, label: short, short, want: n, reusable: 0, reusableAt: null, perTryUsd: 1, savesUsd: 0 });
const plan = { a: side(2, 'v2', 3), b: side('draft', 'v3 draft', 3), examples: 1, tries: 3, perTryMs: 60000,
  connectors: { mode: 'pretend', pretend: [], off: [], scripts: [], quickScripts: [], engines: [] },
  project: { names: ['worca-cc'], leftOut: [], disk: { needBytes: GB, freeBytes: 48 * GB, enough: true, text: null }, setupCmd: null, setupMs: null } };

test('M1: while the plan loads, a project test already shows the lock line and the Real hint says pushes stay blocked', async () => {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const doc = window.document;
  let release;
  openTestVersionDialog({ doc, win: window, options: [{ use: 2, label: 'v2' }, { use: 'draft', label: 'v3 draft' }], a: 2, b: 'draft',
    examples: [{ id: 1, name: 'Ticket 482', tries: 3, ready: true, projectName: 'worca-cc' }], dateText: () => '28 Oct',
    loadPlan: () => new Promise((r) => { release = () => r(plan); }), onStart: async () => ({ ok: true }) });
  await tick();
  assert.equal(doc.querySelector('.wft-lock').hidden, false, 'the lock line, not the shield line, before the plan');
  assert.equal(doc.querySelector('.wft-safe').hidden, true);
  assert.match(doc.querySelector('#wft-tv-conn-real').closest('label').querySelector('.hint').textContent, / Pushes, pull requests and issues stay blocked\.$/);
  release(); await tick(); await tick();
  assert.equal(doc.querySelector('.wft-lock').hidden, false);
  const { window: w2 } = new JSDOM('<!doctype html><body></body>');
  openTestVersionDialog({ doc: w2.document, win: w2, options: [{ use: 2, label: 'v2' }, { use: 'draft', label: 'v3 draft' }], a: 2, b: 'draft',
    examples: [{ id: 1, name: 'Brief', tries: 3, ready: true, projectName: null }], dateText: () => '28 Oct',
    loadPlan: () => new Promise(() => {}), onStart: async () => ({ ok: true }) });
  await tick();
  assert.equal(w2.document.querySelector('.wft-lock').hidden, true, 'a Part 2 test keeps the shield line');
  assert.equal(w2.document.querySelector('.wft-safe').hidden, false);
});

const ex = (id, name, over = {}) => ({ id, name, hasRequest: true, files: [], fromAt: null, note: null, tries: 3, basics: 4, checks: 1,
  cells: { 2: null, draft: null }, project: null, ready: false, reason: 'pick-project', readyText: `${name} is left out: pick its project first.`, ...over });
test('M3: a pick-project example says what it has: files, no request, or the request only', () => {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const root = window.document.getElementById('root');
  renderTestsPage(root, { workflowId: 'wf_fix', name: 'Fix a bug', needsProject: true, ctx: { liveVersionNo: 2, latestVersionNo: 2 },
    columns: [{ use: 2, label: 'v2' }, { use: 'draft', label: 'v3 draft · yours' }],
    examples: [ex(1, 'A', { files: ['ticket.md'] }), ex(2, 'B', { hasRequest: false }), ex(3, 'C')], running: null, latest: null, pastRuns: [] },
  new Proxy({}, { get: () => () => {} }), { doc: window.document, dateText: () => '28 Oct', now: Date.parse('2026-10-28T12:00:00Z') });
  assert.deepEqual(texts(root, '.wft-row:not(.wft-row-head) .wft-ex > .hint'), [
    'Request + ticket.md · no project yet, so it is left out of tests',
    'No request yet · no project yet, so it is left out of tests',
    'Request only · no project yet, so it is left out of tests']);
});

test('M4: the setup input, the command box and the from-run setup input are monospace over the field font rule', () => {
  const css = readStyleCss();
  const rule = css.split('\n').find((l) => l.includes('input.wft-mono[type="text"]'));
  assert.ok(rule && rule.includes('font-family:var(--mono)'), 'a rule more specific than input[type="text"] sets the mono font');
});

const A = { tryId: 11, status: 'passed', connectors: 'pretend', text: null, name: null, truncated: false, answeredReads: [], wouldHaveSent: [],
  // Round 2: the verdict carries the check's kind and command (checkTry); the page never parses the label.
  verdict: { basics: [], checks: [{ id: 'c_1', kind: 'command', cmd: 'npm ci && npm test', label: 'The command npm ci && npm test passes', met: true, value: '213 passed' },
    { id: 'c_2', label: 'The command looks like this passes', met: true, value: 'Met' }] }, project: null };
const sbs = (over = {}) => ({
  run: { id: 5, kind: 'compare' }, compareTitle: 'Your v3 draft compared with v1', example: { id: 1, name: 'Ticket 482' },
  labels: { a: 'v1', b: 'v3 draft' }, row: { result: 'same', a: { passed: 1, total: 1 }, b: { passed: 1, total: 1 } }, connectors: 'pretend',
  tries: [{ n: 1, a: A, b: { ...A, tryId: 12 } }], start: { ref: 'main', short: 'abc1234', at: '2026-10-28T09:00:00.000Z', setupCmd: null, setupMs: null },
  nothingPushed: true, ...over });
function paintSbs(s) {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const root = window.document.getElementById('root');
  renderSideBySide(root, s, { back() {}, pick() {}, readWhole() {}, loadChanges() {}, pickFile() {}, readChanges() {}, commandOutput() {} },
    { doc: window.document, tryIndex: 0, patches: new Map(), picked: {}, dateText: () => '28 Oct' });
  return root;
}
test('M5 and M8: "What was checked" sets the command in code; one try is "1 try"', () => {
  const root = paintSbs(sbs());
  const rows = [...root.querySelectorAll('.wft-crow:not(.is-head)')];
  const row = rows.find((r) => r.firstChild.textContent === 'The command npm ci && npm test passes');
  assert.equal(row.firstChild.querySelector('.code').textContent, 'npm ci && npm test', 'from the verdict\'s kind and command');
  const other = rows.find((r) => r.firstChild.textContent === 'The command looks like this passes');
  assert.equal(other.firstChild.querySelector('.code'), null, 'a label that only reads like a command stays plain');
  assert.match(root.querySelector('.wft-pg-head .hint').textContent, /^v1 passed 1 of 1 try · v3 draft passed 1 of 1/);
});

test('M7 (U-T14, F26): one helper writes "branch · date · "subject"" (bold branch where asked), the commit id only for developers; the four views use it', () => {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const doc = window.document;
  const plain = startInto(doc, doc.createElement('span'), { ref: 'main', short: 'abc1234', at: 'x' }, () => '28 Oct');
  assert.equal(plain.textContent, 'main · 28 Oct');
  assert.equal(plain.querySelector('.code'), null);
  assert.equal(plain.querySelector('b'), null);
  const said = startInto(doc, doc.createElement('span'), { ref: 'main', short: 'abc1234', at: 'x', subject: 'Fix the date filter' }, () => '28 Oct');
  assert.equal(said.textContent, 'main · 28 Oct · "Fix the date filter"');
  const dev = startInto(doc, doc.createElement('span'), { ref: 'main', short: 'abc1234', at: 'x', subject: 'Fix the date filter' }, () => '28 Oct', { dev: true });
  assert.equal(dev.textContent, 'main at abc1234 · 28 Oct', 'For developers: the commit id, no subject');
  assert.equal(dev.querySelector('.code').textContent, 'abc1234');
  const bold = startInto(doc, doc.createElement('span'), { ref: null, short: 'abc1234', at: null }, () => '28 Oct', { bold: true });
  assert.equal(bold.textContent, 'a commit', 'no branch and no date: never the commit id');
  assert.equal(bold.querySelector('b').textContent, 'a commit');
  for (const f of ['example-editor.mjs', 'test-compare.mjs', 'test-dialogs.mjs', 'test-progress.mjs']) {
    const src = read(`../ui/public/workflows/${f}`);
    assert.ok(/startInto\(/.test(src), `${f} uses the helper`);
    assert.ok(!/createTextNode\(' at '\)|\} at `\)/.test(src), `${f} builds no "at" itself`);
  }
});

test('M9: the from-run dialog says "Filled in from the project\'s setup" only when there is a setup', () => {
  const past = (setupCmd) => ({ pipelineId: 'aaaa0001', workflowId: 'wf_fix', workflowName: 'Fix a bug', title: 'Fix', request: 'Fix it.', files: [], qa: [],
    use: 2, useLabel: 'v2', testable: true, reason: null, reasonText: null,
    project: { key: 'worca-cc-1a2b3c4d', name: 'worca-cc', startSha: 'abc1234'.padEnd(40, '0'), short: 'abc1234', startRef: 'main', startAt: '2026-10-28T09:00:00.000Z', setupCmd } });
  for (const [cmd, shown] of [['npm ci', true], [null, false]]) {
    const { window } = new JSDOM('<!doctype html><body></body>');
    openFromRunDialog({ doc: window.document, win: window, past: past(cmd), dateText: () => '28 Oct', onAdd: async () => ({ ok: true }) });
    const hint = [...window.document.querySelectorAll('.hint')].find((h) => h.textContent === t.SETUP_HINT_PAST);
    assert.equal(!!hint && !hint.hidden, shown, `setup ${cmd}`);
  }
});

test('the footer "Stop testing keeps the tries that are done" is not shown after a setup stop', () => {
  const p = (stopReason) => ({
    run: { id: 9, kind: 'compare', status: 'stopped', stopReason, stopDetail: 'x', tries: 3, a: 2, b: 'draft', exampleIds: [1] },
    title: 'Testing your v3 draft', done: 0, total: 30, costUsd: 0, estimateUsd: 31, capUsd: 40, minutesLeft: null, takenMs: 60000, quick: null, rows: [],
    project: { phases: null, disk: null, setupStop: stopReason === 'setup' ? { cmd: 'npm ci', tail: '', exampleId: 1, exampleName: 'Ticket 482', label: 'v2', tryNo: 1, edited: false } : null } });
  const foot = (stopReason) => {
    const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
    const root = window.document.getElementById('root');
    renderTestProgress(root, p(stopReason), { back() {}, stop() {}, continue() {}, open() {}, editExample() {} }, { doc: window.document, dateText: () => '28 Oct' });
    return [...root.querySelectorAll('p.hint')].some((n) => n.textContent.startsWith('Stop testing keeps the tries that are done'));
  };
  assert.equal(foot('setup'), false);
  assert.equal(foot('user'), true, 'other stops keep it');
});

test('M6: the Tests page lets go of the opened diffs when it leaves the side by side', () => {
  const app = read('../ui/public/workflows/tests-app.mjs');   // the Tests page's controller (moved out of app.js)
  assert.ok(app.includes('function wftShow('), 'wftShow found');
  const show = app.slice(app.indexOf('function wftShow('), app.indexOf('function wftShow(') + 400);
  assert.ok(/patches: null/.test(show) && /wftPatchCut\.clear\(\)/.test(show), 'wftShow drops the diff cache');
});

test('M10: the docs name a push or web call with a token read from a file or git\'s settings among the limits', () => {
  for (const f of ['../docs/feature-flags.md', '../docs/changelog/unreleased.md']) {
    assert.ok(read(f).includes("or a push or web call with a token the agent reads from a file or from git's settings"), f);
  }
});
