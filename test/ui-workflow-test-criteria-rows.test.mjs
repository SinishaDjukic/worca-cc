// test/ui-workflow-test-criteria-rows.test.mjs — board 6: a criterion's verdict per version, why, proof, trust, Agree / Disagree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { criteriaGroup } from '../ui/public/workflows/criteria-rows.mjs';
import { renderSideBySide } from '../ui/public/workflows/test-compare.mjs';

const R = { state: 'reliable', n: 20, agree: 19, decides: true };
const v = (met, extra = {}) => ({ verdict: { criteria: [{ id: 'k_1', label: 'Names a success metric with a number, and how to measure it', met,
  value: met === null ? 'Not checked yet' : met ? 'Met' : 'Not met', reason: met ? 'It gives 60% and how it is counted.' : 'No number and no way to measure it.',
  proof: met ? 'Cut export-related support tickets by 60%' : 'Customers are happier with exporting invoices.', proofFound: met !== null, judgementId: met ? 11 : 12,
  decides: true, trust: R, ...extra }] } });

test('the group, the cells, why and proof for the version that missed it, the trust line and the answers', async () => {
  const { document: doc } = new JSDOM('<!doctype html><body></body>').window;
  const sent = [];
  const els = criteriaGroup(doc, { n: 2, a: v(true), b: v(false) }, { a: 'v4', b: 'v5 draft' }, { once: false,
    actions: { answer: async (id, agree) => { sent.push([id, agree]); return { answer: agree, trust: R }; } } });
  for (const e of els) doc.body.append(e);
  assert.equal(doc.querySelector('.wft-crow-grp').textContent, 'Your criteria · checked by Worca');
  const row = doc.querySelector('.wft-crow.is-crit');
  assert.deepEqual([...row.querySelectorAll('.wft-res-v')].map((x) => x.textContent), ['Met', 'Not met']);
  const why = row.querySelector('.wft-crit-why');
  assert.match(why.textContent, /Why Worca says no for v5 draft:[\s\S]*No number and no way to measure it\./);
  assert.match(why.textContent, /Proof from the result:[\s\S]*"Customers are happier with exporting invoices\."[\s\S]*· found in the result/);
  assert.match(why.textContent, /Worca's checking of this criterion is reliable: it agrees with people 19 of 20 times\./);
  why.querySelector('button.wft-disagree').click();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sent, [[12, false]]);
});

test('a criterion that is not checked shows grey words, never a dot, and no answers', () => {
  const { document: doc } = new JSDOM('<!doctype html><body></body>').window;
  const els = criteriaGroup(doc, { n: 1, a: null, b: v(null, { judgementId: undefined }) }, { a: null, b: 'Your draft' }, { once: true, actions: {} });
  for (const e of els) doc.body.append(e);
  const cell = doc.querySelector('.wft-crow.is-crit .wft-res');
  assert.ok(cell.classList.contains('is-none'));
  assert.equal(cell.textContent, 'Not checked yet');
  assert.equal(doc.querySelector('button.wft-agree'), null);
});

test('no criteria: no group', () => {
  const { document: doc } = new JSDOM('<!doctype html><body></body>').window;
  assert.deepEqual(criteriaGroup(doc, { n: 1, a: { verdict: { basics: [] } }, b: null }, { a: 'v4', b: 'v5 draft' }, { actions: {} }), []);
});

test('the side by side shows the group after Automatic checks, and Agree reaches actions.answer', async () => {
  const { window } = new JSDOM('<!doctype html><body><section id="root" tabindex="-1"></section></body>');
  const doc = window.document;
  const root = doc.getElementById('root');
  const tv = (id, met) => ({ tryId: id, status: 'passed', name: 'brief.md', text: 'Brief', truncated: false, connectors: 'pretend', wouldHaveSent: [],
    answeredReads: [], verdict: { basics: [], checks: [{ id: 'c_1', label: 'Length is 400 to 900 words', met: true, value: '518 words' }],
      criteria: v(met).verdict.criteria } });
  const s = { run: { id: 7, kind: 'compare' }, compareTitle: 'Your v5 draft compared with v4', example: { id: 1, name: 'Bulk invoice export' },
    labels: { a: 'v4', b: 'v5 draft' }, row: { a: { passed: 1, total: 1 }, b: { passed: 1, total: 1 }, result: 'same' }, connectors: 'pretend',
    tries: [{ n: 1, a: tv(1, true), b: tv(2, false) }] };
  const sent = [];
  const actions = { back() {}, pick() {}, readWhole() {}, answer: async (id, agree) => { sent.push([id, agree]); return { answer: agree, trust: R }; } };
  renderSideBySide(root, s, actions, { doc });
  assert.deepEqual([...root.querySelectorAll('.wft-checked .wft-crow-grp')].map((n) => n.textContent), ['Automatic checks', 'Your criteria · checked by Worca']);
  root.querySelector('.wft-checked button.wft-agree').click();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sent, [[12, true]]);
});
