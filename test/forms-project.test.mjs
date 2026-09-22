// test/forms-project.test.mjs — the text projection and the typed-answer grammar (ask-forms P1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptFields, projectForm, coerceInput, parseAnswerLine } from '../src/shared/forms/project.mjs';
import { resolveAnswerSchema } from '../src/shared/forms/schema.mjs';
import { collectAnswer } from '../src/shared/forms/answer.mjs';
import { reviewForm, planForm, releaseForm } from './helpers/ask-form-fixtures.mjs';

/** What P2's envelope looks like for a declared form + its example data. */
const askOf = (form, files = []) => ({ title: form.title, agent: 'designer', data: form.example, layout: form.layout,
  answerSchema: resolveAnswerSchema(form.answer, form.example), files });
const field = (ask, name) => promptFields(ask).find((f) => f.field === name);
const errs = (r) => r.errors.map((e) => `${e.path}:${e.code}`);

test('promptFields: layout order, options from rows / enum / labels, fallback resolved', () => {
  const review = promptFields(askOf(reviewForm()));
  assert.deepEqual(review.map((f) => f.field), ['picked', 'verdict', 'notes']);
  assert.deepEqual(review[0].options, [{ value: 'a', label: 'Option A' }, { value: 'b', label: 'Option B' }]);
  assert.deepEqual(review[0].items, [{ id: 'a', label: 'Option A' }, { id: 'b', label: 'Option B' }], 'a row widget lists its rows');
  assert.deepEqual(review[1].options, [{ value: 'build', label: 'Build it' }, { value: 'iterate', label: 'Another pass' }]);
  assert.deepEqual([review[1].items, review[1].itemFields], [null, null]);
  assert.deepEqual([review[2].required, review[2].when], [true, { verdict: 'iterate' }]);
  const rel = promptFields(askOf(releaseForm()));
  assert.deepEqual(rel.map((f) => `${f.field}:${f.widget}`), ['version:text', 'platforms:multiselect', 'signer:text', 'publish_on:date']);
  assert.equal(rel[0].default, '1.4.0-rc.2', 'defaultFrom arrives resolved');
});

test('promptFields: a review-list exposes its per-item sub-prompts', () => {
  const steps = field(askOf(planForm()), 'steps');
  assert.deepEqual(steps.verdicts, ['keep', 'change', 'drop']);
  assert.deepEqual(steps.items, [{ id: 's1', label: 'Core' }, { id: 's2', label: 'Engine' }]);
  assert.deepEqual(steps.itemFields.map((s) => `${s.field}:${s.widget}:${s.required}:${s.default}`), ['verdict:select:true:keep', 'note:text:false:undefined']);
  assert.deepEqual(steps.itemFields[0].options.map((o) => o.value), ['keep', 'change', 'drop']);
  assert.deepEqual(coerceInput(steps.itemFields[0], '3'), { ok: true, value: 'drop' }, 'a sub-prompt coerces like any field');
});

test('projectForm: display widgets as text, files with type and size, numbered prompts', () => {
  const files = [{ index: 0, rel: 'mockups/a.png', name: 'a.png', mime: 'image/png', bytes: 184320, sha256: 'x' }];
  const text = projectForm(askOf(reviewForm(), files));
  assert.match(text, /^Pick an onboarding direction — designer\n\nTwo directions\./);
  assert.match(text, /\[image\] a: mockups\/a\.png \(image\/png, 180 KB\) — Option A/);
  assert.match(text, /\[image\] b: mockups\/b\.png — Option B/, 'a file with no manifest entry prints bare');
  assert.match(text, /1\. Which direction\? \{picked\}\n {3}one of: 1\) Option A {2}2\) Option B/);
  assert.match(text, /3\. What should change\? \{notes\}\n {3}string · only when verdict=iterate$/);
  assert.doesNotMatch(text, /Reply:|undefined/, 'no ref → no reply line');
});

