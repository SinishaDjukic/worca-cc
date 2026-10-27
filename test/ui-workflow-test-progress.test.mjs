// test/ui-workflow-test-progress.test.mjs — While the test runs, stopped, done (canvas boards 20, 27, 28; C7, C9, G8, D39).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderTestProgress } from '../ui/public/workflows/test-progress.mjs';
import { PAUSE_REFUSED_TEXT, PAUSE_REFUSED_OTHER } from '../src/core/workflow-tests/runner.mjs';

const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const progress = (over = {}, run = {}) => ({
  run: { id: 9, kind: 'compare', a: 4, b: 'draft', tries: 3, status: 'running', stopReason: null, stopDetail: null, exampleIds: [1, 2, 3], ...run },
  title: 'Testing your v5 draft',
  rows: [
    { exampleId: 1, name: 'Offline mode for the field app', label: null, dots: ['passed', 'passed', 'passed'], summary: 'Done · 3 of 3 passed' },
    { exampleId: 2, name: 'Bulk invoice export', label: null, dots: ['passed', 'failed', 'running'], summary: 'Trying 3 of 3' },
    { exampleId: 3, name: 'Customer data export (GDPR)', label: null, dots: ['waiting', 'waiting', 'waiting'], summary: 'Waiting' },
  ],
  done: 7, total: 18, costUsd: 3.8, estimateUsd: 10, capUsd: 15, minutesLeft: 15, quick: { status: 'passed' }, ...over,
});
function boot(p, { window = new JSDOM('<!doctype html><body><section id="root" tabindex="-1"></section></body>').window } = {}) {
  const calls = [];
  const root = window.document.getElementById('root');
  const actions = { back: () => calls.push(['back']), stop: () => calls.push(['stop']), continue: (c) => calls.push(['continue', c]), open: () => calls.push(['open']) };
  renderTestProgress(root, p, actions, { doc: window.document });
  return { root, calls, window, again: (q) => renderTestProgress(root, q, actions, { doc: window.document }) };
}
const facts = (root) => [...root.querySelectorAll('.wft-fact')].map((f) => [...f.children].map((c) => c.textContent));
const stoppedLine = (stopReason, stopDetail = null) => boot(progress({}, { status: 'stopped', stopReason, stopDetail })).root.querySelector('.wft-stopped').textContent;

test('board 20 while it runs: title, pill, Stop testing, the bar, the facts, the rows', () => {
  const { root, calls } = boot(progress());
  assert.equal(root.querySelector('.wft-title').textContent, 'Testing your v5 draft');
  assert.equal(root.querySelector('.wft-pill').textContent, 'Testing · 7 of 18 tries done');
  assert.equal(root.querySelector('.wft-pill').className, 'pill-run peach wft-pill');
  const stop = root.querySelector('.wft-acts .btn-danger');
  assert.equal(stop.textContent, 'Stop testing');
  const bar = root.querySelector('.wft-bar');
  assert.deepEqual([bar.getAttribute('role'), bar.getAttribute('aria-valuenow'), bar.getAttribute('aria-valuemax'), bar.firstElementChild.style.width], ['progressbar', '7', '18', '39%']);
  assert.deepEqual(facts(root), [['Time left', 'about 15 min'], ['Cost so far', '$3.80', 'of about $10 · stops at $15.00'], ['Free quick check', 'Passed', 'every step is connected']]);
  assert.equal(root.querySelector('.wft-prog > .hint').textContent, 'You can close this page or keep working. Worca tells you when the results are ready. Results so far are not final: wait for all 3 tries of an example.');
  assert.deepEqual([...root.querySelectorAll('.wft-prow.is-head > span')].map((s) => s.textContent), ['Example', 'Tries', 'So far']);
  const rows = [...root.querySelectorAll('.wft-prow:not(.is-head)')];
  assert.deepEqual(rows.map((r) => [...r.querySelectorAll('.wft-try-dot')].map((t) => t.className)), [
    ['wft-try-dot ok', 'wft-try-dot ok', 'wft-try-dot ok'], ['wft-try-dot ok', 'wft-try-dot no', 'wft-try-dot run'], ['wft-try-dot', 'wft-try-dot', 'wft-try-dot']]);
  assert.deepEqual(rows.map((r) => r.querySelector('.wft-tries').getAttribute('aria-label')), ['3 passed', '1 passed, 1 not passed, 1 trying', 'Waiting']);
  assert.deepEqual(rows.map((r) => r.lastElementChild.textContent), ['Done · 3 of 3 passed', 'Trying 3 of 3', 'Waiting']);
  assert.equal(root.querySelector('.wft-page > .hint').textContent, 'Stop testing keeps the tries that are done. You can finish the rest later without paying for them twice.');
  click(stop);
  click(root.querySelector('.wft-crumb'));
  assert.deepEqual(calls, [['stop'], ['back']]);
});

