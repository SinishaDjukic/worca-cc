// test/forms-form-def.test.mjs — gate 1: is a declared form well-formed? (ask-forms P1)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFormDef, normalizeAskBlock, FORM_ID_RE } from '../src/shared/forms/form-def.mjs';
import { reviewForm, planForm, releaseForm } from './helpers/ask-form-fixtures.mjs';

const codes = (def, id = 'f') => validateFormDef(def, { id }).errors.map((e) => e.code);
const edit = (make, fn) => { const f = make(); fn(f); return f; };

test('the three fixtures pass gate 1', () => {
  for (const f of [reviewForm(), planForm(), releaseForm()]) assert.deepEqual(validateFormDef(f, { id: 'ok-form' }), { ok: true, errors: [] });
});

test('form ids', () => {
  for (const ok of ['a', 'review-mockups', 'a1-b2', 'a'.repeat(48)]) assert.match(ok, FORM_ID_RE);
  for (const bad of ['', 'A', '1a', 'a_b', '-a', 'a'.repeat(49)]) assert.deepEqual(codes(reviewForm(), bad), ['bad-id'], bad);
});

test('shape errors stop early with `dialect`', () => {
  assert.deepEqual(codes(null), ['dialect']);
  assert.ok(codes(edit(reviewForm, (f) => { f.version = 0; })).includes('dialect'));
  assert.ok(codes(edit(reviewForm, (f) => { f.title = ''; })).includes('dialect'));
  assert.ok(codes(edit(reviewForm, (f) => { f.surface = 'cli'; })).includes('dialect'));
  assert.ok(codes(edit(reviewForm, (f) => { f.layout = []; })).includes('dialect'));
  assert.ok(codes(edit(reviewForm, (f) => { f.answer.properties.verdict.oneOf = []; })).includes('dialect'));
  assert.ok(codes(edit(reviewForm, (f) => { f.data = { type: 'array', items: { type: 'string' } }; })).includes('dialect'));
});

test('layout errors: widget, field, pairing, bind, when, reachability', () => {
  assert.deepEqual(codes(edit(reviewForm, (f) => { f.layout[0].widget = 'hologram'; })), ['unknown-widget']);
  assert.deepEqual(codes(edit(reviewForm, (f) => { f.layout[2].field = 'nope'; })), ['unknown-field', 'unreachable']);
  assert.deepEqual(codes(edit(reviewForm, (f) => { f.layout[2] = { widget: 'toggle', field: 'verdict' }; })), ['bad-pairing']);
  assert.deepEqual(codes(edit(reviewForm, (f) => { f.layout[0].bind = 'data.nope'; })), ['bad-bind']);
  assert.deepEqual(codes(edit(reviewForm, (f) => { delete f.layout[0].bind; })), ['bad-bind'], 'markdown needs bind');
  assert.deepEqual(codes(edit(reviewForm, (f) => { f.layout[0].field = 'notes'; })), ['unknown-field'], 'a display widget collects nothing');
  assert.deepEqual(codes(edit(reviewForm, (f) => { f.layout.push({ widget: 'text', field: 'notes' }); })), ['dup-field']);
  assert.deepEqual(codes(edit(reviewForm, (f) => { f.layout[3].when = { nope: 1 }; })), ['unknown-field']);
  assert.deepEqual(codes(edit(reviewForm, (f) => { f.layout[3].when = { notes: 'x' }; })), ['dialect'], 'an item cannot depend on itself');
  assert.deepEqual(codes(edit(reviewForm, (f) => { f.layout[3].when = { verdict: { a: 1 } }; })), ['dialect']);
  assert.deepEqual(codes(edit(reviewForm, (f) => { f.layout.splice(1, 1); })), ['unreachable'], 'required `picked` lost its input');
  assert.deepEqual(codes(edit(reviewForm, (f) => { f.answer.properties.picked.enumFrom = 'data.images[].nope'; })), ['bad-bind']);
  assert.deepEqual(codes(edit(reviewForm, (f) => { f.layout.push({ widget: 'compare', before: 'data.images', after: 'data.zip' }); })), ['bad-bind', 'bad-bind'], 'a list is not a file, and data.zip is not in the data');
  assert.deepEqual(codes(edit(reviewForm, (f) => { f.layout[2].options = { from: 'data.nope' }; })), ['bad-bind']);
  const typo = validateFormDef(edit(reviewForm, (f) => { f.layout[2].lables = {}; }), { id: 'f' });
  assert.deepEqual(typo.errors.map((e) => `${e.code}|${e.message}`), ['dialect|"select" has no "lables" key'], 'a misspelt layout key is named, not ignored');
  assert.deepEqual(codes(edit(reviewForm, (f) => { f.layout[0].rows = 3; })), ['dialect'], 'a key of another widget');
});

