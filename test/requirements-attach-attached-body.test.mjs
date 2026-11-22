// test/requirements-attach-attached-body.test.mjs — the run page's attached-requirements card
// (ui/public/shape/attached-body.mjs) and its dispatch: `isRequirementsAsk` true for `plan.attached`, plan-body renders
// the attached card, one Agree sends `agreedSeqs` for the features still pending.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderAttachedBody } from '../ui/public/shape/attached-body.mjs';
import { renderPlanBody } from '../ui/public/shape/plan-body.mjs';
import { isRequirementsAsk, stepChip, stepTitle } from '../ui/public/shape/step-card.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const FEATURES = [
  { seq: 1, id: 'f-1', title: 'Export runs as CSV', criteriaCount: 3, markdown: '# a', agreed: true },
  { seq: 2, id: 'f-2', title: 'Share a run by link', criteriaCount: 2, markdown: '# b', agreed: false },
  { seq: 3, id: 'f-3', title: 'Dark theme', criteriaCount: 4, markdown: '# c', agreed: false },
];
const plan = (features = FEATURES) => ({ attached: { features } });

test('isRequirementsAsk is true for an attached ask and the old predicates are unchanged', () => {
  assert.equal(isRequirementsAsk({ kind: 'plan', plan: plan() }), true);
  assert.equal(isRequirementsAsk({ kind: 'plan', plan: { criteria: { items: [] } } }), true);
  assert.equal(isRequirementsAsk({ kind: 'plan', plan: { error: { message: 'x' } } }), true);
  assert.equal(isRequirementsAsk({ kind: 'plan', plan: { file: '/p.md' } }), false);
  assert.equal(stepChip({ kind: 'plan', plan: plan() }, {}), 'Requirements');
  assert.equal(stepTitle({ kind: 'plan', plan: plan() }), 'Your turn: agree the requirements');
});

test('renderAttachedBody lists every feature and marks the agreed ones', () => {
  const body = renderAttachedBody(doc, plan(), { onAnswer: () => {} });
  const rows = [...body.querySelectorAll('.attached-feature')];
  assert.equal(rows.length, 3);
  assert.match(rows[0].textContent, /Export runs as CSV/);
  assert.match(rows[0].textContent, /Agreed/);
  assert.doesNotMatch(rows[1].textContent, /Agreed/);
  assert.doesNotMatch(rows[2].textContent, /Agreed/);
  assert.match(rows[2].textContent, /4 requirements/);
});

test('one Agree sends the pending seqs', () => {
  const sent = [];
  const body = renderAttachedBody(doc, plan(), { onAnswer: (p) => sent.push(p) });
  const agree = body.querySelectorAll('button.attached-agree');
  assert.equal(agree.length, 1);
  agree[0].click();
  assert.deepEqual(sent, [{ decision: 'approve', agreedSeqs: [2, 3] }]);
});

test('with everything agreed the action still answers, with no pending seqs to add', () => {
  const sent = [];
  const body = renderAttachedBody(doc, plan(FEATURES.map((f) => ({ ...f, agreed: true }))), { onAnswer: (p) => sent.push(p) });
  body.querySelector('button.attached-agree').click();
  assert.equal(sent[0].decision, 'approve');
  assert.deepEqual(sent[0].agreedSeqs, [1, 2, 3]);
});

test('a malformed attached payload renders an empty list without throwing', () => {
  const body = renderAttachedBody(doc, { attached: {} }, { onAnswer: () => {} });
  assert.equal(body.querySelectorAll('.attached-feature').length, 0);
});

test('renderPlanBody draws the attached card with the head and one Agree that posts through deps.submit', async () => {
  const panel = doc.createElement('div');
  doc.body.appendChild(panel);
  const calls = [];
  const deps = { doc, run: {}, extras: true, title: 'Your turn: agree the requirements', chip: 'Requirements',
    fetchPlan: async () => null, submit: async (p) => { calls.push(p); return true; } };
  renderPlanBody(panel, { id: 'q1', kind: 'plan', plan: plan() }, deps);
  assert.ok(panel.querySelector('.ask-mcard-head'));
  assert.equal(panel.querySelectorAll('.attached-feature').length, 3);
  panel.querySelector('button.attached-agree').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, [{ decision: 'approve', agreedSeqs: [2, 3] }]);
});
