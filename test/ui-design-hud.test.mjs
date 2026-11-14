// The Design stage's HUD (ui/public/design/hud.mjs): the dark bar under the stage. Its dots, text, line, cost and
// actions per phase (plan, build, end, halt, none), the in-place Stop question, Resume, Export, × and Hide cursors.
// It paints the plain object `selectHud` returns (Task 7); `paint` gets it whole, `stopWord` included.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createHud } from '../ui/public/design/hud.mjs';

const tick = () => new Promise((resolve) => setImmediate(resolve));

// `o.onExport`: pass an `onExport` (P6 wires it; until then the HUD has none).
function rig(o = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div class="dz-wrap"></div></body></html>');
  const win = dom.window;
  const doc = win.document;
  const host = doc.querySelector('.dz-wrap');
  const stops = []; const resumes = []; const exports = []; const hides = []; const dotHits = []; const hovers = []; const follows = [];
  let stopFn = () => Promise.resolve();
  let resumeFn = () => Promise.resolve();
  const hud = createHud({
    doc, host,
    onStop: () => { stops.push(true); return stopFn(); },
    onResume: () => { resumes.push(true); return resumeFn(); },
    ...(o.onExport ? { onExport: () => exports.push(true) } : {}),
    onFollow: () => follows.push(true),
    onHide: () => hides.push(true),
    onDot: (id) => dotHits.push(id),
    onDotHover: (id) => hovers.push(id),
  });
  return {
    hud, el: hud.el, win, doc, host, stops, resumes, exports, hides, dotHits, hovers, follows, tick,
    setStop: (fn) => { stopFn = fn; }, setResume: (fn) => { resumeFn = fn; },
  };
}

const H = (o) => ({ phase: 'build', word: 'Building', wordClass: 'is-work', text: '13 agents · 3 waiting · 9 / 14 sections · 123 layers', cost: '$3.24', pct: '64%', agents: 13, waiting: 3, failed: 0, stopped: 0, followOff: false, canResume: false, buildId: 'b_1', stopWord: 'Stop 13 agents?',
  dots: [{ agentId: 'a', crew: '--teal-ink', waiting: false, label: 'Hero: Writing' }, { agentId: 'b', crew: '--lime-ink', waiting: true, label: 'Price: Waiting for your answer' }], ...o });
const txt = (el) => [...el.querySelectorAll('button')].map((b) => b.textContent.trim() || b.getAttribute('aria-label'));

