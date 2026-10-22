// test/marketplace-layers.test.mjs — the 600px sheet, the centred dialog and menus above them (marketplace P3, CONTRACT §3.3).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { createSheet, createDialog, LAYER_CLOSED } from '../ui/public/marketplace/layers.mjs';
import { dialogOpen, guardModal } from '../ui/public/modal-guard.mjs';
import { openMenu } from '../ui/public/workflows/menu.mjs';
import { ICONS } from '../ui/public/icons.mjs';

const trackDom = useDomRelease(afterEach);
const CSS = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
function setup() {
  const { window } = trackDom(new JSDOM('<!doctype html><body><button id="opener" class="mk-tile" data-key="off/a">a</button></body>'));
  return { doc: window.document, win: window };
}
const esc = (doc) => doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
const press = (win, el) => { el.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true })); el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); };

test('createSheet: a body-level .viewer-modal host, a right panel, focus in and back, Escape closes it', () => {
  const { doc, win } = setup();
  const closed = []; const events = [];
  const sheet = createSheet({ doc, win, onClose: () => closed.push('a') });
  doc.addEventListener(LAYER_CLOSED, (e) => events.push([e.detail.layer, dialogOpen(doc), doc.activeElement.id]));
  const hiddenAtFocus = [];
  doc.addEventListener('focusin', (e) => { if (sheet.root.contains(e.target)) hiddenAtFocus.push(sheet.root.classList.contains('hidden')); });
  assert.deepEqual([sheet.root.id, sheet.root.className, sheet.root.parentElement === doc.body], ['mk-sheet-host', 'viewer-modal mk-layer mk-sheet-host hidden', true]);
  assert.deepEqual([sheet.panel.id, sheet.panel.className, sheet.panel.getAttribute('role'), sheet.panel.getAttribute('aria-modal'), sheet.panel.getAttribute('aria-labelledby')],
    ['mk-sheet', 'mk-sheet', 'dialog', 'true', 'mk-sheet-title']);
  assert.deepEqual([sheet.head.className, sheet.body.className, sheet.foot.className], ['mk-sheet-slot', 'mk-sheet-body', 'mk-sheet-foot']);
  assert.deepEqual([sheet.closeButton.className, sheet.closeButton.dataset.act, sheet.closeButton.getAttribute('aria-label'), sheet.closeButton.parentElement.className],
    ['btn btn-quiet btn-icon mk-close', 'close', 'Close', 'mk-sheet-head']);
  const opener = doc.getElementById('opener'); opener.focus();
  sheet.open();                                    // opener = doc.activeElement
  sheet.open();                                    // again while open: the opener stays the tile, never the focused Close
  assert.deepEqual([sheet.isOpen(), dialogOpen(doc), doc.activeElement === sheet.closeButton, hiddenAtFocus], [true, true, true, [false]], 'focus enters after the host shows');
  esc(doc);
  sheet.close();                                   // closing a closed layer does nothing
  assert.deepEqual([sheet.isOpen(), dialogOpen(doc), closed, events, doc.activeElement === opener], [false, false, ['a'], [['sheet', false, 'opener']], true],
    'LAYER_CLOSED once, after the host hid and focus went back');
});

test('createSheet: [data-autofocus] wins; the scrim closes, a click inside does not; busy holds it; replace fills regions', () => {
  const { doc, win } = setup();
  const sheet = createSheet({ doc, win });
  const field = doc.createElement('input'); field.dataset.autofocus = '';
  const title = Object.assign(doc.createElement('h2'), { id: 'mk-sheet-title', className: 'subpage-title', textContent: 'slack-chat' });
  const save = Object.assign(doc.createElement('button'), { className: 'btn btn-primary', textContent: 'Save' });
  sheet.replace({ head: title, body: [field], foot: [save] });
  assert.deepEqual([sheet.head.firstChild === title, sheet.body.firstChild === field, sheet.foot.firstChild === save], [true, true, true]);
  sheet.open(doc.getElementById('opener'));
  assert.equal(doc.activeElement, field);
  press(win, sheet.panel);
  assert.equal(sheet.isOpen(), true, 'a click inside the panel');
  sheet.setBusy(true);
  assert.deepEqual([sheet.panel.getAttribute('aria-busy'), sheet.closeButton.disabled], ['true', true]);
  esc(doc); press(win, sheet.root);
  assert.equal(sheet.isOpen(), true, 'busy: Escape and the scrim wait');
  sheet.setBusy(false); press(win, sheet.root);
  assert.equal(sheet.isOpen(), false, 'the scrim closes it');
  sheet.replace({ foot: null });
  assert.deepEqual([sheet.body.firstChild === field, sheet.foot.childNodes.length], [true, 0], 'an omitted region stays; null empties one');
  sheet.replace();
  assert.deepEqual([sheet.head.childNodes.length, sheet.body.childNodes.length, sheet.panel.contains(sheet.closeButton)], [0, 0, true],
    'replace() empties the reused sheet; its Close stays (SM21)');
});

