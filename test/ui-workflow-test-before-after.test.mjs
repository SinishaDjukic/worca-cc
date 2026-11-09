// test/ui-workflow-test-before-after.test.mjs — workflow tests 3b, Task 13 (U1–U3; boards 40–42 and their polish): the command
// before and after the change, side by side; the before runs in Test a version's Time row; the before phase while the test runs.
// The last tests build the models with the real runner, judge and service (beforePlanOf, progressOf, sideBySide) and render them.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { renderSideBySide } from '../ui/public/workflows/test-compare.mjs';
import { openTestVersionDialog } from '../ui/public/workflows/test-dialogs.mjs';
import { renderTestProgress } from '../ui/public/workflows/test-progress.mjs';
import { estimateOf } from '../src/shared/workflow-tests/compare.mjs';
import { aboutDuration } from '../src/shared/workflow-tests/project-text.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';
import { _resetForTests } from '../src/core/db.mjs';
import * as store from '../src/core/workflow-tests/store.mjs';
import { createTestRunner } from '../src/core/workflow-tests/runner.mjs';
import { checkTry } from '../src/core/workflow-tests/result.mjs';
import { beforePlanOf, progressOf, sideBySide } from '../src/core/workflow-tests/service.mjs';

const homes = [];
beforeEach(async () => { const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wftba-')); homes.push(dir); _resetForTests(); process.env.WORCA_HOME = dir; });
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

const tick = () => new Promise((r) => setTimeout(r, 0));
const texts = (root, sel) => [...root.querySelectorAll(sel)].map((n) => n.textContent);
const AT = '2026-10-28T09:00:00.000Z';
const ACTIONS = { back() {}, pick() {}, readWhole() {}, loadChanges() {}, pickFile() {}, readChanges() {}, commandOutput() {} };
const cmd = (over) => ({ id: 'c_1', label: 'The command npm test passes', kind: 'command', cmd: 'npm test', met: false, value: '212 passed, 1 failed', output: 'x', ...over });
const paint = (s) => {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const root = window.document.getElementById('root');
  renderSideBySide(root, s, ACTIONS, { doc: window.document, tryIndex: 0, patches: new Map(), picked: {}, dateText: () => '28 Oct' });
  return root;
};
function sbs(beforeA, beforeB, over = {}) {
  const v = (before, tryId) => ({ tryId, status: 'failed', connectors: 'pretend', text: null, wouldHaveSent: [], answeredReads: [],
    verdict: { basics: [], checks: [cmd(before ? { before, ...over } : over)] },
    project: { changes: { counts: { added: 0, changed: 0, removed: 0 }, files: [], total: 0, added: 0, removed: 0 }, setup: null } });
  return paint({ run: { id: 5, kind: 'compare' }, compareTitle: 'Your v3 draft compared with v2', example: { id: 1, name: 'Ticket 482' }, labels: { a: 'v2', b: 'v3 draft' },
    row: { result: 'worse', a: { passed: 0, total: 1 }, b: { passed: 0, total: 1 } }, connectors: 'pretend', tries: [{ n: 1, a: v(beforeA, 11), b: v(beforeB, 12) }],
    start: { ref: 'main', short: 'abc1234', at: AT, setupCmd: null, setupMs: null }, nothingPushed: true });
}
const TESTS_LEVEL = { ran: true, level: 'tests', beforeOk: false, beforeTimedOut: false, afterOk: false, cached: true, at: AT,
  madePass: { n: 1, names: ['rounds three lines of 0.125 to 0.38'] }, stillPass: { n: 212 }, broke: { n: 1, names: ['adds lines'] },
  stillFailing: { n: 0, names: [] }, added: { n: 3, failing: 1 }, gone: { n: 0, names: [] }, lostPass: { n: 0 } };

test('U1 (board 40): tests by name: broke first, then made pass and still pass; bold counts; red when it broke; the rest only when not zero', () => {
  const root = sbs(null, TESTS_LEVEL);
  const box = root.querySelector('.wft-before');
  assert.equal(box.getAttribute('role'), 'group');
  assert.equal(box.getAttribute('aria-label'), 'Before the change · v3 draft');
  assert.equal(box.querySelector('.wft-before-h').textContent, 'Before the change · v3 draft');
  assert.deepEqual(texts(box, '.wft-before-row'), ['Tests it broke: 1 · "adds lines"', 'Tests the change made pass: 1 · "rounds three lines of 0.125 to 0.38"',
    'Tests that passed before and still pass: 212', 'New tests: 3, 1 failing']);
  assert.deepEqual(texts(box, '.wft-before-n'), ['1', '1', '212', '3'], 'polish 2: each count in bold');
  assert.ok(box.querySelectorAll('b.wft-before-n').length === 4);
  assert.deepEqual(texts(box, '.wft-before-broke'), ['Tests it broke: 1 · "adds lines"'], 'red text, and the words say "broke"');
  assert.ok(box.classList.contains('is-bad'));
  assert.equal(root.querySelectorAll('.wft-before').length, 1, 'v2\'s try had no before run: nothing for it');
  // It sits under the command's row, after the red "Not met" box.
  const row = box.parentElement;
  assert.ok(row.classList.contains('wft-crow'));
  assert.deepEqual([...row.children].slice(-2).map((n) => n.className), ['wft-why-cmd', 'wft-before is-bad']);
  assert.ok(texts(root, '.wft-dev-facts > span').includes('Before the change: npm test · it failed · 28 Oct · kept from an earlier test'));
  const fact = [...root.querySelectorAll('.wft-dev-facts > span')].find((n) => n.textContent.startsWith('Before the change'));
  assert.equal(fact.querySelector('.code').textContent, 'npm test');
});

test('U1: nothing broke: a neutral block; 0 still shown for broke and made pass; still failing and no longer run only when not zero', () => {
  const ok = { ...TESTS_LEVEL, cached: false, broke: { n: 0, names: [] }, madePass: { n: 0, names: [] }, added: { n: 0, failing: 0 },
    stillFailing: { n: 1, names: ['rounds three lines of 0.125 to 0.38'] } };
  const box = sbs(null, ok).querySelector('.wft-before');
  assert.equal(box.classList.contains('is-bad'), false);
  assert.deepEqual(texts(box, '.wft-before-row'), ['Tests it broke: 0', 'Tests the change made pass: 0', 'Tests that passed before and still pass: 212',
    'Tests that failed before and still fail: 1 · "rounds three lines of 0.125 to 0.38"']);
  assert.equal(box.querySelectorAll('.wft-before-broke').length, 0);
  // A failing test that is gone now is said, not red; a passing one that is gone makes the block and its line red.
  const goneFail = sbs(null, { ...ok, gone: { n: 1, names: ['old failing'] }, lostPass: { n: 0 } }).querySelector('.wft-before');
  assert.equal(goneFail.classList.contains('is-bad'), false);
  assert.equal(texts(goneFail, '.wft-before-row').at(-1), 'Tests that no longer run: 1 · "old failing"');
  assert.equal(goneFail.querySelectorAll('.wft-before-broke').length, 0);
  const lost = sbs(null, { ...ok, gone: { n: 1, names: ['rounds with the old helper'] }, lostPass: { n: 1 } }).querySelector('.wft-before');
  assert.ok(lost.classList.contains('is-bad'), 'controller: a test that passed before and is missing now is bad');
  assert.deepEqual(texts(lost, '.wft-before-broke'), ['Tests that no longer run: 1 · "rounds with the old helper"']);
});

test('U1: only the first 5 names, then "and N more"', () => {
  const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const box = sbs(null, { ...TESTS_LEVEL, broke: { n: 7, names } }).querySelector('.wft-before');
  assert.equal(texts(box, '.wft-before-row')[0], 'Tests it broke: 7 · "a", "b", "c", "d", "e" and 2 more');
});

test('U1: failures only, exit code only (red when it broke), not run', () => {
  const failures = { ran: true, level: 'failures', beforeOk: false, beforeTimedOut: false, afterOk: false, cached: false, at: AT,
    failingNow: { n: 1, names: ['src/a.test.js › t'] }, noLongerFail: { n: 0, names: [] }, stillFailing: { n: 2, names: ['x', 'y'] },
    counts: { before: { passed: 212, failed: 2, skipped: 0 }, after: { passed: 211, failed: 3, skipped: 0 } } };
  const exit = { ran: true, level: 'exit', beforeOk: true, beforeTimedOut: false, afterOk: false, cached: false, at: AT };
  const root = sbs(exit, failures);
  const [a, b] = root.querySelectorAll('.wft-before');
  assert.deepEqual([...a.querySelectorAll(':scope > span:not(.wft-before-h)')].map((x) => x.textContent), ['It passed before the change: the change broke it.',
    "Worca could not read test names in this command's output, so it compares only whether the command passed."]);
  assert.ok(a.classList.contains('is-bad'), 'polish 3: exit code only, red when it broke');
  assert.deepEqual(texts(a, '.wft-before-broke'), ['It passed before the change: the change broke it.']);
  assert.equal(a.getAttribute('aria-label'), 'Before the change · v2');
  assert.deepEqual(texts(b, '.wft-before-row'), ['Tests failing now that did not fail before: 1 · "src/a.test.js › t"', 'Tests that failed before and no longer fail: 0',
    'Tests that failed before and still fail: 2 · "x", "y"', 'Passed: 212 before, 211 now']);
  assert.deepEqual(texts(b, '.wft-before-broke'), ['Tests failing now that did not fail before: 1 · "src/a.test.js › t"', 'Passed: 212 before, 211 now']);
  assert.equal(b.querySelector('.hint').textContent, 'This test tool names only the tests that fail, so the tests that pass are counted, not named.');
  assert.ok(b.classList.contains('is-bad'));
  // Failures by name: fewer passing now is red too, also when no new name fails; the same count is neutral.
  const fewer = sbs(null, { ...failures, failingNow: { n: 0, names: [] } }).querySelector('.wft-before');
  assert.ok(fewer.classList.contains('is-bad'));
  assert.deepEqual(texts(fewer, '.wft-before-broke'), ['Passed: 212 before, 211 now']);
  const same = sbs(null, { ...failures, failingNow: { n: 0, names: [] }, counts: { before: { passed: 212 }, after: { passed: 212 } } }).querySelector('.wft-before');
  assert.equal(same.classList.contains('is-bad'), false);
  const unread = sbs(null, { ...failures, failingNow: { n: 0, names: [] }, counts: { before: null, after: { passed: 3 } } }).querySelector('.wft-before');
  assert.equal(unread.classList.contains('is-bad'), false);
  assert.equal(texts(unread, '.wft-before-row').some((t) => t.startsWith('Passed:')), false, 'a count not read is not said');
  // Exit code only, in its other states: never red.
  for (const [r, said] of [[{ beforeOk: true, afterOk: true }, 'It passed before the change too.'], [{ beforeOk: false, afterOk: false }, 'It failed before the change too.'],
    [{ beforeOk: false, afterOk: true }, 'It failed before the change, and passes now.'], [{ beforeOk: true, beforeTimedOut: true, afterOk: false }, 'Before the change, it ran longer than its time limit.']]) {
    const box = sbs(null, { ...exit, beforeTimedOut: false, ...r }).querySelector('.wft-before');
    assert.equal(box.querySelector(':scope > span:not(.wft-before-h)').textContent, said);
    assert.equal(box.classList.contains('is-bad'), false, said);
  }
  const notRun = sbs(null, { ran: false, reason: 'setup' });
  const box = notRun.querySelector('.wft-before');
  assert.equal(box.querySelector(':scope > span:not(.wft-before-h)').textContent, 'Worca could not run it before the change: the setup step failed.');
  assert.equal(box.classList.contains('is-bad'), false);
  assert.equal(texts(notRun, '.wft-dev-facts > span').some((t) => t.startsWith('Before the change')), false, 'not run: no fact under For developers');
});

test('U1: a command met shows its block too; a check that is not a command never has one', () => {
  const root = sbs(null, { ...TESTS_LEVEL, broke: { n: 0, names: [] }, afterOk: true }, { met: true, value: '213 passed', output: 'x' });
  assert.equal(root.querySelectorAll('.wft-before').length, 1);
  assert.equal(root.querySelectorAll('.wft-why-cmd').length, 0);
  const notCmd = sbs(null, TESTS_LEVEL, { kind: 'under', dirs: ['src/'], label: 'Changes only files under src/' });
  assert.equal(notCmd.querySelectorAll('.wft-before').length, 0);
});

// Board 41 (polish 5): the Time row keeps 3a's line; the run before the change is a grey line of its own under it.
const GB = 2 ** 30;
const side = (use, short) => ({ use, label: short, short, want: 3, reusable: 0, reusableAt: null, perTryUsd: 1, savesUsd: 0 });
const tvPlan = (before) => ({ a: side(2, 'v2'), b: side('draft', 'v3 draft'), examples: 1, tries: 3, perTryMs: 10 * 60000,
  connectors: { mode: 'pretend', pretend: [], off: [], scripts: [], quickScripts: [], engines: [] },
  project: { names: ['worca-cc'], leftOut: [], disk: { needBytes: GB, freeBytes: 48 * GB, enough: true, text: null }, setupCmd: 'npm ci', setupMs: 2 * 60000, before } });
async function tvDialog(plan) {
  const { window } = new JSDOM('<!doctype html><body></body>');
  openTestVersionDialog({ doc: window.document, win: window, options: [{ use: 2, label: 'v2' }, { use: 'draft', label: 'v3 draft' }], a: 2, b: 'draft',
    examples: [{ id: 1, name: 'Ticket 482', tries: 3, ready: true, projectName: 'worca-cc' }], dateText: () => '24 Oct', loadPlan: async () => plan, onStart: async () => ({ ok: true }) });
  await tick(); await tick();
  return window.document;
}

test('U2 (board 41): Test a version: the before runs on their own line under the Time row, and in its total', async () => {
  const plan = tvPlan({ runs: 2, ms: 4 * 60000, cmd: 'npm test' });
  const doc = await tvDialog(plan);
  const e = estimateOf(plan, { reuseA: false, reuseB: false });
  const time = doc.querySelector('.wft-est-row.is-time');
  assert.equal(time.textContent, `Time${aboutDuration(e.minutes * 60000 + 4 * 60000)} · setup npm ci takes about 2 minutes a try`);
  assert.deepEqual(texts(time, '.code'), ['npm ci']);
  const sub = time.nextElementSibling;
  assert.ok(sub.classList.contains('wft-est-sub'));
  assert.equal(sub.textContent, 'First, npm test runs once on 2 start points: about 4 minutes');
  assert.deepEqual(texts(sub, '.code'), ['npm test']);
  const none = await tvDialog(tvPlan(null));
  assert.equal(none.querySelector('.wft-est-sub'), null, 'every result kept: no second line');
  assert.equal(none.querySelector('.wft-est-row.is-time').textContent, `Time${aboutDuration(e.minutes * 60000)} · setup npm ci takes about 2 minutes a try`);
});

test('U2: several commands, a time never measured, one start point', async () => {
  const several = await tvDialog(tvPlan({ runs: 2, ms: 4 * 60000, cmd: null }));
  assert.equal(several.querySelector('.wft-est-sub').textContent, 'First, the command checks run once on 2 start points: about 4 minutes');
  assert.equal(several.querySelector('.wft-est-sub .code'), null);
  const unknown = await tvDialog(tvPlan({ runs: 2, ms: null, cmd: 'npm test' }));
  assert.equal(unknown.querySelector('.wft-est-sub').textContent, 'First, npm test runs once on 2 start points');
  const one = await tvDialog(tvPlan({ runs: 1, ms: 90_000, cmd: 'npm test' }));
  assert.equal(one.querySelector('.wft-est-sub').textContent, 'First, npm test runs once on 1 start point: about 2 minutes');
});

// Board 42 (polish 6): the before phase while the test runs.
const progressModel = (before, over = {}) => ({ run: { id: 9, kind: 'compare', status: 'running', stopReason: null, stopDetail: null, tries: 1, a: 2, b: 'draft', exampleIds: [1] },
  title: 'Testing your v3 draft', done: 0, total: 2, costUsd: 0, estimateUsd: 2, capUsd: 10, minutesLeft: 20, takenMs: null, quick: null,
  rows: [{ exampleId: 1, name: 'Ticket 482', label: 'v2', dots: ['waiting'], summary: 'Waiting', now: null }],
  project: { phases: null, disk: null, setupStop: null }, before, ...over });
function paintProgress(p) {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const root = window.document.getElementById('root');
  renderTestProgress(root, p, { back() {}, stop() {}, continue() {}, open() {} }, { doc: window.document, dateText: () => '28 Oct' });
  return root;
}

test('U3 (board 42): while the test runs, the "Before the tries" card', () => {
  const root = paintProgress(progressModel({ exampleId: 1, exampleName: 'Ticket 482', cmd: 'npm test', phase: 'setup', n: 1, of: 2, startedMs: Date.now() }));
  const card = root.querySelector('.wft-before-now');
  assert.equal(card.getAttribute('aria-live'), 'polite');
  const h = card.querySelector('h2');
  assert.equal(h.textContent, 'Before the tries');
  assert.equal(card.getAttribute('aria-labelledby'), h.id);
  assert.equal(card.querySelector('.wft-before-now-line').textContent, 'Running npm test on the start point of Ticket 482 · 1 of 2');
  assert.equal(card.querySelector('.wft-before-now-line .code').textContent, 'npm test');
  assert.equal(card.querySelector('.wft-before-now-phase').textContent, 'Running setup');
  assert.equal(card.querySelector('.hint').textContent, 'Running setup', 'the phase line is the card\'s first hint');
  assert.equal(card.querySelector('.wft-before-now-why').textContent,
    'Worca runs the tests once on the project as it was, so it can tell later which tests a version fixed or broke. This uses no AI.');
  assert.equal(card.previousElementSibling.classList.contains('wft-prog'), true, 'under the progress card');
  for (const [phase, said] of [['copy', 'Preparing a copy of the project'], ['command', 'Running the command']]) {
    const r = paintProgress(progressModel({ exampleId: 2, exampleName: 'Ticket 455', cmd: 'npm test', phase, n: 2, of: 2, startedMs: Date.now() }));
    assert.equal(r.querySelector('.wft-before-now-phase').textContent, said);
  }
  assert.equal(paintProgress(progressModel(null)).querySelector('.wft-before-now'), null, 'no before phase: no card');
  const stopped = progressModel({ exampleId: 1, exampleName: 'Ticket 482', cmd: 'npm test', phase: 'setup', n: 1, of: 2, startedMs: Date.now() });
  stopped.run = { ...stopped.run, status: 'stopped', stopReason: 'person' };
  assert.equal(paintProgress(stopped).querySelector('.wft-before-now'), null, 'only while the test runs');
});

test('U1/U3 styles: the block, its red state and the card are in workflow-tests.css; on a phone the checks table does not scroll sideways', () => {
  const css = readStyleCss();
  for (const sel of ['.wft-before{', '.wft-before.is-bad{', '.wft-before-broke{', '.wft-before-n{', '.wft-est-sub{', '.wft-before-now{']) {
    assert.ok(css.includes(sel), `${sel} has a rule`);
  }
  assert.match(css, /\.wft-before\{[^}]*grid-column:1 \/ -1/, 'the block spans the whole row');
  assert.match(css, /\.wft-before\.is-bad\{[^}]*background:var\(--red-bg\)/);
  assert.match(css, /\.wft-before-broke\{[^}]*color:var\(--red-ink-strong\)/);
  // Controller decision 1 (phone width): the notes must not sit in a sideways-scrolling table. At ≤ 700 px the checks table
  // already stacks into one column (browser check H2), so the notes span the phone's width under their check.
  const phone = css.split('\n').find((l) => l.startsWith('@media (max-width:700px)') && l.includes('.wft-crows'));
  assert.ok(phone && /\.wft-crows,\.wft-crows\.is-one\{min-width:0;\}/.test(phone) && phone.includes('.wft-crow,.wft-crow.is-one{grid-template-columns:minmax(0,1fr);'));
});

// ── End to end: the real runner, judge and service shapes (Task 10 review) ─────────────────────────────────────────────
const WF = 'wf_bauI';
const SHA = 'a'.repeat(40);
const pin = { key: 'tickets-1a2b3c4d', startSha: SHA, startRef: 'main', startAt: AT, startCommit: SHA, changes: null, setupCmd: 'npm ci' };
const TESTS = { format: 'tap', pass: ['adds', 'rounds'], fail: [], skip: [], passListed: true, counts: null, truncated: false };
function harness({ beforeRun }) {
  const entries = new Map();
  let n = 0;
  return {
    startRun: async (body, { workflowTest }) => {
      n += 1;
      const runKey = `run-${n}`; const pipelineId = `p${String(n).padStart(7, '0')}`;
      const orch = new EventEmitter(); orch.state = { totalCostUsd: 0, setupStage: null };
      let finish;
      const launch = new Promise((r) => { finish = r; });
      const e = { orch, launch, status: 'running', pipelineId, end(status) { if (e.status !== 'running') return; e.status = status; finish(); } };
      entries.set(runKey, e);
      workflowTest.onOrch(orch, { runKey });
      setImmediate(() => { orch.state.totalCostUsd = 0.5; e.end('done'); });
      return { status: 200, body: { runId: runKey, pipelineId } };
    },
    liveRun: (k) => entries.get(k) || null,
    stopRun: async (k) => { entries.get(k)?.end('stopped'); },
    answer: () => true,
    outcomeOf: async (pipelineId, { help = [], failReason = null, durationMs = null } = {}) => {
      const e = [...entries.values()].find((x) => x.pipelineId === pipelineId);
      return { pipelineId, facts: { status: e.status, costUsd: 0.5, durationMs, sentBack: 0, help, failReason }, text: null, name: null, source: 'end-value',
        files: [], setup: { cmd: 'npm ci', ok: true, exitCode: 0, timedOut: false, ms: 1000, tail: '' }, logFile: null,
        project: { key: pin.key, checkoutDir: `/copy/${pipelineId}`, branch: 'b', runRoot: '/r', files: [], paths: [], touched: [], total: 0,
          counts: { added: 0, changed: 0, removed: 0 }, added: 0, removed: 0 } };
    },
    judge: (ex, outcome, o = {}) => checkTry(ex, outcome, { onCommand: o.onCommand, beforeOf: o.beforeOf,
      runCommand: async () => ({ met: false, value: '1 passed, 1 failed', output: 'not ok 2 rounds', exitCode: 1, ms: 4321,
        tests: { ...TESTS, pass: ['adds'], fail: ['rounds'] } }) }),
    fingerprintOf: async (_wf, use) => `fp-${store.useRef(use)}`,
    prepareProject: async (ex) => ({ copyDir: '/copy', startCommit: ex.project.startCommit }),
    cleanupTry: async () => ({ removed: true, error: null }),
    measureDisk: async () => 1,
    freeDisk: async () => 50 * 2 ** 30,
    mockMode: () => false,
    pollMs: 5,
    beforeRun,
  };
}
const example = () => store.createExample(WF, { name: 'Ticket 482', request: 'Fix the rounding.', checks: [{ kind: 'command', cmd: 'npm test' }] }, { project: pin });

test('end to end U1: the judge\'s real `before` reaches the side by side and For developers', async () => {
  const ex = example();
  const runner = createTestRunner(harness({ beforeRun: async (_spec, { onPhase } = {}) => {
    if (onPhase) onPhase('command');
    return { ran: true, ok: true, exitCode: 0, timedOut: false, tests: TESTS, at: AT, cached: false, ms: 2000 };
  } }));
  const run = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 1 });
  await runner.idle(run.id);
  const s = await sideBySide(WF, run.id, ex.id);
  const root = paint(s);
  const boxes = [...root.querySelectorAll('.wft-before')];
  assert.equal(boxes.length, 2, 'one block per version');
  for (const box of boxes) {
    assert.ok(box.classList.contains('is-bad'));
    assert.deepEqual(texts(box, '.wft-before-row'), ['Tests it broke: 1 · "rounds"', 'Tests the change made pass: 0', 'Tests that passed before and still pass: 1']);
  }
  assert.deepEqual(boxes.map((b) => b.getAttribute('aria-label')), [`Before the change · ${s.labels.a}`, `Before the change · ${s.labels.b}`]);
  assert.ok(texts(root, '.wft-dev-facts > span').includes('Before the change: npm test · it passed · 28 Oct'));
});

