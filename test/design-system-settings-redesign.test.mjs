// test/design-system-settings-redesign.test.mjs — what the Settings redesign added to the library:
//   SettingsRow: the value leads (a value, one supporting line, pickers as labelled fields), a row that opens clicks as a whole;
//   RowPicker: a labelled field of fixed width, a CompactMenu under it;
//   one Dialog: lifted to the window, focus in, Tab kept inside, Esc closes, focus back to the opener;
//   menus and radio groups by keyboard; the focus never dropped to the page by a redraw;
//   a menu item's supporting line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as C from '../ui/public/design-system/components/index.mjs';
import { rowPicker } from '../ui/public/design-system/components/settings-row.mjs';
import { watchDialogs, trapNext, focusables, openDialogs } from '../ui/public/design-system/components/dialog.mjs';
import { choiceMove, typeAhead, watchChoiceKeys, focusMenu } from '../ui/public/design-system/components/compact-menu.mjs';
import { controlAddress, atAddress, triggerOf, watchFocusBack } from '../ui/public/design-system/components/keep-open.mjs';

const dom = (html) => new JSDOM(`<body>${html}</body>`).window.document.body.firstElementChild;
const page = (html = '') => {
  const d = new JSDOM(`<!doctype html><body><div id="c">${html}</div></body>`, { url: 'http://x/#settings', pretendToBeVisual: true });
  return { win: d.window, doc: d.window.document, c: d.window.document.getElementById('c') };
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const key = (win, el, k, o = {}) => { const e = new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }); el.dispatchEvent(e); return e; };

// ---- SettingsRow: the value leads ----
test('settingsRow: the value alone on its line, the note as the row\'s hint; keepLine draws it; a sentence alone is the row\'s one line', () => {
  const r = dom(C.settingsRow({ name: 'Budget', value: '$1,000 a month', note: 'All tasks pause when it is spent', end: '<button class="btn">Change…</button>' }));
  const text = r.querySelector('.set-text');
  assert.deepEqual([...text.children].map((x) => x.className), ['set-value', 'set-said'], 'the value is the line; the note is kept for a screen reader, out of sight (list.one-line)');
  assert.equal(text.querySelector('.set-value').textContent, '$1,000 a month');
  assert.equal(r.querySelector('.set-name').title, 'All tasks pause when it is spent', 'the note is the name\'s tooltip');
  const kept = dom(C.settingsRow({ name: 'Budget', value: '$1,000 a month', note: 'All tasks pause when it is spent', keepLine: 'what a spent budget does' }));
  assert.deepEqual([...kept.querySelector('.set-text').children].map((x) => x.className), ['set-value', 'set-note'], 'a named fact keeps its line');
  assert.equal(kept.dataset.keepLine, 'what a spent budget does');
  assert.ok(r.querySelector('.set-end > .btn'), 'the control is at the row\'s end');
  const old = dom(C.settingsRow({ name: 'Setup', sentence: 'Checks this machine' }));
  assert.equal(old.querySelector('.set-value'), null);
  assert.equal(old.querySelector('.set-note').textContent, 'Checks this machine');
  assert.equal(dom(C.settingsRow({ name: 'Only a name' })).querySelector('.set-text').children.length, 0);
});

test('settingsRow: several choices are a line of labelled pickers under the supporting line', () => {
  const a = rowPicker({ id: 'whr', label: 'Goes to', text: 'Desktop', showLabel: true, items: [{ id: 'desktop', text: 'Desktop', checked: true }] });
  const b = rowPicker({ id: 'lvl', label: 'How much', text: 'Everything', showLabel: true, items: [] });
  const r = dom(C.settingsRow({ name: 'Runs', note: 'What reaches you', picks: a + b }));
  const picks = r.querySelector('.set-text > .set-picks');
  assert.equal(picks.querySelectorAll('.set-pick').length, 2);
  assert.deepEqual([...picks.querySelectorAll('.set-pick-l')].map((x) => x.textContent), ['Goes to', 'How much']);
  assert.equal(picks.previousElementSibling.className, 'set-note');
});

