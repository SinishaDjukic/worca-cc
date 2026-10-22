// ui/public/marketplace/layers.mjs — the Marketplace's right sheet and centred dialog (marketplace P3, CONTRACT §3.3).
// Both are body-level .viewer-modal hosts, so dialogOpen() and modal-guard treat them like every other pop-up:
// Escape and the scrim reach only the layer on top. ONE sheet host per document, shared by every createSheet
// controller (P4 install, P6 manage and update); one dialog root per createDialog call, removed on close (SM21).
import { guardModal } from '../modal-guard.mjs';
import { icon } from '../icons.mjs';

/** Dispatched on the document after a layer closes; detail { layer: 'sheet' | 'dialog' }. */
export const LAYER_CLOSED = 'mk-layer-closed';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]';
const WIDTHS = ['sm', 'md', 'lg'];
const KINDS = ['viewer', 'decision', 'form'];
const sheets = new WeakMap();        // Document -> the one sheet host and its parts
const openDialog = new WeakMap();    // Document -> { layer, handOff } of the createDialog layer on screen

function make(doc, tag, cls) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

function focusables(panel) {
  return [...panel.querySelectorAll(FOCUSABLE)].filter((n) => n.tabIndex >= 0 && !n.closest('[hidden], .hidden') && n.checkVisibility?.() !== false);
}

// Tab / Shift+Tab wrap between the panel's first and last focusable element.
function trapTab(panel) {
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const list = focusables(panel);
    const active = panel.ownerDocument.activeElement;
    if (!list.length) { e.preventDefault(); panel.focus(); return; }
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && (active === first || active === panel)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  });
}

// What close() needs to find the opener again after a re-render: its data-focus-key (the page's re-render key), else
// its first class and the first of data-key / data-name / data-id it carries (no CSS.escape: jsdom lacks it).
function markOf(opener) {
  if (!opener || typeof opener.focus !== 'function') return null;
  const cls = opener.classList?.[0] || null;
  const attr = ['key', 'name', 'id'].find((k) => opener.dataset?.[k] != null) || null;
  return { el: opener, focusKey: opener.dataset?.focusKey ?? null, cls, attr, value: attr ? opener.dataset[attr] : null };
}

// The opener itself, else the element carrying its data-focus-key, else the first with its class and data-* value
// (openers often share a first class such as `btn`, so the focus key goes first).
function refind(doc, mark) {
  if (!mark) return null;
  if (mark.el.isConnected) return mark.el;
  if (mark.focusKey != null) {
    for (const n of doc.querySelectorAll('[data-focus-key]')) if (n.dataset.focusKey === mark.focusKey) return n;
  }
  if (!mark.cls || !mark.attr) return null;
  for (const n of doc.getElementsByClassName(mark.cls)) if (n.dataset[mark.attr] === mark.value) return n;
  return null;
}

function fill(region, part) {
  if (part === undefined) return;
  region.replaceChildren(...(part == null ? [] : Array.isArray(part) ? part : [part]));
}

function focusIn(panel, closeButton) {
  const target = panel.querySelector('[data-autofocus]') || closeButton || focusables(panel)[0] || panel;
  target.focus();
}

// Focus goes back to the opener, or its re-rendered twin; when neither exists it stays where onClose put it,
// and never on a control inside the layer that just left the screen.
function focusBack(doc, root, mark) {
  const back = refind(doc, mark);
  if (back) back.focus();
  if (root.contains(doc.activeElement)) doc.activeElement.blur();
}

function closed(doc, win, layer) {
  doc.dispatchEvent(new win.CustomEvent(LAYER_CLOSED, { detail: { layer } }));
}

function sheetHost(doc) {
  const known = sheets.get(doc);
  if (known) return known;
  const root = make(doc, 'div', 'viewer-modal mk-layer mk-sheet-host hidden');
  root.id = 'mk-sheet-host';
  const panel = make(doc, 'section', 'mk-sheet');
  panel.id = 'mk-sheet';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'mk-sheet-title');
  panel.tabIndex = -1;
  const headRow = make(doc, 'header', 'mk-sheet-head');
  const head = make(doc, 'div', 'mk-sheet-slot');
  const closeButton = make(doc, 'button', 'btn btn-quiet btn-icon mk-close');
  closeButton.type = 'button';
  closeButton.dataset.act = 'close';
  closeButton.setAttribute('aria-label', 'Close');
  closeButton.append(icon(doc, 'x', 16));
  headRow.append(head, closeButton);
  const body = make(doc, 'div', 'mk-sheet-body');
  const foot = make(doc, 'footer', 'mk-sheet-foot');
  panel.append(headRow, body, foot);
  root.append(panel);
  doc.body.append(root);
  const s = { root, panel, head, body, foot, closeButton, owner: null };
  closeButton.addEventListener('click', () => { const o = s.owner; if (o && !o.busy()) o.layer.close(); });
  trapTab(panel);
  sheets.set(doc, s);
  return s;
}

