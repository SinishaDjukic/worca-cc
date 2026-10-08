// test/ask-turn-codex.test.mjs — an Ask turn on Codex (cascading-settings-design.md §4.6, D13, D15, §8 tests 16–17).
import { test, after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createAskTurn, CODEX_NOT_READY_CODE, CODEX_SETUP_DOCS_URL } from '../src/core/ask/turn.mjs';
import { createThread, appendMessage, getMessage, getThread } from '../src/core/ask/store.mjs';

useTempHome(after);
// settings.json lives under $HOME/.worca-cc (the Ask slot, the Ask caps): HOME is a scratch dir too.
const prevHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
const scratchHome = mkdtempSync(join(tmpdir(), 'worca-2b-home-'));
process.env.HOME = scratchHome; process.env.USERPROFILE = scratchHome; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
after(() => {
  for (const [k, v] of [['HOME', prevHome.HOME], ['USERPROFILE', prevHome.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prevHome.ALLOW]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(scratchHome, { recursive: true, force: true });
});
// A short lockdown and a codex that has its features: what reaches the spawn is the adapter's concern (codex-ask-adapter).
const TEST_LOCKDOWN = () => ['--disable', 'shell_tool'];

function seed() {
  const thread = createThread();
  const user = appendMessage(thread.id, { role: 'user', text: 'hello' });
  const asst = appendMessage(thread.id, { role: 'assistant', text: '', status: 'streaming' });
  return { thread, user, asst };
}
function makeTurn(s, over = {}, deps = {}) {
  const frames = [];
  const calls = [];
  const turn = createAskTurn({
    threadId: s.thread.id, assistantMessageId: s.asst.id, userMessageId: s.user.id,
    prompt: 'PROMPT', systemPrompt: 'SYS', restoredPrompt: 'RESTORED', model: 'gpt-5.5', effort: 'low', engine: 'codex',
    firstTurn: false, firstText: 'hello', ...over,
    deps: {
      onFrame: (f) => frames.push(f),
      generateTitle: async () => '',
      failedBecauseSignedOut: async () => { throw new Error('never asked on Codex'); },
      codexPreflight: async () => ({}),
      codexAskSupport: async () => ({}),
      codexLockdown: TEST_LOCKDOWN,
      memoryMount: async () => null,
      ...deps,
      runClaudeImpl: deps.runClaudeImpl ? (o) => { calls.push(o); return deps.runClaudeImpl(o); } : undefined,
    },
  });
  return { turn, frames, calls };
}
const reply = (o, { id = 'item_1', text = 'Answer', cost = 0.01 } = {}) => {
  o.onEvent({ type: 'session', sessionId: 'codex:th-1', model: 'gpt-5.5', init: true });
  o.onEvent({ type: 'session', sessionId: 'codex:th-1' });
  o.onEvent({ type: 'text', text, parentId: null, from: 'assistant', blocks: [text], messageId: id });
  o.onEvent({ type: 'result', text, isError: false, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, costUsd: cost });
  return { text, exitCode: 0 };
};

test('a Codex turn spawns codex read-only with the worca MCP server; the whole message reaches the panel and the row', async () => {
  const s = seed();
  const { turn, frames, calls } = makeTurn(s, {}, { runClaudeImpl: async (o) => reply(o) });
  await turn.run();
  assert.equal(calls[0].engine, 'codex');
  assert.equal(calls[0].sandbox, 'read-only');
  assert.equal(calls[0].askLockdown, true);
  assert.ok(frames.some((f) => f.type === 'ask-delta' && f.text === 'Answer'), 'D15: the whole message streams as one delta');
  assert.equal(getMessage(s.asst.id).text, 'Answer');
  assert.equal(getThread(s.thread.id).sessionId, 'codex:th-1');
  assert.equal(frames.at(-1).type, 'ask-done');
});

test('codexPreflight refusal: ask-error code codex-not-ready, a notice with the setup link, no spawn', async () => {
  const s = seed();
  const { turn, frames, calls } = makeTurn(s, {}, { codexPreflight: async () => ({ refusal: 'codex is not signed in — run `codex login`' }), runClaudeImpl: async (o) => reply(o) });
  await turn.run();
  assert.equal(calls.length, 0);
  const err = frames.find((f) => f.type === 'ask-error');
  assert.equal(err.code, CODEX_NOT_READY_CODE);
  assert.equal(err.message, 'codex is not signed in — run `codex login`');
  const notice = getMessage(s.asst.id).blocks.find((b) => b.kind === 'notice');
  assert.equal(notice.text, "Codex isn't ready: codex is not signed in — run `codex login`");
  assert.equal(notice.href, CODEX_SETUP_DOCS_URL);
  assert.equal(notice.hrefLabel, 'Codex setup');
});

test('a relayed Codex turn skips the preflight: it would check the server user\'s codex, not the agent user\'s', async () => {
  const s = seed();
  let asked = 0; let supported = 0;
  const { turn, calls } = makeTurn(s, {}, { codexPreflight: async () => { asked += 1; return { refusal: 'server user is not signed in' }; },
    codexAskSupport: async () => { supported += 1; return {}; },
    agentRelay: () => ({ token: 't', dispose() {} }), runClaudeImpl: async (o) => reply(o) });
  await turn.run();
  assert.equal(asked, 0);
  assert.equal(supported, 1, 'the lockdown flags are the binary\'s: checked for a relayed turn too');
  assert.equal(calls.length, 1);
});

test('a codex without every lockdown flag refuses with "update codex", a setup notice, no spawn', async () => {
  const s = seed();
  const { turn, frames, calls } = makeTurn(s, {}, {
    codexAskSupport: async () => ({ refusal: 'this codex cannot switch off view_image for a chat — update codex to 0.162 or newer' }),
    runClaudeImpl: async (o) => reply(o) });
  await turn.run();
  assert.equal(calls.length, 0);
  const err = frames.find((f) => f.type === 'ask-error');
  assert.equal(err.code, CODEX_NOT_READY_CODE);
  assert.match(err.message, /update codex to 0\.162/);
  assert.ok(getMessage(s.asst.id).blocks.some((b) => b.kind === 'notice' && b.href === CODEX_SETUP_DOCS_URL && /view_image/.test(b.text)));
});

test('a preflight warning proceeds', async () => {
  const s = seed();
  const { turn, calls } = makeTurn(s, {}, { codexPreflight: async () => ({ warning: 'could not tell' }), runClaudeImpl: async (o) => reply(o) });
  await turn.run();
  assert.equal(calls.length, 1);
});

test('no lockdown on this codex: the turn refuses before any spawn', async () => {
  const s = seed();
  const { turn, frames, calls } = makeTurn(s, {}, { codexLockdown: () => null, runClaudeImpl: async (o) => reply(o) });
  await turn.run();
  assert.equal(calls.length, 0);
  assert.match(frames.find((f) => f.type === 'ask-error').message, /Ask on Codex is unavailable/);
});

test('the shipped lockdown lets a Codex turn start', async () => {
  const s = seed();
  const { turn, calls } = makeTurn(s, {}, { codexLockdown: undefined, runClaudeImpl: async (o) => reply(o) });
  await turn.run();
  assert.equal(calls.length, 1);
});

test('a codex resume that finds no thread retries fresh on Codex', async () => {
  const s = seed();
  let n = 0;
  const { turn, calls } = makeTurn(s, { resumeSessionId: 'codex:gone' }, {
    runClaudeImpl: async (o) => {
      n += 1;
      if (n === 1) { o.onEvent({ type: 'session', sessionId: 'codex:gone', model: 'gpt-5.5', init: true }); throw new Error('codex: no rollout found for thread id gone'); }
      return reply(o);
    },
  });
  await turn.run();
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.engine === 'codex'), 'never retried on Claude');
  assert.equal(calls[1].resumeSessionId, undefined);
  assert.equal(calls[1].prompt, 'RESTORED');
  assert.ok(getMessage(s.asst.id).blocks.some((b) => b.text === 'Context restored from history'));
});