test('projectForm: `ref` appends one reply line naming the first three unconditional fields', () => {
  assert.match(projectForm(askOf(reviewForm()), { ref: 'r7' }), /\n\nReply: \/answer r7 picked=<value> \| verdict=<value>$/);
  assert.match(projectForm(askOf(releaseForm()), { ref: '*a41f' }), /Reply: \/answer \*a41f version=<value> \| platforms=<a,b> \| signer=<value>$/);
});

test('projectForm: tables cap at 10 rows; maxChars drops DISPLAY text only, marked by one … line', () => {
  const ask = { title: 'T', data: { note: 'n'.repeat(300), rows: Array.from({ length: 14 }, (_, i) => ({ id: `r${i}`, n: i })) },
    layout: [{ widget: 'markdown', bind: 'data.note' },
      { widget: 'table', bind: 'data.rows', columns: [{ key: 'id', label: 'Id' }, { key: 'n', label: 'N', unit: 'h' }] },
      { widget: 'toggle', field: 'ok', label: 'Go ahead' }],
    answerSchema: { type: 'object', properties: { ok: { type: 'boolean', default: true } } } };
  const full = projectForm(ask, { ref: 'r1' });
  assert.match(full, /Id \| N\nr0 \| 0h/);
  assert.match(full, /… 4 more rows/);
  assert.equal(projectForm(ask, { ref: 'r1', maxChars: 0 }), full, '0 means no cap');
  const cut = projectForm(ask, { ref: 'r1', maxChars: 400 });
  assert.ok(cut.length <= 400, `${cut.length} <= 400`);
  assert.match(cut, /^T\n/, 'the title survives');
  assert.match(cut, /\n…\n1\. Go ahead \{ok\}/, 'one marker where display text was dropped; the prompt survives');
  assert.match(cut, /Reply: \/answer r1 ok=<value>$/, 'the reply line is never clipped');
  assert.equal(cut.match(/^…$/gm).length, 1);
  const tiny = projectForm(ask, { ref: 'r1', maxChars: 60 });
  assert.doesNotMatch(tiny, /nnnn|Id \| N/, 'all display text is gone');
  assert.equal(tiny.match(/^…$/gm).length, 1, 'two blocks were dropped, still ONE marker');
  assert.match(tiny, /1\. Go ahead \{ok\}[\s\S]*Reply: \/answer r1/, 'prompts and reply outlive the cap');
});

test('coerceInput: by type — number, yes/no, index or value or label, lists, free text, CRLF', () => {
  const ask = askOf(reviewForm());
  assert.deepEqual(coerceInput(field(ask, 'picked'), '2'), { ok: true, value: 'b' });
  assert.deepEqual(coerceInput(field(ask, 'picked'), 'option a'), { ok: true, value: 'a' });
  assert.deepEqual(coerceInput(field(ask, 'picked'), 'b\r'), { ok: true, value: 'b' }, 'a Windows line ending is not part of the answer');
  assert.deepEqual([coerceInput(field(ask, 'picked'), 'zz').ok, coerceInput(field(ask, 'picked'), 'zz').code], [false, 'enum']);
  assert.deepEqual(coerceInput(field(ask, 'notes'), '  '), { ok: true, value: undefined }, 'empty means "use the default"');
  assert.deepEqual(coerceInput(field(ask, 'notes'), 'see C:\\Users\\dev\\a.png \\| ok'), { ok: true, value: 'see C:\\Users\\dev\\a.png | ok' }, 'only \\| \\, \\= \\: \\\\ unescape');
  const plan = askOf(planForm());
  assert.deepEqual(coerceInput(field(plan, 'max_cycles'), '4'), { ok: true, value: 4 });
  assert.equal(coerceInput(field(plan, 'max_cycles'), 'four').code, 'type');
  assert.deepEqual(coerceInput(field(plan, 'run_tests'), 'No'), { ok: true, value: false });
  assert.equal(coerceInput(field(plan, 'run_tests'), 'maybe').code, 'type');
  assert.deepEqual(coerceInput(field(plan, 'order'), 's2, s1'), { ok: true, value: ['s2', 's1'] });
  assert.deepEqual(coerceInput(field(plan, 'steps'), 's2:drop:too risky\\, really').value,
    [{ id: 's2', verdict: 'drop', note: 'too risky, really' }, { id: 's1', verdict: 'keep' }], 'unlisted items take the default verdict');
  assert.equal(coerceInput(field(plan, 'steps'), 's9:drop').ok, false);
  assert.equal(coerceInput(field(plan, 'steps'), 's1:burn').ok, false);
  const rel = askOf(releaseForm());
  assert.deepEqual(coerceInput(field(rel, 'platforms'), '1,windows'), { ok: true, value: ['macos', 'windows'] });
  const free = { field: 'q', type: 'string', widget: 'select', options: [{ value: 'Web only', label: 'Web only' }], free: true, verdicts: [], schema: { type: 'string' } };
  assert.deepEqual(coerceInput(free, 'something else'), { ok: true, value: 'something else' }, '`suggest` takes free text');
});

