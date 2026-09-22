// ui/public/code-editor.mjs
// The app's one code editor (scripts-workbench design §W16): a transparent
// <textarea> laid over a highlighted <pre><code>. The browser keeps the caret,
// IME and selection of a plain textarea — and its undo ring for TYPED text (a Tab
// indent assigns `.value`, which resets that ring: the price of no dependency);
// the colours are painted underneath. No contenteditable, no dependency, no build step.
//
// The highlighter is INJECTED (C11): app.js passes one built on the vendored
// hljs loader, tests pass an escaping stub, and the DEFAULT escapes HTML — so a
// script's own source can never reach innerHTML unescaped. That injected
// function is the ONLY thing in this module allowed near innerHTML.
//
// The textarea keeps the caller's `name` as data-field, so an editor dropped
// into the composer's inspector routes through the same delegated change
// listener a plain textarea did (P1b Task 6).

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape the five HTML metacharacters. Pure; the default highlighter. */
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

// Trailing-edge: a burst of keystrokes costs ONE highlight pass. 60 ms is below
// the threshold where a repaint reads as lag and well above a fast typist's
// inter-key gap.
export const HIGHLIGHT_DEBOUNCE_MS = 60;
// Two spaces, matching the repo's own indentation; a literal tab would render at
// the browser's default width and fight the highlighted layer's alignment.
export const TAB_SPACES = '  ';

/**
 * @param {object} opts
 * @param {Document} [opts.doc]
 * @param {string}   [opts.value]      initial text
 * @param {string}   [opts.language]   hljs language id, mirrored on data-language
 * @param {boolean}  [opts.readOnly]
 * @param {number}   [opts.rows]
 * @param {string}   [opts.name]       data-field on the textarea ('' = none)
 * @param {?function} [opts.onInput]   called with the new text on every keystroke
 * @param {function} [opts.highlight]  (text, language) -> Promise<string html>
 * @returns {{el:HTMLElement, getValue:()=>string, setValue:(v:string)=>void,
 *            setLanguage:(l:string)=>void, setReadOnly:(b:boolean)=>void,
 *            focus:()=>void, destroy:()=>void}}
 */
