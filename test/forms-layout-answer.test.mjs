// test/forms-layout-answer.test.mjs — layout walking, `when`, fallback, the auto answer,
// gate-3 collection and file references (ask-forms P1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveItem, childrenOf, walkLayout, whenOk, visibleFields, widgetsUsed } from '../src/shared/forms/layout.mjs';
import { autoAnswer, collectAnswer, checkAskData, fileRefs, fileAccepts } from '../src/shared/forms/answer.mjs';
import { resolveAnswerSchema } from '../src/shared/forms/schema.mjs';
import { reviewForm, planForm, releaseForm } from './helpers/ask-form-fixtures.mjs';

const codes = (r) => r.errors.map((e) => `${e.path}:${e.code}`);
const collect = (form, data, raw) => collectAnswer(form, resolveAnswerSchema(form.answer, data), raw);

test('effectiveItem: known → itself; unknown or too new → fallback; neither → null', () => {
  const text = { widget: 'text', field: 'a' };
  assert.equal(effectiveItem(text), text);
  assert.equal(effectiveItem({ widget: 'signature', fallback: text }), text);
  assert.equal(effectiveItem({ widget: 'text', requires: { askCatalog: 2 }, fallback: text }), text, 'a known widget that needs a newer catalog falls back');
  assert.equal(effectiveItem({ widget: 'text', requires: { askCatalog: 2 } }, 2).widget, 'text');
  assert.equal(effectiveItem({ widget: 'signature' }), null);
  assert.equal(effectiveItem({ widget: 'a', fallback: { widget: 'b', fallback: { widget: 'text' } } }).widget, 'text');
  assert.equal(effectiveItem(null), null);
});

test('childrenOf / walkLayout / widgetsUsed descend group, columns and tabs', () => {
  const plan = planForm();
  assert.deepEqual(childrenOf(plan.layout[2]).map((c) => c.length), [1, 2]);
  assert.deepEqual(childrenOf({ widget: 'tabs', tabs: [{ label: 'A', children: [{ widget: 'diff' }] }, { label: 'B' }] }).map((c) => c.length), [1, 0]);
  assert.deepEqual(childrenOf({ widget: 'text' }), []);
  const seen = [];
  walkLayout(plan.layout, (raw, eff, parents) => seen.push(`${eff.widget}@${parents.length}`));
  assert.deepEqual(seen, ['callout@0', 'review-list@0', 'columns@0', 'rank@1', 'select@1', 'group@1', 'slider@2', 'toggle@2']);
  assert.deepEqual(widgetsUsed(releaseForm().layout), ['pdf', 'text', 'multiselect', 'date'], 'signature counts as its fallback');
});

test('whenOk / visibleFields: equality, lists, ancestors', () => {
  assert.equal(whenOk(undefined, {}), true);
  assert.equal(whenOk({ v: 'a' }, { v: 'a' }), true);
  assert.equal(whenOk({ v: ['a', 'b'] }, { v: 'b' }), true);
  assert.equal(whenOk({ v: 'a', w: true }, { v: 'a', w: false }), false);
  const f = reviewForm();
  assert.deepEqual(visibleFields(f.layout, {}), ['picked', 'verdict']);
  assert.deepEqual(visibleFields(f.layout, { verdict: 'iterate' }), ['picked', 'verdict', 'notes']);
  const nested = [{ widget: 'toggle', field: 'on' }, { widget: 'group', when: { on: true }, children: [{ widget: 'text', field: 'inner' }] }];
  assert.deepEqual(visibleFields(nested, { on: false }), ['on']);
  assert.deepEqual(visibleFields(nested, { on: true }), ['on', 'inner']);
});

test('autoAnswer (D10): default, defaultFrom, first choice, natural value, hidden dropped', () => {
  const review = reviewForm();
  assert.deepEqual(autoAnswer(review, review.example), { picked: 'a', verdict: 'build' }, 'notes is hidden under build');
  const plan = planForm();
  assert.deepEqual(autoAnswer(plan, plan.example), {
    steps: [{ id: 's1', verdict: 'keep' }, { id: 's2', verdict: 'keep' }], order: ['s1', 's2'],
    scope: 'as-planned', max_cycles: 2, run_tests: true });
  const rel = releaseForm();
  assert.deepEqual(autoAnswer(rel, rel.example), { version: '1.4.0-rc.2', platforms: ['macos', 'linux', 'windows'], signer: 'release bot' }, 'optional publish_on has no auto value');
});