test('coerceInput: in a numeric enum the VALUE wins over the ordinal', () => {
  const ask = { data: {}, layout: [{ widget: 'select', field: 'workers' }],
    answerSchema: { type: 'object', properties: { workers: { type: 'integer', enum: [1, 2, 4, 8] } } } };
  const f = field(ask, 'workers');
  assert.deepEqual(coerceInput(f, '4'), { ok: true, value: 4 }, 'not "the 4th option" (8)');
  assert.deepEqual(coerceInput(f, '8'), { ok: true, value: 8 });
  assert.deepEqual(coerceInput(f, '3'), { ok: true, value: 4 }, 'not a value, so it is the 3rd option');
  assert.equal(coerceInput(f, '9').code, 'enum');
  const named = { data: {}, layout: [{ widget: 'select', field: 'workers', labels: { 1: 'one', 2: 'two', 4: 'four', 8: 'eight' } }], answerSchema: ask.answerSchema };
  assert.deepEqual(coerceInput(field(named, 'workers'), '4'), { ok: true, value: 4 }, 'C10 holds with labels too: a number typed into a number field is the number');
  assert.deepEqual(coerceInput(field(named, 'workers'), 'Eight'), { ok: true, value: 8 });
});

test('parseAnswerLine: field=value | …, escapes, codes, then gate 3', () => {
  const form = reviewForm();
  const ask = askOf(form);
  const r = parseAnswerLine('picked=2 | verdict=iterate | notes=move the CTA \\| tighten the copy', ask);
  assert.deepEqual(r, { values: { picked: 'b', verdict: 'iterate', notes: 'move the CTA | tighten the copy' }, errors: [] });
  assert.deepEqual(collectAnswer(ask, ask.answerSchema, r.values).errors, [], 'the envelope itself is a valid first argument');
  assert.deepEqual(parseAnswerLine('', ask), { values: {}, errors: [] });
  assert.deepEqual(errs(parseAnswerLine('picked=zz', ask)), ['picked:enum']);
  assert.deepEqual(errs(parseAnswerLine('nope=1', ask)), ['nope:unknown-field']);
  assert.deepEqual(errs(parseAnswerLine('picked=a | picked=b', ask)), ['picked:duplicate-field']);
  assert.deepEqual(parseAnswerLine('picked=a | picked=b', ask).values, { picked: 'a' }, 'the first one stands');
  assert.deepEqual(errs(parseAnswerLine('just words', ask)), [':parse'], 'a multi-field form needs names');
  assert.deepEqual(errs(parseAnswerLine('picked=a | stray', ask)), [':parse']);
  assert.deepEqual(parseAnswerLine('notes=a=b, c', ask).values, { notes: 'a=b, c' }, 'only the first = splits; a comma is literal in a string');
});

