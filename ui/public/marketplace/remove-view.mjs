// ui/public/marketplace/remove-view.mjs — Pure DOM for board 3.4: the Remove and Blocked dialogs, and the Purge confirm
// of Leftover data (L11). installed.mjs opens them in createDialog.
import { kindTile, glyphTile, chip } from './kinds.mjs';
import { icon } from '../icons.mjs';
import { glyphOf } from './installed-model.mjs';

const list = (v) => (Array.isArray(v) ? v : []);

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function button(doc, cls, text) {
  const b = h(doc, 'button', cls, text);
  b.type = 'button';
  return b;
}

// [tile, h2#mk-dialog-title, Close]: P3's dialog draws no Close of its own (SM40); its head is header.mk-dialog-head.
function head(doc, tile, title) {
  const t = h(doc, 'h2', 'section-title', title);
  t.id = 'mk-dialog-title';
  const close = button(doc, 'btn btn-quiet btn-icon mk-dlg-close');
  close.dataset.dlg = 'close';
  close.setAttribute('aria-label', 'Close');
  close.append(icon(doc, 'x', 16));
  return [tile, t, close];
}

// [Cancel, the danger button]
function foot(doc, act, label, disabled = false) {
  const cancel = button(doc, 'btn btn-quiet', 'Cancel');
  cancel.dataset.dlg = 'cancel';
  const go = button(doc, 'btn btn-danger mk-confirm', label);
  go.dataset.dlg = act;
  go.disabled = !!disabled;
  return [cancel, go];
}

// The dialog's error line, hidden until an error (P7's hook).
function err(doc) {
  const p = h(doc, 'p', 'hint err mk-dlg-err');
  p.setAttribute('role', 'alert');
  p.hidden = true;
  return p;
}

// section.mk-sec[aria-labelledby=<id>] > h3.subsection-title#<id>
function sec(doc, id, title) {
  const s = h(doc, 'section', 'mk-sec');
  s.setAttribute('aria-labelledby', id);
  const t = h(doc, 'h3', 'subsection-title', title);
  t.id = id;
  s.append(t);
  return s;
}

/** Remove {plugin}?: Goes away, Changes, the purge box with "Cannot be undone.", Cancel / Remove. */
export function renderRemoveDialog(doc, { name, iconKind, goesAway = [], changes = [] }) {
  const body = h(doc, 'div', 'mk-dlg-body');
  const goes = list(goesAway);
  if (goes.length) {
    const s = sec(doc, 'mk-dlg-goes', 'Goes away');
    const ul = h(doc, 'ul', 'mk-goes');
    for (const g of goes) {
      const li = h(doc, 'li');
      li.append(kindTile(doc, g.kind, { size: 'sm' }), h(doc, 'span', 'mk-goes-k', g.text));
      if (g.id != null) li.append(h(doc, 'span', 'mk-id mk-mono', String(g.id)));
      ul.append(li);
    }
    s.append(ul);
    body.append(s);
  }
  const ch = list(changes);
  if (ch.length) {
    const s = sec(doc, 'mk-dlg-changes', 'Changes');
    const ul = h(doc, 'ul', 'mk-changes');
    for (const c of ch) {
      const li = h(doc, 'li');
      li.append(chip(doc, 'n', c.set), h(doc, 'span', 'mk-meta', c.text));
      ul.append(li);
    }
    s.append(ul);
    body.append(s);
  }
  const opt = h(doc, 'div', 'mk-purge-opt');
  const label = h(doc, 'label', 'mk-check');
  const box = h(doc, 'input', 'mk-purge-box');
  box.type = 'checkbox';
  label.append(box, doc.createTextNode('Also delete its config, secrets and state'));
  opt.append(label, h(doc, 'p', 'mk-meta mk-consequence', 'Cannot be undone.'));
  body.append(opt, err(doc));
  return { head: head(doc, kindTile(doc, iconKind, { size: 'md' }), `Remove ${name}?`), body, foot: foot(doc, 'remove', 'Remove') };
}

/** {plugin} is still in use: Used by rows (P4's list rows) with Open links, the note, Remove disabled. */
export function renderBlockedDialog(doc, { name, iconKind, rows = [], note = '' }) {
  const body = h(doc, 'div', 'mk-dlg-body');
  const s = sec(doc, 'mk-dlg-used', 'Used by');
  const ul = h(doc, 'ul', 'mk-list mk-used');
  for (const r of list(rows)) {
    const li = h(doc, 'li', 'mk-list-row');
    const main = h(doc, 'div', 'mk-row-main');
    main.append(h(doc, 'div', 'mk-row-title mk-mono', r.title), h(doc, 'div', 'mk-meta', r.meta));
    li.append(kindTile(doc, r.kind, { size: 'sm' }), main);
    if (r.href) {
      const a = h(doc, 'a', 'mk-link mk-open', 'Open');
      a.dataset.dlg = 'open';
      a.setAttribute('href', r.href);
      a.append(icon(doc, 'chevron', 14));
      li.append(a);
    }
    ul.append(li);
  }
  s.append(ul);
  body.append(s, h(doc, 'p', 'mk-meta mk-used-note', note), err(doc));
  return { head: head(doc, kindTile(doc, iconKind, { size: 'md' }), `${name} is still in use`), body, foot: foot(doc, 'remove', 'Remove', true) };
}

/** Purge {plugin}? (L11): the removed plugin's glyph on a neutral tile, what goes, "Cannot be undone.", Cancel / Purge. */
export function renderPurgeDialog(doc, { name, iconKind }) {
  const body = h(doc, 'div', 'mk-dlg-body');
  body.append(h(doc, 'p', null, 'Deletes its config, secrets and state.'), h(doc, 'p', 'mk-meta mk-consequence', 'Cannot be undone.'), err(doc));
  return { head: head(doc, glyphTile(doc, glyphOf(iconKind), 'none', { size: 'md' }), `Purge ${name}?`), body, foot: foot(doc, 'purge', 'Purge') };
}
