// test/design-system-forms-redesign.test.mjs — the forms redesign's library parts (docs/stillhet/forms.md): PickField,
// FieldPair, FormGrid, FieldFold, FormReadback, a Checkbox with its line of help, a ChoiceNote at body size and a
// ConfirmStrip whose working button is the busy Button. Pure markup: no browser needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { field, pickField, fieldPair, formGrid, fieldFold, formReadback, fieldValue } from '../ui/public/design-system/components/field.mjs';
import { checkbox } from '../ui/public/design-system/components/checkbox.mjs';
import { choiceNote } from '../ui/public/design-system/components/choice-note.mjs';
import { confirmActions, confirmStrip } from '../ui/public/design-system/components/confirm-strip.mjs';

const items = [{ id: 'main', text: 'main (the project\'s default branch)', checked: true }, { id: 'dev', text: 'dev' }];

test('PickField: a label over a field-shaped button that names itself and reports its picks as a SentencePicker does', () => {
  const closed = pickField({ id: 'f-base', label: 'Source branch', text: 'main (the project\'s default branch)', items });
  assert.match(closed, /<span class="fld-l"[^>]*>Source branch<\/span>/);
  assert.match(closed, /class="pd-base is-words is-field fld-pick-b"/, 'the same look as FilterRow\'s labelled picker');
  assert.match(closed, /data-menu="f-base"/);
  assert.match(closed, /aria-expanded="false"/);
  assert.match(closed, /aria-label="Source branch: main \(the project&#39;s default branch\)"|aria-label="Source branch: main \(the project's default branch\)"/);
  assert.doesNotMatch(closed, /role="menu"/, 'closed: no menu in the page');
  const open = pickField({ id: 'f-base', label: 'Source branch', text: 'main', items, open: true });
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /data-menu-pick="f-base\|dev"/);
  assert.match(open, /data-menu-pick="f-base\|main"/);
});

test('PickField: its value sits in a span that cuts short, so a longer choice never widens the field', () => {
  const html = pickField({ id: 'f-w', label: 'Workflow', text: 'A very long workflow name that would not fit', items: [] });
  assert.match(html, /<span class="fld-pick-t">A very long workflow name that would not fit<\/span>/);
  const css = readFileSync('ui/public/stillhet/centers/forms.css', 'utf8');
  assert.match(css, /\.fld-pick-t\{[^}]*text-overflow:ellipsis/);
  assert.match(css, /\.fld-pick \.pd-base\.is-words\.is-field\.fld-pick-b\{[^}]*width:100%/);
});

test('PickField: disabled says why and opens nothing; a hint or an error is its one line', () => {
  const off = pickField({ id: 'p', label: 'Project', text: 'billing-api', items, open: true, disabled: true, tip: 'A schedule stays in its project' });
  assert.match(off, /disabled/);
  assert.match(off, /title="A schedule stays in its project"/);
  assert.doesNotMatch(off, /data-menu-pick/);
  assert.match(pickField({ id: 'p', label: 'P', text: 'x', hint: 'One line of help' }), /<span class="fld-hint" id="p-note">One line of help<\/span>/);
  const err = pickField({ id: 'p', label: 'P', text: 'x', hint: 'help', error: 'Pick one' });
  assert.match(err, /role="alert">Pick one</);
  assert.doesNotMatch(err, /fld-hint/);
});