test('parseAnswerLine: a bare value goes to `bareField`, or to the only field of a one-field form', () => {
  const ask = askOf(reviewForm());
  assert.deepEqual(parseAnswerLine('2', ask, { bareField: 'picked' }).values, { picked: 'b' });
  assert.deepEqual(errs(parseAnswerLine('2', ask, { bareField: 'nope' })), [':parse']);
  const one = { data: {}, layout: [{ widget: 'select', field: 'q', suggest: ['Web only', 'Web and CLI'] }], answerSchema: { type: 'object', required: ['q'], properties: { q: { type: 'string' } } } };
  assert.deepEqual(parseAnswerLine('2', one).values, { q: 'Web and CLI' }, "today's positional /answer still works");
  assert.deepEqual(parseAnswerLine('neither, do X', one).values, { q: 'neither, do X' });
  assert.deepEqual(parseAnswerLine('use a \\= b', one).values, { q: 'use a = b' }, 'an escaped = does not make it a pair');
});

test('projectForm: an absent optional value prints nothing — never the word "undefined"', () => {
  const ask = { title: 'T', data: { after: 'shots/new.png', rows: [{ file: 'a.png' }] }, files: [],
    layout: [{ widget: 'image', bind: 'data.hero' }, { widget: 'pdf', bind: 'data.report' }, { widget: 'json', bind: 'data.cfg' },
      { widget: 'code', bind: 'data.src', name: 'a.js' }, { widget: 'markdown', bind: 'data.note' }, { widget: 'gallery', bind: 'data.rows' },
      { widget: 'compare', before: 'data.before', after: 'data.after' }, { widget: 'toggle', field: 'ok', label: 'Go' }],
    answerSchema: { type: 'object', properties: { ok: { type: 'boolean' } } } };
  const text = projectForm(ask);
  assert.doesNotMatch(text, /undefined|\[pdf\]|\[json\]|\[code\]/);
  assert.match(text, /^T\n\n\[image\] a\.png\n\[compare\] — {2}-> {2}shots\/new\.png\n1\. Go \{ok\}/, 'a row with no id prints bare; a missing side of a compare is a dash');
});

test('projectForm: a text widget bound to a FILE (ask.fileRefs, X16) names the file instead of printing its path as prose', () => {
  const ask = { title: 'T', data: { notes: 'docs/notes.md', rows: 'out/rows.csv', plain: 'Just text.' },
    files: [{ index: 0, rel: 'docs/notes.md', name: 'notes.md', mime: 'text/markdown', bytes: 2048, sha256: 'x' }],
    fileRefs: [{ path: 'data.notes', rel: 'docs/notes.md' }, { path: 'data.rows', rel: 'out/rows.csv' }],
    layout: [{ widget: 'markdown', bind: 'data.notes' }, { widget: 'table', bind: 'data.rows', columns: [{ key: 'a', label: 'A' }] }, { widget: 'markdown', bind: 'data.plain' }],
    answerSchema: { type: 'object', properties: {} } };
  assert.equal(projectForm(ask), 'T\n\n[markdown] docs/notes.md (text/markdown, 2 KB)\n[table] out/rows.csv\nJust text.\n');
});

test('projectForm never throws on a shape gate 1 would refuse (a persisted ask outlives the gate that admitted it)', () => {
  const ask = { title: 'T', data: { rows: [{ id: 'r1', n: 1 }, null, 'x'] },
    layout: [{ widget: 'table', bind: 'data.rows', columns: [null, 'id', { key: 'n' }] }, { widget: 'table', bind: 'data.rows', columns: 'n' },
      { widget: 'select', field: 'pick', options: 'rows', labels: ['x'] }, null, 'junk'],
    answerSchema: { type: 'object', properties: { pick: { type: 'string', enum: ['constructor', 'b'] } } } };
  const text = projectForm(ask, { ref: 'r1' });
  assert.match(text, /^T\n\nn\n1\n1\. pick \{pick\}\n {3}one of: 1\) constructor {2}2\) b/, 'a column with no label shows its key; an inherited name is no label');
});