test('stopped by the cap: why, a higher cap and Finish the rest (C7); by a person: no cap field', () => {
  const capped = boot(progress({ costUsd: 15.4, minutesLeft: null, takenMs: 35 * 60000 + 12000 }, { status: 'stopped', stopReason: 'cap' }));
  assert.equal(capped.root.querySelector('.wft-pill').textContent, 'Stopped · 7 of 18 tries done');
  assert.equal(capped.root.querySelector('.wft-pill').className, 'pill-run wft-pill is-stopped is-parked', 'D39: the status pill, not a badge');
  assert.ok(capped.root.querySelector('.wft-pill .pdot'));
  assert.equal(capped.root.querySelector('.wft-stopped').textContent, 'Stopped: the cost went over $15.00.');
  assert.equal(capped.root.querySelector('#wft-pg-cap').value, '$25');
  assert.equal(capped.root.querySelector('label[for="wft-pg-cap"]').textContent, 'Stop if the cost goes over');
  assert.deepEqual(facts(capped.root)[0], ['Time taken', '35 min'], 'board 27');
  click([...capped.root.querySelectorAll('.wft-acts button')].find((b) => b.textContent === 'Finish the rest'));
  assert.deepEqual(capped.calls, [['continue', 25]]);
  const person = boot(progress({}, { status: 'stopped', stopReason: 'person' }));
  assert.equal(person.root.querySelector('#wft-pg-cap'), null);
  assert.equal(person.root.querySelector('.wft-stopped').textContent, 'You stopped the test.');
  click([...person.root.querySelectorAll('.wft-acts button')].find((b) => b.textContent === 'Finish the rest'));
  assert.deepEqual(person.calls, [['continue', null]]);
  const quick = boot(progress({ quick: { status: 'failed', detail: 'the quick check ended as error' } }, { status: 'stopped', stopReason: 'quick-check', stopDetail: 'the quick check ended as error' }));
  assert.deepEqual(facts(quick.root)[2], ['Free quick check', 'Not passed', 'the quick check ended as error']);
  assert.equal(quick.root.querySelector('.wft-stopped').textContent, 'The free quick check did not pass: the quick check ended as error.');
});