test('setKind(form): the scrim never closes a form sheet; Escape closes it while untouched; an open layer re-arms (SM64)', () => {
  const { doc, win } = setup();
  const sheet = createSheet({ doc, win }); sheet.setKind('form'); sheet.open(doc.getElementById('opener'));
  press(win, sheet.root);
  assert.equal(sheet.isOpen(), true);
  esc(doc);
  assert.equal(sheet.isOpen(), false);
  const s2 = createSheet({ doc, win }); s2.open(doc.getElementById('opener')); s2.setKind('form');
  press(win, s2.root);
  assert.equal(s2.isOpen(), true, 'setKind on an open sheet re-arms the guard: the scrim no longer closes a form');
  const s3 = createSheet({ doc, win, kind: 'form' }); s3.open(doc.getElementById('opener'));
  press(win, s3.root);
  assert.equal(s3.isOpen(), true, 'createSheet({ kind }) arms that kind at open()');
});

test('one sheet at a time; focus returns to the re-rendered opener (same first class and data-key)', () => {
  const { doc, win } = setup();
  const log = [];
  const a = createSheet({ doc, win, onClose: () => log.push('a') });
  const b = createSheet({ doc, win, onClose: () => log.push('b') });
  const events = []; doc.addEventListener(LAYER_CLOSED, (e) => events.push(e.detail.layer));
  a.open(doc.getElementById('opener')); b.open(doc.getElementById('opener'));
  assert.deepEqual([log, events, a.isOpen(), b.isOpen(), a.root === b.root, doc.querySelectorAll('#mk-sheet-host').length], [['a'], [], false, true, true, 1],
    'a hand-off: the host stays up, no LAYER_CLOSED');
  doc.getElementById('opener').remove();
  const twin = (cls, key) => { const n = Object.assign(doc.createElement('button'), { className: cls }); n.dataset.key = key; doc.body.append(n); return n; };
  twin('mk-tile', 'off/b'); twin('mk-row', 'off/a');   // same first class, other key; same key, other class
  const fresh = twin('mk-tile', 'off/a');
  b.close();
  assert.deepEqual([log, events, doc.activeElement === fresh], [['a', 'b'], ['sheet'], true]);
});

test('focus returns to the opener\'s data-focus-key twin first: a .btn opener\'s class and data-name can match another button', () => {
  const { doc, win } = setup();
  const btn = (attrs) => { const n = Object.assign(doc.createElement('button'), { className: 'btn' }); Object.assign(n.dataset, attrs); return n; };
  const opener = btn({ focusKey: 'set:acme', name: 'acme' }); doc.body.append(opener);
  const sheet = createSheet({ doc, win }); sheet.open(opener);
  opener.remove();
  doc.body.prepend(btn({ name: 'acme' }));            // a decoy earlier in the document: same first class, same data-name
  const twin = btn({ focusKey: 'set:acme' }); doc.body.append(twin);
  sheet.close();
  assert.equal(doc.activeElement === twin, true, 'the re-rendered twin, never the decoy');
});

test('Tab and Shift+Tab wrap inside the open panel, past a control CSS hides', () => {
  const { doc, win } = setup();
  const sheet = createSheet({ doc, win });
  const last = Object.assign(doc.createElement('button'), { textContent: 'Save' });
  const unseen = Object.assign(doc.createElement('button'), { textContent: 'Hidden by CSS' }); unseen.checkVisibility = () => false;
  sheet.replace({ foot: [last, unseen] }); sheet.open(doc.getElementById('opener'));
  last.focus();
  last.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert.equal(doc.activeElement, sheet.closeButton);
  sheet.closeButton.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(doc.activeElement, last);
});