test('settingsRow: a row with more to show clicks as a whole; one with nothing more has no trigger', () => {
  const plain = dom(C.settingsRow({ name: 'Hourly rate', value: '$35 an hour' }));
  assert.equal(plain.querySelector('.set-open'), null);
  assert.equal(plain.querySelector('.set-chev'), null);
  assert.equal(plain.className, 'set-row');
  const closed = C.settingsRow({ name: 'Sync', note: 'First', help: 'Needs git', end: '<button class="switch" role="switch"></button>', fold: { open: false, attrs: { 'data-f': 's' } }, detailRows: C.settingsRow({ name: 'Remote' }) });
  const open = C.settingsRow({ name: 'Sync', note: 'First', help: 'Needs git', end: '<button class="switch" role="switch"></button>', fold: { open: true, attrs: { 'data-f': 's' } }, detailRows: C.settingsRow({ name: 'Remote' }) });
  const c = dom(closed), o = dom(open);
  assert.equal(c.firstElementChild.className, 'set-open', 'the line\'s trigger comes first: Tab reaches it before the row\'s own controls');
  assert.equal(c.querySelector('.set-open').getAttribute('aria-label'), 'Sync: more settings');
  assert.equal(c.querySelector('.set-open').getAttribute('title'), 'Needs git', 'the help moves to the trigger, which covers the name');
  assert.equal(c.querySelector('.set-name').hasAttribute('title'), false, 'one tooltip per control');
  assert.match(c.className, /\bis-opens\b/);
  assert.match(o.className, /\bis-opens is-open\b/);
  // nothing in the row's own line changes on open: no word, no width
  const line = (el) => [...el.children].filter((x) => !x.classList.contains('set-detail')).map((x) => x.outerHTML.replace('aria-expanded="true"', 'aria-expanded="false"')).join('');
  assert.equal(line(o), line(c));
  assert.ok(o.querySelector(':scope > .set-detail > .set-rows > .set-row'), 'what opened sits in the row\'s container');
});

// ---- RowPicker ----
test('rowPicker: a field that names what it chooses, its menu only when open, each pick names the picker and the value', () => {
  const items = [{ id: 'never', text: 'Never', checked: true, help: 'Stay' }, { id: '30', text: 'After 30 days' }];
  const closed = dom(rowPicker({ id: 'sv:arch', label: 'Archive', text: 'Never', items, tip: 'When a finished task is archived' }));
  const b = closed.querySelector('button');
  assert.match(b.className, /\bis-field\b/, 'the look of a field: a border, a fixed width');
  assert.equal(b.dataset.menu, 'sv:arch');
  assert.equal(b.getAttribute('aria-haspopup'), 'menu');
  assert.equal(b.getAttribute('aria-expanded'), 'false');
  assert.equal(b.getAttribute('aria-label'), 'Archive: Never');
  assert.equal(b.getAttribute('title'), 'When a finished task is archived');
  assert.equal(closed.querySelector('.menu'), null);
  assert.equal(closed.querySelector('.set-pick-l'), null, 'one picker in a row: the row\'s name is its label');
  const open = dom(rowPicker({ id: 'sv:arch', label: 'Archive', text: 'Never', items, open: true }));
  assert.deepEqual([...open.querySelectorAll('.menu-item')].map((x) => x.dataset.menuPick), ['sv:arch|never', 'sv:arch|30']);
  assert.match(open.querySelector('.menu').className, /\bspick-menu is-right\b/, 'at a row\'s end the menu opens from the field\'s right edge');
  assert.match(dom(rowPicker({ id: 'k', label: 'L', text: 'x', items, open: true, left: true })).querySelector('.menu').className, /spick-menu(?! is-right)/);
  assert.match(open.className, /\bspick\b/, 'a page\'s menu keys and layers find it as they find a SentencePicker');
});