test('C7: every stop line is one sentence; a stored detail gets its full stop only when it has none (the runner stores none)', () => {
  assert.equal(stoppedLine('refused', PAUSE_REFUSED_TEXT[Object.keys(PAUSE_REFUSED_TEXT)[0]]), `Stopped: ${PAUSE_REFUSED_TEXT[Object.keys(PAUSE_REFUSED_TEXT)[0]]}.`);
  for (const t of [...Object.values(PAUSE_REFUSED_TEXT), PAUSE_REFUSED_OTHER]) {
    assert.doesNotMatch(t, /[.!?]$/, 'the runner stores no full stop');
    assert.equal(stoppedLine('refused', t), `Stopped: ${t}.`);
  }
  assert.equal(stoppedLine('refused', 'the AI account reached its usage limit'), 'Stopped: the AI account reached its usage limit.');
  assert.equal(stoppedLine('refused', "Away mode's safety limit paused it"), "Stopped: Away mode's safety limit paused it.");
  assert.equal(stoppedLine('refused', 'This workflow needs a project.'), 'Stopped: This workflow needs a project.', 'a server refusal keeps its own full stop');
  assert.equal(stoppedLine('refused'), 'Stopped: a try did not start.');
  assert.equal(stoppedLine('error', 'a step hit an error that Worca could retry'), 'Stopped: a step hit an error that Worca could retry.');
  assert.equal(stoppedLine('error', 'Is the disk full?'), 'Stopped: Is the disk full?');
  assert.equal(stoppedLine('error'), 'Stopped: something went wrong.');
  assert.equal(stoppedLine('quick-check', 'a step failed: the agent was not found'), 'The free quick check did not pass: a step failed: the agent was not found.');
  assert.equal(stoppedLine('quick-check'), 'The free quick check did not pass: a step is not connected.');
  assert.equal(stoppedLine('drain', 'Worca is restarting.'), 'Stopped: Worca is shutting down.', 'drain: the fixed sentence, whatever the detail');
  assert.equal(stoppedLine('budget'), 'Stopped: the spending limit is reached.');
  assert.equal(stoppedLine('restart'), 'Stopped when Worca restarted.');
  assert.equal(stoppedLine('person'), 'You stopped the test.');
  assert.equal(stoppedLine('something-new', 'the try could not go on'), 'Stopped: the try could not go on.', 'an unknown reason reads as an error');
});

test('done: See what changed (or See the result after Try it once now); two rows per example when both versions are tried (G8)', () => {
  const done = boot(progress({ done: 18, minutesLeft: null, quick: null, takenMs: 26 * 60000 - 20000 }, { status: 'done' }));
  assert.deepEqual([done.root.querySelector('.wft-pill').textContent, done.root.querySelector('.wft-pill').className], ['Done · 18 of 18 tries done', 'pill-run green wft-pill is-parked']);
  assert.deepEqual(facts(done.root)[0], ['Time taken', '26 min'], 'board 28');
  const short = (takenMs) => facts(boot(progress({ takenMs }, { status: 'done' })).root)[0];
  assert.deepEqual([short(20000), short(null)], [['Time taken', '1 min'], ['Time taken', 'not known']], 'under a minute is 1 min; no times at all');
  assert.deepEqual(facts(boot(progress({ takenMs: 9 * 60000 })).root)[0], ['Time left', 'about 15 min'], 'while it runs, the time left');
  assert.deepEqual(facts(done.root)[2], ['Free quick check', 'Off']);
  assert.deepEqual([...done.root.querySelectorAll('.wft-prow.is-head > span')].map((s) => s.textContent), ['Example', 'Tries', 'Result'], 'board 28');
  assert.equal(done.root.querySelector('.wft-page > .hint'), null, 'nothing left to stop or finish');
  assert.ok(done.root.querySelector('.wft-bar').classList.contains('is-done'), 'board 28: a green bar');
  click(done.root.querySelector('.wft-acts .btn-primary'));
  assert.deepEqual([done.root.querySelector('.wft-acts .btn-primary').textContent, done.calls], ['See what changed', [['open']]]);
  const once = boot(progress({ done: 1, total: 1, rows: [{ exampleId: 1, name: 'Bulk', label: null, dots: ['passed'], summary: 'Done · 1 of 1 passed' }] }, { kind: 'once', status: 'done', tries: 1 }));
  assert.equal(once.root.querySelector('.wft-acts .btn-primary').textContent, 'See the result');
  assert.equal(once.root.querySelector('.wft-pill').textContent, 'Done · 1 of 1 try done');
  const two = boot(progress({ rows: [
    { exampleId: 1, name: 'Bulk', label: 'v4', dots: ['passed'], summary: 'Done · 1 of 1 passed' },
    { exampleId: 1, name: 'Bulk', label: 'v5 draft', dots: ['running'], summary: 'Trying 1 of 1' }] }, { tries: 1 }));
  assert.deepEqual([...two.root.querySelectorAll('.wft-prow:not(.is-head)')].map((r) => r.firstElementChild.textContent), ['Bulk · v4', 'Bulk · v5 draft']);
  assert.equal(two.root.querySelector('.wft-prog > .hint').textContent, 'You can close this page or keep working. Worca tells you when the results are ready.');
});