test('promptFields: only OWN answer properties are fields', () => {
  const ask = { data: {}, layout: [{ widget: 'text', field: 'constructor' }, { widget: 'text', field: 'name' }], answerSchema: { type: 'object', properties: { name: { type: 'string' } } } };
  assert.deepEqual(promptFields(ask).map((f) => f.field), ['name']);
  const pick = { data: {}, layout: [{ widget: 'select', field: 'pick', labels: { b: 'Bee' } }], answerSchema: { type: 'object', properties: { pick: { type: 'string', enum: ['constructor', 'b'] } } } };
  assert.deepEqual(promptFields(pick)[0].options, [{ value: 'constructor', label: 'constructor' }, { value: 'b', label: 'Bee' }], 'and only OWN labels are labels');
});

test('coerceInput: a number that names two DIFFERENT options is refused, never guessed', () => {
  const ask = { data: { rows: [{ id: '3', title: 'C' }, { id: '1', title: 'A' }, { id: '2', title: 'B' }], bare: [{ id: '3' }, { id: '1' }, { id: '2' }],
    kept: [{ id: '1', title: 'A' }, { id: '2', title: 'B' }], some: [{ id: '2', title: 'Two' }, { id: '5', title: 'Five' }] },
    layout: [{ widget: 'rank', bind: 'data.rows', field: 'order' }, { widget: 'table-select', bind: 'data.rows', field: 'one' },
      { widget: 'rank', bind: 'data.bare', field: 'bare' }, { widget: 'table-select', bind: 'data.kept', field: 'kept' }, { widget: 'table-select', bind: 'data.some', field: 'some' }],
    answerSchema: { type: 'object', properties: { order: { type: 'array', items: { type: 'string' } }, one: { type: 'string' },
      bare: { type: 'array', items: { type: 'string' } }, kept: { type: 'string' }, some: { type: 'string' } } } };
  const one = coerceInput(field(ask, 'one'), '1');
  assert.deepEqual([one.ok, one.code], [false, 'enum'], 'the prompt shows "1) C", and "1" is also the id of A: either reading sends the agent a wrong row');
  assert.equal(one.message, '"1" is both option 1 ("C") and the id of "A": type the label of the one you mean');
  assert.equal(coerceInput(field(ask, 'order'), '3,1,2').code, 'enum', 'a rank is held to the same rule');
  assert.deepEqual(coerceInput(field(ask, 'order'), 'c, a, b'), { ok: true, value: ['3', '1', '2'] }, 'a label always says which');
  assert.deepEqual(coerceInput(field(ask, 'one'), 'b'), { ok: true, value: '2' });
  assert.deepEqual(coerceInput(field(ask, 'bare'), '3,1,2'), { ok: true, value: ['3', '1', '2'] }, 'rows with no title are SHOWN by their id, so the id is what was typed');
  assert.deepEqual(coerceInput(field(ask, 'kept'), '2'), { ok: true, value: '2' }, 'number and id agree: nothing to refuse');
  assert.deepEqual(coerceInput(field(ask, 'some'), '5'), { ok: true, value: '5' }, 'an id that is no option number');
  assert.equal(coerceInput(field(ask, 'some'), '2').code, 'enum', 'ids 2 and 5: "2" is the first row by id and the second by number');
  assert.deepEqual(coerceInput(field(ask, 'some'), 'five'), { ok: true, value: '5' });
});