test('rowPicker: a long value folds inside the field and is whole in its tooltip; off, it shows its value and cannot open', () => {
  const long = dom(rowPicker({ id: 'k', label: 'Decides', text: 'Trusts a sure agent, and otherwise weighs', items: [] }));
  assert.equal(long.querySelector('button').getAttribute('title'), 'Trusts a sure agent, and otherwise weighs');
  assert.ok(long.querySelector('button > .set-pick-t'), 'the words sit in their own box, so they fold and the chevron stays');
  const off = dom(rowPicker({ id: 'k', label: 'How much', text: 'Everything', items: [{ id: 'a', text: 'A' }], open: true, off: true, tip: 'Pulse keeps everything' }));
  assert.ok(off.querySelector('button').disabled);
  assert.equal(off.querySelector('.menu'), null);
  assert.equal(off.querySelector('[data-menu]'), null, 'no menu hook: nothing a click could open');
  assert.equal(off.querySelector('.tip-wrap').getAttribute('title'), 'Pulse keeps everything', 'the reason is the OffTip\'s: a disabled button shows none of its own');
  assert.equal(off.querySelector('button').hasAttribute('title'), false, 'one tooltip');
  assert.equal(C.rowPicker, rowPicker, 'a page calls R.rowPicker'); assert.equal(C.settingsRow.picker, undefined, 'no bridge on SettingsRow');
});

// ---- a menu item's supporting line ----
test('menuItem: `line` is the item\'s hint; with keepLine it is one shown line under its words; without a line the markup is as before', () => {
  const hint = dom(C.menuItem({ text: 'Advanced', checked: true, line: 'Adds schedules and statistics' }));
  assert.doesNotMatch(hint.className, /\bhas-line\b/); assert.equal(hint.querySelector('.mi-line'), null); assert.equal(hint.title, 'Adds schedules and statistics');
  const it = dom(C.menuItem({ text: 'Advanced', checked: true, line: 'Adds schedules and statistics', keepLine: 'what the mode adds' }));
  assert.match(it.className, /\bhas-line\b/);
  assert.equal(it.querySelector('.mi-l > .mi-line').textContent, 'Adds schedules and statistics');
  assert.equal(C.menuItem({ text: 'Advanced', checked: true }).includes('mi-line'), false);
});

// ---- one Dialog ----
const dlg = (o = {}) => C.dialog({ title: 'Change the budget', body: '<input id="f1"><input id="f2">', yes: 'Save', close: '<svg></svg>', ...o });

test('trapNext: Tab goes on, wraps at both ends, and comes in from outside', () => {
  const l = ['a', 'b', 'c'];
  assert.equal(trapNext(l, 'a', false), 'b');
  assert.equal(trapNext(l, 'c', false), 'a');
  assert.equal(trapNext(l, 'a', true), 'c');
  assert.equal(trapNext(l, 'x', false), 'a');
  assert.equal(trapNext(l, 'x', true), 'c');
  assert.equal(trapNext([], 'x', false), null);
});

test('watchDialogs: a dialog drawn anywhere is lifted to the window, takes the focus, keeps Tab inside, and Esc closes it', async () => {
  const { win, doc, c } = page('<button id="opener">Change…</button><div id="slot"></div>');
  const back = watchFocusBack(doc);
  watchDialogs(doc, back);
  doc.getElementById('opener').focus();
  const slot = doc.getElementById('slot');
  slot.innerHTML = dlg(); await tick();
  const m = doc.querySelector('.viewer-modal');
  assert.equal(m.style.position, 'fixed', 'the window is its box, whatever box the page drew it in');
  assert.equal(m.style.inset, '0px');
  assert.ok(m.hasAttribute('data-lifted'));
  assert.equal(doc.activeElement.id, 'f1', 'the focus moves in, to its first field');
  // Tab from the last control wraps to the first; Shift+Tab from the first goes to the last
  const all = focusables(m);
  all[all.length - 1].focus();
  const e = key(win, all[all.length - 1], 'Tab');
  assert.ok(e.defaultPrevented);
  assert.equal(doc.activeElement, all[0]);
  key(win, all[0], 'Tab', { shiftKey: true });
  assert.equal(doc.activeElement, all[all.length - 1]);
  // Esc presses its Close; the page closes it, and the focus goes back to what opened it
  let closed = 0;
  m.querySelector('[data-dialog="close"]').addEventListener('click', () => { closed += 1; slot.innerHTML = ''; });
  key(win, doc.activeElement, 'Escape');
  assert.equal(closed, 1);
  await tick();
  assert.equal(openDialogs(doc).length, 0);
  assert.equal(doc.activeElement.id, 'opener');
  assert.ok(c);
});

