// test/ask-turn-codex-caps.test.mjs — D14's watchdog and D13's shell guard (§8 test 16).
import { test, after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createAskTurn, CODEX_SHELL_TRIPPED_MESSAGE, codexToolTrippedMessage } from '../src/core/ask/turn.mjs';
import { createThread, appendMessage, getMessage } from '../src/core/ask/store.mjs';

useTempHome(after);
// settings.json lives under $HOME/.worca-cc: HOME is a scratch dir too.
const prevHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
const scratchHome = mkdtempSync(join(tmpdir(), 'worca-2b-home-'));
process.env.HOME = scratchHome; process.env.USERPROFILE = scratchHome; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
after(() => {
  for (const [k, v] of [['HOME', prevHome.HOME], ['USERPROFILE', prevHome.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prevHome.ALLOW]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(scratchHome, { recursive: true, force: true });
});
function seed() {
  const thread = createThread();
  return { thread, user: appendMessage(thread.id, { role: 'user', text: 'q' }), asst: appendMessage(thread.id, { role: 'assistant', text: '', status: 'streaming' }) };
}
const waitAbort = (signal) => new Promise((r) => { if (signal.aborted) return r(); signal.addEventListener('abort', r, { once: true }); });
const abortErr = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
function makeTurn(s, limits, runClaudeImpl, over = {}) {
  const frames = [];
  const turn = createAskTurn({
    threadId: s.thread.id, assistantMessageId: s.asst.id, userMessageId: s.user.id, prompt: 'P', systemPrompt: 'S', restoredPrompt: 'R',
    model: 'gpt-5.5', effort: 'low', engine: 'codex', ...over,
    deps: { onFrame: (f) => frames.push(f), generateTitle: async () => '', codexPreflight: async () => ({}), memoryMount: async () => null,
      codexLockdown: () => ['--disable', 'shell_tool'], codexAskSupport: async () => ({}),
      askLimits: () => limits, runClaudeImpl },
  });
  return { turn, frames };
}
const call = (o, id, name = 'mcp__worca__list_runs') => o.onEvent({ type: 'tool', parentId: null, calls: [{ name, input: {}, toolUseId: id }] });

test('askMaxTurns: the call past the cap aborts; stopped with the existing turn-limit notice', async () => {
  const s = seed();
  const { turn, frames } = makeTurn(s, { maxTurns: 2, maxBudgetUsd: null }, async (o) => {
    o.onEvent({ type: 'session', sessionId: 'codex:t', init: true });
    call(o, 'a'); call(o, 'b'); call(o, 'c');
    await waitAbort(o.signal); throw abortErr();
  });
  await turn.run();
  const done = frames.find((f) => f.type === 'ask-done');
  assert.equal(done.status, 'stopped');
  assert.equal(done.reason, 'max_turns');
  assert.ok(getMessage(s.asst.id).blocks.some((b) => b.text === 'Stopped: reached the 2-turn limit (Settings → Ask Worca)'));
});

test('a capped Codex turn books what it spent (the adapter\'s late result) and stays stopped on its limit', async () => {
  const s = seed();
  const { turn, frames } = makeTurn(s, { maxTurns: 1, maxBudgetUsd: null }, async (o) => {
    o.onEvent({ type: 'session', sessionId: 'codex:t', init: true });
    call(o, 'a'); call(o, 'b');
    await waitAbort(o.signal);
    // The adapter reads the stopped turn's usage from codex's session file and books it before it throws.
    o.onEvent({ type: 'result', subtype: 'error_during_execution', isError: true, text: '', usage: { input_tokens: 900, output_tokens: 9 }, costUsd: 0.02 });
    throw abortErr();
  });
  await turn.run();
  const done = frames.find((f) => f.type === 'ask-done');
  assert.equal(done.status, 'stopped');
  assert.equal(done.reason, 'max_turns');
  assert.equal(done.costUsd, 0.02);
});

test('a Codex turn the person stops books what it spent, and stays the person\'s stop even past the cost cap', async () => {
  const s = seed();
  const { turn, frames } = makeTurn(s, { maxTurns: 400, maxBudgetUsd: 0.01 }, async (o) => {
    o.onEvent({ type: 'session', sessionId: 'codex:t', init: true });
    setTimeout(() => turn.abort.abort(), 5);
    await waitAbort(o.signal);
    o.onEvent({ type: 'result', subtype: 'error_during_execution', isError: true, text: '', usage: { input_tokens: 900, output_tokens: 9 }, costUsd: 0.03 });
    throw abortErr();
  });
  await turn.run();
  const done = frames.find((f) => f.type === 'ask-done');
  assert.equal(done.status, 'stopped');
  assert.equal(done.reason, 'user');
  assert.equal(done.costUsd, 0.03);
});

test('askMaxBudgetUsd: a reported cost over the cap stops the turn with the budget notice', async () => {
  const s = seed();
  const { turn, frames } = makeTurn(s, { maxTurns: 400, maxBudgetUsd: 0.5 }, async (o) => {
    o.onEvent({ type: 'session', sessionId: 'codex:t', init: true });
    o.onEvent({ type: 'text', text: 'x', parentId: null, from: 'assistant', blocks: ['x'], messageId: 'i1' });
    o.onEvent({ type: 'result', text: 'x', isError: false, usage: { input_tokens: 1, output_tokens: 1 }, costUsd: 0.75 });
    return { text: 'x', exitCode: 0 };
  });
  await turn.run();
  const done = frames.find((f) => f.type === 'ask-done');
  assert.equal(done.reason, 'max_budget');
  assert.equal(done.costUsd, 0.75, 'the spend still books');
  assert.ok(getMessage(s.asst.id).blocks.some((b) => b.text === 'Stopped: reached the $0.5 per-turn cap (Settings → Ask Worca)'));
});

test('budget set and an unpriced model: the turn refuses to start, naming the model', async () => {
  const s = seed();
  let spawned = false;
  const { turn, frames } = makeTurn(s, { maxTurns: 400, maxBudgetUsd: 1 }, async () => { spawned = true; return { text: '', exitCode: 0 }; }, { model: 'my-local-codex' });
  await turn.run();
  assert.equal(spawned, false);
  assert.match(frames.find((f) => f.type === 'ask-error').message, /my-local-codex has no known price on Codex/);
});

test('a shell command in the stream stops the turn as an error', async () => {
  const s = seed();
  const { turn, frames } = makeTurn(s, { maxTurns: 400, maxBudgetUsd: null }, async (o) => {
    o.onEvent({ type: 'session', sessionId: 'codex:t', init: true });
    call(o, 'sh', 'Bash');
    await waitAbort(o.signal); throw abortErr();
  });
  await turn.run();
  assert.equal(frames.find((f) => f.type === 'ask-error').message, CODEX_SHELL_TRIPPED_MESSAGE);
});

test('the resume-fallback retry is a fresh codex process: the tool-call count starts over', async () => {
  const s = seed();
  let n = 0;
  const { turn, frames } = makeTurn(s, { maxTurns: 3, maxBudgetUsd: null }, async (o) => {
    n += 1;
    call(o, `a${n}`); call(o, `b${n}`);
    if (n === 1) throw new Error('no rollout found for thread id gone');
    o.onEvent({ type: 'session', sessionId: 'codex:t', init: true });
    return { text: '', exitCode: 0 };
  }, { resumeSessionId: 'codex:gone' });
  await turn.run();
  assert.equal(n, 2);
  assert.equal(frames.find((f) => f.type === 'ask-done').status, 'done', '2 + 2 calls over two processes never pass a cap of 3');
});

for (const [what, push, named] of [
  ['a native web search', (o) => call(o, 'ws', 'WebSearch'), 'WebSearch'],
  ['a file edit', (o) => call(o, 'ed', 'Edit'), 'Edit'],
  ['a sub-agent spawn', (o) => o.onEvent({ type: 'subagent', event: 'spawn', toolUseId: 'sa', label: 'x', description: 'x' }), 'a sub-agent'],
]) {
  test(`${what} in the stream stops the turn as an error naming it`, async () => {
    const s = seed();
    const { turn, frames } = makeTurn(s, { maxTurns: 400, maxBudgetUsd: null }, async (o) => {
      o.onEvent({ type: 'session', sessionId: 'codex:t', init: true });
      push(o);
      await waitAbort(o.signal); throw abortErr();
    });
    await turn.run();
    assert.equal(frames.find((f) => f.type === 'ask-error').message, codexToolTrippedMessage(named));
  });
}

test('a Claude turn has no watchdog: tool calls past askMaxTurns are the CLI\'s business', async () => {
  const s = seed();
  const { turn, frames } = makeTurn(s, { maxTurns: 1, maxBudgetUsd: null }, async (o) => {
    o.onEvent({ type: 'session', sessionId: 'sess', init: true });
    call(o, 'a'); call(o, 'b');
    return { text: '', exitCode: 0 };
  }, { engine: 'claude', model: 'claude-opus-5-5' });
  await turn.run();
  assert.equal(frames.find((f) => f.type === 'ask-done').status, 'done');
});
