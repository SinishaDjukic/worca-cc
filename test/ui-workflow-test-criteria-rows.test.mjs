// test/ui-workflow-test-criteria-rows.test.mjs — board 6: a criterion's verdict per version, why, proof, trust, Agree / Disagree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { criteriaGroup, trustSentence } from '../ui/public/workflows/criteria-rows.mjs';
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

// P4-M6 (board 53): after an answer, Undo, the "Not checked" rows, and board 36's proof from the changes.
const dom = () => new JSDOM('<!doctype html><body></body>').window.document;
const mount = (doc, els) => { for (const e of els) doc.body.append(e); return doc; };
const tick = () => new Promise((r) => setImmediate(r));

test('P4-M6: after Disagree the box says so with Undo; Undo takes it back and the buttons return', async () => {
  const doc = dom();
  const sent = [];
  mount(doc, criteriaGroup(doc, { n: 2, a: v(true), b: v(false) }, { a: 'v4', b: 'v5 draft' }, {
    actions: { answer: async (id, agree) => { sent.push([id, agree]); return { answer: agree, trust: { ...R, n: 21 } }; } } }));
  const why = doc.querySelector('.wft-crit-why');
  why.querySelector('button.wft-disagree').focus();
  why.querySelector('button.wft-disagree').click();
  await tick();
  const said = why.querySelector('.wft-said');
  assert.equal(said.getAttribute('role'), 'status');
  assert.equal(said.textContent, 'You disagreed: Worca notes it.Undo');
  assert.equal(why.querySelector('button.wft-agree'), null);
  assert.equal(doc.activeElement.textContent, 'Undo', 'the focus stays in the box');
  assert.match(why.textContent, /it agrees with people 19 of 21 times\./, 'the reply\'s trust');
  said.querySelector('button').click();
  await tick();
  assert.deepEqual(sent, [[12, false], [12, null]]);
  assert.equal(why.querySelector('.wft-said'), null);
  assert.deepEqual([...why.querySelectorAll('button')].map((b) => [b.textContent, b.disabled]), [['Agree', false], ['Disagree', false]]);
  // Pre-merge QA (P12): each answer button names what it answers, the visible word first.
  for (const b of why.querySelectorAll('button')) {
    assert.match(b.getAttribute('aria-label'), new RegExp(`^${b.textContent}: Names a success metric with a number, and how to measure it · `));
  }
});

test('P4-M6: after Agree, "You agreed." with a check; a failed answer gives the buttons back', async () => {
  const doc = dom();
  let ok = true;
  mount(doc, criteriaGroup(doc, { n: 2, a: v(true), b: v(true) }, { a: 'v4', b: 'v5 draft' }, {
    actions: { answer: async (_id, agree) => (ok ? { answer: agree, trust: R } : undefined) } }));
  const why = doc.querySelector('.wft-crit-why');
  assert.ok(!why.classList.contains('is-bad'), 'a met verdict: the neutral box');
  assert.match(why.textContent, /Why Worca says yes for v5 draft:/);
  why.querySelector('button.wft-agree').click();
  await tick();
  const said = why.querySelector('.wft-said.is-agree');
  assert.equal(said.textContent, 'You agreed.Undo');
  assert.ok(said.querySelector('svg'), 'the check icon');
  ok = false;
  said.querySelector('button').click();
  await tick();
  assert.equal(why.querySelector('.wft-said').textContent, 'You agreed.Undo', 'not taken back: the answer stays');
  assert.equal(why.querySelector('.wft-said button').disabled, false);
});

test('P4-M6: after a reload the earlier answer shows, not the buttons', () => {
  const doc = dom();
  mount(doc, criteriaGroup(doc, { n: 1, a: v(true), b: v(false, { answer: false }) }, { a: 'v4', b: 'v5 draft' }, { actions: { answer: async () => ({}) } }));
  assert.equal(doc.querySelector('.wft-said.is-dis').textContent, 'You disagreed: Worca notes it.Undo');
  assert.equal(doc.querySelector('button.wft-agree'), null);
});

test('P4-M6: a "Not checked" cell is grey with no dot, and a row or box never offers answers on it', () => {
  const doc = dom();
  const nc = (extra = {}) => v(null, { value: "Not checked: Worca's proof was not in the result", judgementId: 13, reason: 'x', proof: 'y', ...extra });
  mount(doc, criteriaGroup(doc, { n: 2, a: v(true), b: nc() }, { a: 'v4', b: 'v5 draft' }, { actions: { answer: async () => ({}) } }));
  const row = doc.querySelector('.wft-crow.is-crit');
  const cells = [...row.querySelectorAll('.wft-res')];
  assert.equal(cells[1].textContent, "Not checked: Worca's proof was not in the result");
  assert.ok(cells[1].classList.contains('is-none'));
  assert.equal(cells[1].querySelector('.wft-dot'), null);
  assert.equal(row.querySelector('.wft-crit-why'), null, 'board P4-M6: no box under a Met beside a Not checked');
  assert.equal(doc.querySelector('button.wft-agree'), null);
  const doc2 = dom();
  mount(doc2, criteriaGroup(doc2, { n: 2, a: v(false), b: nc({ judgementId: 14 }) }, { a: 'v4', b: 'v5 draft' }, { actions: { answer: async () => ({}) } }));
  assert.match(doc2.querySelector('.wft-crit-why').textContent, /Why Worca says no for v4:/, 'the box explains the version with a verdict');
  assert.equal(doc2.querySelectorAll('button.wft-agree').length, 1);
});

