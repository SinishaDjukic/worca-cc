// test/ui-chat-extensions.test.mjs — worca Chat CONTRACT §2: the pure registry other Chat plans extend the Chat page
// through (card builders by type, composer add-ons in registration order). No DOM: the module is plain data.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  registerChatCard, chatCardBuilder, registerComposerAddon, composerAddons, _resetChatExtensions,
} from '../ui/public/chat/extensions.mjs';

beforeEach(() => _resetChatExtensions());

test('card builders: looked up by type, null for an unknown or non-string type, a re-register replaces', () => {
  const a = () => ({ el: null });
  const b = () => ({ el: null });
  assert.equal(chatCardBuilder('receipt'), null);
  registerChatCard('receipt', a);
  assert.equal(chatCardBuilder('receipt'), a);
  assert.equal(chatCardBuilder('run-stop'), null);
  for (const t of [undefined, null, 1, '', {}]) assert.equal(chatCardBuilder(t), null, String(t));
  registerChatCard('receipt', b);
  assert.equal(chatCardBuilder('receipt'), b, 'the last registration wins');
});

test('card builders: a bad type or builder throws a TypeError', () => {
  assert.throws(() => registerChatCard('', () => ({})), TypeError);
  assert.throws(() => registerChatCard(5, () => ({})), TypeError);
  assert.throws(() => registerChatCard('receipt', 'nope'), TypeError);
  assert.equal(chatCardBuilder('receipt'), null, 'nothing was stored');
});

test('composer add-ons: registration order, a copy each call, the same id replaces in place', () => {
  const intent = { id: 'intent', mount: () => ({}) };
  const direction = { id: 'direction', mount: () => ({}) };
  const intent2 = { id: 'intent', mount: () => ({}) };
  registerComposerAddon(intent);
  registerComposerAddon(direction);
  assert.deepEqual(composerAddons().map((a) => a.id), ['intent', 'direction']);
  const list = composerAddons();
  list.push({ id: 'x', mount: () => ({}) });
  assert.equal(composerAddons().length, 2, 'callers get a copy');
  registerComposerAddon(intent2);
  assert.deepEqual(composerAddons(), [intent2, direction], 'same id: replaced where it stood');
});

test('composer add-ons: a missing id or mount throws a TypeError', () => {
  assert.throws(() => registerComposerAddon(null), TypeError);
  assert.throws(() => registerComposerAddon({ mount: () => ({}) }), TypeError);
  assert.throws(() => registerComposerAddon({ id: '', mount: () => ({}) }), TypeError);
  assert.throws(() => registerComposerAddon({ id: 'x' }), TypeError);
  assert.deepEqual(composerAddons(), []);
});

test('_resetChatExtensions forgets every card and add-on', () => {
  registerChatCard('receipt', () => ({}));
  registerComposerAddon({ id: 'intent', mount: () => ({}) });
  _resetChatExtensions();
  assert.equal(chatCardBuilder('receipt'), null);
  assert.deepEqual(composerAddons(), []);
});

test('the module touches no DOM and no app state at import (pure)', () => {
  const src = readFileSync(new URL('../ui/public/chat/extensions.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\b(document|window|localStorage|fetch)\b/);
  assert.doesNotMatch(src, /^import /m, 'no imports');
});