/** A controller over the ONE reused sheet host (created on first use, appended to <body>). */
export function createSheet({ doc, win, onClose = () => {}, kind = 'viewer' }) {
  const s = sheetHost(doc);
  const { root, panel, closeButton } = s;
  let busyOn = false;
  let mark = null;
  let guard = null;
  let isDirty = null;     // SM48: setKind(kind, { isDirty }) — a form whose controls apply at once says when it is dirty
  const busy = () => busyOn;
  const own = { busy, layer: null };
  const isOpen = () => s.owner === own && root.isConnected && !root.classList.contains('hidden');
  const paintBusy = () => {
    if (busyOn) panel.setAttribute('aria-busy', 'true'); else panel.removeAttribute('aria-busy');
    closeButton.disabled = busyOn;
  };
  // Another controller takes the host: this one's onClose runs, focus does not move.
  own.handOff = () => {
    s.owner = null;
    guard?.release();
    guard = null;
    mark = null;
    onClose();
  };
  function close() {
    if (!isOpen()) return;
    s.owner = null;
    root.classList.add('hidden');
    guard?.release();
    guard = null;
    panel.removeAttribute('aria-busy');
    closeButton.disabled = false;
    const back = mark;
    mark = null;
    onClose();
    focusBack(doc, root, back);
    closed(doc, win, 'sheet');
  }
  const layer = {
    root, panel, head: s.head, body: s.body, foot: s.foot, closeButton,
    open(opener = doc.activeElement) {
      if (s.owner && s.owner !== own) s.owner.handOff();
      if (!isOpen() || (opener && !root.contains(opener))) mark = markOf(opener);
      if (!root.isConnected) doc.body.append(root);
      s.owner = own;
      paintBusy();
      root.classList.remove('hidden');
      guard = guardModal(root, { kind, close, busy, ...(isDirty ? { isDirty } : {}) }).opened();
      focusIn(panel, closeButton);
    },
    close,
    isOpen,
    setBusy(on) {
      busyOn = !!on;
      if (isOpen()) paintBusy();
    },
    replace(parts) {
      if (parts === undefined) { s.head.replaceChildren(); s.body.replaceChildren(); s.foot.replaceChildren(); return; }
      fill(s.head, parts.head);
      fill(s.body, parts.body);
      fill(s.foot, parts.foot);
    },
    setKind(next, { isDirty: dirty } = {}) {
      if (KINDS.includes(next)) kind = next;
      isDirty = typeof dirty === 'function' ? dirty : null;
      if (isOpen()) guard.opened({ kind, close, busy, ...(isDirty ? { isDirty } : {}) });
    },
  };
  own.layer = layer;
  return layer;
}

/** One dialog per opening (SM21): built here, appended to <body> by open(), removed by close(). No Close of its own (SM40). */
export function createDialog({ doc, win, width = 'md', onClose = () => {}, kind = 'decision' }) {
  const root = make(doc, 'div', 'viewer-modal mk-layer mk-dialog-host');
  root.id = 'mk-dialog-host';
  const panel = make(doc, 'section', 'mk-dialog');
  panel.id = 'mk-dialog';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'mk-dialog-title');
  panel.dataset.width = WIDTHS.includes(width) ? width : 'md';
  panel.tabIndex = -1;
  const head = make(doc, 'header', 'mk-dialog-head');
  const body = make(doc, 'div', 'mk-dialog-body');
  const foot = make(doc, 'footer', 'mk-dialog-foot');
  panel.append(head, body, foot);
  root.append(panel);
  trapTab(panel);
  let busyOn = false;
  let shown = false;
  let mark = null;
  let guard = null;
  const busy = () => busyOn;
  const isOpen = () => shown && root.isConnected;
  const paintBusy = () => {
    if (busyOn) panel.setAttribute('aria-busy', 'true'); else panel.removeAttribute('aria-busy');
    for (const x of panel.querySelectorAll('.mk-dlg-close')) x.disabled = busyOn;
  };
  function takeDown() {
    shown = false;
    root.remove();
    guard?.release();
    guard = null;
    if (openDialog.get(doc)?.layer === layer) openDialog.delete(doc);
  }
  function close() {
    if (!isOpen()) return;
    takeDown();
    const back = mark;
    mark = null;
    onClose();
    focusBack(doc, root, back);
    closed(doc, win, 'dialog');
  }
  const layer = {
    root, panel, head, body, foot, closeButton: null,
    open(opener = doc.activeElement) {
      const other = openDialog.get(doc);
      if (other && other.layer !== layer) other.handOff();
      if (!isOpen() || (opener && !root.contains(opener))) mark = markOf(opener);
      doc.body.append(root);
      shown = true;
      openDialog.set(doc, { layer, handOff });
      paintBusy();
      guard = guardModal(root, { kind, close, busy }).opened();
      focusIn(panel, null);
    },
    close,
    isOpen,
    setBusy(on) {
      busyOn = !!on;
      paintBusy();
    },
    replace(parts) {
      if (parts === undefined) { head.replaceChildren(); body.replaceChildren(); foot.replaceChildren(); return; }
      fill(head, parts.head);
      fill(body, parts.body);
      fill(foot, parts.foot);
    },
    setKind(next) {
      if (KINDS.includes(next)) kind = next;
      if (isOpen()) guard.opened({ kind, close, busy });
    },
  };
  // Another dialog opens: this one leaves first, its onClose runs, focus does not move.
  function handOff() {
    if (!isOpen()) return;
    takeDown();
    mark = null;
    onClose();
  }
  return layer;
}
