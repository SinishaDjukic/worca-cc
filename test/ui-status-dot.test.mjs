// test/ui-status-dot.test.mjs — the one status-dot renderer (spec §2.1): Needs you and Failed are 12px symbols, never dots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderStatusDot, paintStatusDot, markDot, RUN_MARK_DOTS } from '../ui/public/status-dot.mjs';
import { RUN_MARKS } from '../src/shared/shape/run-status.mjs';
import { RUN_STATES } from '../src/shared/run-model.mjs';
import { checkRows } from './helpers/rows.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const model = (state) => ({ state, ...RUN_STATES[state] });

test('Needs you and Failed draw the 12px "?" / "!" symbol with their aria-label, never a plain dot', async () => {
  await checkRows([['needs-you', 'Needs you', 'is-amber', 'question'], ['failed', 'Failed', 'is-red', 'alert']].map(([state, label, cls, sym]) => ({ name: state, run: () => {
    const el = renderStatusDot(doc, model(state));
    assert.equal(el.getAttribute('role'), 'img');
    assert.equal(el.getAttribute('aria-label'), label);
    assert.ok(el.classList.contains('has-sym') && el.classList.contains(cls));
    assert.equal(el.dataset.symbol, sym);
    const svg = el.querySelector('svg.status-sym');
    assert.ok(svg, 'a symbol, not a plain dot');
    assert.equal(svg.getAttribute('width'), '12');
    assert.equal(svg.getAttribute('height'), '12');
    assert.ok(svg.querySelector('circle'), 'a filled circle');
    assert.ok(svg.querySelectorAll('path').length >= 2, 'the stroke glyph');
  } })));
});

test('the other 8 states draw their 8px dot, hidden from assistive tech (the word is next to it)', async () => {
  const want = { starting: 'is-peach', working: 'is-peach', paused: 'is-grey', waiting: 'is-grey-ring', stopped: 'is-dark-grey',
    ready: 'is-green', 'in-review': 'is-green', merged: 'is-violet' };
  await checkRows(Object.entries(want).map(([state, cls]) => ({ name: state, run: () => {
    const el = renderStatusDot(doc, model(state));
    assert.ok(el.classList.contains('status-dot') && el.classList.contains(cls));
    assert.equal(el.getAttribute('aria-hidden'), 'true');
    assert.equal(el.querySelector('svg'), null);
    assert.equal(el.classList.contains('is-pulse'), state === 'starting' || state === 'working');
  } })));
});

test('repainting the same element from a symbol to a dot drops the symbol and its label', () => {
  const el = renderStatusDot(doc, model('needs-you'));
  paintStatusDot(el, model('working'));
  assert.equal(el.querySelector('svg'), null);
  assert.equal(el.getAttribute('aria-label'), null);
  assert.equal(el.getAttribute('role'), null);
});