test('createDialog: one per opening, removed on close (SM21), no Close of its own (SM40); above the sheet; Escape closes only the top layer', () => {
  const { doc, win } = setup();
  const sheet = createSheet({ doc, win });
  const inside = doc.createElement('button'); sheet.replace({ body: [inside] }); sheet.open(doc.getElementById('opener')); inside.focus();
  const dlg = createDialog({ doc, win, width: 'sm' });
  assert.deepEqual([dlg.root.id, dlg.root.className, dlg.root.isConnected, dlg.panel.id, dlg.panel.className, dlg.panel.dataset.width, dlg.panel.getAttribute('aria-labelledby')],
    ['mk-dialog-host', 'viewer-modal mk-layer mk-dialog-host', false, 'mk-dialog', 'mk-dialog', 'sm', 'mk-dialog-title']);
  assert.deepEqual([dlg.head.className, dlg.body.className, dlg.foot.className, dlg.closeButton, dlg.panel.querySelector('button')],
    ['mk-dialog-head', 'mk-dialog-body', 'mk-dialog-foot', null, null], 'SM40: a dialog draws no Close of its own');
  assert.equal(createDialog({ doc, win }).panel.dataset.width, 'md', 'md by default');
  const own = Object.assign(doc.createElement('button'), { className: 'btn btn-quiet btn-icon mk-dlg-close' }); own.setAttribute('aria-label', 'Close');
  dlg.replace({ head: [own] });
  dlg.open(inside);
  assert.deepEqual([doc.getElementById('mk-dialog-host') === dlg.root, doc.activeElement === own], [true, true], 'focus goes to the first focusable in the dialog');
  const confirm = Object.assign(doc.createElement('div'), { className: 'viewer-modal' }); doc.body.append(confirm);
  guardModal(confirm, { kind: 'decision', close: () => confirm.classList.add('hidden') }).opened();
  esc(doc);
  assert.deepEqual([confirm.classList.contains('hidden'), dlg.isOpen(), sheet.isOpen()], [true, true, true]);
  esc(doc);
  assert.deepEqual([dlg.isOpen(), dlg.root.isConnected, doc.getElementById('mk-dialog'), sheet.isOpen(), doc.activeElement === inside], [false, false, null, true, true]);
  const a = createDialog({ doc, win, onClose: () => inside.dataset.closed = 'a' }); a.open(inside);
  const b = createDialog({ doc, win }); b.open(inside);
  assert.deepEqual([a.isOpen(), inside.dataset.closed, doc.querySelectorAll('#mk-dialog').length], [false, 'a', 1], 'one dialog at a time');
  b.close();
  esc(doc);
  assert.equal(sheet.isOpen(), false);
});

test('createDialog: decision closes on the scrim, form never; busy holds Escape, the scrim and its .mk-dlg-close; setKind re-arms an open dialog', () => {
  const { doc, win } = setup();
  const events = []; doc.addEventListener(LAYER_CLOSED, (e) => events.push(e.detail.layer));
  const opener = doc.getElementById('opener');
  const d1 = createDialog({ doc, win }); d1.open(opener);
  press(win, d1.root);
  const d2 = createDialog({ doc, win, kind: 'form' }); d2.open(opener);
  press(win, d2.root);
  assert.deepEqual([d1.isOpen(), d2.isOpen(), events], [false, true, ['dialog']], 'decision: the scrim is the safe No; form: never');
  d2.close();
  const own = Object.assign(doc.createElement('button'), { className: 'btn btn-quiet btn-icon mk-dlg-close' });
  const d3 = createDialog({ doc, win }); d3.replace({ head: [own] }); d3.open(opener);
  d3.setBusy(true);
  esc(doc); press(win, d3.root);
  assert.deepEqual([d3.isOpen(), d3.panel.getAttribute('aria-busy'), own.disabled], [true, 'true', true], 'busy: Escape and the scrim wait');
  d3.setBusy(false); d3.setKind('form'); press(win, d3.root);
  assert.deepEqual([d3.isOpen(), d3.panel.getAttribute('aria-busy'), own.disabled], [true, null, false], 'setKind re-arms an open dialog');
  esc(doc);
  assert.deepEqual([d3.isOpen(), events, doc.activeElement === opener], [false, ['dialog', 'dialog', 'dialog'], true]);
});

