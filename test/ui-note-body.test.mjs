// test/ui-note-body.test.mjs — the Planner's note in a card (ui/public/shape/note-body.mjs): text nodes only, divided
// list rows with a middle-cut lone name, and a fold that opens in place and survives a repaint.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildNoteBody, noteOpenKeys } from '../ui/public/shape/note-body.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';
import { cssRules } from './helpers/css-rules.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
beforeEach(() => noteOpenKeys().clear());

const P = (c) => c.repeat(270);   // three estimated lines
const LONG = `${P('a')}\n\n${P('b')}\n\n- one\n- two\n- three\n- four\n- five\n- six\n\nAfter the list.`;
const all = (el, s) => [...el.querySelectorAll(s)];
const visible = (el, s) => all(el, s).filter((n) => !n.closest('[hidden]'));

test('an empty or non-string note draws nothing', () => {
  assert.equal(buildNoteBody(doc, ''), null);
  assert.equal(buildNoteBody(doc, undefined), null);
  assert.equal(buildNoteBody(doc, 'Only a title', { dropTitle: true }), null);
});

test('paints p, code and divided rows; an ordered list keeps its markers', () => {
  const { el, toggle } = buildNoteBody(doc, 'Add `a.mjs` now.\n\n- first row\n\n1. one thing\n2) `b.mjs`');
  assert.equal(el.className, 'note-body');
  assert.ok(el.id);
  assert.equal(el.querySelector(':scope > p.note-p').textContent, 'Add a.mjs now.');
  assert.equal(el.querySelector('p.note-p code').textContent, 'a.mjs');
  assert.deepEqual(all(el, ':scope > ul.note-rows > li.note-row').map((li) => li.textContent), ['first row']);
  assert.deepEqual(all(el, ':scope > ol.note-rows > li.note-row > .note-n').map((n) => n.textContent), ['1.', '2)']);
  assert.equal(toggle.textContent, 'Show the full note', 'the second list is past the first one reached');
  assert.equal(el.querySelector('ol').hidden, true);
});

test('raw HTML in the note is text: no element is created', () => {
  const { el } = buildNoteBody(doc, '<img src=x onerror=alert(1)> and `<b>x</b>`\n\n- <script>a()</script> here\n- <i>');
  assert.equal(el.querySelector('img, b, script, i'), null);
  assert.match(el.querySelector('p').textContent, /^<img src=x onerror=alert\(1\)> and <b>x<\/b>$/);
  assert.equal(el.querySelector('li .note-mid').title, '<i>');
});

