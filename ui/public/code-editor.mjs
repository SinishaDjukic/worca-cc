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
//
// Around that core: a line-number gutter, a bottom drag handle, an opt-in expand
// button that opens a large editor window, and an opt-in, debounced lint whose
// warnings sit beside their line. The large window is a SECOND editor in a
// body-level overlay that mirrors every keystroke into the field's own textarea;
// the field itself never moves out of its host, so the host's delegated listeners
// keep seeing it. Lint output reaches the DOM through textContent and title only.

import { icon } from './icons.mjs';

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
// Lint waits for typing to pause: a warning that flickers on every keystroke is noise.
export const LINT_DEBOUNCE_MS = 1000;
export const LARGE_EDITOR_ROWS = 30;
export const MIN_EDITOR_PX = 72;      // ≈ 3 rows; the floor of a drag
export const GRIP_STEP_PX = 20;       // one keyboard resize step (≈ one row)
const ROW_PX = 18.6;                  // 12px × 1.55, the layers' shared line height

/** Pure: the height a drag or an arrow press produces. start = current px (0 in jsdom), delta = px moved. */
export function nextEditorHeight(startPx, deltaPx) {
  return Math.max(MIN_EDITOR_PX, Math.round(startPx + deltaPx));
}

let modalSeq = 0;
const sameWarnings = (a, b) => a.length === b.length
  && a.every((w, i) => w.line === b[i].line && w.message === b[i].message && w.code === b[i].code);

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
 * @param {boolean}  [opts.lineNumbers] gutter of 1..N line numbers (default true)
 * @param {boolean}  [opts.resizable]   bottom drag handle (default true)
 * @param {boolean}  [opts.expandable]  expand button that opens the large window (default false)
 * @param {string}   [opts.title]       large-window heading
 * @param {string}   [opts.caption]     large-window note under the heading
 * @param {?function} [opts.lint]       (text) -> [{line, message, code?}], sync; null = no lint
 * @param {number}   [opts.lintDelayMs] tests only
 * @param {?function} [opts.onLint]     (warnings) after an input/setValue pass whose result CHANGED
 * @param {?function} [opts.onExpandedChange] (open) after the window opened / after it closed and its change fired
 * @returns {{el:HTMLElement, getValue:()=>string, setValue:(v:string)=>void,
 *            setLanguage:(l:string)=>void, setReadOnly:(b:boolean)=>void,
 *            focus:()=>void, destroy:()=>void, getWarnings:()=>Array,
 *            isExpanded:()=>boolean, expand:()=>void, collapse:()=>void}}
 */