test('build: dots, text, line, cost, Stop, hide; role and label', () => {
  const { hud, el } = rig();
  hud.paint(H(), { hidden: false });
  assert.deepEqual([el.getAttribute('role'), el.getAttribute('aria-label')], ['group', 'Build status']);
  assert.equal(el.querySelector('.dz-hud-text').textContent, '13 agents · 3 waiting · 9 / 14 sections · 123 layers');
  assert.equal(el.querySelector('.dz-line i').style.width, '64%');
  assert.equal(el.querySelector('.dz-hud-cost').textContent, '$3.24');
  const dots = [...el.querySelectorAll('.dz-dots button')];
  assert.deepEqual(dots.map((d) => [d.getAttribute('aria-label'), d.title, d.style.getPropertyValue('--dot'), d.classList.contains('is-wait')]), [
    ['Hero: Writing', 'Hero: Writing', 'var(--teal-ink)', false], ['Price: Waiting for your answer', 'Price: Waiting for your answer', 'var(--lime-ink)', true]]);
  assert.deepEqual(txt(el.querySelector('.dz-hud-acts')), ['Stop', 'Hide cursors']);
  assert.ok(el.querySelector('.dz-hud-acts .btn.btn-sm:not(.btn-quiet)'));
});
test('a dot stays the same element across paints, opens its agent, and hovers its tip', () => {
  const { hud, el, dotHits, hovers, win } = rig();
  hud.paint(H(), { hidden: false });
  const d = el.querySelector('.dz-dots button');
  hud.paint(H({ text: 'x' }), { hidden: false });
  assert.equal(el.querySelector('.dz-dots button'), d);
  d.click();
  assert.deepEqual(dotHits, ['a']);
  d.dispatchEvent(new win.Event('mouseenter')); d.dispatchEvent(new win.Event('mouseleave'));
  assert.deepEqual(hovers, ['a', null]);
});
test('the state word is spoken once per change, not the numbers', () => {
  const { hud, el } = rig();
  hud.paint(H(), { hidden: false });
  const sr = el.querySelector('.sr-only[aria-live="polite"]');
  assert.equal(sr.textContent, 'Building');
  hud.paint(H({ text: 'other' }), { hidden: false });
  assert.equal(sr.textContent, 'Building');
  hud.paint(H({ word: 'Needs you' }), { hidden: false });
  assert.equal(sr.textContent, 'Needs you');
});
test('Stop asks in place: Stop 13 agents? with Keep building and Stop; safe choice focused; Esc keeps building; the count stays live', async () => {
  const { hud, el, stops, win, tick } = rig();
  hud.paint(H(), { hidden: false });
  [...el.querySelectorAll('button')].find((b) => b.textContent === 'Stop').click();
  assert.ok(el.classList.contains('is-confirm'));
  assert.equal(el.querySelector('.dz-hud-text').textContent, 'Stop 13 agents?');
  assert.equal(el.querySelector('.dz-dots'), null);
  const [keep, stop] = el.querySelectorAll('.dz-hud-acts button');
  assert.deepEqual([keep.textContent, keep.className, stop.textContent, stop.className], ['Keep building', 'btn btn-sm btn-quiet', 'Stop', 'btn btn-sm btn-danger']);
  assert.equal(el.ownerDocument.activeElement, keep);
  hud.paint(H({ stopWord: 'Stop 12 agents?' }), { hidden: false });
  assert.equal(el.querySelector('.dz-hud-text').textContent, 'Stop 12 agents?');
  el.querySelector('.dz-hud-acts').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(el.classList.contains('is-confirm'), false);
  assert.equal(stops.length, 0);
  [...el.querySelectorAll('button')].find((b) => b.textContent === 'Stop').click();
  el.querySelectorAll('.dz-hud-acts button')[1].click(); await tick();
  assert.equal(stops.length, 1);
  assert.equal(el.classList.contains('is-confirm'), false);
});
test('a refused Stop says so in the HUD and keeps the question; a build that ends closes it', async () => {
  const { hud, el, tick, setStop } = rig();
  setStop(() => Promise.reject(new Error('nope')));
  hud.paint(H(), { hidden: false });
  [...el.querySelectorAll('button')].find((b) => b.textContent === 'Stop').click();
  el.querySelectorAll('.dz-hud-acts button')[1].click();
  assert.equal(el.querySelectorAll('.dz-hud-acts button')[1].textContent, 'Stopping…');
  await tick();
  assert.equal(el.querySelector('.dz-hud-text').textContent, 'Could not stop');
  assert.equal(el.querySelector('.dz-hud-text').title, 'nope');
  assert.ok(el.classList.contains('is-confirm'));
  hud.paint(H(), { hidden: false });
  assert.equal(el.querySelector('.dz-hud-text').textContent, 'Could not stop', 'it stays until the person acts');
  hud.paint(H({ phase: 'end', text: 'Built by 1 agent in 1s · $0.01' }), { hidden: false });
  assert.equal(el.classList.contains('is-confirm'), false);
});
test('plan: Planning… with its cost; Follow only when the camera is off, before Stop', () => {
  const { hud, el } = rig();
  hud.paint(H({ phase: 'plan', text: 'Planning…', cost: '$0.12', followOff: true }), { hidden: false });
  assert.equal(el.querySelector('.dz-hud-text').textContent, 'Planning…');
  assert.equal(el.querySelector('.dz-hud-cost').textContent, '$0.12');
  assert.deepEqual(txt(el.querySelector('.dz-hud-acts')), ['Stop', 'Hide cursors'], 'no Follow while planning');
  hud.paint(H({ followOff: true }), { hidden: false });
  assert.deepEqual(txt(el.querySelector('.dz-hud-acts')), ['Follow', 'Stop', 'Hide cursors']);
  assert.equal(el.querySelector('.dz-hud-acts button').className, 'btn btn-sm btn-quiet');
});
test('hide cursors: label and icon flip, is-off; the count is untouched', () => {
  const { hud, el, hides } = rig();
  hud.paint(H(), { hidden: true });
  const b = el.querySelector('[aria-label="Show cursors"]');
  assert.ok(b.classList.contains('is-off'));
  assert.equal(el.querySelector('.dz-hud-text').textContent.startsWith('13 agents'), true);
  b.click();
  assert.equal(hides.length, 1);
});
test('end: the text, a full line, Export as primary, × closes until the next round', () => {
  const { hud, el, exports } = rig({ onExport: true });
  const end = H({ phase: 'end', text: 'Built by 29 agents in 6m 14s · $4.20', cost: '', dots: [] });
  hud.paint(end, { hidden: false });
  assert.equal(el.querySelector('.dz-line i').style.width, '100%');
  assert.equal(el.querySelector('.dz-dots'), null);
  const [exp, close] = el.querySelectorAll('.dz-hud-acts button');
  assert.deepEqual([exp.textContent, exp.className, close.getAttribute('aria-label')], ['Export', 'btn btn-sm btn-primary', 'Close']);
  assert.doesNotMatch(el.textContent, /Replay/);
  exp.click();
  assert.equal(exports.length, 1);
  close.click();
  assert.ok(el.classList.contains('is-none'));
  hud.paint(end, { hidden: false });
  assert.ok(el.classList.contains('is-none'), 'stays closed');
  hud.paint(H(), { hidden: false });
  assert.equal(el.classList.contains('is-none'), false, 'a Continue keeps the buildId: leaving the end phase reopens it');
});
test('with no export wired yet the button says why it is off', () => {
  const { hud, el } = rig();
  hud.paint(H({ phase: 'end', text: 't', dots: [] }), { hidden: false });
  const exp = el.querySelector('.btn-primary');
  assert.deepEqual([exp.disabled, exp.title], [true, 'Exports are not available yet']);
});
test('halt: the text, Resume as primary, its pending word and its failure', async () => {
  const { hud, el, resumes, tick, setResume } = rig();
  hud.paint(H({ phase: 'halt', text: 'Stopped · 6 / 14 sections · 104 layers · $2.74', cost: '', dots: [], canResume: true }), { hidden: false });
  assert.equal(el.querySelector('.dz-line'), null);
  const [res, close] = el.querySelectorAll('.dz-hud-acts button');
  assert.deepEqual([res.textContent, res.className, close.getAttribute('aria-label')], ['Resume', 'btn btn-sm btn-primary', 'Close']);
  res.click(); assert.equal(res.textContent, 'Resuming…'); await tick();
  assert.equal(resumes.length, 1);
  setResume(() => Promise.reject(new Error('A build is running')));
  el.querySelector('.btn-primary').click(); await tick();
  assert.equal(el.querySelector('.dz-hud-text').textContent, 'Could not resume');
  assert.equal(el.querySelector('.dz-hud-text').title, 'A build is running');
});
test('phase none: no HUD', () => {
  const { hud, el } = rig();
  hud.paint(H({ phase: 'none' }), { hidden: false });
  assert.ok(el.classList.contains('is-none'));
});
test('× also lifts when the buildId changes, even into another end', () => {
  const { hud, el } = rig();
  hud.paint(H({ phase: 'end', text: 't', dots: [] }), { hidden: false });
  el.querySelector('[aria-label="Close"]').click();
  assert.ok(el.classList.contains('is-none'));
  hud.paint(H({ phase: 'end', text: 't', dots: [], buildId: 'b_2' }), { hidden: false });
  assert.equal(el.classList.contains('is-none'), false);
});
test('a dot that leaves under the pointer hides its tip; a crew that is not a token name paints no colour', () => {
  const { hud, el, hovers, win } = rig();
  hud.paint(H({ dots: [{ agentId: 'a', crew: 'red;background:url(x)', waiting: false, label: 'Hero: Writing' }] }), { hidden: false });
  const d = el.querySelector('.dz-dots button');
  assert.equal(d.style.getPropertyValue('--dot'), '');
  d.dispatchEvent(new win.Event('mouseenter'));
  hud.paint(H({ dots: [] }), { hidden: false });
  assert.equal(el.querySelector('.dz-dots button'), null);
  assert.deepEqual(hovers, ['a', null]);
});
test('a focused dot keeps the focus when an earlier agent\'s dot goes (review cycle 3 N1)', () => {
  const { hud, el, doc } = rig();
  const dot = (id) => ({ agentId: id, crew: '--teal-ink', waiting: false, label: id });
  hud.paint(H({ dots: [dot('a'), dot('b'), dot('c')] }), { hidden: false });
  const b = el.querySelectorAll('.dz-dots button')[1];
  b.focus();
  hud.paint(H({ dots: [dot('b'), dot('c')] }), { hidden: false });
  assert.deepEqual([[...el.querySelectorAll('.dz-dots button')].map((d) => d.getAttribute('aria-label')), doc.activeElement === b], [['b', 'c'], true]);
});
test('a Stop answered after the question closed, or after destroy, changes nothing', async () => {
  const { hud, el, tick, setStop, host } = rig();
  const fails = [];
  setStop(() => new Promise((resolve, reject) => { fails.push(reject); }));
  const askAndStop = () => {
    [...el.querySelectorAll('button')].find((b) => b.textContent === 'Stop').click();
    el.querySelectorAll('.dz-hud-acts button')[1].click();
  };
  hud.paint(H(), { hidden: false });
  askAndStop();
  assert.equal(hud.confirmOpen(), true);
  hud.closeConfirm();
  assert.equal(hud.confirmOpen(), false);
  assert.equal(el.classList.contains('is-confirm'), false);
  askAndStop();
  fails[0](new Error('late')); await tick();
  const acts = () => [...el.querySelectorAll('.dz-hud-acts button')].map((b) => [b.textContent, b.disabled]);
  assert.equal(el.querySelector('.dz-hud-text').textContent, 'Stop 13 agents?', 'the first Stop answered after its question closed');
  assert.deepEqual(acts(), [['Keep building', true], ['Stopping…', true]]);
  hud.destroy();
  assert.equal(host.querySelector('.dz-hud'), null);
  fails[1](new Error('later')); await tick();
  hud.paint(H(), { hidden: false });
  assert.equal(el.querySelector('.dz-hud-text').textContent, 'Stop 13 agents?');
  assert.deepEqual(acts(), [['Keep building', true], ['Stopping…', true]]);
});
