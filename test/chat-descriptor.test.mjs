// test/chat-descriptor.test.mjs — the chat descriptors (engines/chat.mjs): the engines with one are the Ask engines, each
// agrees with engine-switch.mjs on attachments, and Codex and Copilot keep the words and checks they had before the
// descriptors existed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_ENGINES, chatDescriptor, chatDescriptors, chatCostCapRefusal } from '../src/core/engines/chat.mjs';
import { listEngines } from '../src/core/engines/index.mjs';
import { ASK_ENGINES, lockedChatEngine } from '../src/core/model-env.mjs';
import { ENGINES, CHAT_ENGINE_NAMES, chatAttachRefusal } from '../src/shared/engine-switch.mjs';

test('the engines with a chat descriptor are the Ask engines, in engine order', () => {
  assert.deepEqual(CHAT_ENGINES, ASK_ENGINES);
  assert.deepEqual([...CHAT_ENGINE_NAMES], ASK_ENGINES);
  assert.deepEqual(listEngines().filter((a) => a.chat && a.chat.lockdown()).map((a) => a.name), ASK_ENGINES.filter((e) => e !== 'claude'));
  assert.deepEqual(ASK_ENGINES, ['claude', 'codex', 'copilot', 'gemini', 'goose', 'opencode', 'qwen']);
  // Cursor: wired, off — a descriptor without a lockdown, its flag unverified, not an Ask engine.
  assert.ok(chatDescriptor('cursor'));
  assert.equal(chatDescriptor('cursor').lockdown(), null);
  assert.equal(ENGINES.cursor.chat.verified, false);
  assert.equal(ASK_ENGINES.includes('cursor'), false);
  assert.equal(chatDescriptor('mock'), null);
  assert.equal(chatDescriptor('claude'), null);
  assert.equal(lockedChatEngine('claude'), false);
  assert.equal(lockedChatEngine('qwen'), true);
  assert.equal(lockedChatEngine('cursor'), false);
});

test('every descriptor: a lockdown, a not-ready code and docs link, attachments as engine-switch.mjs says', () => {
  for (const d of chatDescriptors()) {
    if (d.engine === 'cursor') continue;
    assert.ok(d.lockdown(), d.engine);
    assert.equal(d.notReady.code, `${d.engine}-not-ready`);
    assert.match(d.notReady.docsUrl, /^https:\/\/github\.com\/SinishaDjukic\/worca-cc\/blob\/dev\/docs\/models\.md#/);
    assert.equal(d.images, ENGINES[d.engine].chat.images);
    assert.equal(d.pdfs, ENGINES[d.engine].chat.pdfs);
    assert.equal(d.reportsCost, ENGINES[d.engine].cost);
    for (const k of ['cli', 'attachments', 'composerBinary', 'webOff']) assert.ok(d.prompt[k], `${d.engine} prompt.${k}`);
  }
  assert.equal(typeof chatDescriptor('qwen').selfTest, 'function');
  assert.equal(typeof chatDescriptor('gemini').selfTest, 'function');
  for (const e of ['goose', 'opencode', 'cursor']) assert.equal(typeof chatDescriptor(e).selfTest, 'function', e);
  assert.deepEqual(chatDescriptor('goose').metaTools, ['load_skill']);
  assert.equal(chatDescriptor('codex').selfTest, null, 'Codex and Copilot lock down by verified flags alone');
  assert.equal(chatDescriptor('copilot').selfTest, null);
});

test('Codex and Copilot keep their words', () => {
  const codex = chatDescriptor('codex');
  assert.equal(codex.notReady.docsUrl, 'https://github.com/SinishaDjukic/worca-cc/blob/dev/docs/models.md#codex');
  assert.equal(codex.notReady.prefix, "Codex isn't ready");
  assert.equal(codex.notReady.setupLabel, 'Codex setup');
  assert.equal(codex.notReady.flag, 'codexSetup');
  assert.equal(codex.shellTrippedMessage, 'Codex tried to run a shell command although its shell was switched off — worca stopped the turn.');
  assert.equal(codex.suggestionModel, 'gpt-5.6-luna');
  assert.equal(codex.titles, true);
  const copilot = chatDescriptor('copilot');
  assert.equal(copilot.notReady.docsUrl, 'https://github.com/SinishaDjukic/worca-cc/blob/dev/docs/models.md#github-copilot-cli');
  assert.equal(copilot.notReady.flag, 'copilotSetup');
  assert.equal(copilot.noLockdownMessage, 'Chat on Copilot is unavailable: this copilot cannot be locked down for a chat. Use a Claude chat.');
  assert.equal(copilot.shellTrippedMessage, 'Copilot tried to run a shell command although it was given none — worca stopped the turn.');
  assert.equal(copilot.suggestionModel, null);
  assert.equal(chatCostCapRefusal(copilot, 'copilot/gpt-5.4'), 'A per-turn cost cap is set, and Copilot reports no cost, so worca cannot keep this turn under it. Turn the cap off (Settings › Chat), or use a Claude or Codex chat.');
  assert.equal(chatCostCapRefusal(codex, 'nope', () => false), 'A per-turn cost cap is set, and nope has no known price on Codex, so worca cannot keep this turn under it. Pick a priced Codex model, or turn the cap off (Settings › Chat).');
  assert.equal(chatCostCapRefusal(codex, 'gpt-5.5', () => true), null);
});

test('what a chat takes, by engine', () => {
  assert.equal(chatAttachRefusal({ engine: 'claude', kind: 'binary', pdf: true }), null);
  assert.equal(chatAttachRefusal({ engine: 'codex', kind: 'image' }), null);
  assert.equal(chatAttachRefusal({ engine: 'codex', kind: 'binary', pdf: true }), 'a Codex chat cannot view PDFs (Claude, Gemini CLI, OpenCode or Qwen Code chats can)');
  assert.equal(chatAttachRefusal({ engine: 'goose', kind: 'image' }), null);
  assert.equal(chatAttachRefusal({ engine: 'goose', kind: 'binary', pdf: true }), 'a Goose chat cannot view PDFs (Claude, Gemini CLI, OpenCode or Qwen Code chats can)');
  assert.equal(chatAttachRefusal({ engine: 'copilot', kind: 'image' }), 'a Copilot chat cannot view images or PDFs (Claude, Gemini CLI, OpenCode or Qwen Code chats view both)');
  for (const engine of ['gemini', 'opencode', 'qwen']) {
    assert.equal(chatAttachRefusal({ engine, kind: 'image' }), null, engine);
    assert.equal(chatAttachRefusal({ engine, kind: 'binary', pdf: true }), null, engine);
  }
  for (const engine of ['copilot', 'gemini', 'qwen']) assert.equal(chatAttachRefusal({ engine, kind: 'text' }), null, engine);
});