test('collectAnswer (gate 3): hidden + unknown + empty dropped, required only while visible', () => {
  const f = reviewForm();
  const ok = collect(f, f.example, { picked: 'a', verdict: 'build', notes: 'left over from before', hacked: 1, extra: '' });
  assert.deepEqual(ok, { values: { picked: 'a', verdict: 'build' }, errors: [] });
  assert.deepEqual(codes(collect(f, f.example, { picked: 'a', verdict: 'iterate' })), ['notes:required']);
  assert.deepEqual(codes(collect(f, f.example, { picked: 'a', verdict: 'iterate', notes: 'short' })), ['notes:minLength']);
  assert.deepEqual(codes(collect(f, f.example, { picked: 'zzz', verdict: 'build' })), ['picked:enum'], 'enumFrom is a closed set');
  assert.deepEqual(codes(collect(f, f.example, {})), ['picked:required', 'verdict:required']);
  assert.deepEqual(codes(collect(f, f.example, null)), ['picked:required', 'verdict:required']);
});

test('collectAnswer: nested rows are stripped to declared keys and validated', () => {
  const plan = planForm();
  const r = collect(plan, plan.example, { steps: [{ id: 's1', verdict: 'drop', note: 'risky', evil: 1 }, { id: 's2', verdict: 'keep', note: '' }], order: ['s2', 's1'], scope: 'minimal' });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.values.steps, [{ id: 's1', verdict: 'drop', note: 'risky' }, { id: 's2', verdict: 'keep' }]);
  assert.deepEqual(codes(collect(plan, plan.example, { steps: [{ id: 'nope', verdict: 'keep' }], order: ['s1', 's1'], scope: 'minimal' })), ['steps[0].id:enum', 'order:unique']);
});

test('collectAnswer reads only `.layout` of its first argument (a persisted ask has no `answer`)', () => {
  const f = reviewForm();
  const schema = resolveAnswerSchema(f.answer, f.example);
  assert.deepEqual(collectAnswer({ layout: f.layout }, schema, { picked: 'b', verdict: 'build' }), { values: { picked: 'b', verdict: 'build' }, errors: [] });
});

test('checkAskData (gate 2 core): the data schema, then "could --yes answer THIS data?"', () => {
  const f = reviewForm();
  assert.deepEqual(checkAskData(f, f.example), { ok: true, errors: [] });
  assert.deepEqual(checkAskData(f, { images: [{ id: 'a' }] }).errors.map((e) => `${e.path}:${e.code}`), ['data.images[0].file:required']);
  assert.deepEqual(checkAskData(f, { imagez: [] }).errors.map((e) => `${e.path}:${e.code}`), ['data.images:required', 'data.imagez:unknown-key']);
  const empty = checkAskData(f, { images: [] });
  assert.deepEqual(empty.errors.map((e) => `${e.path}:${e.code}`), ['answer.picked:bad-auto'], 'a required choice with no rows is unanswerable');
  assert.match(empty.errors[0].message, /unattended runs could not answer "picked"/);
  const rel = releaseForm();
  assert.deepEqual(checkAskData(rel, {}).errors.map((e) => e.code), ['required']);
  assert.deepEqual(checkAskData(rel, { suggested_version: 'not semver' }).errors.map((e) => `${e.path}:${e.code}`), ['answer.version:bad-auto'], 'defaultFrom fed a value the pattern refuses');
});

test('collectAnswer does not mutate its input', () => {
  const f = reviewForm();
  const raw = { picked: 'a', verdict: 'build', notes: 'x' };
  collect(f, f.example, raw);
  assert.deepEqual(raw, { picked: 'a', verdict: 'build', notes: 'x' });
});

test('fileRefs: every file value, with its concrete path and accept list', () => {
  const f = reviewForm();
  assert.deepEqual(fileRefs(f.data, f.example), [
    { path: 'data.images[0].file', rel: 'mockups/a.png', accept: ['image/*'] },
    { path: 'data.images[1].file', rel: 'mockups/b.png', accept: ['image/*'] }]);
  const rel = releaseForm();
  assert.deepEqual(fileRefs(rel.data, rel.example), [{ path: 'data.report', rel: 'reports/q3.pdf', accept: ['application/pdf'] }]);
  assert.deepEqual(fileRefs(rel.data, { suggested_version: '1.0.0' }), [], 'an absent optional file is no ref');
});

test('fileAccepts: what a form may display, from the schema alone', () => {
  assert.deepEqual(fileAccepts(reviewForm().data), ['image/*']);
  assert.deepEqual(fileAccepts(releaseForm().data), ['application/pdf']);
  assert.deepEqual(fileAccepts(planForm().data), [], 'a form with no file shows none');
  const mixed = { type: 'object', properties: { a: { type: 'file' }, rows: { type: 'array', items: { type: 'object', properties: {
    f: { type: 'file', accept: ['image/png', 'application/pdf'] }, g: { type: 'file', accept: ['application/pdf'] } } } } } };
  assert.deepEqual(fileAccepts(mixed), ['*/*', 'application/pdf', 'image/png'], 'deduped, sorted; no accept means anything');
});