test('a form proves itself: bad example, and an auto answer that cannot pass gate 3', () => {
  assert.deepEqual(codes(edit(reviewForm, (f) => { delete f.example; })), ['bad-example']);
  assert.deepEqual(codes(edit(reviewForm, (f) => { f.example.images[0].file = 7; })), ['bad-example']);
  // a required free-text field, always visible, with no default: `--yes` could never answer it
  const stuck = edit(reviewForm, (f) => { delete f.layout[3].when; });
  const r = validateFormDef(stuck, { id: 'f' });
  assert.deepEqual(r.errors.map((e) => `${e.path}:${e.code}`), ['answer.notes:bad-auto']);
  assert.match(r.errors[0].message, /Give it a "default" or "defaultFrom"/);
  assert.deepEqual(codes(edit(reviewForm, (f) => { delete f.layout[3].when; f.answer.properties.notes.default = 'Nothing to change here.'; })), []);
});

test('normalizeAskBlock: keeps the good, names the bad, never throws', () => {
  assert.deepEqual(normalizeAskBlock(undefined), { forms: {}, dropped: [] });
  assert.equal(normalizeAskBlock('x').dropped[0].id, '*');
  assert.equal(normalizeAskBlock({ forms: [] }).dropped[0].id, '*');
  const out = normalizeAskBlock({ forms: { 'review-mockups': reviewForm(), broken: edit(reviewForm, (f) => { f.layout[0].widget = 'hologram'; }), 'Bad_Id': reviewForm() } });
  assert.deepEqual(Object.keys(out.forms), ['review-mockups']);
  assert.deepEqual(out.dropped.map((d) => d.id), ['broken', 'Bad_Id']);
  assert.match(out.dropped[0].reason, /hologram/);
  const many = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`f${i}`, reviewForm()]));
  const capped = normalizeAskBlock({ forms: many });
  assert.equal(Object.keys(capped.forms).length, 8);
  assert.deepEqual(capped.dropped.map((d) => d.reason), ['more than 8 forms', 'more than 8 forms']);
  const huge = edit(reviewForm, (f) => { f.example.summary = 'x'.repeat(70000); });
  assert.match(normalizeAskBlock({ forms: { big: huge } }).dropped[0].reason, /larger than 65536 bytes/);
});

test('inherited names are not answer fields or data paths', () => {
  assert.deepEqual(codes(edit(reviewForm, (f) => { f.layout[3].when = { constructor: 'x' }; })), ['unknown-field']);
  assert.deepEqual(codes(edit(reviewForm, (f) => { f.layout[2].field = 'constructor'; })), ['unknown-field', 'unreachable']);
  assert.deepEqual(codes(edit(reviewForm, (f) => { f.layout[0].bind = 'data.constructor'; })), ['bad-bind']);
  assert.deepEqual(codes(edit(reviewForm, (f) => { f.answer.properties.picked.enumFrom = 'data.toString'; })), ['bad-bind']);
});

