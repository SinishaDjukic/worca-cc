// test/ui-auto-build.test.mjs — the workflow card's build choreography (mockup §B + §F motion), on fake timers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderAutoProposal } from '../ui/public/auto-proposal.mjs';
import { buildTrace, scheduleTrace, playAssembly, BUILD_STEPS, TRACE_TIMING } from '../ui/public/auto-build.mjs';
import { proposalFor } from './helpers/auto-proposal-fixture.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
function fakeWin({ reduced = false } = {}) {
  const timers = [];
  return {
    win: {
      setTimeout: (fn, ms) => { timers.push({ fn, ms, at: null }); return timers.length; },
      clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
      matchMedia: (q) => ({ matches: reduced && /reduce/.test(q) }),
    },
    /** run every timer due at or before `t` ms (ms are relative to schedule time — the module never chains timers, so this is exact) */
    run: (t) => { for (const x of timers) if (x.fn && x.ms <= t && x.at == null) { x.at = t; const f = x.fn; x.fn = null; f(); } },
    timers,
  };
}

test('trace: four steps, aria-live, step 0 live at once; scheduleTrace advances on the task timing and stop() cancels', () => {
  const tr = buildTrace(doc, { mode: 'task' });
  assert.equal(tr.el.getAttribute('aria-live'), 'polite');
  const steps = [...tr.el.querySelectorAll('.ask-wfcard-step')];
  assert.equal(steps.length, 4);
  assert.deepEqual(steps.map((s) => s.querySelector('.st-label').textContent), BUILD_STEPS.map((s) => s[0]));
  assert.ok(steps[0].classList.contains('is-live'));
  const f = fakeWin();
  const stop = scheduleTrace(tr, { win: f.win, mode: 'task' });
  assert.deepEqual(f.timers.map((t) => t.ms), TRACE_TIMING.task);
  f.run(600);
  assert.ok(steps[0].classList.contains('is-done') && steps[1].classList.contains('is-live'));
  assert.equal(steps[0].querySelector('.st-meter').textContent, BUILD_STEPS[0][1], 'a done step shows its meter');
  stop(); f.run(5000);
  assert.ok(!steps[2].classList.contains('is-live'), 'stopped: no later step fires');
  assert.equal(buildTrace(doc, { mode: 'shape' }).el.querySelectorAll('.st-label')[1].textContent, 'Checking the shape');
});

test('assembly: nodes reveal in placement order 140 ms apart, a wire only once both ends are shown, badges + match last; reduced motion lands at once', () => {
  const h = renderAutoProposal(proposalFor(), { doc, width: 702 });
  const f = fakeWin();
  const order = h.graph.flowLayout().order;
  const done = []; playAssembly(h, { win: f.win, onDone: () => done.push(1) });
  const hidden = () => order.filter((id) => h.graph.nodeEl(id).classList.contains('is-hid')).length;
  assert.equal(hidden(), order.length, 'everything starts hidden');
  assert.ok(h.parts.match.classList.contains('is-hid'));
  f.run(0);   assert.equal(hidden(), order.length - 1);
  f.run(140); assert.equal(hidden(), order.length - 2);
  const wires = [...h.graph.wiresEl.querySelectorAll('path.wire[data-wire-id]')];
  const tpl = h.graph.template();
  const firstWire = wires.find((p) => { const w = tpl.wires.find((x) => x.id === p.dataset.wireId); return w && order.indexOf(w.from.node) <= 1 && order.indexOf(w.to.node) <= 1; });
  assert.ok(firstWire.classList.contains('is-hid'), 'the check at 120 ms ran before its later end landed at 140 ms');
  f.run(260); assert.ok(!firstWire.classList.contains('is-hid'), 'the check at 140 + 120 ms reveals it');
  f.run(order.length * 140 + 420);
  assert.equal(hidden(), 0); assert.ok(!h.parts.match.classList.contains('is-hid')); assert.deepEqual(done, [1]);
  assert.equal(h.parts.graph.querySelectorAll('.is-hid').length, 0, 'nothing stays hidden');
  h.destroy();
  const r = fakeWin({ reduced: true });
  const h2 = renderAutoProposal(proposalFor(), { doc, width: 702 });
  const done2 = []; playAssembly(h2, { win: r.win, onDone: () => done2.push(1) });
  assert.equal(r.timers.length, 0); assert.deepEqual(done2, [1]); assert.equal(h2.parts.graph.querySelectorAll('.is-hid').length, 0);
  h2.destroy();
});