test('FieldPair: one label over two fields that keep their own names for a screen reader', () => {
  const html = fieldPair({ label: 'Engine and model', wider: 'second', fields: [pickField({ id: 'a', label: 'Engine', text: 'Claude', quietLabel: true }), pickField({ id: 'b', label: 'Model', text: 'The workflow\'s own', quietLabel: true })] });
  assert.equal((html.match(/class="fld-l"/g) || []).length, 1, 'one visible label');
  assert.match(html, /role="group" aria-label="Engine and model"/);
  assert.match(html, /aria-label="Engine: Claude"/);
  assert.match(html, /aria-label="Model: The workflow/);
  assert.match(html, /fld-pair is-second/);
});

test('FormGrid: every field has a cell, a wide one takes the row, an empty string keeps no cell', () => {
  const html = formGrid({ fields: ['<i>a</i>', { html: '<i>b</i>', wide: true }, '', '<span></span>'] });
  assert.equal((html.match(/class="fld-cell/g) || []).length, 3);
  assert.match(html, /<div class="fld-cell is-wide"><i>b<\/i><\/div>/);
  const css = readFileSync('ui/public/stillhet/centers/forms.css', 'utf8');
  assert.match(css, /@media \(max-width: 560px\)\{[\s\S]*\.fld-grid,\.cc-opts\{grid-template-columns:minmax\(0,1fr\)/, 'the fields stack on a narrow screen');
});

test('FieldFold: closed it is one button that says what is inside; open it holds its fields in place', () => {
  const closed = fieldFold({ label: 'More options', says: 'Title, branch', body: '<i>x</i>', attrs: { 'data-c-more': '' } });
  assert.match(closed, /aria-expanded="false"/);
  assert.match(closed, /Title, branch/);
  assert.doesNotMatch(closed, /<i>x<\/i>/);
  const open = fieldFold({ label: 'More options', says: 'Title, branch', body: '<i>x</i>', open: true });
  assert.match(open, /class="fld-fold is-open"/);
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /<div class="fld-fold-body"><i>x<\/i><\/div>/);
  assert.doesNotMatch(open, /Title, branch/);
});

test('FormReadback: one supporting line, never a control; nothing when there is nothing to say', () => {
  assert.equal(formReadback(''), '');
  const html = formReadback('Starts now on billing-api, then opens a PR.');
  assert.match(html, /^<p class="fld-read" role="status">Starts now on billing-api, then opens a PR\.<\/p>$/);
  assert.doesNotMatch(html, /<button|<a /);
});

test('Field: a date and a time are the browser\'s own pickers, so any time can be given', () => {
  assert.match(field({ id: 't', label: 'At', type: 'time', value: '07:45' }), /type="time" value="07:45"/);
  assert.match(field({ id: 'd', label: 'Date', type: 'date', value: '2026-11-17' }), /type="date" value="2026-11-17"/);
});

test('the new parts are reachable from page code through Field until the index exports them', () => {
  assert.equal(field.pick, pickField); assert.equal(field.pair, fieldPair); assert.equal(field.grid, formGrid);
  assert.equal(field.fold, fieldFold); assert.equal(field.readback, formReadback); assert.equal(field.value, fieldValue);
});

test('Checkbox: with help, its label and one line of help are two spans beside the box', () => {
  const html = checkbox({ label: 'Run without memory', help: 'It reads no project or team memory and writes none', checked: true, attrs: { 'data-c-opt': 'noMemory' } });
  assert.match(html, /class="pd-check has-help"/);
  assert.match(html, /<input type="checkbox"[^>]*data-c-opt="noMemory"[^>]*checked/);
  assert.match(html, /<span class="pd-check-l">Run without memory<\/span><span class="pd-check-h">It reads no project or team memory and writes none<\/span>/);
  assert.doesNotMatch(checkbox({ label: 'Plain' }), /has-help/);
});

test('ChoiceNote (lessons 9): its text takes the body role, never the status zone\'s headline word', () => {
  const html = choiceNote({ needsYou: false, text: 'team policy · 1 note', rows: [{ text: 'a row' }] });
  assert.match(html, /<span class="rc-main choice-note-t">team policy · 1 note<\/span>/);
  assert.doesNotMatch(html, /rc-word/);
  const css = readFileSync('ui/public/stillhet/centers/forms.css', 'utf8');
  const rule = /\.choice-note-t\{([^}]*)\}/.exec(css)?.[1] || '';
  assert.match(rule, /var\(--fs-body\)/, 'body size');
  assert.match(rule, /white-space:normal/, 'it wraps');
});

test('ConfirmStrip: while its step is out the button is the busy Button with the present-tense words', () => {
  const acts = confirmActions({ yes: 'Merging…', busy: true });
  assert.match(acts, /stillhet-busy/);
  assert.match(acts, /aria-busy="true"/);
  assert.match(acts, /data-confirm="yes"/);
  assert.match(acts, /Merging…/);
  const rest = confirmStrip({ text: 'Merge #959 into dev?', yes: 'Merge PR' });
  assert.doesNotMatch(rest, /stillhet-busy/);
  assert.match(confirmStrip({ text: 'Merge #959 into dev?', yes: 'Merge PR', busy: 'Merging…' }), /stillhet-busy/);
});

test('FieldValue: a fact on an inspect view is a label over its value, with nothing to press', () => {
  const html = fieldValue({ label: 'Repeats', value: 'Every <weekday>', hint: 'In Europe/Sofia' });
  assert.match(html, /<span class="fld-l">Repeats<\/span><span class="fld-v">Every &lt;weekday&gt;<\/span>/);
  assert.match(html, /<span class="fld-hint">In Europe\/Sofia<\/span>/);
  assert.doesNotMatch(html, /<button|<input|<textarea|data-menu/);
});