test('the module never assigns innerHTML', () => {
  const src = readFileSync(new URL('../ui/public/shape/note-body.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|outerHTML/);
});

test('a lone name row: head/tail split with the full value in title; a sentence row is plain', () => {
  const name = 'src/core/shape/a-very-long-module-name-for-the-run.mjs';
  const { el } = buildNoteBody(doc, `- \`${name}\`\n- \`a.mjs\` — why it matters\n- x\n- abcde`);
  const [lone, sentence, one, odd] = all(el, 'li.note-row');
  const mid = lone.querySelector('span.note-mid');
  assert.equal(mid.title, name);
  assert.equal(mid.querySelector('.note-mid-head').textContent, name.slice(0, -16));
  assert.equal(mid.querySelector('.note-mid-tail').textContent, name.slice(-16));
  assert.equal(mid.textContent, name);
  assert.equal(sentence.querySelector('.note-mid'), null);
  assert.equal(sentence.querySelector('code').textContent, 'a.mjs');
  assert.equal(sentence.textContent, 'a.mjs — why it matters');
  assert.equal(one.querySelector('.note-mid-head').textContent, 'x', 'a one-character name keeps it in the head');
  assert.equal(one.querySelector('.note-mid-tail').textContent, '');
  assert.deepEqual([odd.querySelector('.note-mid-head').textContent, odd.querySelector('.note-mid-tail').textContent], ['abc', 'de']);
});

test('folded: the past-fold parts are hidden, four rows and "+2 more" show, the cut paragraph is clamped', () => {
  const { el } = buildNoteBody(doc, LONG);
  assert.deepEqual(visible(el, 'li.note-row').map((li) => li.textContent), ['one', 'two', 'three', 'four', '+2 more']);
  assert.equal(el.querySelector('li.note-row.note-more').textContent, '+2 more');
  assert.deepEqual(visible(el, 'p.note-p').map((p) => p.textContent), [P('a'), P('b')]);
  const long = buildNoteBody(doc, `${'c'.repeat(720)}\n\nNext.`).el;
  const [first, next] = all(long, 'p.note-p');
  assert.ok(first.classList.contains('is-clamped'));
  assert.equal(first.style.getPropertyValue('--note-clamp'), '6');
  assert.equal(next.hidden, true);
  const listLast = buildNoteBody(doc, `${P('a')}\n\n${P('b')}\n\n${P('c')}\n\n- a\n- b`).el;
  assert.equal(listLast.querySelectorAll('p.note-p')[2].hidden, true);
  assert.equal(listLast.querySelector('.note-rows').hidden, true, 'a list past the stop is hidden whole');
});

test('the toggle opens and closes; its label and aria-expanded follow; nothing is rebuilt', () => {
  const clicks = [];
  const host = doc.createElement('div');
  host.addEventListener('click', () => clicks.push(1));
  const { el, toggle } = buildNoteBody(doc, `${LONG}\n\n${'d'.repeat(10)}`);
  host.appendChild(el);
  assert.equal(el.lastElementChild, toggle);
  assert.deepEqual([toggle.type, toggle.className], ['button', 'btn btn-sm btn-quiet note-toggle']);
  assert.equal(toggle.getAttribute('aria-controls'), el.id);
  assert.deepEqual([toggle.textContent, toggle.getAttribute('aria-expanded')], ['Show the full note', 'false']);
  const rows = all(el, 'li.note-row');
  toggle.click();
  assert.deepEqual([toggle.textContent, toggle.getAttribute('aria-expanded')], ['Show less', 'true']);
  assert.deepEqual(visible(el, 'li.note-row').map((li) => li.textContent), ['one', 'two', 'three', 'four', 'five', 'six']);
  assert.equal(visible(el, 'p.note-p').length, 4);
  assert.equal(el.querySelector('.is-clamped'), null);
  assert.deepEqual(all(el, 'li.note-row'), rows);
  toggle.click();
  assert.deepEqual([toggle.textContent, toggle.getAttribute('aria-expanded')], ['Show the full note', 'false']);
  assert.deepEqual(visible(el, 'li.note-row').map((li) => li.textContent), ['one', 'two', 'three', 'four', '+2 more']);
  assert.deepEqual(clicks, [], 'a click stays in the note: no host delegate sees it');
  const clamped = buildNoteBody(doc, 'c'.repeat(720));
  clamped.toggle.click();
  assert.equal(clamped.el.querySelector('p').classList.contains('is-clamped'), false);
  assert.equal(clamped.el.querySelector('p').style.getPropertyValue('--note-clamp'), '');
  clamped.toggle.click();
  assert.equal(clamped.el.querySelector('p').style.getPropertyValue('--note-clamp'), '6');
});

test('a note that fits has no toggle', () => {
  const { el, toggle } = buildNoteBody(doc, 'Short.\n\n- a\n- b');
  assert.equal(toggle, null);
  assert.equal(el.querySelector('.note-toggle, .note-more, [hidden], .is-clamped'), null);
});

test('same key → built open after a toggle; closing forgets it; no key remembers nothing', () => {
  buildNoteBody(doc, LONG, { key: 'stop:a' }).toggle.click();
  const again = buildNoteBody(doc, LONG, { key: 'stop:a' });
  assert.equal(again.toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(visible(again.el, '.note-more').length, 0);
  assert.equal(buildNoteBody(doc, LONG, { key: 'stop:b' }).toggle.getAttribute('aria-expanded'), 'false');
  again.toggle.click();
  assert.equal(buildNoteBody(doc, LONG, { key: 'stop:a' }).toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(noteOpenKeys().size, 0);
  buildNoteBody(doc, LONG).toggle.click();
  assert.equal(noteOpenKeys().size, 0);
  assert.equal(buildNoteBody(doc, LONG).toggle.getAttribute('aria-expanded'), 'false');
});

test('CSS: the note is normal --ink-2 text, never an inner scrollbar, tokens only', () => {
  const rules = cssRules(readStyleCss().replace(/\/\*[\s\S]*?\*\//g, '')).filter((r) => /\.note-(?:body|p|rows|row|n|mid|mid-head|mid-tail|more|toggle|text)(?![\w-])/.test(r.sel));
  const body = (sel) => (rules.find((r) => r.sel === sel) || {}).body || '';
  assert.match(body('.note-body'), /font-weight:400;/);
  assert.match(body('.note-body'), /font-size:var\(--fs-body\);/);
  assert.match(body('.note-body'), /color:var\(--ink-2\);/);
  assert.match(body('.chat-q .qblock > .note-body'), /grid-column:1 \/ -1;margin:0 0 10px;/);
  // A wide card puts the question beside its options: with a note the block is one column, so the options sit under it.
  assert.match(body('.chat-q .qblock:has(> .note-body)'), /grid-template-columns:minmax\(0,1fr\);grid-template-rows:none;/);
  assert.match(body('.chat-q.chat-rc-q .qblock:has(> .note-body) > :is(.qtext,.qopts)'), /grid-column:1;grid-row:auto;/);
  assert.match(body('.note-body .is-clamped'), /-webkit-line-clamp:var\(--note-clamp\);/);
  assert.match(body('.note-mid-head'), /text-overflow:ellipsis;/);
  assert.match(body('.note-mid-tail'), /flex:none;/);
  for (const r of rules) {
    assert.doesNotMatch(r.body, /max-height|overflow(?:-[xy])?:(?:auto|scroll)/, r.sel);
    assert.doesNotMatch(r.body, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, r.sel);
  }
});
