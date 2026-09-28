// test/ui-ask-widgets-input.test.mjs — the typed input widgets (ask-forms §6.1):
// number, slider, toggle, date, select (cards / segmented / dropdown / suggest)
// and multiselect. Pure jsdom; every widget is exercised through renderAskForm so
// the engine contract (collect, when, readonly) is exercised with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { renderAskForm } from '../ui/public/ask/form-renderer.mjs';
import { COMMON_ITEM_KEYS, LAYOUT_ITEM_KEYS } from '../src/shared/forms/catalog.mjs';

const win = new JSDOM('<!doctype html><body></body>').window;
const doc = win.document;
const click = (n) => n.dispatchEvent(new win.Event('click', { bubbles: true }));
const input = (n) => n.dispatchEvent(new win.Event('input', { bubbles: true }));
const change = (n) => n.dispatchEvent(new win.Event('change', { bubbles: true }));

const askOf = (layout, properties, extra = {}) => ({
  id: 'q:1', askId: 'q_1', kind: 'form', form: 'f', version: 1, title: 'T', surface: 'any',
  data: extra.data || {}, files: [], fileRefs: extra.fileRefs || [], layout,
  answerSchema: { type: 'object', required: extra.required || [], properties },
});
const mount = (ask, opts = {}) => renderAskForm(ask, { doc, ...opts });

test('number: min/max/step from the schema, unit chip, numeric value', () => {
  const f = mount(askOf(
    [{ widget: 'number', field: 'n', label: 'Count', unit: 'px' }],
    { n: { type: 'integer', minimum: 1, maximum: 10, multipleOf: 2 } },
  ));
  const el = f.el.querySelector('input[type="number"]');
  assert.equal(el.getAttribute('min'), '1');
  assert.equal(el.getAttribute('max'), '10');
  assert.equal(el.getAttribute('step'), '2');
  assert.equal(f.el.querySelector('.af-unit').textContent, 'px');
  el.value = '4'; input(el);
  assert.equal(f.snapshot().n, 4);
  assert.equal(typeof f.snapshot().n, 'number');
  el.value = ''; input(el);
  assert.equal('n' in f.snapshot(), false, 'a cleared number is no value');
});

test('slider: range bounds, a live output, and the two end labels', () => {
  const f = mount(askOf(
    [{ widget: 'slider', field: 's', label: 'Weight', unit: '%', minLabel: 'none', maxLabel: 'all' }],
    { s: { type: 'integer', minimum: 0, maximum: 100, default: 40 } },
  ));
  const r = f.el.querySelector('input[type="range"]');
  assert.equal(r.getAttribute('min'), '0');
  assert.equal(r.getAttribute('max'), '100');
  assert.equal(r.value, '40');
  assert.equal(f.el.querySelector('.af-slider-val').textContent, '40%');
  const ends = [...f.el.querySelectorAll('.af-slider-ends span')].map((n) => n.textContent);
  assert.deepEqual(ends, ['none', 'all']);
  r.value = '70'; input(r);
  assert.equal(f.snapshot().s, 70);
  assert.equal(f.el.querySelector('.af-slider-val').textContent, '70%');
});

test('toggle: a real checkbox in the house switch markup, boolean value', () => {
  const f = mount(askOf(
    [{ widget: 'toggle', field: 't', label: 'Ship it' }],
    { t: { type: 'boolean', default: false } },
  ));
  const box = f.el.querySelector('input[type="checkbox"]');
  assert.equal(box.className, 'sw-input', 'reuses the existing switch skin');
  assert.ok(f.el.querySelector('.switch'), 'the knob element is there');
  assert.equal(f.el.querySelector('.af-switch-txt').textContent, 'Ship it');
  box.checked = true; change(box);
  assert.equal(f.snapshot().t, true);
  box.checked = false; change(box);
  assert.equal(f.snapshot().t, false, 'false is a VALUE, not an absence');
});