test('layout VALUES: what a key holds is checked, so no consumer meets a shape it cannot read', () => {
  const said = (make, fn) => validateFormDef(edit(make, fn), { id: 'f' }).errors.map((e) => `${e.path}|${e.code}|${e.message}`);
  assert.deepEqual(said(reviewForm, (f) => { f.layout[2].label = { a: 1 }; }), ['layout#3|dialect|"label" must be text']);
  assert.deepEqual(said(reviewForm, (f) => { f.layout[2].labels = ['Build it']; }), ['layout#3|dialect|"labels" is { value: text }']);
  assert.deepEqual(said(reviewForm, (f) => { f.layout[2].style = 'chips'; }), ['layout#3|dialect|"style" of "select" is one of: cards, segmented, dropdown']);
  assert.deepEqual(said(reviewForm, (f) => { f.layout[2].options = 'data.images'; }), ['layout#3|dialect|"options" is { from, value, label, description }']);
  assert.deepEqual(said(reviewForm, (f) => { f.layout[2].options = { from: 'data.images', labl: 'caption' }; }), ['layout#3|dialect|"options" has no "labl" key']);
  assert.deepEqual(said(reviewForm, (f) => { f.layout[3].rows = '4'; }), ['layout#4|dialect|"rows" must be a whole number, 1 or more']);
  assert.deepEqual(said(releaseForm, (f) => { f.layout[1].mono = 'yes'; }), ['layout#2|dialect|"mono" must be true or false']);
  assert.deepEqual(said(releaseForm, (f) => { f.layout[1].requires = { askCatalog: 'two' }; }), ['layout#2|dialect|"requires" is { askCatalog: n }']);
  assert.deepEqual(said(releaseForm, (f) => { f.layout[1].fallback = 'text'; }), ['layout#2|dialect|"fallback" is a layout item']);
  for (const columns of [[null], 'id', [], [{ label: 'Id' }], [{ key: 'id', label: 7 }]]) {
    assert.deepEqual(said(reviewForm, (f) => { f.layout.push({ widget: 'table', bind: 'data.images', columns }); }), ['layout#5|dialect|"columns" is a non-empty list of { key, label }'], JSON.stringify(columns));
  }
  assert.deepEqual(said(reviewForm, (f) => { f.layout.push({ widget: 'table', bind: 'data.images', columns: [{ key: 'id', label: 'Id', align: 'right', mono: true }] }); }), [], 'a column may carry keys of the renderer');
  assert.deepEqual(said(planForm, (f) => { f.layout[2].columns = [[], 'x']; }), ['layout#3|dialect|"columns" is a non-empty list of item lists', 'answer.order|unreachable|required field "order" has no input in the layout', 'answer.scope|unreachable|required field "scope" has no input in the layout']);
  assert.deepEqual(said(reviewForm, (f) => { f.layout.push({ widget: 'group', title: 'G' }); }), ['layout#5|dialect|"group" needs "children": a list of items']);
  assert.deepEqual(said(reviewForm, (f) => { f.layout.push({ widget: 'tabs', tabs: [null, { label: 'B', children: 'x' }] }); }), ['layout#5|dialect|"tabs" is a non-empty list of { label, children }']);
});

test('a row widget binds ROWS: a list of objects, with a text id where the answer is made of ids', () => {
  assert.deepEqual(codes(edit(planForm, (f) => { f.layout[2].columns[0][0].bind = 'data.goal'; })), ['bad-bind'], 'rank on a string');
  assert.deepEqual(codes(edit(reviewForm, (f) => { f.layout[1].bind = 'data.summary'; })), ['bad-bind'], 'gallery on a string');
  assert.deepEqual(codes(edit(reviewForm, (f) => { f.layout[1].bind = 'data.images[].id'; })), ['bad-bind'], 'a column of ids is not rows');
  const numeric = validateFormDef(edit(planForm, (f) => { f.data.properties.steps.items.properties.id = { type: 'integer' }; f.example.steps = [{ id: 1, title: 'a' }]; }), { id: 'f' });
  assert.deepEqual(numeric.errors.map((e) => `${e.path}|${e.code}|${e.message}`), [
    // the answer's ids are text and the rows' are numbers: no pick could ever match (the kind of `enumFrom`)
    'answer.steps[].id|bad-bind|"enumFrom": data.steps[].id is a number, and this field is text',
    'answer.order[]|bad-bind|"enumFrom": data.steps[].id is a number, and this field is text',
    'layout#2|bad-bind|"bind": rows of "review-list" need a required text "id"',
    'layout#4|bad-bind|"bind": rows of "rank" need a required text "id"']);
  const optional = validateFormDef(edit(planForm, (f) => { f.data.properties.steps.items.required = ['title']; }), { id: 'f' });
  assert.deepEqual(optional.errors.map((e) => `${e.path}|${e.code}`), ['layout#2|bad-bind', 'layout#4|bad-bind'], 'a row the agent may leave without an id cannot be ranked or judged');
  const show = edit(reviewForm, (f) => { delete f.layout[1].field; f.answer.required = ['verdict', 'notes']; delete f.answer.properties.picked; delete f.data.properties.images.items.properties.id; f.data.properties.images.items.required = ['file']; f.example.images = [{ file: 'mockups/a.png' }]; });
  assert.deepEqual(codes(show), [], 'a gallery that only shows needs no id');
  const opaque = edit(planForm, (f) => { f.data.properties.steps = { type: 'array', items: { type: 'object' } }; f.answer.properties.steps.items.properties.id = { type: 'string' }; f.answer.properties.order.items = { type: 'string' }; });
  assert.deepEqual(codes(opaque), [], 'opaque rows cannot be checked and are let through');
  const below = edit(reviewForm, (f) => { f.data.properties.blob = { type: 'object' }; f.layout.push({ widget: 'file-list', bind: 'data.blob.files' }); });
  assert.deepEqual(codes(below), [], 'and so is a bind below an opaque object (C3)');
});

