// test/ui-code-editor.test.mjs — the shared code editor (scripts-workbench §W16, C11).
// Pure jsdom: the module imports nothing, so no /vendor route and no hljs are involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCodeEditor, escapeHtml, HIGHLIGHT_DEBOUNCE_MS, TAB_SPACES } from '../ui/public/code-editor.mjs';

const dom = new JSDOM('<!doctype html><body></body>');
const doc = dom.window.document;
const win = dom.window;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tick = () => new Promise((r) => setTimeout(r, 0));
const parts = (ed) => ({
  pre: ed.el.querySelector('pre.code-editor-hl'),
  code: ed.el.querySelector('pre.code-editor-hl > code'),
  ta: ed.el.querySelector('textarea.code-editor-ta'),
});
const key = (ta, { shift = false } = {}) => ta.dispatchEvent(
  new win.KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true }),
);

test('escapeHtml covers the five metacharacters', () => {
  assert.equal(escapeHtml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(TAB_SPACES, '  ');
  assert.equal(HIGHLIGHT_DEBOUNCE_MS, 60);
});

test('the structure: a textarea over an aria-hidden highlighted pre, named for the host form', async () => {
  const ed = createCodeEditor({ doc, value: 'const a = 1;\n', language: 'javascript', rows: 6, name: 'param:source' });
  const { pre, code, ta } = parts(ed);
  assert.ok(ed.el.classList.contains('code-editor'));
  assert.equal(ed.el.dataset.language, 'javascript');
  assert.equal(pre.getAttribute('aria-hidden'), 'true');
  assert.ok(code, 'the pre holds a <code>');
  assert.equal(ta.rows, 6);
  assert.equal(ta.spellcheck, false);
  assert.equal(ta.dataset.field, 'param:source');
  assert.ok(ta.classList.contains('mono'));
  assert.equal(ed.getValue(), 'const a = 1;\n');
  assert.equal(ta.readOnly, false);
  await tick();
  assert.equal(code.innerHTML, 'const a = 1;\n\n', 'the default highlighter escapes, plus the trailing row newline');
  ed.destroy();
});

test('an unnamed editor carries no data-field (nothing routes to the composer)', () => {
  const ed = createCodeEditor({ doc, value: '' });
  assert.equal(parts(ed).ta.dataset.field, undefined);
  ed.destroy();
});

test('the DEFAULT highlighter escapes, so a script source can never inject markup', async () => {
  const ed = createCodeEditor({ doc, value: '<img src=x onerror=alert(1)>' });
  await tick();
  const { code } = parts(ed);
  assert.equal(code.querySelector('img'), null);
  assert.equal(code.textContent, '<img src=x onerror=alert(1)>\n');
  ed.destroy();
});

test('typing repaints on a 60 ms trailing debounce; the injected highlighter sees the language', async () => {
  const calls = [];
  const ed = createCodeEditor({
    doc, value: 'a', language: 'bash',
    highlight: async (text, lang) => { calls.push([text, lang]); return `<span class="hljs-string">${escapeHtml(text)}</span>`; },
  });
  await tick();
  assert.deepEqual(calls, [['a', 'bash']], 'one paint on construction');
  const { ta, code } = parts(ed);
  for (const v of ['ab', 'abc', 'abcd']) {
    ta.value = v;
    ta.dispatchEvent(new win.Event('input', { bubbles: true }));
  }
  assert.equal(calls.length, 1, 'nothing repaints while the keystrokes are still coming');
  await sleep(HIGHLIGHT_DEBOUNCE_MS * 4);
  assert.deepEqual(calls, [['a', 'bash'], ['abcd', 'bash']], 'three keystrokes collapse into ONE repaint');
  assert.equal(code.innerHTML, '<span class="hljs-string">abcd</span>\n');
  ed.destroy();
});

test('onInput fires on every keystroke (the dirty marker cannot wait for the debounce)', async () => {
  const seen = [];
  const ed = createCodeEditor({ doc, value: '', onInput: (v) => seen.push(v) });
  const { ta } = parts(ed);
  for (const v of ['x', 'xy']) { ta.value = v; ta.dispatchEvent(new win.Event('input', { bubbles: true })); }
  assert.deepEqual(seen, ['x', 'xy']);
  ed.destroy();
});

test('a stale highlight result is dropped: the newest text always wins', async () => {
  const gates = [];
  const ed = createCodeEditor({
    doc, value: 'v0',
    highlight: (text) => new Promise((resolve) => gates.push(() => resolve(`<i>${escapeHtml(text)}</i>`))),
  });
  ed.setValue('v1');
  ed.setValue('v2');
  assert.equal(gates.length, 3, 'construction + two setValue paints');
  gates[2]();              // newest resolves first
  await tick();
  gates[1](); gates[0]();  // the two older ones land afterwards
  await tick();
  assert.equal(parts(ed).code.innerHTML, '<i>v2</i>\n');
  ed.destroy();
});

test('a highlighter that throws, or answers with a non-string, degrades to escaped text', async () => {
  const bad = createCodeEditor({ doc, value: '<b>', highlight: async () => { throw new Error('no grammar'); } });
  await tick();
  assert.equal(parts(bad).code.innerHTML, '&lt;b&gt;\n');
  bad.destroy();
  const weird = createCodeEditor({ doc, value: '<b>', highlight: async () => ({ nope: true }) });
  await tick();
  assert.equal(parts(weird).code.innerHTML, '&lt;b&gt;\n');
  weird.destroy();
});

test('Tab inserts two spaces at the caret and fires input', () => {
  const ed = createCodeEditor({ doc, value: 'ab' });
  const { ta } = parts(ed);
  let inputs = 0;
  ta.addEventListener('input', () => { inputs += 1; });
  ta.selectionStart = ta.selectionEnd = 1;
  const handled = !key(ta);
  assert.equal(handled, true, 'the default (moving focus) is prevented');
  assert.equal(ed.getValue(), 'a  b');
  assert.equal(ta.selectionStart, 3);
  assert.equal(ta.selectionEnd, 3);
  assert.equal(inputs, 1, 'a synthetic input event, so the host sees the edit');
  ed.destroy();
});

test('Tab over a multi-line selection indents every touched line; Shift+Tab outdents', () => {
  const ed = createCodeEditor({ doc, value: 'one\ntwo\nthree' });
  const { ta } = parts(ed);
  ta.selectionStart = 1;              // inside "one"
  ta.selectionEnd = 5;                // inside "two"
  key(ta);
  assert.equal(ed.getValue(), '  one\n  two\nthree');
  assert.equal(ta.selectionStart, 3, 'the caret keeps its column');
  assert.equal(ta.selectionEnd, 9);
  key(ta, { shift: true });
  assert.equal(ed.getValue(), 'one\ntwo\nthree');
  key(ta, { shift: true });
  assert.equal(ed.getValue(), 'one\ntwo\nthree', 'outdenting an unindented block is a no-op');
  ed.destroy();
});

test('Shift+Tab on one line removes up to two leading spaces', () => {
  const ed = createCodeEditor({ doc, value: 'x\n   y' });
  const { ta } = parts(ed);
  ta.selectionStart = ta.selectionEnd = 5;
  key(ta, { shift: true });
  assert.equal(ed.getValue(), 'x\n y');
  key(ta, { shift: true });
  assert.equal(ed.getValue(), 'x\ny');
  ed.destroy();
});

test('Escape then Tab leaves the editor: the accessible control is not a keyboard trap', () => {
  const ed = createCodeEditor({ doc, value: 'a' });
  const { ta } = parts(ed);
  ta.selectionStart = ta.selectionEnd = 1;
  const esc = () => ta.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  esc();
  assert.equal(key(ta), true, 'the Tab after Escape is NOT prevented — focus moves on');
  assert.equal(ed.getValue(), 'a', 'and it indents nothing');
  assert.equal(key(ta), false, 'the release is one-shot: the next Tab indents again');
  assert.equal(ed.getValue(), 'a  ');
  esc();
  assert.equal(key(ta, { shift: true }), true, 'Shift+Tab is released too, or focus could only go forwards');
  // Leaving the field cancels the arm: a Tab after clicking away and back indents.
  esc();
  ta.dispatchEvent(new win.Event('blur'));
  ta.selectionStart = ta.selectionEnd = 0;
  assert.equal(key(ta), false, 'blur disarms Escape');
  ed.destroy();
});

test('read-only: the textarea is locked, Tab moves focus on, and setReadOnly flips both', () => {
  const ed = createCodeEditor({ doc, value: 'a', readOnly: true });
  const { ta } = parts(ed);
  assert.equal(ta.readOnly, true);
  assert.equal(ed.el.classList.contains('ro'), true);
  ta.selectionStart = ta.selectionEnd = 0;
  assert.equal(key(ta), true, 'the Tab default is NOT prevented while read-only');
  assert.equal(ed.getValue(), 'a');
  ed.setReadOnly(false);
  assert.equal(ta.readOnly, false);
  assert.equal(ed.el.classList.contains('ro'), false);
  ed.destroy();
});

test('setValue / setLanguage repaint at once; the scroll is mirrored onto the pre', async () => {
  const ed = createCodeEditor({ doc, value: 'a', language: 'javascript', highlight: async (t, l) => `<u data-l="${l}">${escapeHtml(t)}</u>` });
  const { pre, code, ta } = parts(ed);
  ed.setValue('b & c');
  await tick();
  assert.equal(code.innerHTML, '<u data-l="javascript">b &amp; c</u>\n');
  ed.setLanguage('python');
  await tick();
  assert.equal(ed.el.dataset.language, 'python');
  assert.equal(code.innerHTML, '<u data-l="python">b &amp; c</u>\n');
  ta.scrollTop = 42; ta.scrollLeft = 7;
  ta.dispatchEvent(new win.Event('scroll', { bubbles: false }));
  assert.equal(pre.scrollTop, 42);
  assert.equal(pre.scrollLeft, 7);
  ed.destroy();
});

test('destroy: no more repaints, and a late highlight resolution touches nothing', async () => {
  const gates = [];
  const ed = createCodeEditor({ doc, value: 'a', highlight: (t) => new Promise((r) => gates.push(() => r(`<i>${escapeHtml(t)}</i>`))) });
  const { ta, code } = parts(ed);
  const before = code.innerHTML;
  ed.destroy();
  gates[0]();
  await tick();
  assert.equal(code.innerHTML, before, 'the resolution after destroy() is ignored');
  ta.value = 'z';
  ta.dispatchEvent(new win.Event('input', { bubbles: true }));
  await sleep(HIGHLIGHT_DEBOUNCE_MS * 3);
  assert.equal(gates.length, 1, 'the input listener is gone');
});