test('a REQUIRED toggle or slider with no default answers with the state it shows', () => {
  // P1's auto mode (answer.mjs `candidate`) reads an untouched required boolean as
  // `false` and an untouched required number as its minimum. The switch reads "off"
  // and the slider sits at its minimum, so the web posts the same - never a
  // `required` error on a control whose visible state is a legal value.
  const f = mount(askOf(
    [{ widget: 'toggle', field: 't', label: 'Ship it' }, { widget: 'slider', field: 's', label: 'Weight' }],
    { t: { type: 'boolean' }, s: { type: 'integer', minimum: 10, maximum: 50 } },
    { required: ['t', 's'] },
  ));
  assert.deepEqual(f.snapshot(), { t: false, s: 10 });
  assert.deepEqual(f.progress(), { done: 2, total: 2 });
  assert.deepEqual(f.collect().errors, []);
  assert.equal(f.el.querySelector('input[type="checkbox"]').checked, false, 'and the switch still reads off');
  const opt = mount(askOf(
    [{ widget: 'toggle', field: 't', label: 'Opt' }, { widget: 'slider', field: 's', label: 'Opt' }],
    { t: { type: 'boolean' }, s: { type: 'integer', minimum: 0, maximum: 5 } },
  ));
  assert.deepEqual(opt.snapshot(), {}, 'an OPTIONAL untouched toggle/slider stays unanswered, as auto mode leaves it');
  const ro = mount(askOf([{ widget: 'toggle', field: 't', label: 'RO' }], { t: { type: 'boolean' } }, { required: ['t'] }),
    { readonly: true, values: {} });
  assert.deepEqual(ro.snapshot(), {}, 'readonly never invents a value');
});

test('date: type=date, the stored string, format kept verbatim', () => {
  const f = mount(askOf(
    [{ widget: 'date', field: 'd', label: 'When' }],
    { d: { type: 'string', format: 'date' } },
  ));
  const el = f.el.querySelector('input[type="date"]');
  el.value = '2026-09-21'; input(el);
  assert.equal(f.snapshot().d, '2026-09-21');
});

test('select cards: role=group labelled by the field label, aria-pressed, one winner', () => {
  const f = mount(askOf(
    [{ widget: 'select', field: 'v', label: 'Verdict', labels: { approve: 'Approve', changes: 'Request changes' } }],
    { v: { type: 'string', enum: ['approve', 'changes'] } },
    { required: ['v'] },
  ));
  const group = f.el.querySelector('.af-choices');
  assert.equal(group.getAttribute('role'), 'group');
  const labelId = f.el.querySelector('.af-label').id;
  assert.equal(group.getAttribute('aria-labelledby'), labelId);
  const btns = [...group.querySelectorAll('.af-choice')];
  assert.deepEqual(btns.map((b) => b.textContent.trim()), ['Approve', 'Request changes']);
  assert.deepEqual(btns.map((b) => b.getAttribute('aria-pressed')), ['false', 'false'],
    'nothing is preselected without a default — a review must not lean toward approve');
  click(btns[1]);
  assert.deepEqual(btns.map((b) => b.getAttribute('aria-pressed')), ['false', 'true']);
  assert.equal(f.snapshot().v, 'changes');
  click(btns[0]);
  assert.equal(f.snapshot().v, 'approve', 'the previous pick is released');
});

test('select: >6 options fall back to a dropdown; style wins over the count', () => {
  const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const drop = mount(askOf([{ widget: 'select', field: 'v', label: 'Pick' }], { v: { type: 'string', enum: many } }));
  const sel = drop.el.querySelector('select');
  assert.ok(sel, 'seven options render a dropdown');
  assert.ok(drop.el.querySelector('.select-wrap'), 'inside the house select chrome');
  assert.equal(sel.options.length, 8, 'a blank first option, then the seven');
  sel.value = 'd'; change(sel);
  assert.equal(drop.snapshot().v, 'd');

  const seg = mount(askOf([{ widget: 'select', field: 'v', label: 'Pick', style: 'segmented' }],
    { v: { type: 'string', enum: ['x', 'y'] } }));
  assert.ok(seg.el.querySelector('.seg'), 'style:segmented reuses the .seg skin');
  const on = seg.el.querySelectorAll('.seg button')[1];
  click(on);
  assert.equal(on.classList.contains('on'), true);
  assert.equal(seg.snapshot().v, 'y');
});