test('board 27: a stopped test\'s grey bar, and tries never made read as not tried', () => {
  const st = boot(progress({ rows: [
    { exampleId: 1, name: 'Pricing', label: null, dots: ['passed', 'stopped', 'waiting'], summary: 'Not finished · 1 of 3 tried' },
    { exampleId: 2, name: 'GDPR', label: null, dots: ['waiting', 'waiting', 'waiting'], summary: 'Not finished · 0 of 3 tried' }] }, { status: 'stopped', stopReason: 'person' }));
  assert.ok(st.root.querySelector('.wft-bar').classList.contains('is-stopped'));
  assert.deepEqual([...st.root.querySelectorAll('.wft-tries')].map((t) => t.getAttribute('aria-label')), ['1 passed, 2 not tried', 'Not tried']);
});

test('stopped by a change during the test (D27): the C18 sentence, and no Finish the rest', () => {
  const ch = boot(progress({}, { status: 'stopped', stopReason: 'changed', stopDetail: 'Your draft changed since this test started: start a new test.' }));
  assert.equal(ch.root.querySelector('.wft-stopped').textContent, 'Your draft changed since this test started: start a new test.');
  assert.equal([...ch.root.querySelectorAll('.wft-acts button')].some((b) => b.textContent === 'Finish the rest'), false);
  assert.equal(ch.root.querySelector('#wft-pg-cap'), null);
});

test('a repaint keeps the focus on the same control and announces the new state once (frames repaint the page)', () => {
  const b = boot(progress());
  const live = b.root.querySelector('.wft-pg-live');
  assert.deepEqual([live.getAttribute('aria-live'), live.textContent], ['polite', 'Testing · 7 of 18 tries done']);
  b.root.querySelector('.wft-acts .btn-danger').focus();
  b.again(progress({ done: 8 }));
  const doc = b.window.document;
  assert.equal(doc.activeElement, b.root.querySelector('.wft-acts .btn-danger'), 'Stop testing keeps the focus');
  assert.equal(b.root.querySelector('.wft-pg-live'), live, 'one live line across repaints');
  assert.equal(live.textContent, 'Testing · 8 of 18 tries done');
  b.root.querySelector('.wft-crumb').focus();
  b.again(progress({ done: 18 }, { status: 'stopped', stopReason: 'cap' }));
  assert.equal(doc.activeElement, b.root.querySelector('.wft-crumb'));
  assert.equal(live.textContent, 'Stopped · 18 of 18 tries done. Stopped: the cost went over $15.00.');
  b.root.querySelector('#wft-pg-cap').focus();
  b.root.querySelector('#wft-pg-cap').value = '$40';
  b.again(progress({ done: 18 }, { status: 'stopped', stopReason: 'cap' }));
  assert.deepEqual([doc.activeElement.id, doc.activeElement.value], ['wft-pg-cap', '$40'], 'a typed limit survives a repaint of the same test');
  b.root.querySelector('.wft-acts .btn-primary').focus();
  b.again(progress({ done: 18 }, { status: 'done' }));
  assert.equal(doc.activeElement, b.root, 'the button went away: the page holds the focus, never <body>');
});

test('app.js: the WS frame reaches wftChanged; Task 10\'s "comes in a later step" toast is gone', () => {
  const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  // assert.ok, not assert.match: a failure would print all of app.js.
  assert.ok(/if \(msg\.type === 'workflow-tests-changed'\) \{\s*wftChanged\(msg\);\s*return;\s*\}/.test(app), 'the WS dispatcher hands the frame to wftChanged');
  assert.ok(!/detail: 'This page comes in a later step\.'/.test(app), 'Task 10\'s temporary toast is gone');
  assert.ok(!/title: 'Test a version', detail: 'This comes in a later step\.'/.test(app), 'Test a version opens the dialog');
  assert.ok(/title: msg\.status === 'done' \? 'Test results are ready' : 'Test stopped'/.test(app), 'C13: the results-ready toast');
});