test('a mid-turn codex error is shown with its own text and class, never retried', async () => {
  const s = seed();
  const { turn, frames, calls } = makeTurn(s, {}, { runClaudeImpl: async (o) => { o.onEvent({ type: 'session', sessionId: 'codex:th-1', init: true }); throw Object.assign(new Error('codex: You hit your usage limit. Try again at 15:47.'), { errorClass: 'usage_limit' }); } });
  await turn.run();
  assert.equal(calls.length, 1);
  const err = frames.find((f) => f.type === 'ask-error');
  assert.equal(err.errorClass, 'usage_limit');
  assert.equal('code' in err, false);
});

test('images ride both attempts; the memory folder is named in the Codex system prompt, never mounted', async () => {
  const s = seed();
  const { turn, calls } = makeTurn(s, { images: ['/att/a.png'] }, { memoryMount: async () => '/h/ask/memory/global', runClaudeImpl: async (o) => reply(o) });
  await turn.run();
  assert.deepEqual(calls[0].images, ['/att/a.png']);
  assert.equal('addDirs' in calls[0], false);
  assert.match(calls[0].systemPrompt, /\/h\/ask\/memory\/global\/\.claude\/rules\/worca/);
});

test('the chat title runs on Codex with the Ask slot model, read-only', async () => {
  const s = seed();
  const titles = [];
  const { turn } = makeTurn(s, { firstTurn: true }, {
    generateTitle: async (_t, o) => { titles.push(o); return 'T'; }, askSlot: (e) => (e === 'codex' ? { model: 'gpt-5.6-luna' } : undefined),
    runClaudeImpl: async (o) => reply(o),
  });
  await turn.run();
  await turn.titlePromise;
  assert.equal(titles[0].engine, 'codex');
  assert.equal(titles[0].model, 'gpt-5.6-luna');
});

test('a refused first Codex turn starts no codex for its title: the prompt words become the title', async () => {
  const s = seed();
  const titles = [];
  const { turn, calls } = makeTurn(s, { firstTurn: true, deterministicTitle: 'hello' }, {
    codexLockdown: () => null, generateTitle: async (_t, o) => { titles.push(o); return 'T'; }, runClaudeImpl: async (o) => reply(o),
  });
  await turn.run();
  await turn.titlePromise;
  assert.equal(calls.length, 0);
  assert.equal(titles.length, 0, 'no title spawn');
  assert.equal(getThread(s.thread.id).title, 'hello');
});

test('the MCP servers note shows once when asked', async () => {
  const s = seed();
  const { turn } = makeTurn(s, { mcpCodexNote: true }, { runClaudeImpl: async (o) => reply(o) });
  await turn.run();
  const notes = getMessage(s.asst.id).blocks.filter((b) => b.mcpCodex);
  assert.deepEqual(notes.map((b) => b.text), ['Your MCP servers are available in Claude chats']);
});
