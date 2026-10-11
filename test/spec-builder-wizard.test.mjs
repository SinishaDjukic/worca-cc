// test/spec-builder-wizard.test.mjs — the Spec Builder wizard alone (jsdom, no app shell), with a stub api.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { createSpecBuilder, estimateSummary } from '../ui/public/spec-builder.mjs';

const trackDom = useDomRelease(afterEach);
const tick = () => new Promise((r) => setTimeout(r, 0));
const EST = (low) => ({ recipe: 'r', stages: [{ phase: 'implementer', model: null, low, high: low * 2, n: 0, basis: 'rough' }], low, high: low * 2, ms: 60_000, msHigh: 120_000, basis: 'rough', samples: 0 });

function mount(api) {
  const { document: doc } = trackDom(new JSDOM('<!doctype html><body></body>')).window;
  const sb = createSpecBuilder({ doc, api, onGenerate: async () => {}, onOpenAsk: () => {} });
  doc.body.appendChild(sb.el);
  const q = (s) => sb.el.querySelector(s);
  const goal = (text) => { const g = q('[data-sb-goal]'); g.value = text; g.dispatchEvent(new doc.defaultView.Event('input')); };
  return { sb, q, goal };
}

test('a slow older estimate never overwrites a newer one', async () => {
  const pending = [];
  const { q, goal } = mount({ areas: async () => [], estimate: () => new Promise((res) => pending.push(res)) });
  goal('Add dark mode');
  q('[data-sb-next]').click(); q('[data-sb-next]').click(); q('[data-sb-next]').click();   // → Estimate (request 1)
  q('.sb-nav .btn-ghost').click();                                                         // Back
  q('[data-sb-next]').click();                                                             // → Estimate (request 2)
  assert.equal(pending.length, 2);
  pending[1](EST(2));
  await tick();
  assert.match(q('[data-sb-summary]').textContent, /^\$2\.00/);
  pending[0](EST(9));
  await tick();
  assert.match(q('[data-sb-summary]').textContent, /^\$2\.00/, 'the stale answer lost');
});

test('the Scope step asks for Areas once per goal, whatever re-renders it', async () => {
  let calls = 0;
  const { q, goal } = mount({ areas: async () => { calls += 1; return []; }, estimate: async () => EST(1) });
  goal('Add dark mode');
  q('[data-sb-next]').click(); q('[data-sb-next]').click();
  q('[data-sb-size="large"]').click();
  q('[data-sb-size="small"]').click();
  await tick();
  assert.equal(calls, 1);
});

test('estimateSummary: rough vs history', () => {
  assert.match(estimateSummary({ ...EST(1), basis: 'rough' }), /Rough estimate$/);
  assert.match(estimateSummary({ ...EST(1), basis: 'history', samples: 4 }), /Based on 4\+ past runs$/);
  assert.equal(estimateSummary(null), '');
});