test('watchDialogs: a redraw of the open dialog keeps the focus on the same control; a key the page already answered is left alone', async () => {
  const { win, doc } = page('<button id="opener">Open</button><div id="slot"></div>');
  watchDialogs(doc, watchFocusBack(doc));
  doc.getElementById('opener').focus();
  const slot = doc.getElementById('slot');
  slot.innerHTML = dlg(); await tick();
  doc.querySelector('[data-dialog="yes"]').focus();
  slot.innerHTML = dlg({ status: 'It needs an amount' }); await tick();
  assert.equal(doc.activeElement.dataset.dialog, 'yes', 'the same button, drawn again');
  let closed = 0;
  doc.querySelector('[data-dialog="close"]').addEventListener('click', () => { closed += 1; });
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.preventDefault(); }, true);   // the page's own layer: something typed stays
  key(win, doc.activeElement, 'Escape');
  assert.equal(closed, 0);
});

test('focusables: a radio group is one stop, its chosen answer', () => {
  const g = dom(`<div>${C.optionList({ label: 'Starts again', options: ['Each day', 'Each week', 'Each month'], selected: 2 })}<button>Save</button></div>`);
  assert.deepEqual(focusables(g).map((x) => x.textContent), ['Each month', 'Save']);
});

// ---- menus and radio groups by keyboard ----
test('choiceMove and typeAhead: arrows wrap, Home and End jump, typing finds the next match', () => {
  assert.equal(choiceMove(3, 0, 'ArrowDown'), 1);
  assert.equal(choiceMove(3, 2, 'ArrowDown'), 0);
  assert.equal(choiceMove(3, 0, 'ArrowUp'), 2);
  assert.equal(choiceMove(3, 1, 'ArrowLeft'), 0);
  assert.equal(choiceMove(3, 1, 'ArrowRight'), 2);
  assert.equal(choiceMove(3, 1, 'Home'), 0);
  assert.equal(choiceMove(3, 1, 'End'), 2);
  assert.equal(choiceMove(3, 1, 'Enter'), -1);
  assert.equal(choiceMove(0, 0, 'ArrowDown'), -1);
  assert.equal(typeAhead(['Resume', 'Wait for me', 'Wait a day'], 0, 'w'), 1);
  assert.equal(typeAhead(['Resume', 'Wait for me', 'Wait a day'], 1, 'w'), 2);
  assert.equal(typeAhead(['Resume', 'Wait for me'], 1, 'r'), 0, 'it wraps');
  assert.equal(typeAhead(['Resume'], 0, 'x'), -1);
});

test('watchChoiceKeys: in a radio group an arrow moves the choice, and the page\'s own shortcuts never see the key', () => {
  const { win, doc, c } = page(C.optionList({ label: 'Starts again', options: ['Each day', 'Each week', 'Each month'], selected: 2 }));
  watchChoiceKeys(doc);
  const radios = [...c.querySelectorAll('[role="radio"]')];
  let picked = -1, heard = 0;
  radios.forEach((r, i) => r.addEventListener('click', () => { picked = i; }));
  doc.addEventListener('keydown', () => { heard += 1; });   // the bar's shortcuts
  radios[2].focus();
  const e = key(win, radios[2], 'ArrowUp');
  assert.ok(e.defaultPrevented);
  assert.equal(doc.activeElement, radios[1]);
  assert.equal(picked, 1, 'the choice follows the focus');
  key(win, radios[1], 'ArrowDown'); key(win, radios[2], 'ArrowDown');
  assert.equal(doc.activeElement, radios[0], 'it wraps');
  assert.equal(heard, 0);
});