export function createCodeEditor({
  doc = globalThis.document, value = '', language = 'javascript', readOnly = false,
  rows = 18, name = '', onInput = null, highlight = async (text) => escapeHtml(text),
} = {}) {
  const win = doc.defaultView || globalThis;
  let lang = String(language || '');
  let seq = 0;            // paint token: only the newest result may be applied
  let timer = null;
  let dead = false;

  const el = doc.createElement('div');
  el.className = `code-editor${readOnly ? ' ro' : ''}`;
  el.dataset.language = lang;

  const pre = doc.createElement('pre');
  pre.className = 'code-editor-hl';
  pre.setAttribute('aria-hidden', 'true');   // the textarea is the accessible control
  const code = doc.createElement('code');
  pre.appendChild(code);

  const ta = doc.createElement('textarea');
  ta.className = 'code-editor-ta mono';
  ta.spellcheck = false;
  ta.rows = rows;
  ta.readOnly = Boolean(readOnly);
  ta.value = String(value ?? '');
  if (name) ta.dataset.field = name;
  el.append(pre, ta);

  /** The one innerHTML write. `html` comes from the injected highlighter (or the
   *  escaping default); anything that is not a string falls back to escaped text.
   *  The extra '\n' keeps the last row visible — <pre> swallows one trailing
   *  newline, which would otherwise scroll the layers out of step. */
  function apply(html, text) {
    code.innerHTML = (typeof html === 'string' ? html : escapeHtml(text)) + '\n';
  }

  async function paint() {
    const my = ++seq;
    const text = ta.value;
    const at = lang;
    let html = null;
    try { html = await highlight(text, at); } catch { html = null; }
    if (dead || my !== seq) return;            // destroyed, or a newer paint won
    apply(html, text);
  }

  function schedule() {
    if (timer != null) win.clearTimeout(timer);
    timer = win.setTimeout(() => { timer = null; void paint(); }, HIGHLIGHT_DEBOUNCE_MS);
  }

  function onInputEvent() {
    if (typeof onInput === 'function') onInput(ta.value);
    schedule();
  }

  function onScroll() {
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  }

  // Escape arms the NEXT Tab to move focus instead of indenting. The textarea is
  // the accessible control here (the <pre> is aria-hidden), and an indent handler
  // that swallows every Tab and Shift+Tab would make it a keyboard trap — no
  // keyboard user could ever leave it. Escape-then-Tab is the editor convention.
  let tabOut = false;
  /** Leaving the field cancels a pending Escape: coming back and pressing Tab must
   *  indent again, the way it does on a field nobody armed. */
  function onBlur() { tabOut = false; }

  /** Tab / Shift+Tab. A caret with no multi-line selection inserts two spaces;
   *  anything spanning a newline (and every Shift+Tab) re-indents whole lines,
   *  which is what an editor user expects from a code field. Read-only lets Tab
   *  through so focus still moves on. */
  function onKeyDown(ev) {
    if (ev.key === 'Escape') { tabOut = true; return; }
    const armed = tabOut;
    tabOut = false;
    if (ev.key !== 'Tab' || ev.ctrlKey || ev.metaKey || ev.altKey || ta.readOnly || armed) return;
    const v = ta.value;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    ev.preventDefault();
    if (!ev.shiftKey && !v.slice(start, end).includes('\n')) {
      ta.value = v.slice(0, start) + TAB_SPACES + v.slice(end);
      ta.selectionStart = start + TAB_SPACES.length;
      ta.selectionEnd = ta.selectionStart;
      ta.dispatchEvent(new win.Event('input', { bubbles: true }));
      return;
    }
    const lineStart = v.lastIndexOf('\n', start - 1) + 1;
    const nl = v.indexOf('\n', end);
    const blockEnd = nl === -1 ? v.length : nl;
    let first = 0;
    let total = 0;
    const lines = v.slice(lineStart, blockEnd).split('\n').map((line, i) => {
      if (ev.shiftKey) {
        const cut = line.startsWith(TAB_SPACES) ? TAB_SPACES.length : (line.startsWith(' ') ? 1 : 0);
        if (i === 0) first = -cut;
        total -= cut;
        return line.slice(cut);
      }
      if (i === 0) first = TAB_SPACES.length;
      total += TAB_SPACES.length;
      return TAB_SPACES + line;
    });
    ta.value = v.slice(0, lineStart) + lines.join('\n') + v.slice(blockEnd);
    ta.selectionStart = Math.max(lineStart, start + first);
    ta.selectionEnd = Math.max(ta.selectionStart, end + total);
    ta.dispatchEvent(new win.Event('input', { bubbles: true }));
  }

  ta.addEventListener('input', onInputEvent);
  ta.addEventListener('scroll', onScroll);
  ta.addEventListener('keydown', onKeyDown);
  ta.addEventListener('blur', onBlur);
  void paint();

  return {
    el,
    getValue: () => ta.value,
    setValue(v) { ta.value = String(v ?? ''); void paint(); },
    setLanguage(l) { lang = String(l || ''); el.dataset.language = lang; void paint(); },
    setReadOnly(b) { ta.readOnly = Boolean(b); el.classList.toggle('ro', Boolean(b)); },
    focus() { if (typeof ta.focus === 'function') ta.focus(); },
    destroy() {
      dead = true;
      if (timer != null) { win.clearTimeout(timer); timer = null; }
      ta.removeEventListener('input', onInputEvent);
      ta.removeEventListener('scroll', onScroll);
      ta.removeEventListener('keydown', onKeyDown);
      ta.removeEventListener('blur', onBlur);
    },
  };
}