test('normalizeAskBlock counts BYTES, not UTF-16 units', () => {
  const wide = edit(reviewForm, (f) => { f.title = 'Pick'; f.example.summary = 'é'.repeat(7000); });
  const forms = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`f${i}`, wide]));
  assert.ok(JSON.stringify({ forms }).length < 65536, 'under the cap in characters');
  assert.match(normalizeAskBlock({ forms }).dropped[0].reason, /larger than 65536 bytes/);
});

test('`options.from` binds rows too; a file widget binds a FILE', () => {
  const at = (f) => validateFormDef(f, { id: 'f' }).errors.map((e) => `${e.path}|${e.code}|${e.message}`);
  assert.deepEqual(at(edit(planForm, (f) => { f.layout[2].columns[1][0].options = { from: 'data.goal' }; })), ['layout#5|bad-bind|"options.from": "select" needs a list of objects']);
  assert.deepEqual(codes(edit(planForm, (f) => { f.layout[2].columns[1][0].options = { from: 'data.steps[].id' }; })), ['bad-bind'], 'a column is not rows');
  assert.deepEqual(codes(edit(planForm, (f) => { f.layout[2].columns[1][0].options = { from: 'data.steps', label: 'title' }; })), []);
  // only `file` values are snapshotted (spec §7), so a file widget bound to anything else can show nothing
  assert.deepEqual(at(edit(reviewForm, (f) => { f.layout.unshift({ widget: 'image', bind: 'data.summary' }); })), ['layout#1|bad-bind|"bind": "image" shows a file, and data.summary is a string']);
  assert.deepEqual(codes(edit(releaseForm, (f) => { f.layout[0].bind = 'data.suggested_version'; })), ['bad-bind'], 'pdf on a string');
  assert.deepEqual(codes(edit(releaseForm, (f) => { f.layout.push({ widget: 'compare', before: 'data.report', after: 'data.suggested_version' }); })), ['bad-bind'], 'one side of a compare');
  assert.deepEqual(codes(edit(releaseForm, (f) => { f.layout.push({ widget: 'compare', before: 'data.report', after: 'data.report' }, { widget: 'media', bind: 'data.report' }); })), []);
  const below = edit(reviewForm, (f) => { f.data.properties.blob = { type: 'object' }; f.layout.push({ widget: 'image', bind: 'data.blob.shot' }); });
  assert.deepEqual(codes(below), [], 'below an opaque object there is no schema to hold it to (C3)');
});

test('`when` must be answerable: an input collects its field, and no field waits on itself', () => {
  const at = (f) => validateFormDef(f, { id: 'f' }).errors.map((e) => `${e.path}|${e.code}|${e.message}`);
  const ghost = edit(reviewForm, (f) => { f.answer.properties.ghost = { type: 'string' }; f.layout[3].when = { ghost: 'x' }; });
  assert.deepEqual(at(ghost), ['layout#4|unknown-field|"when" names "ghost", which no item collects'], 'the item could never be shown');
  // verdict waits on notes and notes waits on verdict: a human sees neither, and an EMPTY answer would pass gate 3
  const cycle = edit(reviewForm, (f) => { f.layout[2].when = { notes: 'x' }; });
  assert.deepEqual(at(cycle), ['layout#3|dialect|"when" is circular: verdict → notes → verdict']);
  const viaGroup = edit(reviewForm, (f) => { f.layout[3] = { widget: 'group', when: { notes: 'x' }, children: [f.layout[3]] }; });
  assert.deepEqual(at(viaGroup), ['layout#5|dialect|"when" is circular: notes → notes'], 'an ancestor counts');
  const chain = edit(planForm, (f) => { f.layout[2].columns[1][1].when = { scope: 'thorough' }; f.layout[2].columns[1][1].children[1].when = { max_cycles: 2 }; });
  assert.deepEqual(at(chain), [], 'a chain is not a circle');
});