test('the cost limit is exact (never rounded like an estimate); Try it once now shows a bare cost, as board 28\'s one-try panel', () => {
  const capped = boot(progress({ costUsd: 12.9, capUsd: 12.5, estimateUsd: 9.4 }, { status: 'stopped', stopReason: 'cap' }));
  assert.equal(capped.root.querySelector('.wft-stopped').textContent, 'Stopped: the cost went over $12.50.');
  assert.deepEqual(facts(capped.root)[1], ['Cost so far', '$12.90', 'of about $9 · stops at $12.50'], 'the estimate keeps its "about"');
  const once = boot(progress({ done: 1, total: 1, costUsd: 0.55, estimateUsd: 0.52, capUsd: null, quick: null, takenMs: 300000,
    rows: [{ exampleId: 1, name: 'Bulk', label: null, dots: ['passed'], summary: 'Done · 1 of 1 passed' }] }, { kind: 'once', status: 'done', tries: 1 }));
  assert.deepEqual(facts(once.root), [['Time taken', '5 min'], ['Cost so far', '$0.55'], ['Free quick check', 'Off']]);
});

test('Stop testing and Finish the rest stay busy across repaints until their action answers (one post per click)', async () => {
  const { window } = new JSDOM('<!doctype html><body><section id="root" tabindex="-1"></section></body>');
  const doc = window.document;
  const root = doc.getElementById('root');
  const pending = [];
  let stops = 0;
  const actions = { back() {}, open() {}, continue: () => new Promise((r) => pending.push(r)),
    stop: () => { stops += 1; return new Promise((r) => pending.push(r)); } };
  const paint = (p) => renderTestProgress(root, p, actions, { doc });
  paint(progress());
  click(root.querySelector('.wft-acts .btn-danger'));
  paint(progress({ done: 8 }));                       // a try ended meanwhile: the frame repaints the page
  const stop = root.querySelector('.wft-acts .btn-danger');
  assert.equal(stop.disabled, true, 'the repainted Stop testing is still busy');
  click(stop);
  assert.equal(stops, 1, 'a click on the repainted button sends nothing');
  pending.shift()();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(root.querySelector('.wft-acts .btn-danger').disabled, false, 'the answer gives the button back');
  paint(progress({}, { status: 'stopped', stopReason: 'person' }));
  const finish = () => [...root.querySelectorAll('.wft-acts button')].find((b) => b.textContent === 'Finish the rest');
  click(finish());
  paint(progress({}, { status: 'stopped', stopReason: 'person' }));
  assert.equal(finish().disabled, true);
  pending.shift()();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(finish().disabled, false);
  paint(progress({}, { id: 10, status: 'stopped', stopReason: 'person' }));
  assert.equal(finish().disabled, false, 'another test is never busy with this one\'s action');
});

test('app.js (Task 13 review): frames repaint only the shown Tests page, re-entry repaints it, a failed versions read is said', () => {
  const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  const body = (name) => { const i = app.indexOf(`function ${name}(`); return i < 0 ? '' : app.slice(i, app.indexOf('\n}\n', i)); };
  assert.ok(/currentView\(\) !== 'workflows'/.test(body('wftChanged')), 'wftChanged repaints only inside the Workflows view');
  assert.ok(/wftRefresh\(\)/.test(body('enterWorkflowsView')), 'entering the Workflows view again repaints a shown Tests page');
  const tv = body('wftTestVersion');
  assert.ok(/if \(!versions\) \{ notify\(\{ tone: 'err', title: 'Could not open Test a version'/.test(tv), 'no versions read: a toast, never "No saved version yet"');
});
