// test/ui-run-progress-bar.test.mjs — the shared run progress bar painter (ui/public/run-progress-bar.mjs):
// idempotent painters over a host element, so the fill node survives repaints and its width glides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { paintProgressBar, paintChainBar, renderRowLine } from '../ui/public/run-progress-bar.mjs';
import { checkRows } from './helpers/rows.mjs';

const { window } = new JSDOM('<!doctype html><body></body>');
const doc = window.document;

// jsdom's CSS parser serialises "50.00%" as "50%"; compare the number, which is what the browser paints.
const pct = (n) => Number.parseFloat(n.style.width);

const stage = (id, label, state, agents = []) => ({ id, label, state, agents });
const STAGES = [
  stage('plan', 'Plan', 'done', [{ label: 'Planner', state: 'done' }]),
  stage('build', 'Build', 'done', [{ label: 'Implementer', state: 'done' }]),
  stage('review', 'Review', 'current', [{ label: 'Reviewer', state: 'current' }, { label: 'Fixer', state: 'waiting' }]),
  stage('ready', 'Ready', 'waiting'),
];
const staged = (extra = {}) => ({ mode: 'stages', stage: 'review', fraction: 0.4, tone: 'blue', stages: STAGES, passes: 2, text: '', ...extra });

test('paintProgressBar', async () => {
  await checkRows([
    { name: 'null prog hides host', run() {
      const host = doc.createElement('div');
      paintProgressBar(host, null);
      assert.equal(host.hidden, true);
    } },
    { name: 'a missing host is a no-op', run() {
      assert.doesNotThrow(() => paintProgressBar(null, staged()));
    } },
    { name: 'stages mode builds ticks, marks, detail', run() {
      const host = doc.createElement('div');
      paintProgressBar(host, staged());
      assert.equal(host.hidden, false);
      assert.equal(host.querySelectorAll('.run-prog-tick').length, 3);
      assert.equal(host.querySelectorAll('.run-prog-mark').length, 4);
      assert.ok(host.querySelector('.run-prog-detail[data-min-level="advanced"]'));
      assert.equal(host.querySelector('.run-prog-detail').getAttribute('role'), 'tooltip');
    } },
    { name: 'marks carry the stage state', run() {
      const host = doc.createElement('div');
      paintProgressBar(host, staged());
      const states = [...host.querySelectorAll('.run-prog-mark')].map((m) => `${m.dataset.stage}:${m.dataset.state}`);
      assert.deepEqual(states, ['plan:done', 'build:done', 'review:current', 'ready:waiting']);
    } },
    { name: 'a stage the run lacks reads as waiting', run() {
      const host = doc.createElement('div');
      paintProgressBar(host, staged({ stages: [stage('plan', 'Plan', 'current')] }));
      const build = host.querySelector('.run-prog-mark[data-stage="build"]');
      assert.equal(build.dataset.state, 'waiting');
    } },
    { name: 'fill element survives repaint and follows width and tone', run() {
      const host = doc.createElement('div');
      paintProgressBar(host, staged({ fraction: 0.3, stages: [], passes: 0 }));
      const fill1 = host.querySelector('.run-prog-fill');
      assert.equal(host.dataset.tone, 'blue');
      paintProgressBar(host, staged({ fraction: 0.5, tone: 'green', stages: [], passes: 0 }));
      const fill2 = host.querySelector('.run-prog-fill');
      assert.strictEqual(fill1, fill2, 'same fill element');
      assert.equal(pct(fill2), 50);
      assert.equal(host.dataset.tone, 'green');
    } },
    { name: 'nodes mode has no marks, ticks or detail', run() {
      const host = doc.createElement('div');
      paintProgressBar(host, { mode: 'nodes', fraction: 0.5, tone: 'blue', stages: [], passes: 0 });
      assert.equal(host.querySelectorAll('.run-prog-mark').length, 0);
      assert.equal(host.querySelectorAll('.run-prog-tick').length, 0);
      assert.equal(host.querySelector('.run-prog-detail'), null);
      assert.ok(host.querySelector('.run-prog-fill'));
    } },
    { name: 'switching mode rebuilds the skeleton', run() {
      const host = doc.createElement('div');
      paintProgressBar(host, staged());
      paintProgressBar(host, { mode: 'nodes', fraction: 0.2, tone: 'blue', stages: [], passes: 0 });
      assert.equal(host.querySelector('.run-prog-detail'), null);
      assert.equal(host.dataset.mode, 'nodes');
    } },
    { name: 'detail lists stages, agents with states and the pass count, no times', run() {
      const host = doc.createElement('div');
      paintProgressBar(host, staged());
      const detail = host.querySelector('.run-prog-detail');
      const text = detail.textContent;
      assert.match(text, /Review · now · 2 passes/);
      assert.match(text, /Reviewer · now/);
      assert.match(text, /Fixer · waiting/);
      assert.match(text, /Plan · done/);
      assert.doesNotMatch(text, /Ready/, 'the ready stage is not listed');
      assert.doesNotMatch(text, /\d+[smh]\b/);
    } },
    { name: 'one pass is singular; a skipped stage says it is not in the workflow', run() {
      const host = doc.createElement('div');
      paintProgressBar(host, staged({ passes: 1, stages: [stage('plan', 'Plan', 'skipped'), stage('review', 'Review', 'current')] }));
      const text = host.querySelector('.run-prog-detail').textContent;
      assert.match(text, /1 pass(?!es)/);
      assert.match(text, /Plan · not in this workflow/);
    } },
    { name: 'an unchanged breakdown keeps its nodes; a changed one repaints', run() {
      const host = doc.createElement('div');
      paintProgressBar(host, staged());
      const list1 = host.querySelector('.run-prog-stages');
      paintProgressBar(host, staged({ fraction: 0.6 }));
      assert.strictEqual(host.querySelector('.run-prog-stages'), list1);
      paintProgressBar(host, staged({ passes: 3 }));
      assert.notStrictEqual(host.querySelector('.run-prog-stages'), list1);
      assert.match(host.querySelector('.run-prog-detail').textContent, /3 passes/);
    } },
    { name: 'accessibility: the track and marks are aria-hidden, the detail opens by CSS not JS', run() {
      const host = doc.createElement('div');
      paintProgressBar(host, staged());
      assert.equal(host.querySelector('.run-prog-track').getAttribute('aria-hidden'), 'true');
      assert.equal(host.querySelector('.run-prog-marks').getAttribute('aria-hidden'), 'true');
      assert.equal(host.querySelector('.run-prog-detail').hidden, false, 'no JS hiding; the CSS level gate does it');
      assert.equal(host.hasAttribute('tabindex'), false, 'tabindex lives in the template (6a)');
    } },
  ]);
});