test('style.css: the 600px right sheet; z-order sheet 50 < dialog 52 < menus over a layer 58 < #confirm-modal 60; solid red in a dialog', () => {
  for (const re of [/\.mk-sheet\{position:absolute;top:0;right:0;bottom:0;width:min\(600px,100%\);/, /\.viewer-modal\.mk-dialog-host\{z-index:52;/,
    /body:has\(> \.mk-layer:not\(\.hidden\)\) > \.wfv-menu\{z-index:58;\}/, /#confirm-modal\.viewer-modal\{z-index:60;\}/,
    /\.mk-dialog \.btn-danger\{background:var\(--red-ink-strong\);color:var\(--panel\);\}/, /\.mk-sheet:focus,\.mk-dialog:focus\{outline:none;\}/,
    /\.mk-dialog-head > \.mk-dlg-close\{margin-left:auto;flex:none;\}/, /\.mk-sheet-body > \*,\.mk-dialog-body > \*\{flex-shrink:0;\}/]) assert.match(CSS, re);
});

test('openMenu: an item may lead with an icons.mjs glyph and be destructive', () => {
  const { doc } = setup();
  const anchor = doc.getElementById('opener');
  const m = openMenu({ doc, anchor, label: 'github-source actions', items: [{ label: 'Check health', icon: 'pulse' }, { sep: true }, { label: 'Remove…', icon: 'trash', danger: true }] });
  const [health, remove] = m.el.querySelectorAll('.wfv-menu-item');
  assert.deepEqual([health.className, health.firstElementChild.className, health.firstElementChild.innerHTML.includes(ICONS.pulse)], ['menu-item wfv-menu-item', 'ic wfv-menu-ic', true]);
  assert.deepEqual([remove.className, remove.textContent], ['menu-item wfv-menu-item is-danger', 'Remove…']);
  m.close();
});

test('a close() by code always closes, busy or not (P6: Save closes its sheet; leaving #marketplace closes a running review)', () => {
  const { doc, win } = setup();
  const closed = [];
  const sheet = createSheet({ doc, win, onClose: () => closed.push('sheet') });
  sheet.open(doc.getElementById('opener')); sheet.setBusy(true);
  sheet.close();
  assert.deepEqual([sheet.isOpen(), closed, sheet.closeButton.disabled, sheet.panel.hasAttribute('aria-busy')], [false, ['sheet'], false, false]);
  const dlg = createDialog({ doc, win, onClose: () => closed.push('dialog') });
  dlg.open(doc.getElementById('opener')); dlg.setBusy(true);
  dlg.close();
  assert.deepEqual([dlg.isOpen(), closed], [false, ['sheet', 'dialog']]);
});
test('Close closes; a closed sheet is not handed off again; focus never stays in a hidden sheet', () => {
  const { doc, win } = setup(); const op = doc.getElementById('opener'); const log = [];
  const a = createSheet({ doc, win, onClose: () => log.push('a') });
  const b = createSheet({ doc, win, onClose: () => log.push('b') });
  op.focus(); a.open(op); a.closeButton.click();
  assert.deepEqual([a.isOpen(), doc.activeElement === op, log], [false, true, ['a']]);
  b.open(op);
  assert.deepEqual(log, ['a'], 'the closed sheet\'s onClose does not run again on hand-off');
  op.remove(); b.close();
  assert.equal(b.root.contains(doc.activeElement), false);
});
test('busy set before open shows; a handed-off controller\'s busy never paints the current sheet', () => {
  const { doc, win } = setup(); const op = doc.getElementById('opener');
  const s = createSheet({ doc, win }); s.setBusy(true); s.open(op);
  assert.deepEqual([s.panel.getAttribute('aria-busy'), s.closeButton.disabled], ['true', true]);
  const t = createSheet({ doc, win }); t.open(op);
  assert.deepEqual([t.panel.hasAttribute('aria-busy'), t.closeButton.disabled], [false, false]);
  s.setBusy(true);
  assert.deepEqual([t.panel.hasAttribute('aria-busy'), t.closeButton.disabled], [false, false]);
});
test('Tab wraps from the focused panel itself and inside a layer with nothing focusable', () => {
  const { doc, win } = setup(); const op = doc.getElementById('opener');
  const sheet = createSheet({ doc, win });
  const last = Object.assign(doc.createElement('button'), { textContent: 'Save' });
  sheet.replace({ foot: [last] }); sheet.open(op); sheet.panel.focus();
  const e = new win.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
  sheet.panel.dispatchEvent(e);
  assert.deepEqual([e.defaultPrevented, doc.activeElement === last], [true, true]);
  sheet.close();
  const dlg = createDialog({ doc, win }); dlg.open(op);
  const t = new win.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  dlg.panel.dispatchEvent(t);
  assert.deepEqual([t.defaultPrevented, doc.activeElement === dlg.panel], [true, true]);
  dlg.close();
});
test('dialog close is idempotent; replace fills and empties every region; the reused sheet empties its foot', () => {
  const { doc, win } = setup(); const op = doc.getElementById('opener'); const log = []; const ev = [];
  doc.addEventListener(LAYER_CLOSED, (e) => ev.push(e.detail.layer));
  const dlg = createDialog({ doc, win, onClose: () => log.push('x') });
  const h = doc.createElement('h2'); const p = doc.createElement('p'); const b = doc.createElement('button');
  dlg.replace({ head: [h], body: p, foot: [b] });
  assert.deepEqual([dlg.head.firstChild === h, dlg.body.firstChild === p, dlg.foot.firstChild === b], [true, true, true]);
  dlg.replace();
  assert.deepEqual([dlg.head.childNodes.length, dlg.body.childNodes.length, dlg.foot.childNodes.length], [0, 0, 0]);
  dlg.open(op); dlg.close(); dlg.close();
  assert.deepEqual([log, ev], [['x'], ['dialog']]);
  const sheet = createSheet({ doc, win });
  sheet.replace({ foot: [doc.createElement('button')] }); sheet.replace();
  assert.equal(sheet.foot.childNodes.length, 0);
});
test('focus goes back to the opener after onClose ran', () => {
  const { doc, win } = setup(); const op = doc.getElementById('opener');
  const other = doc.createElement('button'); doc.body.append(other);
  const s = createSheet({ doc, win, onClose: () => other.focus() }); s.open(op); s.close();
  assert.equal(doc.activeElement, op);
});

test('setKind(form, { isDirty }): a control applied at once is no unsaved change; Escape asks only while isDirty() (P6, SM48)', async () => {
  const { doc, win } = setup();
  let dirty = false;
  const sheet = createSheet({ doc, win });
  const sw = Object.assign(doc.createElement('input'), { type: 'checkbox' });
  sheet.replace({ body: [sw] });
  sheet.setKind('form', { isDirty: () => dirty });
  sheet.open(doc.getElementById('opener'));
  sw.checked = true;
  sw.dispatchEvent(new win.Event('change', { bubbles: true }));
  esc(doc);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sheet.isOpen(), false, 'the switch applied at once: Escape just closes');
  dirty = true;
  sheet.open(doc.getElementById('opener'));
  esc(doc);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual([!!doc.querySelector('dialog.discard-modal'), sheet.isOpen()], [true, true], '"Discard changes?" while isDirty()');
  press(win, sheet.root);
  assert.equal(sheet.isOpen(), true, 'a form sheet never closes on the scrim');
  doc.querySelector('dialog.discard-modal .discard-keep').click();
  const s2 = createSheet({ doc, win });
  const box = Object.assign(doc.createElement('input'), { type: 'checkbox' });
  s2.replace({ body: [box] });
  s2.open(doc.getElementById('opener'));
  s2.setKind('form', { isDirty: () => false });                      // the re-arm of an open layer (SM64) carries it too
  box.checked = true;
  box.dispatchEvent(new win.Event('change', { bubbles: true }));
  esc(doc);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual([s2.isOpen(), doc.querySelector('dialog.discard-modal')], [false, null]);
});
