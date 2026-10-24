// test/ui-list-keys.test.mjs — the one list keyboard (issue #948): key → action, glyphs and hints
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listKeyAction, keyGlyph, keyHint, isMac } from '../ui/public/list-keys.mjs';

const ev = (key, o = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, targetIsRow: true, inField: false, ...o });
const act = (key, o, ctx) => listKeyAction(ev(key, o), { list: 'runs', ...ctx });

test('moves: j / ArrowDown down, k / ArrowUp up, Shift+arrows extend', () => {
  assert.equal(act('j'), 'down');
  assert.equal(act('ArrowDown'), 'down');
  assert.equal(act('k'), 'up');
  assert.equal(act('ArrowUp'), 'up');
  assert.equal(act('ArrowDown', { shiftKey: true }), 'extend-down');
  assert.equal(act('ArrowUp', { shiftKey: true }), 'extend-up');
  assert.equal(act('J', { shiftKey: true }), null, 'Shift+J is not a move');
});

test('letter keys never fire in a text field; Escape still clears a selection there', () => {
  for (const k of ['j', 'k', 'e', 's', 'g', '.', '?', 'Backspace', 'Enter', ' ']) assert.equal(act(k, { inField: true }), null, k);
  assert.equal(act('Escape', { inField: true }, { size: 2 }), 'clear');
});

test('Ctrl+A on Linux and ⌘A on a Mac select all; other modified keys are not ours', () => {
  assert.equal(act('a', { ctrlKey: true }), 'all');
  assert.equal(act('a', { metaKey: true }), 'all');
  assert.equal(act('e', { ctrlKey: true }), null);
  assert.equal(act('j', { altKey: true }), null);
});

test('row keys: Enter on a row opens, arrows fold, . menu, S stop, E archive, ? help', () => {
  assert.equal(act('Enter'), 'open');
  assert.equal(act('Enter', { targetIsRow: false }), null, 'a focused button keeps its own Enter');
  assert.equal(act('ArrowRight'), 'unfold');
  assert.equal(act('ArrowLeft'), 'fold');
  assert.equal(act('.'), 'menu');
  assert.equal(act('s'), 'stop');
  assert.equal(act('E'), 'archive', 'Caps Lock E is still E');
  assert.equal(act('?', { shiftKey: true }), 'help');
});

test('Delete, G and Shift+G only from the Advanced level, as the ⋯ menu', () => {
  assert.equal(act('Backspace', {}, { level: 'simple' }), null);
  assert.equal(act('Backspace', {}, { level: 'advanced' }), 'delete');
  assert.equal(act('Delete', {}, { level: 'expert' }), 'delete');
  assert.equal(act('Backspace'), 'delete', 'no level attribute gates nothing (DEFAULT_UI_LEVEL)');
  assert.equal(act('g', {}, { level: 'simple' }), null);
  assert.equal(act('g', {}, { level: 'advanced' }), 'add-to-group');
  assert.equal(act('G', { shiftKey: true }, { level: 'advanced' }), 'leave-group');
});

test('glyphs: Mac symbols, words elsewhere; hints join with + off a Mac', () => {
  assert.equal(keyGlyph('mod', true), '⌘');
  assert.equal(keyGlyph('mod', false), 'Ctrl');
  assert.equal(keyGlyph('Backspace', true), '⌫');
  assert.equal(keyGlyph('ArrowUp', false), '↑');
  assert.equal(keyGlyph('g', false), 'G');
  assert.equal(keyHint(['shift', 'G'], true), '⇧G');
  assert.equal(keyHint(['shift', 'G'], false), 'Shift+G');
  assert.equal(isMac({ navigator: { platform: 'MacIntel' } }), true);
  assert.equal(isMac({ navigator: { platform: 'Linux x86_64' } }), false);
});