test('paintChainBar', async () => {
  const chain = () => ({
    total: 3, index: 2, fraction: 0.5, tone: 'blue', text: 'Run 2 of 3 · Plan',
    parts: [
      { state: 'done', fraction: 1, tone: 'green' },
      { state: 'current', fraction: 0.3, tone: 'blue' },
      { state: 'waiting', fraction: 0, tone: 'blue' },
    ],
  });
  await checkRows([
    { name: 'hidden for a single run, a null chain and a missing host', run() {
      const host = doc.createElement('div');
      paintChainBar(host, { total: 1 });
      assert.equal(host.hidden, true);
      paintChainBar(host, null);
      assert.equal(host.hidden, true);
      assert.doesNotThrow(() => paintChainBar(null, chain()));
    } },
    { name: 'three parts with state, tone, width and label', run() {
      const host = doc.createElement('div');
      paintChainBar(host, chain());
      assert.equal(host.hidden, false);
      const parts = host.querySelectorAll('.run-chain-part');
      assert.equal(parts.length, 3);
      assert.equal(parts[0].dataset.state, 'done');
      assert.equal(parts[0].dataset.tone, 'green');
      assert.equal(pct(parts[1].firstElementChild), 30);
      assert.equal(parts[1].firstElementChild.className, 'run-prog-fill');
      assert.equal(host.querySelector('.run-chain-label').textContent, 'Run 2 of 3 · Plan');
      assert.equal(host.querySelector('.run-chain-track').getAttribute('aria-hidden'), 'true');
    } },
    { name: 'repaint keeps the part fills and moves them', run() {
      const host = doc.createElement('div');
      paintChainBar(host, chain());
      const fill = host.querySelectorAll('.run-prog-fill')[1];
      const next = chain();
      next.parts[1].fraction = 0.8;
      next.text = 'Run 2 of 3 · Build';
      paintChainBar(host, next);
      assert.strictEqual(host.querySelectorAll('.run-prog-fill')[1], fill);
      assert.equal(pct(fill), 80);
      assert.equal(host.querySelector('.run-chain-label').textContent, 'Run 2 of 3 · Build');
    } },
    { name: 'a changed run count rebuilds the parts; a short parts list falls back to waiting', run() {
      const host = doc.createElement('div');
      paintChainBar(host, chain());
      paintChainBar(host, { total: 2, text: 'Run 1 of 2', parts: [{ state: 'current', fraction: 0.1, tone: 'amber' }] });
      const parts = host.querySelectorAll('.run-chain-part');
      assert.equal(parts.length, 2);
      assert.equal(parts[0].dataset.tone, 'amber');
      assert.equal(parts[1].dataset.state, 'waiting');
      assert.equal(pct(parts[1].firstElementChild), 0);
    } },
  ]);
});

test('renderRowLine', async () => {
  await checkRows([
    { name: 'sets tone and width on an aria-hidden span', run() {
      const line = renderRowLine(doc, { fraction: 0.4, tone: 'blue' });
      assert.equal(line.tagName, 'SPAN');
      assert.equal(line.className, 'runs-row-prog');
      assert.equal(line.getAttribute('aria-hidden'), 'true');
      assert.equal(line.dataset.tone, 'blue');
      assert.equal(pct(line.querySelector('i')), 40);
    } },
    { name: 'from sets the start width, not the target', run() {
      const line = renderRowLine(doc, { fraction: 0.6, tone: 'amber' }, '20.00%');
      assert.equal(line.dataset.tone, 'amber');
      assert.equal(pct(line.querySelector('i')), 20);
    } },
    { name: 'a missing progress object paints an empty blue line', run() {
      const line = renderRowLine(doc, null);
      assert.equal(line.dataset.tone, 'blue');
      assert.equal(pct(line.querySelector('i')), 0);
    } },
  ]);
});

// Layout guards (no layout engine in jsdom): the bars must not share a flex row with the Live view switch,
// which squeezed them to ~128px so the four stage labels overlapped.
const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
const rule = (sel) => (css.match(new RegExp(`^${sel.replace(/[.>]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm')) || [])[1] || '';

test('run progress layout CSS', async () => {
  await checkRows([
    { name: 'the sheet head is a grid, not a squeezing flex row', run() {
      assert.match(rule('.rd-sheet-head'), /display:\s*grid/);
    } },
    { name: 'the bars span the full head width', run() {
      assert.match(rule('.rd-sheet-head > .run-prog'), /grid-column:\s*1\s*\/\s*-1/);
    } },
    { name: 'the hover detail opens above the bar', run() {
      const r = rule('.run-prog-detail');
      assert.match(r, /bottom:\s*calc\(100% \+ 6px\)/);
      assert.doesNotMatch(r, /top:\s*calc/);
    } },
  ]);
});
