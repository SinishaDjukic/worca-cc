// test/ui-workflow-test-criteria-editor.test.mjs — boards 2 and 32: the criteria rows, their trust lines, Switch, Checked with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { renderCriteriaSection } from '../ui/public/workflows/criteria-editor.mjs';

const MODELS = { models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }, { id: 'claude-haiku-4-5', label: 'Haiku 4.5' }],
  suggested: { id: 'claude-opus-5-5', label: 'Opus 5.5', suggested: true } };
const draft = () => ({ criteria: [{ id: 'k_1', text: 'Names a success metric with a number, and how to measure it' },
  { id: 'k_2', text: "Mentions that today's export stops at 200 invoices" }], judge: null });

test('board 2: each row, its trust line, the exact switch and the checking model', () => {
  const { document: doc } = new JSDOM('<!doctype html><body></body>').window;
  const switched = [];
  const s = renderCriteriaSection(doc, draft(), { models: MODELS, trust: { k_1: { state: 'reliable', n: 20, agree: 19, decides: true } },
    onConfirm: () => {}, onSwitch: (c, alt) => switched.push([c.id, alt]) });
  doc.body.append(s.el);
  assert.equal(doc.querySelector('.wft-grp').textContent, 'Your criteria');
  assert.equal(doc.querySelector('.wft-grp-hint').textContent,
    'Write each one as a short sentence that is true of a good result. Worca reads the result, answers yes or no for each sentence, and says why.');
  const rows = [...doc.querySelectorAll('.wft-crit')];
  assert.equal(rows[0].querySelector('input').value, 'Names a success metric with a number, and how to measure it');
  assert.equal(rows[0].querySelector('.badge').textContent, 'Reliable');
  assert.match(rows[0].textContent, /Worca agrees with people 19 of 20 times/);
  assert.match(rows[1].textContent, /Can be checked exactly: the result must contain "200"\./);
  assert.equal(rows[1].querySelector('.badge'), null, 'M10: no green "Reliable" for a criterion an exact check could replace');
  rows[1].querySelector('button.wft-switch').click();
  assert.deepEqual(switched, [['k_2', { kind: 'mentions', text: '200' }]]);
  const sel = doc.getElementById('wft-judge');
  assert.deepEqual([...sel.options].map((o) => o.textContent), ['Opus 5.5 · suggested', 'Haiku 4.5']);
  assert.equal(doc.querySelector('label[for="wft-judge"]').textContent, 'Checked with');
  sel.value = 'claude-haiku-4-5'; sel.dispatchEvent(new doc.defaultView.Event('change'));
  rows[0].querySelector('input').value = 'Names a metric';
  rows[0].querySelector('input').dispatchEvent(new doc.defaultView.Event('input'));
  assert.deepEqual(s.read(), { criteria: [{ id: 'k_1', text: 'Names a metric' }, { id: 'k_2', text: "Mentions that today's export stops at 200 invoices" }],
    judge: { model: 'claude-haiku-4-5' } });
  doc.querySelector('button.wft-add-crit').click();
  assert.equal(doc.querySelectorAll('.wft-crit').length, 3, 'Add a criterion adds an empty row');
  assert.equal(doc.activeElement, doc.querySelectorAll('.wft-crit input')[2], 'the new row has the focus');
  assert.equal(s.read().criteria.length, 3, 'the empty row is sent; the server drops it (D86)');
  s.remove({ id: 'k_2' });
  assert.deepEqual(s.read().criteria.map((c) => c.id || ''), ['k_1', ''], 'remove() takes a criterion out by its id (Switch, I8)');
});

test('M10 (user decision 2): a criterion an exact check could replace shows only the violet line, whatever its trust', () => {
  const { document: doc } = new JSDOM('<!doctype html><body></body>').window;
  const s = renderCriteriaSection(doc, draft(), { models: MODELS, trust: { k_2: { state: 'reliable', n: 20, agree: 20, decides: true } } });
  doc.body.append(s.el);
  const row = doc.querySelectorAll('.wft-crit')[1];
  assert.equal(row.querySelector('.badge'), null);
  assert.doesNotMatch(row.textContent, /agrees with people/);
  assert.ok(row.querySelector('.wft-crit-meta.is-exact'));
});

test('a project example: board 32\'s hint; no suggestion keeps the plain label; the judge hint', () => {
  const { document: doc } = new JSDOM('<!doctype html><body></body>').window;
  const s = renderCriteriaSection(doc, { criteria: [], judge: { model: 'claude-haiku-4-5' } }, { project: true,
    models: { models: MODELS.models, suggested: { ...MODELS.suggested, suggested: false } } });
  doc.body.append(s.el);
  assert.equal(doc.querySelector('.wft-grp-hint').textContent,
    'Write each one as a short sentence that is true of a good result. Worca reads what changed, answers yes or no for each sentence, and says why.');
  const sel = doc.getElementById('wft-judge');
  assert.deepEqual([...sel.options].map((o) => o.textContent), ['Opus 5.5', 'Haiku 4.5']);
  assert.equal(sel.value, 'claude-haiku-4-5', 'the saved model is picked');
  assert.match(doc.querySelector('.field .hint').textContent,
    /^Worca suggests an AI model that this workflow does not use to write, so it does not mark its own work\. Changing it starts the trust tests for these criteria again\./);
  assert.deepEqual(s.read(), { criteria: [], judge: { model: 'claude-haiku-4-5' } });
});

test('a new criterion: "Confirm 4 results" opens Check the checker; without it (not built yet), its line and no link', () => {
  const { document: doc } = new JSDOM('<!doctype html><body></body>').window;
  const trust = { k_1: { state: 'confirm', n: 0, agree: 0, decides: true } };
  const s = renderCriteriaSection(doc, draft(), { models: MODELS, trust });
  doc.body.append(s.el);
  assert.equal(doc.querySelectorAll('.wft-crit')[0].querySelector('button.wft-confirm'), null);
  assert.match(doc.querySelectorAll('.wft-crit')[0].textContent, /New criterion\. It counts/);
  const asked = [];
  const t = renderCriteriaSection(doc, draft(), { models: MODELS, trust, onConfirm: (c) => asked.push(c.id) });
  doc.body.replaceChildren(t.el);
  const link = doc.querySelector('.wft-crit button.wft-confirm');
  assert.equal(link.textContent, 'Confirm 4 results');
  link.click();
  assert.deepEqual(asked, ['k_1']);
});

test('tests-app.mjs reads the models and the trust when the editor opens, and hands them to the editor (no confirm link before Task 22)', () => {
  const ctl = readFileSync(new URL('../ui/public/workflows/tests-app.mjs', import.meta.url), 'utf8');
  assert.match(ctl, /wftCall\('GET', `\$\{wftBase\(id\)\}\/judge-models`\)/);
  assert.match(ctl, /exampleId != null \? await wftCall\('GET', `\$\{wftBase\(id\)\}\/examples\/\$\{exampleId\}\/criteria`\) : null/);
  assert.match(ctl, /judgeModels: wft\.judgeModels, criteriaTrust: wft\.criteriaTrust \|\| \{\}, onConfirmCriterion: null/);
});