test('projectForm: null, an object and an inherited name never reach the text', () => {
  const ask = { title: 'T', data: { goal: null, blob: null, rows: [{ id: 'r', n: null, o: { a: 1 } }] },
    layout: [{ widget: 'callout', title: 'Goal.', bind: 'data.goal' }, { widget: 'json', bind: 'data.blob' },
      { widget: 'table', bind: 'data.rows', columns: [{ key: 'id' }, { key: 'n' }, { key: 'o' }, { key: 'constructor' }, { key: '__proto__' }] },
      { widget: 'rank', bind: 'data.rows', field: 'order', titleKey: 'toString' },
      { widget: 'select', field: 'pick', options: { from: 'data.rows', value: 'constructor', label: 'valueOf' } }],
    answerSchema: { type: 'object', properties: { order: { type: 'array', items: { type: 'string' } }, pick: { type: 'string' } } } };
  const text = projectForm(ask);
  assert.doesNotMatch(text, /null|undefined|native code|\[object/);
  assert.match(text, /^T\n\nGoal\.\n\nid \| n \| o \| constructor \| __proto__\nr \| — \| \{"a":1\} \| — \| —\n- r: r\n/, 'a missing cell is a dash, an object cell is its JSON, an inherited name is no cell');
  assert.deepEqual(field(ask, 'pick').options, [], 'an inherited name is not an option value');
});

test('a row with no text id is shown, but it is not a choice (opaque rows reach here unchecked)', () => {
  const ask = { title: 'T', data: { rows: [{ title: 'No id' }, { id: 's2', title: 'Two' }, { id: 7, title: 'Numeric' }] },
    layout: [{ widget: 'review-list', bind: 'data.rows', field: 'steps' }, { widget: 'rank', bind: 'data.rows', field: 'order' }],
    answerSchema: { type: 'object', properties: { order: { type: 'array', items: { type: 'string' } },
      steps: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, verdict: { type: 'string', enum: ['keep', 'drop'] } } } } } } };
  assert.deepEqual(field(ask, 'order').options, [{ value: 's2', label: 'Two' }]);
  assert.deepEqual(field(ask, 'steps').items, [{ id: 's2', label: 'Two' }]);
  const text = projectForm(ask);
  assert.doesNotMatch(text, /undefined/);
  assert.match(text, /^- No id\n- s2: Two\n- Numeric\n1\. steps/m);
  assert.match(text, /order of: s2 · optional$/m);
  assert.deepEqual(coerceInput(field(ask, 'steps'), 's2:drop'), { ok: true, value: [{ id: 's2', verdict: 'drop' }] }, 'completion adds no row without an id');
});

test('coerceInput: a partial rank is completed in data order; a review-list verdict reads like its own prompt', () => {
  const plan = askOf(planForm());
  assert.deepEqual(coerceInput(field(plan, 'order'), 's2'), { ok: true, value: ['s2', 's1'] }, 'named first, the rest as they were (C18)');
  assert.deepEqual(coerceInput(field(plan, 'order'), 's2, s2').value, ['s2', 's2', 's1'], 'a repeat is left for gate 3 to refuse (unique)');
  assert.deepEqual(coerceInput(field(plan, 'steps'), 's1:Drop, ').value, [{ id: 's1', verdict: 'drop' }, { id: 's2', verdict: 'keep' }], 'case-insensitive; a trailing comma is not an item');
  assert.deepEqual(coerceInput(field(plan, 'steps'), 's2:2:why\\: because').value, [{ id: 's2', verdict: 'change', note: 'why: because' }, { id: 's1', verdict: 'keep' }], 'a verdict by number, as the per-item prompt takes it');
  assert.equal(coerceInput(field(plan, 'steps'), 's1').code, 'enum', 'an item with no verdict');
});

test('projectForm: a review-list shows what is being judged — the body, on one line, clipped', () => {
  const form = planForm();
  form.example.steps[1].body = `Gate 2:\n  ${'check '.repeat(40)}`;
  const text = projectForm(askOf(form));
  assert.match(text, /^- s1: Core$/m);
  assert.match(text, /^- s2: Engine — Gate 2: check check .{120,140}…$/m);
});

test('parseAnswerLine: free text holding "=" is told how to say so, where a bare answer is possible', () => {
  const one = { data: {}, layout: [{ widget: 'textarea', field: 'q' }], answerSchema: { type: 'object', required: ['q'], properties: { q: { type: 'string' } } } };
  const r = parseAnswerLine('set FOO=bar in env', one);
  assert.deepEqual(errs(r), ['set FOO:unknown-field'], 'C9: the first unescaped = splits');
  assert.equal(r.errors[0].message, '"set FOO" is not a field of this form (a literal = in an answer is written \\=)');
  assert.deepEqual(parseAnswerLine('set FOO\\=bar in env', one).values, { q: 'set FOO=bar in env' }, 'and that works');
  assert.equal(parseAnswerLine('nope=1', askOf(reviewForm())).errors[0].message, '"nope" is not a field of this form', 'no hint where a bare answer is impossible');
});