test('end to end U2: beforePlanOf\'s answer reaches the Time row', async () => {
  const ex1 = { id: 1, project: pin, checks: [{ id: 'c_1', kind: 'command', cmd: 'npm test', timeoutMin: 10 }] };
  const ex2 = { id: 2, project: { ...pin, startCommit: 'b'.repeat(40) }, checks: [{ id: 'c_2', kind: 'command', cmd: 'npm test', timeoutMin: 10 }] };
  const before = await beforePlanOf([ex1, ex2], { readKept: async () => null, setupMsOf: () => 90_000, commandMsOf: () => 30_000 });
  const doc = await tvDialog(tvPlan(before));
  assert.equal(doc.querySelector('.wft-est-sub').textContent, 'First, npm test runs once on 2 start points: about 4 minutes');
  const kept = await beforePlanOf([ex1, ex2], { readKept: async () => ({ ran: true }), setupMsOf: () => 90_000, commandMsOf: () => 30_000 });
  assert.equal((await tvDialog(tvPlan(kept))).querySelector('.wft-est-sub'), null);
});

test('end to end U3: progressOf\'s `before` (the runner\'s beforeNowOf) reaches the "Before the tries" card', async () => {
  const ex = example();
  let release;
  const held = new Promise((r) => { release = r; });
  const runner = createTestRunner(harness({ beforeRun: async (_spec, { signal, onPhase }) => {
    onPhase('setup');
    await new Promise((r) => { signal.addEventListener('abort', r, { once: true }); held.then(r); });
    return { ran: false, reason: 'stopped' };
  } }));
  const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  for (let i = 0; i < 200 && runner.beforeNowOf(run.id)?.phase !== 'setup'; i += 1) await new Promise((r) => setTimeout(r, 5));
  const p = progressOf(WF, run.id, { beforeNowOf: runner.beforeNowOf });
  const card = paintProgress(p).querySelector('.wft-before-now');
  assert.equal(card.querySelector('.wft-before-now-line').textContent, 'Running npm test on the start point of Ticket 482 · 1 of 1');
  assert.equal(card.querySelector('.wft-before-now-phase').textContent, 'Running setup');
  await runner.stop(run.id);
  release();
  await runner.idle(run.id);
});