test('status-dot CSS: 8px dot, 12px symbol, pulse off under reduced motion', () => {
  const css = readStyleCss();
  assert.match(css, /\.status-dot\{[^}]*width:8px;height:8px;[^}]*border-radius:50%/);
  assert.match(css, /\.status-dot\.has-sym\{[^}]*width:12px;height:12px/);
  assert.match(css, /prefers-reduced-motion: reduce\)\{[^@]*\.status-dot\.is-pulse\{animation:none;\}/);
  assert.match(css, /\.status-sym > g\{stroke:var\(--on-signal\);\}/);
  assert.match(css, /--on-signal:light-dark\(#19191B,#19191B\)/);
});

test('QA 6: a plain Needs-you dot (no symbol) still names itself "Needs you"', () => {
  const el = renderStatusDot(doc, { ...model('needs-you'), symbol: null });
  assert.equal(el.querySelector('svg'), null);
  assert.ok(el.classList.contains('is-amber') && !el.classList.contains('has-sym'));
  assert.equal(el.getAttribute('role'), 'img');
  assert.equal(el.getAttribute('aria-label'), 'Needs you');
  assert.equal(el.getAttribute('aria-hidden'), null);
});

test('#948 s2: an idle chat paints the bubble line icon in the dot\'s place; a plain dot model empties it', () => {
  const el = renderStatusDot(doc, { state: 'idle', dot: 'grey', icon: 'chat', word: 'Idle' });
  assert.ok(el.classList.contains('has-ic'));
  assert.equal(el.querySelectorAll('svg.status-ic').length, 1);
  assert.equal(el.getAttribute('aria-hidden'), 'true');
  paintStatusDot(el, model('working'));
  assert.equal(el.querySelector('svg'), null);
  assert.ok(!el.classList.contains('has-ic'));
});

test('a chat kind names its icon: role img, the name as aria-label and tooltip; a repaint without one drops both', async () => {
  await checkRows([
    ['an idle chat that started a run', { state: 'idle', dot: 'grey', icon: 'run', word: 'Idle', dotLabel: 'Started a run' }, 'ic:run', 'has-ic'],
    ['a plain chat', { state: 'idle', dot: 'grey', icon: 'chat', word: 'Idle', dotLabel: 'Chat' }, 'ic:chat', 'has-ic'],
    ['a chat whose run needs you', { state: 'needs-you', dot: 'amber', symbol: 'question', word: 'Needs you', dotLabel: 'Run needs you' }, 'question', 'has-sym'],
  ].map(([name, m, sym, cls]) => ({ name, run: () => {
    const el = renderStatusDot(doc, m);
    assert.ok(el.classList.contains(cls));
    assert.equal(el.dataset.symbol, sym);
    assert.equal(el.getAttribute('role'), 'img');
    assert.equal(el.getAttribute('aria-label'), m.dotLabel);
    assert.equal(el.getAttribute('title'), m.dotLabel);
    assert.equal(el.getAttribute('aria-hidden'), null);
    paintStatusDot(el, { state: 'replying', dot: 'green', pulse: true, word: 'Replying' });
    assert.equal(el.getAttribute('title'), null, 'the busy pulse has no name of its own: its word is on the sub line');
    assert.equal(el.getAttribute('role'), null);
    assert.equal(el.getAttribute('aria-label'), null);
    assert.equal(el.getAttribute('aria-hidden'), 'true');
  } })));
});

test('Following a run draws the run line icon in the Following colour, pulsing; the CSS keeps its colour on the icon', () => {
  const el = renderStatusDot(doc, { state: 'following', dot: 'peach', pulse: true, icon: 'track', word: 'Following a run', dotLabel: 'Follows a run' });
  assert.deepEqual([...el.classList].sort(), ['has-ic', 'is-peach', 'is-pulse', 'status-dot']);
  assert.equal(el.querySelectorAll('svg.status-ic').length, 1);
  assert.equal(el.getAttribute('aria-label'), 'Follows a run');
  const css = readStyleCss();
  assert.match(css, /\.status-dot\.has-ic\.is-peach\{color:var\(--peach-ink\);\}/, 'the icon reads in the Following colour, not ink-2');
});

// ---- Shaper small runs s4 (R-ux-1, R-ux-5): a run status mark becomes a dot only through markDot ----
const paint = (m) => renderStatusDot(doc, m);
const dev = (state) => ({ state, ...RUN_STATES[state] });

test('markDot: every mark has a dot entry, and only live pulses (R-ux-5)', () => {
  assert.deepEqual(Object.keys(RUN_MARK_DOTS).sort(), [...RUN_MARKS].sort());
  assert.deepEqual(Object.entries(RUN_MARK_DOTS).filter(([, v]) => v.pulse).map(([k]) => k), ['live']);
  assert.ok(Object.isFrozen(RUN_MARK_DOTS));
});

test('markDot: done is green, live peach with the pulse, a null or unknown mark returns the very same model', () => {
  const w = dev('working');
  assert.deepEqual([markDot(w, 'done', 'done').dot, markDot(w, 'done', 'done').pulse, markDot(w, 'done', 'done').symbol], ['green', false, null]);
  const live = markDot(dev('ready'), 'live', 'writing tests');
  assert.deepEqual([live.dot, live.pulse, live.symbol], ['peach', true, null]);
  assert.equal(markDot(w, null, 'x'), w);
  assert.equal(markDot(w, 'nonsense', 'x'), w);
  assert.equal(markDot(w, undefined, null), w);
});

test('markDot: only an open stop draws the amber "?" and only a failed run the red "!" (aria-label = the word)', () => {
  const ask = paint(markDot(dev('working'), 'ask', 'waiting for you'));
  assert.ok(ask.classList.contains('is-amber') && ask.classList.contains('has-sym'));
  assert.equal(ask.dataset.symbol, 'question');
  assert.equal(ask.getAttribute('role'), 'img');
  assert.equal(ask.getAttribute('aria-label'), 'waiting for you');
  const failed = paint(markDot(dev('working'), 'failed', 'failed'));
  assert.ok(failed.classList.contains('is-red') && failed.classList.contains('has-sym'));
  assert.equal(failed.dataset.symbol, 'alert');
  assert.equal(failed.getAttribute('aria-label'), 'failed');
  // No word given: the RUN_STATES word labels the symbol.
  assert.equal(paint(markDot(dev('working'), 'ask', null)).getAttribute('aria-label'), 'Needs you');
  assert.equal(paint(markDot(dev('working'), 'failed', '')).getAttribute('aria-label'), 'Failed');
  for (const mark of ['done', 'live', 'after', 'ring', 'faint']) {
    const el = paint(markDot(dev('working'), mark, 'x'));
    assert.equal(el.dataset.symbol, undefined, `${mark}: no glyph`);
    assert.equal(el.querySelector('svg'), null, `${mark}: no glyph`);
  }
});

test('markDot: a held answer (after) is the dashed ring: no "?", no SVG, aria-hidden, no pulse (R-ux-1)', () => {
  const el = paint(markDot(dev('needs-you'), 'after', 'after run 3'));
  assert.ok(el.classList.contains('status-dot') && el.classList.contains('is-dashed-ring'));
  assert.ok(!el.classList.contains('has-sym') && !el.classList.contains('is-pulse'));
  assert.equal(el.querySelector('svg'), null);
  assert.equal(el.dataset.symbol, undefined);
  assert.equal(el.getAttribute('aria-hidden'), 'true');
  assert.equal(el.getAttribute('role'), null);
});

test('markDot: next draws the --ink ring, a free run and a waiting run the grey ring (owner direction d6dd6d688)', () => {
  const next = paint(markDot(dev('waiting'), 'ring', 'next'));
  assert.ok(next.classList.contains('is-ink-ring'), 'next: its own ink ring variant');
  assert.ok(paint(markDot(dev('waiting'), 'ring', 'next · small change run')).classList.contains('is-ink-ring'));
  const free = paint(markDot(dev('waiting'), 'ring', ''));
  assert.ok(free.classList.contains('is-grey-ring') && !free.classList.contains('is-ink-ring'), 'a free run without the turn: grey ring');
  const waits = paint(markDot(dev('waiting'), 'faint', 'waits for run 7, 10'));
  assert.ok(waits.classList.contains('is-grey-ring'));
  for (const el of [next, free, waits]) { assert.equal(el.getAttribute('aria-hidden'), 'true'); assert.equal(el.querySelector('svg'), null); }
});

test('markDot: a merged run keeps violet and a PR-problem run keeps plain amber with its label, even with mark done', () => {
  const merged = paint(markDot(dev('merged'), 'done', 'done'));
  assert.ok(merged.classList.contains('is-violet'));
  const prProblem = { state: 'needs-you', dot: 'amber', pulse: false, symbol: null, word: 'Needs you' };
  const el = paint(markDot(prProblem, 'done', 'done'));
  assert.ok(el.classList.contains('is-amber') && !el.classList.contains('has-sym'));
  assert.equal(el.getAttribute('aria-label'), 'Needs you');
  assert.equal(markDot(prProblem, 'done', 'done').state, 'needs-you', 'data-state keeps the dev state');
});

test('markDot is pure: the input model is not changed', () => {
  const m = Object.freeze(dev('working'));
  assert.doesNotThrow(() => markDot(m, 'after', 'after run 3'));
  assert.equal(m.dot, 'peach');
});
