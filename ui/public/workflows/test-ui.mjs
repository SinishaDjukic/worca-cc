// ui/public/workflows/test-ui.mjs — the small DOM helpers the workflow tests views share (plans/workflow-tests-part2-plan.md
// Task 10). textContent only; dialogs on the shared createDialog layout (marketplace/layers.mjs).
import { createDialog } from '../marketplace/layers.mjs';
import { icon } from '../icons.mjs';

/** G19, D37: the hint beside a start button while a test of the workflow runs (the server's BUSY_TEXT). */
export const BUSY_HINT = 'A test of this workflow is running. Wait for it, or stop it first.';

/** U-T14 (F26): a start point as "main · 28 Oct · "Fix the login"" appended to `node`: the branch (bold with `bold`), the date when the
 *  start has one, the commit subject when it could be read. No commit id: `dev` (the "For developers" facts) keeps the old
 *  "main at <code>abc1234</code> · 28 Oct". `start` is { ref, short, at, subject }; a start without a branch says "a commit". */
export function startInto(doc, node, start, dateText, { bold = false, dev = false } = {}) {
  const st = start || {};
  const name = st.ref || (dev ? st.short : '') || 'a commit';
  node.append(bold ? el(doc, 'b', '', name) : doc.createTextNode(name));
  if (dev) node.append(doc.createTextNode(' at '), el(doc, 'span', 'code', st.short || ''));
  if (st.at) node.append(doc.createTextNode(` · ${dateText(st.at)}`));
  if (!dev && st.subject) node.append(doc.createTextNode(` · "${st.subject}"`));
  return node;
}
/** A check as the editor, the dialog's preview and the side by side write it: the command, folders and patterns in code
 *  (boards 32, 33, 36; P47), any other check as its label. Inline, in one span. */
export function checkWords(doc, c, label) {
  const s = el(doc, 'span');
  const codes = (list, sep) => list.forEach((x, i) => { if (i) s.append(doc.createTextNode(sep(i, list.length))); s.append(el(doc, 'span', 'code', x)); });
  if (c && c.kind === 'command') s.append(doc.createTextNode('The command '), el(doc, 'span', 'code', c.cmd),
    doc.createTextNode(c.metWhen === 'breaks-nothing' ? ' breaks nothing that passed before' : ' passes'));   // D82, U4 (board 43)
  else if (c && c.kind === 'under' && Array.isArray(c.dirs) && c.dirs.length) {
    s.append(doc.createTextNode('Changes only files under '));
    codes(c.dirs, (i, n) => (i === n - 1 ? ' and ' : ', '));
  } else if (c && c.kind === 'unchanged' && Array.isArray(c.patterns) && c.patterns.length) {
    s.append(doc.createTextNode('Leaves these files unchanged: '));
    codes(c.patterns, () => ', ');
  } else s.textContent = label;
  return s;
}

/** F52 (board UfMockNote): in mock mode, the one line under a Tests page's title and buttons: plain ink text with a blue
 *  information icon, not a coloured box. */
export function mockNote(doc) {
  const p = el(doc, 'p', 'wft-mock-note');
  p.setAttribute('role', 'note');
  const words = el(doc, 'span');
  words.append(el(doc, 'b', '', 'Mock mode:'), doc.createTextNode(' the results are canned answers, not a real verdict.'));
  p.append(icon(doc, 'info', 14), words);
  return p;
}

