// test/chat-price.test.mjs — worca's prices for a locked-down chat's model, the same rule on every engine
// (ask/chat-price.mjs): the Models page price, else the list price the engine's provider bills.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatModelRates } from '../src/core/ask/chat-price.mjs';
import { chatDescriptor } from '../src/core/engines/chat.mjs';
import { providerListRates } from '../src/core/engines/chat-descriptor.mjs';

const none = () => null;

test('a Models page price wins on every engine; {free} is zero', () => {
  for (const e of ['codex', 'copilot', 'gemini', 'goose', 'opencode', 'qwen']) {
    assert.deepEqual(chatModelRates(chatDescriptor(e), 'm', { costOf: () => ({ perMtok: { input: 1, output: 2 } }) }), { input: 1, output: 2 }, e);
    assert.equal(chatModelRates(chatDescriptor(e), 'm', { costOf: () => ({ free: true }) }).output, 0, e);
  }
});

test('the list price where the engine\'s provider bills one; none elsewhere', () => {
  assert.deepEqual(chatModelRates(chatDescriptor('codex'), 'gpt-6.1-sol', { costOf: none }), { input: 2, output: 10, cacheRead: 0.1 });
  assert.deepEqual(chatModelRates(chatDescriptor('codex'), null, { costOf: none }), { input: 2, output: 10, cacheRead: 0.1 }, "Codex's default model");
  assert.equal(chatModelRates(chatDescriptor('codex'), 'my-local-codex', { costOf: none }), null);
  for (const e of ['goose', 'opencode']) {
    assert.deepEqual(chatModelRates(chatDescriptor(e), 'anthropic/claude-sonnet-5-5', { costOf: none }).output, 10, e);
    assert.deepEqual(chatModelRates(chatDescriptor(e), 'openai/gpt-6-luna', { costOf: none }), { input: 0.1, output: 0.5, cacheRead: 0.01 }, e);
    assert.equal(chatModelRates(chatDescriptor(e), 'google/gemini-3-flash', { costOf: none }), null, e);
  }
  for (const e of ['copilot', 'gemini', 'qwen']) assert.equal(chatModelRates(chatDescriptor(e), 'gemini-3-pro', { costOf: none }), null, `${e}: a Models page price only`);
  assert.equal(providerListRates('no-slash'), null);
});