test('watchChoiceKeys: a menu takes arrows, Home, End and type-ahead; ↓ on its trigger opens it or goes in; Tab goes in', () => {
  const closed = rowPicker({ id: 'p', label: 'Paused tasks', text: 'Resume', items: [] });
  const open = rowPicker({ id: 'p', label: 'Paused tasks', text: 'Resume', open: true, items: [{ id: 'auto', text: 'Resume after the reset', checked: true }, { id: 'me', text: 'Wait for me' }, { id: 'off', text: 'Never', off: true }] });
  const { win, doc, c } = page(closed);
  watchChoiceKeys(doc);
  let clicks = 0;
  c.addEventListener('click', (e) => { if (e.target.closest('[data-menu]')) { clicks += 1; c.innerHTML = open; } });
  c.querySelector('[data-menu]').focus();
  key(win, doc.activeElement, 'ArrowDown');
  assert.equal(clicks, 1, '↓ on a closed trigger opens its menu');
  const trigger = c.querySelector('[data-menu]'), items = [...c.querySelectorAll('.menu-item')];
  assert.equal(focusMenu(c.querySelector('.menu')), true, 'a menu that has just opened takes the focus');
  assert.equal(doc.activeElement, items[0], 'on the chosen answer');
  key(win, items[0], 'ArrowDown');
  assert.equal(doc.activeElement, items[1]);
  key(win, items[1], 'ArrowDown');
  assert.equal(doc.activeElement, items[0], 'an item that is off is skipped, and the list wraps');
  key(win, items[0], 'End'); assert.equal(doc.activeElement, items[1]);
  key(win, items[1], 'Home'); assert.equal(doc.activeElement, items[0]);
  key(win, items[0], 'w'); assert.equal(doc.activeElement, items[1], 'type-ahead');
  assert.equal(focusMenu(c.querySelector('.menu')), false, 'a menu redrawn while you are inside it is left alone');
  trigger.focus();
  const tab = key(win, trigger, 'Tab');
  assert.ok(tab.defaultPrevented);
  assert.equal(doc.activeElement, items[0], 'the menu is next after its trigger');
  key(win, items[0], 'Tab', { shiftKey: true });
  assert.equal(doc.activeElement, trigger);
});

// ---- the focus is never dropped to the page ----
test('controlAddress: a control is found again by its key, its id, its own hooks, its role and name, or its place in a named group', () => {
  const { doc, c } = page('<button data-key="a:1" data-x="1">A</button><button id="b">B</button><button data-svsw="sync" data-placed="">C</button><button role="switch" aria-label="Sync"></button><div role="radiogroup" aria-label="Period"><button role="radio">x</button><button role="radio">y</button></div><span>z</span>');
  const [a, b, sw, named, , ] = c.children;
  assert.deepEqual(controlAddress(a), { sel: '[data-key="a:1"]', n: 0 });
  assert.deepEqual(controlAddress(b), { sel: '[id="b"]', n: 0 });
  assert.deepEqual(controlAddress(sw), { sel: '[data-svsw="sync"]', n: 0 }, 'what the library writes on it (data-placed) is no address');
  assert.deepEqual(controlAddress(named), { sel: '[role="switch"][aria-label="Sync"]', n: 0 });
  const y = c.querySelectorAll('[role="radio"]')[1];
  assert.equal(atAddress(doc, controlAddress(y)), y);
  assert.equal(controlAddress(c.querySelector('span')), null);
  assert.equal(controlAddress(null), null);
});

test('watchFocusBack: a redraw gives the focus to the control drawn in the same place; a menu\'s item gone, to its trigger', async () => {
  const sw = (on) => C.switchButton({ on, label: 'Sync', attrs: { 'data-svsw': 'sync' } });
  const { doc, c } = page(sw(false));
  watchFocusBack(doc);
  c.firstElementChild.focus();
  c.innerHTML = sw(true); await tick();
  assert.equal(doc.activeElement, c.firstElementChild, 'a switch keeps the focus after it is drawn again');
  assert.equal(doc.activeElement.getAttribute('aria-checked'), 'true');
  // a pick: the menu closes, and the focus goes back to the trigger, never to the page
  const pick = (open) => rowPicker({ id: 'p', label: 'Archive', text: 'Never', open, items: [{ id: 'never', text: 'Never' }] });
  c.innerHTML = pick(true); await tick();
  const item = c.querySelector('.menu-item');
  assert.equal(triggerOf(item), c.querySelector('[data-menu]'));
  item.focus();
  c.innerHTML = pick(false); await tick();
  assert.equal(doc.activeElement, c.querySelector('[data-menu="p"]'));
});

test('set.group-order: the side menu starts with Worca, then Work, AI, Access, Add-ons', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../ui/public/stillhet/settings/settings-model.js', import.meta.url), 'utf8');
  const groups = src.slice(src.indexOf('const GROUPS = ['), src.indexOf('];', src.indexOf('const GROUPS = [')));
  assert.deepEqual([...groups.matchAll(/title: '([^']+)'/g)].map((m) => m[1]), ['Worca', 'Work', 'AI', 'Access', 'Add-ons']);
});