export const el = (doc, tag, cls, text) => {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
export const btn = (doc, label, onClick, cls = 'btn btn-sm') => {
  const b = el(doc, 'button', cls, label);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
};

/** A button that is only an icon from icons.mjs, never a glyph (docs/design-system.md › Icons). `label` is its aria-label. */
export const iconBtn = (doc, name, label, onClick, cls = 'btn btn-sm btn-quiet btn-icon', size = 16) => {
  const b = btn(doc, null, onClick, cls);
  b.setAttribute('aria-label', label);
  b.append(icon(doc, name, size));
  return b;
};

/** A past run's badge, on the Tests page (board 19) and in the picker (board 25, C11): an exactly equal request says
 *  so; else green finished, red failed, a plain stopped. One helper, so the two lists speak the same badge language. */
export function runStatusBadge(doc, r) {
  if (r.sameAs) return el(doc, 'span', 'badge', 'Same request as another');
  if (r.status === 'done') return el(doc, 'span', 'badge green', 'Finished');
  if (r.status === 'error') return el(doc, 'span', 'badge red', 'Failed');
  return el(doc, 'span', 'badge', 'Stopped');
}

/** Board 39: a past run that cannot become an example stays listed, but its box or radio is disabled and says why in text
 *  (`.wft-pick-why`), never by colour alone. aria-disabled plus aria-describedby, so a screen reader in browse mode reads
 *  the reason with it. `row` is the label it sits in (greyed through `.is-refused`). */
export function refusedRun(doc, { row, input, text, reason, id }) {
  const why = el(doc, 'span', 'wft-pick-why', reason || '');
  why.id = id;
  text.append(why);
  input.disabled = true;
  input.checked = false;
  input.setAttribute('aria-disabled', 'true');
  input.setAttribute('aria-describedby', id);
  row.classList.add('is-refused');
}

/** A server reason as a sentence: "the name must be …" → "The name must be ….". */
export const sentence = (s) => {
  const t = String(s || '').trim();
  return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? '' : '.'}` : t;
};

/** A .seg radio group. options = [[value, text]]; onPick(value) gets the value as given. */
export function seg(doc, label, options, value, onPick) {
  const g = el(doc, 'div', 'seg');
  g.setAttribute('role', 'radiogroup');
  g.setAttribute('aria-label', label);
  const paint = (v) => {
    for (const b of g.children) {
      const on = b.dataset.value === String(v);
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  };
  for (const [v, text] of options) {
    const b = btn(doc, text, () => { paint(v); onPick(v); }, '');
    b.setAttribute('role', 'radio');
    b.dataset.value = String(v);
    g.append(b);
  }
  paint(value);
  return g;
}

/** A .field: a <label for> when the control has an id, else a span for a group; an optional "opt" word and hint. */
export function field(doc, label, control, { id = null, hint = null, opt = null } = {}) {
  const f = el(doc, 'div', 'field');
  const l = el(doc, id ? 'label' : 'span', 'label', label);
  if (id) l.htmlFor = id;
  if (opt) l.append(el(doc, 'span', 'opt', ` ${opt}`));
  f.append(l, control);
  if (hint) f.append(el(doc, 'span', 'hint', hint));
  return f;
}

/** A card with its own heading (aria-labelledby) and hint. */
export function card(doc, title, id, hint = null, cls = '') {
  const c = el(doc, 'section', `card wft-card${cls ? ` ${cls}` : ''}`);
  const h = el(doc, 'h2', '', title);
  h.id = id;
  c.setAttribute('aria-labelledby', id);
  c.append(h);
  if (hint) c.append(el(doc, 'p', 'hint', hint));
  return c;
}

/**
 * A dialog on the shared layout: title, body, an error line, [Remove], Cancel and the confirming button.
 * onConfirm() → {ok, error?} (or a promise of it); the dialog closes on ok and shows the error otherwise.
 * onRemove() may return the element to focus once the dialog closes.
 */
export function testDialog({ doc, win, title, body, confirmLabel, onConfirm, onRemove = null, footStart = null, width = 'md' }) {
  const dlg = createDialog({ doc, win, width });
  const h = el(doc, 'h2', 'mk-dialog-title', title);
  h.id = 'mk-dialog-title';
  const error = el(doc, 'p', 'hint err wft-dlg-error');
  error.setAttribute('aria-live', 'polite');
  const foot = [];
  // onRemove may return where the focus goes next (the opener left with the removed line).
  if (onRemove) foot.push(btn(doc, 'Remove', () => { const next = onRemove(); dlg.close(); if (next && typeof next.focus === 'function') next.focus(); }, 'btn btn-danger wft-dlg-remove'));
  if (footStart) { footStart.classList.add('mk-foot-start'); foot.unshift(footStart); }   // U-T9: a link at the left of the row
  foot.push(btn(doc, 'Cancel', () => dlg.close(), 'btn'));
  const ok = btn(doc, confirmLabel, async () => {
    if (ok.disabled) return;   // busy, or nothing to confirm (a dispatched click still reaches a disabled button's listener)
    error.textContent = '';
    ok.disabled = true;
    dlg.setBusy(true);
    let res;
    try { res = await onConfirm(); } catch (e) { res = { ok: false, error: e && e.message ? e.message : String(e) }; }
    dlg.setBusy(false);
    ok.disabled = false;
    if (res && res.ok) dlg.close(); else error.textContent = (res && res.error) || 'That did not work. Try again.';
  }, 'btn btn-primary wft-dlg-ok');
  foot.push(ok);
  dlg.replace({ head: [h], body: [...body, error], foot });
  dlg.open();
  return Object.assign(dlg, { okButton: ok, errorLine: error });
}

// U-T9 (M1, D8): the person's own note on what a good result is. Worca does not check it.
export const NOTE_LABEL = 'What a good result has';
export const NOTE_OPT = 'in your own words';
export const NOTE_HINT = 'A note for people. Worca does not check it.';
/** The note's textarea in its field (the editor's card and the Use-as-example dialog share the words). */
export function noteField(doc, textarea) {
  return field(doc, NOTE_LABEL, textarea, { id: textarea.id, hint: NOTE_HINT, opt: NOTE_OPT });
}