export function createCodeEditor({
  doc = globalThis.document, value = '', language = 'javascript', readOnly = false,
  rows = 18, name = '', onInput = null, highlight = async (text) => escapeHtml(text),
  lineNumbers = true, resizable = true, expandable = false, title = '', caption = '',
  lint = null, lintDelayMs = LINT_DEBOUNCE_MS, onLint = null, onExpandedChange = null,
} = {}) {
  const win = doc.defaultView || globalThis;
  let lang = String(language || '');
  let seq = 0;            // paint token: only the newest result may be applied
  let timer = null;
  let dead = false;
  let lintTimer = null;
  let warnings = [];
  let gutterKey = '';
  let expanded = false;
  let overlay = null;               // { root, inner, startValue, listeners } while the large window is open

  const el = doc.createElement('div');
  el.className = `code-editor${readOnly ? ' ro' : ''}${lineNumbers ? ' has-gutter' : ''}`;
  el.dataset.language = lang;

  const body = doc.createElement('div');
  body.className = 'code-editor-body';
  let gutter = null;
  if (lineNumbers) {
    gutter = doc.createElement('div');
    gutter.className = 'code-editor-gutter';
    gutter.setAttribute('aria-hidden', 'true');
    body.appendChild(gutter);
  }

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
  body.append(pre, ta);
  el.appendChild(body);

  let grip = null;
  let expandBtn = null;
  if (resizable || expandable) {
    const foot = doc.createElement('div');
    foot.className = 'code-editor-foot';
    if (resizable) {
      grip = doc.createElement('div');
      grip.className = 'code-editor-grip';
      grip.setAttribute('role', 'separator');
      grip.setAttribute('aria-orientation', 'horizontal');
      grip.setAttribute('aria-label', 'Resize editor');
      grip.setAttribute('aria-valuemin', String(MIN_EDITOR_PX));
      // A guess until the first resize: jsdom has no layout, a browser corrects it on the first drag.
      grip.setAttribute('aria-valuenow', String(Math.round(rows * ROW_PX + 24)));
      grip.tabIndex = 0;
      foot.appendChild(grip);
    }
    if (expandable) {
      expandBtn = doc.createElement('button');
      expandBtn.type = 'button';
      expandBtn.className = 'code-editor-expand btn btn-sm btn-quiet btn-icon';
      expandBtn.setAttribute('aria-label', 'Open large editor');
      expandBtn.title = 'Open large editor';
      expandBtn.appendChild(icon(doc, 'expand', 14));
      foot.appendChild(expandBtn);
    }
    el.appendChild(foot);
  }
  let list = null;
  if (typeof lint === 'function') {
    list = doc.createElement('ul');
    list.className = 'code-editor-warnings';
    list.setAttribute('aria-live', 'polite');
    list.hidden = true;
    el.appendChild(list);
  }

  /** The one innerHTML write. `html` comes from the injected highlighter (or the
   *  escaping default); anything that is not a string falls back to escaped text.
   *  The extra '\n' keeps the last row visible — <pre> swallows one trailing
   *  newline, which would otherwise scroll the layers out of step. The scroll is
   *  mirrored again after the write: a scroll that came before the new text was
   *  painted was clamped to the old, shorter text and would stay a line behind. */
  function apply(html, text) {
    code.innerHTML = (typeof html === 'string' ? html : escapeHtml(text)) + '\n';
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
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

  /** The gutter: one row per logical line (no soft wrap, so rows line up), warned lines marked. It is
   *  rebuilt only when the line count or the warnings change, never per keystroke. */
  function paintGutter() {
    if (!gutter) return;
    const count = ta.value.split('\n').length;
    const byLine = new Map();
    for (const w of warnings) byLine.set(w.line, [...(byLine.get(w.line) || []), w.message]);
    const key = `${count}|${[...byLine].map(([l, m]) => `${l}:${m.join('\n')}`).join('|')}`;
    if (key === gutterKey) return;
    gutterKey = key;
    el.style.setProperty('--ce-digits', String(String(count).length));
    const rowsEls = [];
    for (let n = 1; n <= count; n += 1) {
      const row = doc.createElement('div');
      row.textContent = String(n);
      if (byLine.has(n)) { row.className = 'warn'; row.title = byLine.get(n).join('\n'); }
      rowsEls.push(row);
    }
    gutter.replaceChildren(...rowsEls);
    gutter.scrollTop = ta.scrollTop;
  }

  function paintWarnings() {
    if (!list) return;
    list.replaceChildren(...warnings.map((w) => {
      const li = doc.createElement('li');
      li.className = 'code-editor-warning';
      li.textContent = `Line ${w.line}: ${w.message}`;
      return li;
    }));
    list.hidden = warnings.length === 0;
  }

  /** The host's lint, made safe: a throw or a malformed entry means "no warning", never a broken field. */
  function safeLint(text) {
    if (typeof lint !== 'function') return [];
    let raw;
    try { raw = lint(text); } catch { return []; }
    if (!Array.isArray(raw)) return [];
    const max = text.split('\n').length;
    const out = [];
    for (const w of raw) {
      if (w && Number.isInteger(w.line) && w.line >= 1 && typeof w.message === 'string') {
        out.push({ line: Math.min(w.line, max), message: w.message, code: typeof w.code === 'string' ? w.code : '' });
      }
    }
    return out;
  }

  function runLint(notify) {
    const next = safeLint(ta.value);
    const changed = !sameWarnings(next, warnings);
    warnings = next;
    paintWarnings();
    paintGutter();
    if (changed && notify && typeof onLint === 'function') onLint(warnings.map((w) => ({ ...w })));
  }

  function onInputEvent() {
    if (typeof onInput === 'function') onInput(ta.value);
    schedule();
    paintGutter();
    if (list) {
      if (lintTimer != null) win.clearTimeout(lintTimer);
      lintTimer = win.setTimeout(() => { lintTimer = null; runLint(true); }, lintDelayMs);
    }
  }

  function onScroll() {
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
    if (gutter) gutter.scrollTop = ta.scrollTop;
  }

  // ---- the bottom grip ------------------------------------------------------
  // Resizing only ever sets the textarea's height; the text is never touched.
  let drag = null;
  function setHeight(px) {
    ta.style.height = `${px}px`;
    if (grip) grip.setAttribute('aria-valuenow', String(px));
  }
  if (grip) {
    grip.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      try { grip.setPointerCapture?.(ev.pointerId); } catch { /* jsdom has none */ }
      drag = { y: ev.clientY, h: ta.offsetHeight, id: ev.pointerId };
    });
    grip.addEventListener('pointermove', (ev) => {
      if (drag) setHeight(nextEditorHeight(drag.h, ev.clientY - drag.y));
    });
    const endDrag = () => {
      if (!drag) return;
      try { grip.releasePointerCapture?.(drag.id); } catch { /* not captured */ }
      drag = null;
    };
    grip.addEventListener('pointerup', endDrag);
    grip.addEventListener('pointercancel', endDrag);
    grip.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
      ev.preventDefault();
      setHeight(nextEditorHeight(ta.offsetHeight, ev.key === 'ArrowDown' ? GRIP_STEP_PX : -GRIP_STEP_PX));
    });
  }

  // ---- the large window -----------------------------------------------------
  function mirror(v) {
    if (ta.value === v) return;
    ta.value = v;
    ta.dispatchEvent(new win.Event('input', { bubbles: true }));
  }

  /** Close the large window. The ORDER matters: the flag drops first; the textarea is back in focus and
   *  has the final text BEFORE `change` fires (a host repaint on that change would otherwise find it
   *  detached); `onExpandedChange(false)` comes last, so a host that deferred a repaint runs it after
   *  the commit. */
  function collapse() {
    if (!expanded || !overlay) return;
    const { root, inner, startValue, listeners } = overlay;
    expanded = false;
    overlay = null;
    for (const [target, type, fn] of listeners) target.removeEventListener(type, fn);
    const finalValue = inner.getValue();
    inner.destroy();
    root.remove();
    mirror(finalValue);
    if (ta.isConnected && typeof ta.focus === 'function') ta.focus();
    if (ta.value !== startValue) ta.dispatchEvent(new win.Event('change', { bubbles: true }));
    if (typeof onExpandedChange === 'function') onExpandedChange(false);
  }

  function expand() {
    if (!expandable || expanded || dead || !doc.body) return;
    const id = `code-editor-modal-title-${(modalSeq += 1)}`;
    const root = doc.createElement('div');
    root.className = 'viewer-modal code-editor-modal';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', id);
    const card = doc.createElement('div');
    card.className = 'code-editor-modal-card';
    const head = doc.createElement('div');
    head.className = 'code-editor-modal-head';
    const h = doc.createElement('h2');
    h.id = id;
    h.className = 'code-editor-modal-title';
    h.textContent = title || 'Editor';
    head.appendChild(h);
    if (caption) {
      const small = doc.createElement('small');
      small.className = 'code-editor-modal-caption';
      small.textContent = caption;
      head.appendChild(small);
    }
    const close = doc.createElement('button');
    close.type = 'button';
    close.className = 'code-editor-modal-close btn btn-sm btn-quiet btn-icon';
    close.setAttribute('aria-label', 'Close large editor');
    close.title = 'Close large editor';
    close.appendChild(icon(doc, 'x', 14));
    head.appendChild(close);
    const inner = createCodeEditor({
      doc, value: ta.value, language: lang, highlight, lint, lintDelayMs, rows: LARGE_EDITOR_ROWS,
      expandable: false, resizable: false, lineNumbers: true, readOnly: ta.readOnly, onInput: mirror,
    });
    card.append(head, inner.el);
    root.appendChild(card);

    let downOnRoot = false;
    const listeners = [
      [root, 'keydown', (ev) => {
        if (ev.key !== 'Escape' || ev.isComposing) return;
        ev.preventDefault();
        ev.stopPropagation();
        collapse();
      }],
      [close, 'click', () => collapse()],
      [root, 'pointerdown', (ev) => { downOnRoot = ev.target === root; }],
      [root, 'click', (ev) => { if (downOnRoot && ev.target === root) collapse(); downOnRoot = false; }],
      [doc, 'focusin', (ev) => { if (!root.contains(ev.target)) inner.focus(); }],
    ];
    for (const [target, type, fn] of listeners) target.addEventListener(type, fn);
    overlay = { root, inner, startValue: ta.value, listeners };
    expanded = true;
    doc.body.appendChild(root);
    inner.focus();
    if (typeof onExpandedChange === 'function') onExpandedChange(true);
  }

  if (expandBtn) {
    // Without this the button press would blur the textarea first: the host would commit (and a
    // composer would rebuild its inspector) before the click ever lands.
    const keepFocus = (ev) => ev.preventDefault();
    expandBtn.addEventListener('mousedown', keepFocus);
    expandBtn.addEventListener('pointerdown', keepFocus);
    expandBtn.addEventListener('click', () => expand());
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
  if (list) runLint(false);
  paintGutter();

  return {
    el,
    getValue: () => ta.value,
    setValue(v) {
      ta.value = String(v ?? '');
      if (overlay) overlay.inner.setValue(ta.value);
      void paint();
      if (lintTimer != null) { win.clearTimeout(lintTimer); lintTimer = null; }
      if (list) runLint(true); else paintGutter();
    },
    setLanguage(l) { lang = String(l || ''); el.dataset.language = lang; void paint(); },
    setReadOnly(b) { ta.readOnly = Boolean(b); el.classList.toggle('ro', Boolean(b)); },
    focus() { if (typeof ta.focus === 'function') ta.focus(); },
    getWarnings: () => warnings.map((w) => ({ ...w })),
    isExpanded: () => expanded,
    expand,
    collapse,
    destroy() {
      dead = true;
      if (timer != null) { win.clearTimeout(timer); timer = null; }
      if (lintTimer != null) { win.clearTimeout(lintTimer); lintTimer = null; }
      if (overlay) {
        // Known gap: no `change` here — the text was already mirrored into the field on every keystroke.
        const { root, inner, listeners } = overlay;
        for (const [target, type, fn] of listeners) target.removeEventListener(type, fn);
        inner.destroy();
        root.remove();
        overlay = null;
        expanded = false;
      }
      ta.removeEventListener('input', onInputEvent);
      ta.removeEventListener('scroll', onScroll);
      ta.removeEventListener('keydown', onKeyDown);
      ta.removeEventListener('blur', onBlur);
    },
  };
}
