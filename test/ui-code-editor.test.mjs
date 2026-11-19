// test/ui-code-editor.test.mjs — the shared code editor (scripts-workbench §W16, C11).
// Pure jsdom: the module imports only the icon set, so no /vendor route and no hljs are involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import { JSDOM } from 'jsdom';
import {
  createCodeEditor, escapeHtml, HIGHLIGHT_DEBOUNCE_MS, LINT_DEBOUNCE_MS, LARGE_EDITOR_ROWS, MIN_EDITOR_PX, GRIP_STEP_PX, nextEditorHeight,
} from '../ui/public/code-editor.mjs';

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

test('escapeHtml covers the five metacharacters and the DEFAULT highlighter escapes, so a source can never inject markup', async () => {
  await checkRows([
    { name: 'escapeHtml covers the five metacharacters', run: () => {
      assert.equal(escapeHtml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
      assert.equal(escapeHtml(null), '');
    } },
    { name: 'the DEFAULT highlighter escapes, so a script source can never inject markup', run: async () => {
      const ed = createCodeEditor({ doc, value: '<img src=x onerror=alert(1)>' });
      await tick();
      const { code } = parts(ed);
      assert.equal(code.querySelector('img'), null);
      assert.equal(code.textContent, '<img src=x onerror=alert(1)>\n');
      ed.destroy();
    } },
  ]);
});

test('structure: textarea over an aria-hidden pre, data-field only when named', async () => {
  await checkRows([
    { name: 'the structure: a textarea over an aria-hidden highlighted pre, named for the host form', run: async () => {
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
    } },
    { name: 'an unnamed editor carries no data-field (nothing routes to the composer)', run: () => {
      const ed = createCodeEditor({ doc, value: '' });
      assert.equal(parts(ed).ta.dataset.field, undefined);
      ed.destroy();
    } },
  ]);
});

test('typing: onInput on every keystroke, repaint on one 60 ms trailing debounce with the language', async () => {
  await checkRows([
    { name: 'typing repaints on a 60 ms trailing debounce; the injected highlighter sees the language', run: async () => {
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
    } },
    { name: 'onInput fires on every keystroke (the dirty marker cannot wait for the debounce)', run: async () => {
      const seen = [];
      const ed = createCodeEditor({ doc, value: '', onInput: (v) => seen.push(v) });
      const { ta } = parts(ed);
      for (const v of ['x', 'xy']) { ta.value = v; ta.dispatchEvent(new win.Event('input', { bubbles: true })); }
      assert.deepEqual(seen, ['x', 'xy']);
      ed.destroy();
    } },
  ]);
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

test('Tab/Shift+Tab indent and outdent single and multi-line selections', async () => {
  await checkRows([
    { name: 'Tab over a multi-line selection indents every touched line; Shift+Tab outdents', run: () => {
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
    } },
    { name: 'Shift+Tab on one line removes up to two leading spaces', run: () => {
      const ed = createCodeEditor({ doc, value: 'x\n   y' });
      const { ta } = parts(ed);
      ta.selectionStart = ta.selectionEnd = 5;
      key(ta, { shift: true });
      assert.equal(ed.getValue(), 'x\n y');
      key(ta, { shift: true });
      assert.equal(ed.getValue(), 'x\ny');
      ed.destroy();
    } },
  ]);
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

test('a repaint re-syncs the pre to the textarea: a scroll mirrored before the new text was painted is not left behind', async () => {
  // Typing a new last line scrolls the textarea at once, but the pre only gets that line on the (debounced) paint,
  // so the browser clamps the mirrored scroll to the old, shorter text (review of #1471).
  const ed = createCodeEditor({ doc, value: 'a', highlight: async (t) => escapeHtml(t) });
  const { pre, ta } = parts(ed);
  ta.scrollTop = 42; ta.scrollLeft = 7;
  ta.dispatchEvent(new win.Event('scroll', { bubbles: false }));
  pre.scrollTop = 30; pre.scrollLeft = 0;          // what the browser's clamp leaves
  ed.setValue('a\nb');
  await tick();
  assert.deepEqual([pre.scrollTop, pre.scrollLeft], [42, 7]);
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

// ---- gutter, grip, lint -------------------------------------------------------

const type = (ta, v) => { ta.value = v; ta.dispatchEvent(new win.Event('input', { bubbles: true })); };
const gutterRows = (ed) => [...ed.el.querySelectorAll('.code-editor-gutter > div')];
const items = (ed) => [...ed.el.querySelectorAll('.code-editor-warnings > li')].map((li) => li.textContent);
const mouse = (target, kind, init = {}) => target.dispatchEvent(new win.MouseEvent(kind, { bubbles: true, cancelable: true, ...init }));
/** A lint that flags every line holding `bad`, so a test controls the result with the text. */
const flagBad = (text) => text.split('\n').flatMap((l, i) => (l.includes('bad') ? [{ line: i + 1, message: `bad ${i + 1}`, code: 'x' }] : []));

test('structure: gutter, grip and has-gutter by default; each is optional; the expand button is opt-in', () => {
  const ro = (ed) => ({
    gutter: ed.el.querySelector('.code-editor-gutter'), grip: ed.el.querySelector('.code-editor-grip'),
    expand: ed.el.querySelector('.code-editor-expand'), list: ed.el.querySelector('.code-editor-warnings'),
  });
  const rows = [
    ['defaults', {}, { gutter: true, grip: true, expand: false, list: false, has: true }],
    ['no line numbers', { lineNumbers: false }, { gutter: false, grip: true, expand: false, list: false, has: false }],
    ['not resizable', { resizable: false }, { gutter: true, grip: false, expand: false, list: false, has: true }],
    ['expandable with lint', { expandable: true, lint: () => [] }, { gutter: true, grip: true, expand: true, list: true, has: true }],
  ];
  return checkRows(rows.map(([name, opts, want]) => ({ name, run: () => {
    const ed = createCodeEditor({ doc, value: 'a', ...opts });
    const got = ro(ed);
    assert.deepEqual({ gutter: !!got.gutter, grip: !!got.grip, expand: !!got.expand, list: !!got.list, has: ed.el.classList.contains('has-gutter') }, want);
    assert.ok(parts(ed).ta && parts(ed).pre && parts(ed).code, 'the existing parts still resolve');
    if (got.grip) {
      assert.equal(got.grip.getAttribute('role'), 'separator');
      assert.equal(got.grip.getAttribute('aria-orientation'), 'horizontal');
      assert.equal(got.grip.tabIndex, 0);
    }
    if (got.expand) assert.equal(got.expand.getAttribute('aria-label'), 'Open large editor');
    ed.destroy();
  } })));
});

test('gutter: the line count follows input at once, setValue too, and the digit width tracks it', async () => {
  const ed = createCodeEditor({ doc, value: '' });
  const { ta } = parts(ed);
  await checkRows([
    { name: 'one line to start', run: () => assert.deepEqual(gutterRows(ed).map((r) => r.textContent), ['1']) },
    { name: 'three after typing, with no wait', run: () => { type(ta, 'a\nb\nc'); assert.deepEqual(gutterRows(ed).map((r) => r.textContent), ['1', '2', '3']); } },
    { name: 'setValue (which fires no event) repaints', run: () => { ed.setValue('1\n2\n3\n4\n5'); assert.equal(gutterRows(ed).length, 5); } },
    { name: '100+ lines need three digits', run: () => {
      ed.setValue(Array.from({ length: 120 }, (_, i) => String(i)).join('\n'));
      assert.equal(gutterRows(ed).length, 120);
      assert.equal(ed.el.style.getPropertyValue('--ce-digits'), '3');
    } },
    { name: 'no gutter without lineNumbers', run: () => {
      const bare = createCodeEditor({ doc, value: 'a\nb', lineNumbers: false });
      assert.equal(bare.el.querySelector('.code-editor-gutter'), null);
      bare.setValue('x');
      bare.destroy();
    } },
  ]);
  ed.destroy();
});

test('grip: arrows and a pointer drag set the height, nothing ever touches the text', async () => {
  const text = `tab\there \n  trailing  \n😀 emoji\n${Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n')}`;
  await checkRows([
    { name: 'nextEditorHeight is start + delta, floored at three rows', run: () => {
      assert.equal(nextEditorHeight(200, 40), 240);
      assert.equal(nextEditorHeight(200, -500), MIN_EDITOR_PX);
      assert.equal(nextEditorHeight(100.4, 0.3), 101);
    } },
    { name: 'ArrowDown / ArrowUp step the height (jsdom has no layout, so the floor shows)', run: () => {
      const ed = createCodeEditor({ doc, value: text });
      const { ta } = parts(ed);
      const grip = ed.el.querySelector('.code-editor-grip');
      const down = new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
      grip.dispatchEvent(down);
      assert.equal(down.defaultPrevented, true);
      assert.equal(ta.style.height, `${nextEditorHeight(0, GRIP_STEP_PX)}px`);
      assert.equal(grip.getAttribute('aria-valuenow'), String(MIN_EDITOR_PX));
      assert.equal(ed.getValue(), text, 'resizing never touches the value');
      ed.destroy();
    } },
    { name: 'pointer down / move / up sets a height with no setPointerCapture, and releases', run: () => {
      const ed = createCodeEditor({ doc, value: text });
      const { ta } = parts(ed);
      const grip = ed.el.querySelector('.code-editor-grip');
      Object.defineProperty(ta, 'offsetHeight', { value: 200, configurable: true });
      mouse(grip, 'pointermove', { clientY: 500 });
      assert.equal(ta.style.height, '', 'a move with no press does nothing');
      mouse(grip, 'pointerdown', { clientY: 100 });
      mouse(grip, 'pointermove', { clientY: 160 });
      assert.equal(ta.style.height, '260px');
      mouse(grip, 'pointerup', { clientY: 160 });
      mouse(grip, 'pointermove', { clientY: 400 });
      assert.equal(ta.style.height, '260px', 'the drag ended');
      assert.equal(ed.getValue(), text);
      ed.destroy();
    } },
  ]);
});

test('lint: the construction pass paints without onLint; typing waits for the pause, then one pass and one onLint', async () => {
  const seen = [];
  const lint = (t) => { seen.push(t); return flagBad(t); };
  const got = [];
  const ed = createCodeEditor({ doc, value: 'ok\nbad', lint, lintDelayMs: 30, onLint: (w) => got.push(w) });
  const { ta } = parts(ed);
  await checkRows([
    { name: 'the construction pass paints the list and the gutter mark, and does not notify', run: () => {
      assert.deepEqual(items(ed), ['Line 2: bad 2']);
      const marked = gutterRows(ed).filter((r) => r.classList.contains('warn'));
      assert.equal(marked.length, 1);
      assert.equal(marked[0].textContent, '2');
      assert.equal(marked[0].title, 'bad 2');
      assert.equal(got.length, 0);
      assert.equal(ed.el.querySelector('.code-editor-warnings').hidden, false);
    } },
    { name: 'three quick inputs lint nothing and keep the old list', run: async () => {
      seen.length = 0;
      for (const v of ['ok\nbad\nx', 'ok\nbad\nxy', 'fine']) type(ta, v);
      assert.equal(seen.length, 0);
      assert.deepEqual(items(ed), ['Line 2: bad 2'], 'no flicker while typing');
      await sleep(70);
      assert.deepEqual(seen, ['fine'], 'one pass, with the newest text');
      assert.equal(got.length, 1);
      assert.deepEqual(got[0], []);
      assert.deepEqual(items(ed), []);
      assert.equal(ed.el.querySelector('.code-editor-warnings').hidden, true);
      assert.equal(gutterRows(ed).filter((r) => r.classList.contains('warn')).length, 0, 'the gutter mark clears too');
    } },
    { name: 'an identical result does not notify again', run: async () => {
      type(ta, 'still fine');
      await sleep(70);
      assert.equal(got.length, 1);
    } },
    { name: 'a new defect notifies with a copy', run: async () => {
      type(ta, 'bad one');
      await sleep(70);
      assert.equal(got.length, 2);
      assert.equal(got[1][0].line, 1);
      assert.equal(got[1][0].message, 'bad 1');
      ed.getWarnings()[0].message = 'tampered';
      assert.equal(ed.getWarnings()[0].message, 'bad 1', 'getWarnings returns a copy');
    } },
    { name: 'setValue lints at once and notifies when the result changed', run: () => {
      ed.setValue('fixed');
      assert.deepEqual(items(ed), []);
      assert.equal(got.length, 3);
    } },
  ]);
  ed.destroy();
  await checkRows([
    { name: 'the default delay is one second, and nothing has linted 100 ms after an input', run: async () => {
      assert.equal(LINT_DEBOUNCE_MS, 1000);
      const calls = [];
      const slow = createCodeEditor({ doc, value: 'a', lint: (t) => { calls.push(t); return []; } });
      calls.length = 0;
      type(parts(slow).ta, 'b');
      await sleep(100);
      assert.equal(calls.length, 0);
      slow.destroy();
    } },
    { name: 'destroy() cancels a pending lint', run: async () => {
      const calls = [];
      const e = createCodeEditor({ doc, value: 'a', lint: (t) => { calls.push(t); return []; }, lintDelayMs: 20 });
      calls.length = 0;
      type(parts(e).ta, 'b');
      e.destroy();
      await sleep(60);
      assert.equal(calls.length, 0);
    } },
  ]);
});

test('lint output is made safe: a throw is no warning, junk is filtered, lines are clamped, markup is never parsed', async () => {
  await checkRows([
    { name: 'a throwing lint gives no warnings and a working field', run: () => {
      const ed = createCodeEditor({ doc, value: 'a', lint: () => { throw new Error('boom'); } });
      assert.deepEqual(ed.getWarnings(), []);
      type(parts(ed).ta, 'b');
      assert.equal(ed.getValue(), 'b');
      ed.destroy();
    } },
    { name: 'a non-array result gives none', run: () => {
      const ed = createCodeEditor({ doc, value: 'a', lint: () => 'x' });
      assert.deepEqual(ed.getWarnings(), []);
      ed.destroy();
    } },
    { name: 'garbage entries are dropped and a far line is clamped to the last', run: () => {
      const ed = createCodeEditor({
        doc, value: 'a\nb',
        lint: () => [null, { line: 0, message: 'm' }, { line: 1.5, message: 'm' }, { line: 1, message: 5 }, { line: 99, message: 'far' }],
      });
      assert.deepEqual(ed.getWarnings(), [{ line: 2, message: 'far', code: '' }]);
      ed.destroy();
    } },
    { name: 'a message is text: no element is created from it', run: () => {
      const ed = createCodeEditor({ doc, value: 'a', lint: () => [{ line: 1, message: '<img src=x onerror=alert(1)>' }] });
      assert.equal(ed.el.querySelector('img'), null);
      assert.equal(ed.el.querySelector('.code-editor-warning').textContent, 'Line 1: <img src=x onerror=alert(1)>');
      assert.equal(gutterRows(ed)[0].querySelector('img'), null);
      ed.destroy();
    } },
    { name: 'without lint there is no list, and onLint never fires', run: () => {
      let fired = 0;
      const ed = createCodeEditor({ doc, value: 'a', onLint: () => { fired += 1; } });
      type(parts(ed).ta, 'b');
      ed.setValue('c');
      assert.equal(ed.el.querySelector('.code-editor-warnings'), null);
      assert.deepEqual(ed.getWarnings(), []);
      assert.equal(fired, 0);
      ed.destroy();
    } },
  ]);
});

// ---- the large window ------------------------------------------------------------

const TITLE = 'Shell · n1 — Command';
const CAPTION = "Runs with worca's privileges.";
/** An expandable editor mounted in a host that records the events a composer would see. */
function mount(opts = {}) {
  const host = doc.createElement('div');
  doc.body.appendChild(host);
  const log = [];
  host.addEventListener('change', () => log.push('change'));
  host.addEventListener('input', () => log.push('input'));
  const ed = createCodeEditor({
    doc, value: 'a', expandable: true, title: TITLE, caption: CAPTION, lintDelayMs: 20,
    onExpandedChange: (open) => log.push(`expanded:${open}`), ...opts,
  });
  host.appendChild(ed.el);
  const overlays = () => [...doc.querySelectorAll('body > .viewer-modal.code-editor-modal')];
  const inner = () => overlays()[0] && overlays()[0].querySelector('textarea.code-editor-ta');
  const cleanup = () => { ed.destroy(); host.remove(); };
  return { ed, host, log, overlays, inner, cleanup, ta: parts(ed).ta };
}
const openBtn = (m) => m.ed.el.querySelector('.code-editor-expand');
const press = (target, key) => target.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

test('large window: one body-level dialog with the title and caption, an inner editor of 30+ rows with a gutter', () => {
  const m = mount();
  openBtn(m).click();
  const [root] = m.overlays();
  assert.equal(m.overlays().length, 1);
  assert.equal(root.getAttribute('role'), 'dialog');
  assert.equal(root.getAttribute('aria-modal'), 'true');
  assert.equal(root.querySelector('h2').textContent, TITLE);
  assert.equal(root.getAttribute('aria-labelledby'), root.querySelector('h2').id);
  assert.equal(root.querySelector('.code-editor-modal-caption').textContent, CAPTION);
  assert.ok(m.inner().rows >= LARGE_EDITOR_ROWS);
  assert.equal(doc.activeElement, m.inner());
  assert.equal(m.inner().dataset.field, undefined, 'no data-field, so no host listener routes it');
  assert.ok(root.querySelector('.code-editor-gutter'));
  assert.equal(root.querySelector('.code-editor-expand'), null, 'no nested expand');
  assert.equal(root.querySelector('.code-editor-grip'), null);
  assert.equal(m.ed.isExpanded(), true);
  assert.deepEqual(m.log, ['expanded:true']);
  openBtn(m).click();
  assert.equal(m.overlays().length, 1, 'expand is idempotent');
  m.cleanup();
});

test('large window: every keystroke reaches the field at once; nothing commits while open; the inner lint matches', async () => {
  const m = mount({ value: 'ok', lint: flagBad });
  openBtn(m).click();
  const inner = m.inner();
  type(inner, 'ok\nbad here');
  assert.equal(m.ed.getValue(), 'ok\nbad here', 'the field follows before the next keystroke');
  assert.ok(m.log.includes('input'));
  assert.ok(!m.log.includes('change'), 'no change while open');
  await sleep(60);
  assert.deepEqual(items(m.ed), ['Line 2: bad 2']);
  assert.deepEqual([...m.overlays()[0].querySelectorAll('.code-editor-warning')].map((li) => li.textContent), ['Line 2: bad 2'], 'the same warnings in the window');
  m.cleanup();
});

test('large window: Escape, the close button and a backdrop click all keep the text and commit once, in order', async () => {
  const TEXT = 'tab\there  \n😀\n  x ';
  const rows = [
    ['Escape', (m) => {
      const seenOnDoc = [];
      const spy = (e) => seenOnDoc.push(e);
      doc.addEventListener('keydown', spy);
      const ev = new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      m.inner().dispatchEvent(ev);
      doc.removeEventListener('keydown', spy);
      assert.equal(ev.defaultPrevented, true);
      assert.equal(seenOnDoc.length, 0, 'Escape never reaches a document listener');
    }],
    ['the close button', (m) => m.overlays()[0].querySelector('.code-editor-modal-close').click()],
    ['a backdrop click', (m) => { const root = m.overlays()[0]; mouse(root, 'pointerdown'); mouse(root, 'click'); }],
  ];
  await checkRows(rows.map(([name, close]) => ({ name, run: () => {
    const m = mount();
    openBtn(m).click();
    type(m.inner(), TEXT);
    m.log.length = 0;
    close(m);
    assert.equal(m.overlays().length, 0, 'the window is gone');
    assert.equal(m.ta.value, TEXT, 'byte for byte');
    assert.equal(doc.activeElement, m.ta);
    assert.equal(m.log.filter((e) => e === 'change').length, 1);
    assert.ok(m.log.indexOf('change') < m.log.indexOf('expanded:false'), 'change first, then onExpandedChange');
    assert.equal(m.ed.isExpanded(), false);
    m.cleanup();
  } })));
});

test('large window: no edit means no change; a drag from the card onto the backdrop does not close it', () => {
  const m = mount();
  openBtn(m).click();
  m.ed.collapse();
  assert.deepEqual(m.log, ['expanded:true', 'expanded:false'], 'no change without an edit');
  openBtn(m).click();
  const root = m.overlays()[0];
  mouse(root.querySelector('.code-editor-modal-card'), 'pointerdown');
  mouse(root, 'click');
  assert.equal(m.overlays().length, 1, 'a press that began inside is not a backdrop click');
  m.cleanup();
});

test('large window: pressing the expand button keeps focus in the field (no blur before the click)', () => {
  const m = mount();
  const down = new win.MouseEvent('mousedown', { bubbles: true, cancelable: true });
  openBtn(m).dispatchEvent(down);
  assert.equal(down.defaultPrevented, true);
  const ptr = new win.MouseEvent('pointerdown', { bubbles: true, cancelable: true });
  openBtn(m).dispatchEvent(ptr);
  assert.equal(ptr.defaultPrevented, true);
  m.cleanup();
});

test('large window: destroy() while open removes the overlay and fires no change', () => {
  const m = mount();
  openBtn(m).click();
  type(m.inner(), 'typed');
  m.log.length = 0;
  m.ed.destroy();
  assert.equal(m.overlays().length, 0);
  assert.ok(!m.log.includes('change'));
  assert.equal(m.ta.value, 'typed', 'the keystrokes were already mirrored');
  m.host.remove();
});

test('large window: it carries no run or test control, a read-only field opens read-only, focus is kept inside', () => {
  const m = mount({ readOnly: true });
  openBtn(m).click();
  const labels = [...m.ed.el.querySelectorAll('button'), ...m.overlays()[0].querySelectorAll('button')]
    .map((b) => `${b.textContent} ${b.getAttribute('aria-label') || ''} ${b.title}`);
  assert.ok(labels.length >= 2);
  for (const l of labels) assert.doesNotMatch(l, /\b(run|test)\b/i);
  assert.equal(m.inner().readOnly, true);
  const outside = doc.createElement('button');
  doc.body.appendChild(outside);
  outside.focus();
  assert.equal(doc.activeElement, m.inner(), 'focus that leaves comes back');
  outside.remove();
  m.cleanup();
});

test('expand() is a no-op unless the editor is expandable', () => {
  const ed = createCodeEditor({ doc, value: 'a' });
  ed.expand();
  assert.equal(ed.isExpanded(), false);
  assert.equal(doc.querySelectorAll('.code-editor-modal').length, 0);
  ed.destroy();
});