test('hostile answer keys: inherited names are dropped like any unknown key; `__proto__` sets no prototype', () => {
  const f = reviewForm();
  const raw = JSON.parse('{"picked":"a","verdict":"build","constructor":"x","toString":"y","__proto__":{"verdict":"iterate","notes":"smuggled in by prototype"}}');
  const r = collect(f, f.example, raw);
  assert.deepEqual(r, { values: { picked: 'a', verdict: 'build' }, errors: [] });
  assert.equal(Object.getPrototypeOf(r.values), Object.prototype);
  const proto = JSON.parse('{"picked":"a","__proto__":{"verdict":"iterate"}}');
  assert.deepEqual(codes(collect(f, f.example, proto)), ['verdict:required'], 'an inherited verdict neither counts nor reveals `notes`');
  assert.equal(whenOk({ constructor: 'x' }, {}), false, '`when` reads own values only');
  assert.equal(whenOk({ v: 'a' }, Object.create({ v: 'a' })), false, 'an inherited value is not an answer');
  assert.equal(whenOk({ v: 'a' }, null), false, 'no values: nothing holds, nothing throws');
  assert.deepEqual(collectAnswer({ layout: f.layout }, null, { picked: 'a' }).values, {}, 'a missing schema collects nothing and does not throw');
  const plan = planForm();
  const rows = collect(plan, plan.example, { steps: JSON.parse('[{"id":"s1","verdict":"keep","constructor":"x","__proto__":{"note":"n"}}]'), order: ['s1', 's2'], scope: 'minimal' });
  assert.deepEqual(rows, { values: { steps: [{ id: 's1', verdict: 'keep' }], order: ['s1', 's2'], scope: 'minimal' }, errors: [] }, 'rows are stripped to OWN declared keys too');
});

test('collectAnswer: a rank and a review-list name each item once — the widget rule no schema keyword can state', () => {
  const plan = planForm();
  delete plan.answer.properties.order.uniqueItems;
  const twice = { steps: [{ id: 's1', verdict: 'drop' }, { id: 's1', verdict: 'keep' }], order: ['s2', 's2'], scope: 'minimal' };
  assert.deepEqual(codes(collect(plan, plan.example, twice)), ['steps:unique', 'order:unique']);
  const declared = planForm();
  assert.deepEqual(codes(collect(declared, declared.example, { ...twice, steps: [{ id: 's1', verdict: 'drop' }] })), ['order:unique'], 'with `uniqueItems` declared it is still reported once');
  const dup = checkAskData(planForm(), { steps: [{ id: 's1', title: 'a' }, { id: 's1', title: 'b' }] });
  assert.deepEqual(dup.errors.map((e) => `${e.path}:${e.code}`), ['answer.order:bad-auto', 'answer.steps:bad-auto'], 'rows that share an id are refused at ask time');
});

test('autoAnswer: a row with no text id is not an item (opaque rows reach here unchecked)', () => {
  const f = planForm();
  f.data.properties.steps = { type: 'array', items: { type: 'object' } };
  const data = { steps: [{ title: 'No id' }, { id: 's2', title: 'Two' }, { id: 7, title: 'Numeric' }] };
  const auto = autoAnswer(f, data);
  assert.deepEqual([auto.steps, auto.order], [[{ id: 's2', verdict: 'keep' }], ['s2']], 'the review and the order name the same rows');
  assert.deepEqual(checkAskData(f, data), { ok: true, errors: [] });
});

test('a `when` chain of ANY depth settles: no hidden value reaches the agent, from a human or from auto mode', () => {
  const names = Array.from({ length: 9 }, (_, i) => `f${i}`);
  const chain = { answer: { type: 'object', properties: Object.fromEntries(names.map((n, i) => [n, { type: 'boolean', default: i > 0 }])) },
    layout: names.map((n, i) => (i === 0 ? { widget: 'toggle', field: n } : { widget: 'toggle', field: n, when: { [names[i - 1]]: true } })) };
  const all = Object.fromEntries(names.map((n) => [n, true]));
  assert.deepEqual(collectAnswer(chain, chain.answer, { ...all, f0: false }), { values: { f0: false }, errors: [] }, 'eight fields hang on f0: all eight go');
  assert.deepEqual(collectAnswer({ layout: [...chain.layout].reverse() }, chain.answer, { ...all, f0: false }).values, { f0: false }, 'in any layout order');
  assert.deepEqual(autoAnswer(chain, {}), { f0: false }, 'auto mode drops them too (D10)');
  assert.deepEqual(collectAnswer(chain, chain.answer, all).values, all, 'and a chain that holds is kept whole');
});