test('board 36: the trust line while Worca needs answers', () => {
  const doc = dom();
  mount(doc, criteriaGroup(doc, { n: 2, a: v(true), b: v(false, { trust: { state: 'collecting', n: 4, agree: 4, decides: true } }) }, { a: 'v2', b: 'v3 draft' }, { actions: {} }));
  assert.equal(doc.querySelector('.wft-crit-why .wft-crit-trust').textContent,
    "Worca's checking of this criterion needs your answers: Worca has 4 of the 10 answers it needs.");
});

test('board 36: proof from the changes names the file and shows the line in code font', () => {
  const patch = ['diff --git a/src/core/billing/total.mjs b/src/core/billing/total.mjs', '--- a/src/core/billing/total.mjs', '+++ b/src/core/billing/total.mjs',
    '@@ -1,1 +1,1 @@', '-const x = 1;', '+const x = 2;',
    'diff --git a/src/core/billing/round.mjs b/src/core/billing/round.mjs', '--- a/src/core/billing/round.mjs', '+++ b/src/core/billing/round.mjs',
    '@@ -3,1 +3,1 @@', '-  return Math.round(value * 100) / 100;', '+   return toCents(value) / 100;', ''].join('\n');
  const proj = (id, met, proof) => ({ tryId: id, project: { changes: { files: [] } }, ...v(met, { proof, judgementId: id + 100 }) });
  const cur = { n: 2, a: proj(1, true, 'Adds a test'), b: proj(2, false, '+   return toCents(value) / 100;') };
  const doc = dom();
  mount(doc, criteriaGroup(doc, cur, { a: 'v2', b: 'v3 draft' }, { actions: {}, patches: new Map([[2, patch]]) }));
  const proof = doc.querySelector('.wft-crit-why .wft-crit-proof');
  assert.equal(proof.querySelector('b').textContent, 'Proof from the changes: ');
  assert.equal(proof.querySelector('.hint').textContent, 'src/core/billing/round.mjs · found in the changes');
  assert.equal(proof.querySelector('.wft-crit-code').textContent, '+   return toCents(value) / 100;');
  const doc2 = dom();
  mount(doc2, criteriaGroup(doc2, cur, { a: 'v2', b: 'v3 draft' }, { actions: {}, patches: new Map() }));
  assert.match(doc2.querySelector('.wft-crit-proof').textContent, /^Proof from the result: "\+ {3}return toCents\(value\) \/ 100;" · found in the result$/,
    'the changes not read yet: the result\'s words');
});

test('fix round 1: a proof the server rule rejects (short parts, under 8 characters) is not shown as found in the changes', () => {
  const patch = ['diff --git a/src/a.mjs b/src/a.mjs', '--- a/src/a.mjs', '+++ b/src/a.mjs', '@@ -1,1 +1,1 @@', '-x', '+const ab = 1; const total = 2;', ''].join('\n');
  const proj = (id, met, proof) => ({ tryId: id, project: { changes: { files: [] } }, ...v(met, { proof, judgementId: id + 100 }) });
  for (const proof of ['ab … total', 'total']) {
    const cur = { n: 2, a: proj(1, true, 'Adds a test'), b: proj(2, false, proof) };
    const doc = dom();
    mount(doc, criteriaGroup(doc, cur, { a: 'v2', b: 'v3 draft' }, { actions: {}, patches: new Map([[2, patch]]) }));
    assert.match(doc.querySelector('.wft-crit-proof b').textContent, /^Proof from the result/, proof);
  }
});

test('fix round 1: no trust text adds no empty paragraph; the collecting sentence is spelled out; a thrown answer is told and gives the buttons back', async () => {
  const doc = dom();
  mount(doc, criteriaGroup(doc, { n: 2, a: v(true), b: v(false, { trust: null }) }, { a: 'v4', b: 'v5 draft' }, {
    actions: { answer: async () => { throw new Error('offline'); } } }));
  const why = doc.querySelector('.wft-crit-why');
  assert.equal(why.querySelector('.wft-crit-trust'), null);
  assert.equal(trustSentence({ state: 'collecting', n: 4 }), "Worca's checking of this criterion needs your answers: Worca has 4 of the 10 answers it needs.");
  why.querySelector('button.wft-agree').click();
  await tick();
  assert.deepEqual([...why.querySelectorAll('button')].map((b) => [b.textContent, b.disabled]), [['Agree', false], ['Disagree', false]]);
  assert.match(doc.querySelector('.toast.err').textContent, /offline/);
});