test('an input with no `field` is reported once, not also as "the same field twice"', () => {
  const r = validateFormDef(edit(reviewForm, (f) => { delete f.layout[2].field; delete f.layout[3].field; }), { id: 'f' });
  assert.deepEqual(r.errors.map((e) => e.code), ['unknown-field', 'unknown-field', 'unreachable', 'unreachable']);
});

test('`enumFrom` / `defaultFrom` land on the right KIND of data, not merely on something in it', () => {
  const at = (f) => validateFormDef(f, { id: 'f' }).errors.map((e) => `${e.path}|${e.code}|${e.message}`);
  // rows are not values: the enum would be empty for ever, and on an OPTIONAL field nothing else notices
  const rows = edit(reviewForm, (f) => { f.answer.required = ['verdict', 'notes']; f.answer.properties.picked.enumFrom = 'data.images'; });
  assert.deepEqual(at(rows), ['answer.picked|bad-bind|"enumFrom": data.images holds objects, not values']);
  const kind = edit(planForm, (f) => { f.data.properties.budget = { type: 'integer' }; f.answer.properties.scope = { type: 'string', enumFrom: 'data.budget' }; });
  assert.deepEqual(at(kind), ['answer.scope|bad-bind|"enumFrom": data.budget is a number, and this field is text']);
  const tags = edit(planForm, (f) => { f.data.properties.scopes = { type: 'array', items: { type: 'string' } }; f.answer.properties.scope = { type: 'string', enumFrom: 'data.scopes' }; f.example.scopes = ['minimal']; });
  assert.deepEqual(at(tags), [], 'a plain list of values is as good as a column');
  // a text field takes ONE value, a list field takes a list
  const many = edit(releaseForm, (f) => { f.data.properties.tags = { type: 'array', items: { type: 'string' } }; f.answer.properties.version.defaultFrom = 'data.tags'; });
  assert.deepEqual(at(many), ['answer.version|bad-bind|"defaultFrom": data.tags is a list, and this field takes one value']);
  const single = edit(releaseForm, (f) => { delete f.answer.properties.platforms.default; f.answer.properties.platforms.defaultFrom = 'data.suggested_version'; });
  assert.deepEqual(at(single), ['answer.platforms|bad-bind|"defaultFrom": data.suggested_version is one value, and this field is a list']);
  const list = edit(releaseForm, (f) => {
    f.data.properties.suggested_platforms = { type: 'array', items: { type: 'string' } };
    delete f.answer.properties.platforms.default; f.answer.properties.platforms.defaultFrom = 'data.suggested_platforms'; f.example.suggested_platforms = ['linux'];
  });
  assert.deepEqual(at(list), [], 'a list field fed from a list');
  const below = edit(releaseForm, (f) => { f.data.properties.blob = { type: 'object' }; f.answer.properties.signer.defaultFrom = 'data.blob.who'; });
  assert.deepEqual(at(below), [], 'below an opaque object there is no schema to hold it to (C3)');
  const belowList = edit(releaseForm, (f) => { f.data.properties.blob = { type: 'object' }; delete f.answer.properties.platforms.default; f.answer.properties.platforms.defaultFrom = 'data.blob.platforms'; });
  assert.deepEqual(at(belowList), [], 'for a list field too');
});

