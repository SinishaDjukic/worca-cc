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

// The neutral four-section bar and the continuous group bar.
const fourStage = (extra = {}) => staged({ fill: [1, 1, 0.4, 0], fraction: 0.6, ...extra });

test('paintProgressBar: four neutral sections', async () => {
  await checkRows([
    { name: 'four sections, one per stage, each with its own fill', run() {
      const host = doc.createElement('div');
      paintProgressBar(host, fourStage());
      const secs = [...host.querySelectorAll('.run-prog-sec')];
      assert.deepEqual(secs.map((s) => s.dataset.stage), ['plan', 'build', 'review', 'ready']);
      assert.deepEqual(secs.map((s) => pct(s.querySelector('.run-prog-fill'))), [100, 100, 40, 0]);
      assert.equal(host.querySelectorAll('.run-prog-tick').length, 0, 'ticks are gone: sections are the stops');
    } },
    { name: 'the current section is marked and the pulse edge needs { pulse: true }', run() {
      const host = doc.createElement('div');
      paintProgressBar(host, fourStage());
      assert.equal(host.querySelector('.run-prog-sec.is-current').dataset.stage, 'review');
      assert.equal(host.dataset.pulse, 'off');
      paintProgressBar(host, fourStage(), { pulse: true });
      assert.equal(host.dataset.pulse, 'on');
    } },
    { name: 'fill elements survive repaints (the width glides)', run() {
      const host = doc.createElement('div');
      paintProgressBar(host, fourStage());
      const first = host.querySelector('.run-prog-sec[data-stage="review"] .run-prog-fill');
      paintProgressBar(host, fourStage({ fill: [1, 1, 0.8, 0] }));
      assert.equal(host.querySelector('.run-prog-sec[data-stage="review"] .run-prog-fill'), first);
      assert.equal(pct(first), 80);
    } },
  ]);
});

test('paintChainBar: one continuous fill at the group fraction', () => {
  const host = doc.createElement('div');
  paintChainBar(host, { total: 3, fraction: 0.5, text: 'Run 2 of 3 · Build', parts: [] });
  assert.equal(host.querySelectorAll('.run-chain-track').length, 1);
  assert.equal(host.querySelectorAll('.run-chain-part').length, 0);
  assert.equal(pct(host.querySelector('.run-chain-track > .run-prog-fill')), 50);
  assert.equal(host.querySelector('.run-chain-label').textContent, 'Run 2 of 3 · Build');
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

test('neutral bar CSS: ink steps 40/60/80/100%, --line-2 upcoming, no tone colours, pulse edge off under reduced motion', () => {
  for (const [stage, n] of [['plan', 40], ['build', 60], ['review', 80], ['ready', 100]]) {
    assert.match(css, new RegExp(`\\.run-prog-sec\\[data-stage="${stage}"\\]\\{--sec-ink:color-mix\\(in srgb,var\\(--ink\\) ${n}%,var\\(--line-2\\)\\);\\}`));
  }
  assert.match(rule('.run-prog-sec'), /background:var\(--line-2\)/);
  assert.doesNotMatch(css, /data-tone="(?:amber|green|red)"\][^{]*\.run-prog-fill/);
  assert.match(rule('.run-chain-track > .run-prog-fill'), /background:var\(--ink-2\)/);
  // A1: the Runs list row bar is ink-grey too; its data-tone stays for other readers, but no CSS colours it.
  assert.match(rule('.runs-row-prog > i'), /background:var\(--ink-2\)/);
  assert.doesNotMatch(css, /\.runs-row-prog\[data-tone/);
  assert.doesNotMatch(css, /\.runs-row-prog[^{]*\{[^}]*--blue/);
  assert.match(css, /prefers-reduced-motion: reduce\)\{[^@]*\.run-prog\[data-pulse="on"\] \.run-prog-sec\.is-current > \.run-prog-fill::after\{animation:none;\}/);
});

test('run progress layout CSS', async () => {
  await checkRows([
    { name: 'the sheet head is a grid, not a squeezing flex row', run() {
      assert.match(rule('.rd-sheet-head'), /display:\s*grid/);
    } },
    { name: 'the bars take the status block\'s width: a grid, never a squeezing flex row (slice 4, D19)', run() {
      assert.match(rule('.run-status'), /display:\s*grid/);
      assert.match(rule('.rd-sheet-head'), /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
      assert.doesNotMatch(css, /(^|\})\.rd-now-top\{display:flex/m, 'the old orb row no longer lays the block out');
    } },
    { name: 'run page: the bar spans the whole head, the status line keeps column 1 beside the switch and buttons', run() {
      const top = rule('.rd-sheet-head > .rd-now-top');
      assert.match(top, /grid-area:1 \/ 1 \/ 2 \/ -1/, 'the block spans every head column');
      assert.match(top, /grid-template-columns:subgrid/, 'its rows line up with the head\'s columns');
      assert.match(top, /column-gap:0/);
      assert.match(css, /^\.rd-sheet-head > \.rd-now-top > \*\{grid-column:1 \/ -1;\}/m, 'the bar and the other rows span the card');
      assert.match(rule('.rd-sheet-head > .rd-now-top > .run-status-head'), /grid-column:1;/, 'the status text ends where the switch begins');
      // Scoped to the run page: the shared block's own rule lays out no subgrid for the chat card or the group page.
      assert.doesNotMatch(rule('.run-status'), /subgrid/);
    } },
    { name: 'the hover detail opens above the bar', run() {
      const r = rule('.run-prog-detail');
      assert.match(r, /bottom:\s*calc\(100% \+ 6px\)/);
      assert.doesNotMatch(r, /top:\s*calc/);
    } },
  ]);
});

test('stage labels line up with their segments: the marks row shares the track\'s columns and gap, each label left-aligned', () => {
  const gap = (r) => (r.match(/(?:^|;)gap:([^;]+)/) || [])[1];
  assert.match(rule('.run-prog-marks'), /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.equal(gap(rule('.run-prog-marks')), gap(rule('.run-prog-track')));
  const mark = rule('.run-prog-mark');
  assert.match(mark, /text-align:left/);
  assert.match(mark, /min-width:0/);
  assert.match(mark, /text-overflow:ellipsis/);
  assert.match(rule('.run-prog.is-compact .run-prog-marks'), /display:none/);
});