test('select with suggest: buttons plus free text, either one is the answer', () => {
  // X5 / P1 C14: `suggest` is a LAYOUT key of select. The schema is plain string,
  // so there is no enum and collectAnswer runs no enum check.
  const f = mount(askOf(
    [{ widget: 'select', field: 'q', label: 'Where?', suggest: ['Redis', 'Postgres'] }],
    { q: { type: 'string' } },
  ));
  const btns = [...f.el.querySelectorAll('.af-choice')];
  assert.equal(btns.length, 2);
  const free = f.el.querySelector('input[type="text"]');
  assert.ok(free, 'free text rides with the suggestions');
  click(btns[0]);
  assert.equal(f.snapshot().q, 'Redis');
  free.value = 'SQLite'; input(free);
  assert.equal(f.snapshot().q, 'SQLite');
  assert.deepEqual(btns.map((b) => b.getAttribute('aria-pressed')), ['false', 'false'],
    'typing releases the suggestion');
  assert.deepEqual(f.collect().errors, [], 'free text is not enum-checked — there is no enum');
});

test('every layout key the widgets read is in P1 LAYOUT_ITEM_KEYS (X6 / C15)', () => {
  // Gate 1 refuses an item key that is not in the table, so a widget that reads one
  // would work in a test and be dropped at load time. Walk the sources instead of
  // trusting a comment.
  // W3 runs this task BESIDE Tasks 5 and 6, so the display / layout modules may not
  // exist yet; scan whichever are on disk (Task 11's blast-radius run sees all three).
  const files = ['widgets-input.mjs', 'widgets-display.mjs', 'widgets-layout.mjs']
    .map((f) => [f, fileURLToPath(new URL(`../ui/public/ask/${f}`, import.meta.url))])
    .filter(([, p]) => existsSync(p));
  assert.ok(files.length >= 1, 'widgets-input.mjs is always there');
  const allowed = new Set(COMMON_ITEM_KEYS);
  for (const keys of Object.values(LAYOUT_ITEM_KEYS)) for (const k of keys) allowed.add(k);
  // Keys the ENGINE owns on a column/tab descriptor, never on a layout item.
  const notItemKeys = new Set(['key', 'align', 'mono', 'unit', 'format', 'tones', 'value',
    'description', 'from', 'id', 'verdict', 'note', 'children']);
  const offenders = [];
  for (const [f, p] of files) {
    const src = readFileSync(p, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
    for (const m of src.matchAll(/\bitem\.([A-Za-z_$][\w$]*)/g)) {
      const k = m[1];
      if (!allowed.has(k) && !notItemKeys.has(k)) offenders.push(`${f}: item.${k}`);
    }
  }
  assert.deepEqual([...new Set(offenders)], []);
});

test('select: options.from reads rows out of the ask data', () => {
  const f = mount(askOf(
    [{ widget: 'select', field: 'pick', label: 'Image',
      options: { from: 'data.images', value: 'id', label: 'caption', description: 'note' } }],
    { pick: { type: 'string', enum: ['a', 'b'] } },
    { data: { images: [{ id: 'a', caption: 'Option A', note: 'warm' }, { id: 'b', caption: 'Option B' }] } },
  ));
  const btns = [...f.el.querySelectorAll('.af-choice')];
  assert.deepEqual(btns.map((b) => b.querySelector('.af-choice-txt').firstChild.textContent),
    ['Option A', 'Option B']);
  assert.equal(btns[0].querySelector('.af-choice-desc').textContent, 'warm');
  click(btns[1]);
  assert.equal(f.snapshot().pick, 'b');
});

test('multiselect: role=checkbox entries, aria-checked, an array answer', () => {
  const f = mount(askOf(
    [{ widget: 'multiselect', field: 'm', label: 'Tags' }],
    { m: { type: 'array', minItems: 1, items: { type: 'string', enum: ['x', 'y', 'z'] } } },
    { required: ['m'] },
  ));
  const btns = [...f.el.querySelectorAll('.af-choice')];
  assert.deepEqual(btns.map((b) => b.getAttribute('role')), ['checkbox', 'checkbox', 'checkbox']);
  click(btns[0]); click(btns[2]);
  assert.deepEqual(f.snapshot().m, ['x', 'z']);
  assert.equal(btns[0].getAttribute('aria-checked'), 'true');
  click(btns[0]);
  assert.deepEqual(f.snapshot().m, ['z']);
  assert.deepEqual(f.collect().errors, [], 'one pick satisfies minItems');
});

test('readonly disables every input widget', () => {
  const f = mount(askOf(
    [{ widget: 'select', field: 'v', label: 'V' }, { widget: 'toggle', field: 't', label: 'T' },
      { widget: 'slider', field: 's', label: 'S' }],
    { v: { type: 'string', enum: ['a', 'b'] }, t: { type: 'boolean' },
      s: { type: 'integer', minimum: 0, maximum: 5 } },
  ), { readonly: true, values: { v: 'b', t: true, s: 3 } });
  for (const n of f.el.querySelectorAll('button, input, select')) assert.equal(n.disabled, true);
  assert.equal(f.el.querySelectorAll('.af-choice[aria-pressed="true"]').length, 1,
    'the stored choice is still shown as picked');
});

// --------------------------------------------------------------- data widgets

const ROWS = {
  items: [
    { id: 'a', title: 'Alpha', meta: '2 files', note: 'first' },
    { id: 'b', title: 'Beta', meta: '1 file' },
    { id: 'c', title: 'Gamma', meta: '9 files' },
  ],
};

test('rank: seeded to the data order, arrow buttons move a row, answer is the id order', () => {
  const f = mount(askOf(
    [{ widget: 'rank', field: 'order', label: 'Priority', bind: 'data.items', titleKey: 'title', metaKey: 'meta' }],
    { order: { type: 'array', items: { type: 'string' } } },
    { data: ROWS, required: ['order'] },
  ));
  assert.deepEqual(f.snapshot().order, ['a', 'b', 'c'], 'the data order IS the default answer');
  const li = () => [...f.el.querySelectorAll('.af-rank li')];
  assert.deepEqual(li().map((n) => n.querySelector('.af-rank-n').textContent), ['1', '2', '3']);
  const down = li()[0].querySelector('.af-rank-dn');
  assert.equal(down.getAttribute('aria-label'), 'Move Alpha down');
  assert.equal(li()[0].querySelector('.af-rank-up').disabled, true, 'the first row cannot move up');
  click(down);
  assert.deepEqual(f.snapshot().order, ['b', 'a', 'c']);
  assert.deepEqual(li().map((n) => n.querySelector('b').textContent), ['Beta', 'Alpha', 'Gamma']);
  assert.equal(li()[0].dataset.afDrag, 'rank', 'rows are marked for the busy sweep');
  const up = li()[2].querySelector('.af-rank-up');
  click(up);
  assert.deepEqual(f.snapshot().order, ['b', 'c', 'a']);
});

test('table-select: a radio column for a string answer, checkboxes for an array', () => {
  const cols = [{ key: 'title', label: 'Name' }, { key: 'meta', label: 'Size', align: 'right' }];
  const one = mount(askOf(
    [{ widget: 'table-select', field: 'pick', label: 'Row', bind: 'data.items', columns: cols }],
    { pick: { type: 'string' } }, { data: ROWS },
  ));
  const radios = [...one.el.querySelectorAll('input[type="radio"]')];
  assert.equal(radios.length, 3);
  assert.deepEqual([...one.el.querySelectorAll('.af-tbl th')].map((t) => t.textContent), ['', 'Name', 'Size']);
  click(one.el.querySelectorAll('.af-pick')[1]);
  assert.equal(one.snapshot().pick, 'b');
  assert.equal(one.el.querySelectorAll('.af-pick')[1].getAttribute('aria-selected'), 'true');

  const many = mount(askOf(
    [{ widget: 'table-select', field: 'picks', label: 'Rows', bind: 'data.items', columns: cols }],
    { picks: { type: 'array', items: { type: 'string' } } }, { data: ROWS },
  ));
  assert.equal(many.el.querySelectorAll('input[type="checkbox"]').length, 3);
  click(many.el.querySelectorAll('.af-pick')[0]);
  click(many.el.querySelectorAll('.af-pick')[2]);
  assert.deepEqual(many.snapshot().picks, ['a', 'c']);
});

test('review-list: every row starts at the default verdict; a non-default reveals the note', () => {
  const f = mount(askOf(
    [{ widget: 'review-list', field: 'reviews', label: 'Findings', bind: 'data.items',
      titleKey: 'title', bodyKey: 'note', metaKey: 'meta', labels: { ok: 'Keep', fix: 'Fix' },
      notePlaceholder: 'What should change?' }],
    { reviews: { type: 'array', items: { type: 'object', required: ['id', 'verdict'], properties: {
      id: { type: 'string' },
      verdict: { type: 'string', enum: ['ok', 'fix'], default: 'ok' },
      note: { type: 'string' } } } } },
    { data: ROWS, required: ['reviews'] },
  ));
  assert.deepEqual(f.snapshot().reviews, [
    { id: 'a', verdict: 'ok' }, { id: 'b', verdict: 'ok' }, { id: 'c', verdict: 'ok' },
  ]);
  const cards = [...f.el.querySelectorAll('.af-rv-item')];
  assert.equal(cards[0].querySelector('.af-rv-title').textContent, 'Alpha');
  assert.equal(cards[0].querySelector('.af-rv-body').textContent, 'first');
  const note = cards[1].querySelector('.af-rv-note');
  assert.equal(note.hidden, true, 'the note is hidden at the default verdict');
  click(cards[1].querySelectorAll('.seg button')[1]);
  assert.equal(note.hidden, false);
  note.value = 'rename it'; input(note);
  assert.deepEqual(f.snapshot().reviews[1], { id: 'b', verdict: 'fix', note: 'rename it' });
  click(cards[1].querySelectorAll('.seg button')[0]);
  assert.deepEqual(f.snapshot().reviews[1], { id: 'b', verdict: 'ok' }, 'back to default drops the note');
});

test('gallery with a field is a picker: <img> per row, aria-pressed, one winner', () => {
  const ask = askOf(
    [{ widget: 'gallery', field: 'picked', label: 'Mockups', bind: 'data.images',
      captionKey: 'caption', fileKey: 'file' }],
    { picked: { type: 'string' } },
    { data: { images: [
      { id: 'a', caption: 'Option A', file: 'mockups/a.png' },
      { id: 'b', caption: 'Option B', file: 'mockups/b.svg' },
    ] } },
  );
  ask.fileRefs = [
    { path: 'data.images[0].file', rel: 'mockups/a.png' },
    { path: 'data.images[1].file', rel: 'mockups/b.svg' },
  ];
  ask.files = [
    { index: 0, rel: 'mockups/a.png', name: 'a.png', mime: 'image/png', bytes: 2048, sha256: 'x' },
    { index: 1, rel: 'mockups/b.svg', name: 'b.svg', mime: 'image/svg+xml', bytes: 1024, sha256: 'y' },
  ];
  const f = mount(ask, { fileUrl: (i) => `/api/runs/r1/ask-files/${ask.askId}/${i}` });
  const cards = [...f.el.querySelectorAll('.af-gal-card')];
  assert.equal(cards.length, 2);
  const imgs = [...f.el.querySelectorAll('.af-gal-card img')];
  assert.deepEqual(imgs.map((i) => i.getAttribute('src')),
    ['/api/runs/r1/ask-files/q_1/0', '/api/runs/r1/ask-files/q_1/1']);
  assert.equal(imgs[0].getAttribute('alt'), 'Option A');
  assert.equal(imgs[1].tagName, 'IMG', 'an SVG file is an <img>, never inline markup');
  assert.match(f.el.querySelector('.af-gal-sub').textContent, /2 KB/);
  click(cards[1]);
  assert.equal(f.snapshot().picked, 'b');
  assert.equal(cards[1].getAttribute('aria-pressed'), 'true');
  assert.equal(cards[0].getAttribute('aria-pressed'), 'false');
});