test('`when` compares what its field can BE: a scalar field, a value of its type, inside its `enum`', () => {
  const at = (f) => validateFormDef(f, { id: 'f' }).errors.map((e) => `${e.path}|${e.code}|${e.message}`);
  // equality is all `when` has, and a list never equals anything: the item would be hidden for good
  assert.deepEqual(at(edit(releaseForm, (f) => { f.layout[4].when = { platforms: 'macos' }; })), ['layout#5|dialect|"when" cannot compare "platforms": it is a list']);
  assert.deepEqual(at(edit(reviewForm, (f) => { f.layout[3].when = { verdict: 'itrate' }; })), ['layout#4|dialect|"when" waits for verdict = "itrate", which "verdict" can never be'], 'a typo outside the enum');
  assert.deepEqual(at(edit(reviewForm, (f) => { f.layout[3].when = { verdict: ['iterate', 'nope'] }; })), ['layout#4|dialect|"when" waits for verdict = "nope", which "verdict" can never be'], 'every listed value must be possible');
  const group = (when) => edit(planForm, (f) => { f.layout[0].when = when; });
  assert.deepEqual(at(group({ run_tests: 'true' })), ['layout#1|dialect|"when" waits for run_tests = "true", which "run_tests" can never be'], 'text is not on/off');
  assert.deepEqual(at(group({ max_cycles: 2.5 })), ['layout#1|dialect|"when" waits for max_cycles = 2.5, which "max_cycles" can never be'], 'a whole-number field');
  assert.deepEqual(at(group({ run_tests: true, max_cycles: [1, 2], scope: 'minimal' })), []);
  assert.deepEqual(at(edit(reviewForm, (f) => { f.layout[3].when = { picked: 'anything' }; })), [], '`enumFrom` is open until ask time');
});

test('a file widget shows ONE file: a column of them is what `gallery` and `file-list` are for', () => {
  const at = (f) => validateFormDef(f, { id: 'f' }).errors.map((e) => `${e.path}|${e.code}|${e.message}`);
  assert.deepEqual(at(edit(reviewForm, (f) => { f.layout.unshift({ widget: 'image', bind: 'data.images[].file' }); })),
    ['layout#1|bad-bind|"bind": "image" shows one file, and data.images[].file is a column of them']);
  const below = edit(reviewForm, (f) => { f.data.properties.blob = { type: 'object' }; f.layout.push({ widget: 'compare', before: 'data.blob.shots[].file', after: 'data.blob.shot' }); });
  assert.deepEqual(at(below), ['layout#5|bad-bind|"before": "compare" shows one file, and data.blob.shots[].file is a column of them'], 'also below an opaque object: a column is a list whatever it holds');
});

test('normalizeAskBlock never throws: list nesting that fits 64 KB is dropped, by name', () => {
  let m = { type: 'string' };
  for (let i = 0; i < 100; i += 1) m = { type: 'array', items: m };
  const deep = edit(reviewForm, (f) => { f.data.properties.m = m; });
  assert.ok(new TextEncoder().encode(JSON.stringify({ forms: { deep } })).length <= 65536, 'the block must get past the size check');
  const out = normalizeAskBlock({ forms: { deep } });
  assert.deepEqual(Object.keys(out.forms), []);
  assert.match(out.dropped[0].reason, /nesting is limited/);
});

test('normalizeAskBlock never throws: JSON nested past the depth cap is refused before anything walks it', () => {
  // 20 000 levels are 40 KB: inside the size limit, and past what JSON.stringify survives on Node 22
  let deep = 1;
  for (let i = 0; i < 20000; i += 1) deep = [deep];
  const f = edit(reviewForm, (g) => { g.data.properties.blob = { type: 'object' }; g.example.blob = { x: deep }; });
  const out = normalizeAskBlock({ forms: { deep: f } });
  assert.deepEqual(Object.keys(out.forms), []);
  assert.deepEqual(out.dropped, [{ id: '*', reason: '"ask" is nested deeper than 256 levels' }]);
  // the boundary, exactly: the block is level 1, so 255 lists inside it reach 256 and 256 reach 257
  const lists = (n) => { let v = 1; for (let i = 0; i < n; i += 1) v = [v]; return v; };
  assert.deepEqual(normalizeAskBlock({ forms: {}, junk: lists(255) }), { forms: {}, dropped: [] });
  assert.deepEqual(normalizeAskBlock({ forms: {}, junk: lists(256) }).dropped.map((d) => d.id), ['*']);
  // far above anything written by hand: 80 nested groups still pass gate 1
  let item = { widget: 'markdown', bind: 'data.summary' };
  for (let i = 0; i < 80; i += 1) item = { widget: 'group', children: [item] };
  assert.deepEqual(Object.keys(normalizeAskBlock({ forms: { ok: edit(reviewForm, (g) => { g.layout.push(item); }) } }).forms), ['ok']);
});
