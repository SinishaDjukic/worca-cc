// test/ui-keys-sheet.test.mjs — the one Keyboard shortcuts sheet (issue #948, mock 10)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sheetSections, openKeysSheet, RESERVED } from '../ui/public/keys-sheet.mjs';
import { listKeyAction, chatPageKeyAction } from '../ui/public/list-keys.mjs';

const dom = (platform = 'MacIntel') => {
  const { window } = new JSDOM('<!doctype html><body><button id="opener">View</button></body>', { pretendToBeVisual: true });
  Object.defineProperty(window.navigator, 'platform', { value: platform, configurable: true });
  return window;
};
const labels = (secs) => secs.flatMap((s) => s.rows.map((r) => r.label));

test('sections: Anywhere, Runs list, Selection; below Advanced no group or Delete rows', () => {
  assert.deepEqual(sheetSections().map((s) => s.title), ['Anywhere', 'Runs list', 'Selection']);
  const simple = labels(sheetSections({ advanced: false }));
  for (const gone of ['Add to group…', 'Remove from group', 'Delete']) assert.ok(!simple.includes(gone), gone);
  assert.equal(labels(sheetSections()).length - simple.length, 3);
});

test('no shortcut uses a combo the browser keeps for itself', () => {
  for (const s of sheetSections()) for (const r of s.rows) for (const combo of r.keys) {
    const id = combo.map((t) => String(t).toLowerCase()).join('+');
    assert.ok(!RESERVED.includes(id), `${r.label}: ${id}`);
  }
});

test('open: title, Mac glyphs, Esc closes and hands focus back', () => {
  const window = dom();
  const doc = window.document;
  const opener = doc.getElementById('opener');
  opener.focus();
  openKeysSheet({ doc, opener });
  const modal = doc.querySelector('.keys-modal');
  assert.equal(modal.querySelector('h2').textContent, 'Keyboard shortcuts');
  assert.ok([...modal.querySelectorAll('kbd.kbd')].some((k) => k.textContent === '⌘'));
  assert.equal(doc.activeElement.textContent, 'Close');
  openKeysSheet({ doc, opener });
  assert.equal(doc.querySelectorAll('.keys-modal').length, 1, 'a second open does not stack');
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(doc.querySelector('.keys-modal'), null);
  assert.equal(doc.activeElement, opener);
});

test('Windows / Linux: Ctrl and Backspace chips, no "⌘ is Ctrl" sentence; Close and the backdrop close it', () => {
  const window = dom('Win32');
  const doc = window.document;
  openKeysSheet({ doc, opener: doc.getElementById('opener') });
  const chips = [...doc.querySelectorAll('.keys-modal kbd.kbd')].map((k) => k.textContent);
  assert.ok(chips.includes('Ctrl') && chips.includes('Backspace') && !chips.includes('⌘'));
  assert.doesNotMatch(doc.querySelector('.keys-note').textContent, /⌘ is Ctrl/);
  doc.querySelector('.keys-modal .keys-close').click();
  assert.equal(doc.querySelector('.keys-modal'), null);
  openKeysSheet({ doc });
  const m = doc.querySelector('.keys-modal');
  m.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(doc.querySelector('.keys-modal'), null);
});

test('a repaint replaced the opener: the focus goes to the fallback', () => {
  const window = dom();
  const doc = window.document;
  const opener = doc.getElementById('opener');
  const spare = doc.createElement('button');
  spare.textContent = 'View';
  doc.body.append(spare);
  openKeysSheet({ doc, opener, fallback: () => spare });
  opener.remove();
  doc.querySelector('.keys-modal .keys-close').click();
  assert.equal(doc.activeElement, spare);
});

test('every sheet row is a key the list keyboard answers (the table and the sheet cannot drift)', () => {
  const tok = { ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Enter: 'Enter',
    Space: ' ', Backspace: 'Backspace', Escape: 'Escape', '?': '?', '.': '.' };
  for (const s of sheetSections().filter((x) => x.title !== 'Anywhere')) for (const r of s.rows) for (const chord of r.keys) {
    const mods = { shiftKey: chord.includes('shift'), metaKey: chord.includes('mod') };
    const keys = chord.filter((t) => t !== 'shift' && t !== 'mod');
    for (const k of keys) {   // a two-key chip ("↑ ↓", "→ ←", "J K") lists alternatives; each must map to an action
      const key = tok[k] || (mods.shiftKey ? k.toUpperCase() : k.toLowerCase());
      const a = listKeyAction({ key, altKey: false, ctrlKey: false, targetIsRow: true, inField: false, ...mods },
        { size: 1, list: 'runs', level: 'expert' });
      assert.ok(a, `${r.label}: ${chord.join('+')}`);
    }
  }
});

test('Chat page sheet: 4 sections in order, and every row is a key its own function answers', () => {
  const secs = sheetSections({ page: 'chat' });
  assert.deepEqual(secs.map((s) => s.title), ['Anywhere', 'Chat page', 'Chats list', 'Selection']);
  // The same token map as the Runs walk above; a chord's non-modifier tokens are alternatives ("↑ ↓", "J K").
  const tok = { ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Enter: 'Enter',
    Space: ' ', Backspace: 'Backspace', Escape: 'Escape', '.': '.', '\\': '\\' };
  const code = (k) => (k === '\\' ? 'Backslash' : /^[A-Z]$/.test(k) ? `Key${k}` : k);
  for (const s of secs.filter((x) => x.list)) for (const r of s.rows) for (const chord of r.keys) {
    const mods = { shiftKey: chord.includes('shift'), metaKey: chord.includes('mod'), altKey: chord.includes('alt') };
    for (const k of chord.filter((t) => t !== 'shift' && t !== 'mod' && t !== 'alt')) {
      const key = tok[k] || (mods.shiftKey ? k.toUpperCase() : k.toLowerCase());
      const e = { key, code: code(k), ctrlKey: false, targetIsRow: true, inField: false, ...mods };
      const a = s.list === 'chat-page' ? chatPageKeyAction(e, { mac: true }) : listKeyAction(e, { size: 1, list: s.list, level: 'expert' });
      assert.ok(a, `${s.title} › ${r.label}: ${chord.join('+')}`);
    }
  }
});

test('Chat page sheet: no combo the browser keeps; it opens with "New chat" and Esc hands the focus back', () => {
  for (const s of sheetSections({ page: 'chat' })) for (const r of s.rows) for (const combo of r.keys) {
    const id = combo.map((t) => String(t).toLowerCase()).join('+');
    assert.ok(!RESERVED.includes(id), `${r.label}: ${id}`);
  }
  const window = dom();
  const doc = window.document;
  const opener = doc.getElementById('opener');
  opener.focus();
  openKeysSheet({ doc, opener, page: 'chat' });
  assert.ok([...doc.querySelectorAll('.keys-modal .keys-label')].some((n) => n.textContent === 'New chat'));
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(doc.querySelector('.keys-modal'), null);
  assert.equal(doc.activeElement, opener);
});
