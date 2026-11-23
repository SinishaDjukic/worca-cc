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

test('tests-app.mjs reads the models and the trust when the editor opens, and hands them to the editor with the confirm link (Task 22)', () => {
  const ctl = readFileSync(new URL('../ui/public/workflows/tests-app.mjs', import.meta.url), 'utf8');
  assert.match(ctl, /wftCall\('GET', `\$\{wftBase\(id\)\}\/judge-models`\)/);
  // Pre-merge QA: read together with the editor's other reads (ui-workflow-test-open-example.test.mjs checks they go out at once).
  assert.match(ctl, /exampleId != null \? wftCall\('GET', `\$\{wftBase\(id\)\}\/examples\/\$\{exampleId\}\/criteria`\) : null/);
  assert.match(ctl, /judgeModels: wft\.judgeModels, criteriaTrust: wft\.criteriaTrust \|\| \{\},[\s\S]{0,600}?onConfirmCriterion: \(c\) => wftConfirmCriterion\(session\.exampleId, c/);
});

// P4-M2 (approved 2026-11-20, boards 50–52): the states board 2 did not draw.
const PAYING = { models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5', pays: 'Claude sign-in' },
  { id: 'claude-opus-5-5-vx', label: 'Opus 5.5', pays: 'Google Vertex AI, set where Worca runs' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', pays: 'Claude sign-in' }, { id: 'claude-haiku-4-5', label: 'Haiku 4.5', pays: 'Claude sign-in' }],
suggested: { id: 'claude-opus-5-5', label: 'Opus 5.5', pays: 'Claude sign-in', suggested: true } };
const JUDGE_HINT_M2 = 'Worca suggests an AI model that this workflow does not use to write, so it does not mark its own work. Changing it starts the trust tests for these criteria again. After each model: who pays for its checks, as far as Worca can tell.';

test('P4-M2: every state of a criterion row on a saved example, its Remove button and the empty row', () => {
  const { document: doc } = new JSDOM('<!doctype html><body></body>').window;
  const asked = [];
  const d = { judge: null, criteria: [
    { id: 'k_1', text: 'Names a success metric with a number, and how to measure it' },
    { id: 'k_2', text: 'Quotes customers from the interviews, and makes up no quotes' },
    { id: 'k_3', text: 'Explains the legal reason for each data field' },
    { id: 'k_4', text: 'Says who may export, and why' },
    { id: 'k_5', text: 'Proposes a test that can finish within 4 weeks' }] };
  const s = renderCriteriaSection(doc, d, { models: PAYING, onConfirm: (c) => asked.push(c.id), trust: {
    k_1: { state: 'reliable', n: 20, agree: 19, decides: true }, k_2: { state: 'reliable', n: 20, agree: 20, decides: true },
    k_3: { state: 'confirm', n: 0, agree: 0, decides: true }, k_4: { state: 'collecting', n: 4, agree: 4, decides: true },
    k_5: { state: 'unreliable', n: 10, agree: 6, decides: false } } });
  doc.body.append(s.el);
  const rows = () => [...doc.querySelectorAll('.wft-crit')];
  const meta = (r) => r.querySelector('.wft-crit-meta').textContent;
  assert.equal(meta(rows()[0]), 'Reliable Worca agrees with people 19 of 20 times');
  assert.equal(rows()[0].querySelector('.badge').className, 'badge green');
  assert.equal(meta(rows()[1]), 'Can be checked exactly, without AI. Switch');
  assert.equal(rows()[1].querySelector('.wft-crit-meta').className, 'wft-crit-meta is-exact');
  assert.equal(meta(rows()[2]), 'Confirm 4 results so Worca knows it judges it your way.');
  assert.equal(rows()[2].querySelector('.wft-confirm').className, 'badge amber wft-confirm');
  assert.equal(meta(rows()[3]), 'Needs your answers Worca has 4 of the 10 answers it needs');
  assert.equal(rows()[3].querySelector('.badge').className, 'badge');
  assert.equal(meta(rows()[4]), 'Unreliable Agrees with people 6 of 10 times. Shown, but does not decide better or worse. Fix it');
  assert.equal(rows()[4].querySelector('.badge').className, 'badge red');
  rows()[4].querySelector('button.wft-fix').click();
  assert.deepEqual(asked, ['k_5'], 'Fix it opens Check the checker');
  const rm = rows()[0].querySelector('button.wft-crit-rm');
  assert.equal(rm.getAttribute('aria-label'), 'Remove "Names a success metric with a number, and how to measure it"');
  assert.ok(rm.querySelector('svg'), 'an icon from icons.mjs, not a glyph');
  doc.querySelector('button.wft-add-crit').click();
  const empty = rows()[5];
  assert.equal(empty.querySelector('input').placeholder, 'A sentence that is true of a good result');
  assert.equal(empty.querySelector('input').getAttribute('aria-label'), 'Criterion 6');
  assert.equal(empty.querySelector('.wft-crit-meta'), null, 'an empty row has no line under it');
  assert.equal(empty.querySelector('button.wft-crit-rm').getAttribute('aria-label'), 'Remove this criterion');
  empty.querySelector('input').value = 'Lists the risks';
  empty.querySelector('input').dispatchEvent(new doc.defaultView.Event('input'));
  assert.equal(empty.querySelector('button.wft-crit-rm').getAttribute('aria-label'), 'Remove "Lists the risks"', 'the label follows the words');
  rows()[0].querySelector('button.wft-crit-rm').click();
  assert.deepEqual(s.read().criteria.map((c) => c.id || ''), ['k_2', 'k_3', 'k_4', 'k_5', '']);
  assert.equal(doc.activeElement, doc.querySelector('button.wft-add-crit'), 'the focus goes to Add a criterion');
});

test('P4-M2: a new example, not saved yet: "Not checked yet"; Add an exact check; who pays in Checked with', () => {
  const { document: doc } = new JSDOM('<!doctype html><body></body>').window;
  const added = [];
  const s = renderCriteriaSection(doc, { criteria: [{ text: 'Names a success metric with a number' }], judge: null },
    { models: PAYING, trust: null, onAddExact: () => added.push(true) });
  doc.body.append(s.el);
  const row = doc.querySelector('.wft-crit');
  assert.equal(row.querySelector('.wft-crit-meta').textContent, 'Not checked yet Save the example first. Then Worca can check this criterion.');
  assert.equal(row.querySelector('.badge').className, 'badge');
  assert.equal(row.querySelector('button.wft-crit-rm').getAttribute('aria-label'), 'Remove "Names a success metric with a number"');
  doc.querySelector('button.wft-add-crit').click();
  assert.equal(doc.querySelectorAll('.wft-crit')[1].querySelector('.wft-crit-meta'), null, 'an empty row says nothing yet');
  const ex = doc.querySelector('button.wft-add-exact');
  assert.equal(ex.textContent, 'Add an exact check');
  ex.click();
  assert.deepEqual(added, [true]);
  const sel = doc.getElementById('wft-judge');
  assert.deepEqual([...sel.options].map((o) => o.textContent), ['Opus 5.5 · Claude sign-in · suggested',
    'Opus 5.5 · Google Vertex AI, set where Worca runs', 'Sonnet 5.5 · Claude sign-in', 'Haiku 4.5 · Claude sign-in']);
  assert.equal(doc.querySelector('.field .hint').textContent, JUDGE_HINT_M2);
});

test('P4-M2: a workflow that writes with every model: the strongest one, without "· suggested"; no Add an exact check without its handler', () => {
  const { document: doc } = new JSDOM('<!doctype html><body></body>').window;
  const one = { models: [PAYING.models[0]], suggested: { ...PAYING.suggested, suggested: false } };
  const s = renderCriteriaSection(doc, { criteria: [], judge: null }, { models: one });
  doc.body.append(s.el);
  assert.deepEqual([...doc.getElementById('wft-judge').options].map((o) => o.textContent), ['Opus 5.5 · Claude sign-in']);
  assert.equal(doc.querySelector('button.wft-add-exact'), null);
});
