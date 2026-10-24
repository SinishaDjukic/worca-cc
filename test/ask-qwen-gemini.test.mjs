// test/ask-qwen-gemini.test.mjs — an Ask Worca chat on Qwen Code, Gemini CLI, Goose and OpenCode: the spawn's lockdown options, the
// MCP child's file tools, the catalog (no effort vocabulary), the prompt, the turn's readiness gate (support check,
// self-test, preflight), the watchdog, the resume fallback, the title, and the panel's engine rules.
import { test, after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { buildAskSpawnOptions, buildMcpConfig } from '../src/core/ask/spawn.mjs';
import { defaultFileDeps } from '../src/core/ask/file-deps.mjs';
import { createAskModels, chatEngine, ENGINE_LABEL } from '../src/core/ask/models.mjs';
import { engineSystemRules, buildSystemPrompt, buildComposerSystemPrompt } from '../src/core/ask/prompt.mjs';
import { createAskTurn } from '../src/core/ask/turn.mjs';
import { suggestionModel } from '../src/core/ask/suggest.mjs';
import { createThread, appendMessage, getMessage, getThread } from '../src/core/ask/store.mjs';
import { ASK_ENGINES } from '../src/core/model-env.mjs';
import { ASK_CHAT_ENGINES, attachRefusal, pickerGroups, isEngineSetupNotice } from '../ui/public/ask-engine.mjs';
import { chatDescriptor } from '../src/core/engines/chat.mjs';

useTempHome(after);
const prevHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
const scratchHome = mkdtempSync(join(tmpdir(), 'worca-ask-qg-home-'));
process.env.HOME = scratchHome; process.env.USERPROFILE = scratchHome; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
after(() => {
  for (const [k, v] of [['HOME', prevHome.HOME], ['USERPROFILE', prevHome.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prevHome.ALLOW]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(scratchHome, { recursive: true, force: true });
});

const FAMILY = { anchor: 'gemini-cli-and-qwen-code', cap: (E) => `A per-turn cost cap is set, and ${E.label} reports no cost` };
const ENGINES_UNDER_TEST = [
  { ...FAMILY, engine: 'qwen', label: 'Qwen Code', cli: "Qwen Code with Qwen Code's own sign-in", model: 'qwen3-coder-plus', session: 'qwen:0b5e8c1a-0000-4000-8000-0000000000a1', cwd: '/h/.worca-cc/tmp/ask', resumeGone: 'qwen: No saved session found with ID x' },
  { ...FAMILY, engine: 'gemini', label: 'Gemini CLI', cli: "Gemini CLI with Gemini CLI's own sign-in", model: 'gemini-3-pro', session: 'gemini:0b5e8c1a-0000-4000-8000-0000000000e1', cwd: '/h/.worca-cc/tmp/ask/gemini/ask_00000001', resumeGone: 'gemini exited with code 42: Invalid session identifier' },
  // Goose and OpenCode report a cost, but worca knows no price of their models: a cost cap refuses the turn too.
  { engine: 'goose', label: 'Goose', cli: "Goose with Goose's own providers", anchor: 'goose', cap: (E) => `A per-turn cost cap is set, and ${E.model} has no known price on Goose`, model: 'google/gemini-3-flash', session: 'goose:worca-1-abc', cwd: '/h/.worca-cc/tmp/ask', resumeGone: "goose exited with code 1: No session found with name 'worca-1-abc'" },
  { engine: 'opencode', label: 'OpenCode', cli: "OpenCode with OpenCode's own providers", anchor: 'opencode', cap: (E) => `A per-turn cost cap is set, and ${E.model} has no known price on OpenCode`, model: 'anthropic/claude-sonnet-5-5', session: 'opencode:ses_abc123', cwd: '/h/.worca-cc/tmp/ask', resumeGone: 'opencode exited with code 1: Error: Session not found' },
];

const spawnBase = (over = {}) => ({
  thread: { id: 'ask_00000001', sessionId: null },
  turn: { prompt: 'hello', systemPrompt: 'SYS', model: 'm', effort: 'medium', modelEnv: { X: '1' }, images: ['/att/a.png'] },
  limits: { maxTurns: 40, maxBudgetUsd: null },
  mcpConfigPath: '/h/.worca-cc/tmp/ask/mcp-askm_00000001.json',
  scratchDir: '/h/.worca-cc/tmp/ask',
  memoryDir: '/h/.worca-cc/ask/memory/global',
  web: { enabled: true, allowedDomains: ['example.com'], search: { url: 'https://s/{query}', keyVar: 'BRAVE_KEY' } },
  ...over,
});

test('the engine lists agree, and Chat runs on Qwen Code, Gemini CLI, Goose and OpenCode (not Cursor)', () => {
  assert.deepEqual([...ASK_CHAT_ENGINES], ASK_ENGINES);
  for (const e of ['qwen', 'gemini', 'goose', 'opencode']) assert.ok(ASK_ENGINES.includes(e), e);
  assert.equal(ASK_ENGINES.includes('cursor'), false);
  assert.equal(ENGINE_LABEL.qwen, 'Qwen Code');
  assert.equal(ENGINE_LABEL.gemini, 'Gemini CLI');
});

for (const E of ENGINES_UNDER_TEST) {
  test(`a ${E.label} chat: the adapter lockdown, the worca MCP server, no images, none of Claude's levers`, () => {
    const { signal, onEvent, ...o } = buildAskSpawnOptions({ ...spawnBase({ thread: { id: 'ask_00000001', sessionId: E.session } }),
      turn: { ...spawnBase().turn, model: E.model }, engine: E.engine, commands: { url: 'http://127.0.0.1:1/c', token: 'tok-1' } });
    assert.deepEqual(o, {
      engine: E.engine, cwd: E.cwd, prompt: 'hello', systemPrompt: 'SYS', model: E.model, effort: 'medium',
      sandbox: 'read-only', askLockdown: true, mcpConfigPath: '/h/.worca-cc/tmp/ask/mcp-askm_00000001.json',
      envScrub: true, envAllowlist: ['SSH_AUTH_SOCK', 'BRAVE_KEY'], resumeSessionId: E.session,
      spawnEnv: { ASK_COMMAND_TOKEN: 'tok-1' },
    });
  });

  test(`the MCP child of a ${E.label} chat gets worca's file tools`, () => {
    const doc = buildMcpConfig({ homeBase: '/h', threadId: 'ask_00000001', serverPath: '/s.mjs', env: {}, engine: E.engine, skillRoot: '/h/.worca-cc/ask/ask_00000001/skills/askm_1' });
    assert.equal(doc.mcpServers.worca.env.WORCA_ASK_ENGINE, E.engine);
    assert.equal(doc.mcpServers.worca.env.WORCA_ASK_SKILL_ROOT, '/h/.worca-cc/ask/ask_00000001/skills/askm_1');
    const d = defaultFileDeps({ threadId: 'ask_00000001', env: { WORCA_ASK_ENGINE: E.engine } });
    assert.equal(d.engine, E.engine);
    assert.equal(d.chatImages, true, 'every engine here forwards an image block');
    assert.equal(d.chatPdfs, E.engine !== 'goose', 'Goose turns a PDF block into text: no PDFs');
    assert.equal(typeof d.files.readMedia, 'function');
    assert.equal(typeof d.files.readFile, 'function');
  });
}

const ROWS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false, hasEnv: false, engine: 'claude' },
  { id: 'qwen3-coder-plus', label: 'Qwen3 Coder Plus', efforts: [], custom: 'global', hasEnv: false, engine: 'qwen' },
  { id: 'gemini-3-pro', label: 'Gemini 3 Pro', custom: 'global', hasEnv: false, engine: 'gemini' },
];
const mk = (prefs = { engine: 'claude', slots: {} }, avail = {}) => createAskModels({ listModels: async () => ROWS, pluginModels: () => [],
  secretStatus: () => [], effortless: () => new Set(), askPrefs: () => prefs, ...avail });

test('askCatalog: Qwen and Gemini rows with one hidden effort, their defaults, askEngine qwen', async () => {
  const cat = await mk({ engine: 'qwen', slots: { qwen: { model: 'qwen3-coder-plus' } } }).askCatalog();
  const q = cat.models.find((m) => m.id === 'qwen3-coder-plus');
  assert.equal(q.engine, 'qwen');
  assert.deepEqual(q.efforts, ['medium'], 'an engine with no effort carries one placeholder…');
  assert.equal(q.noEffort, true, '…that the picker hides');
  assert.deepEqual(cat.defaults.qwen, { model: 'qwen3-coder-plus', effort: 'medium' });
  assert.deepEqual(cat.defaults.gemini, { model: 'gemini-3-pro', effort: 'medium' });
  assert.equal(cat.askEngine, 'qwen');
  const off = await mk({ engine: 'qwen', slots: {} }, { qwenAvailable: () => false }).askCatalog();
  assert.equal(off.models.some((m) => m.engine === 'qwen'), false);
  assert.equal(off.askEngine, 'claude');
  assert.equal(off.models.some((m) => m.engine === 'gemini'), true, 'one engine off leaves the other');
});

test('a Qwen chat takes only Qwen models', async () => {
  const m = mk();
  assert.deepEqual(await m.validateModelEffort('qwen3-coder-plus', 'medium', { engine: 'qwen' }), { ok: true, model: 'qwen3-coder-plus', effort: 'medium' });
  assert.deepEqual(await m.validateModelEffort('gemini-3-pro', 'medium', { engine: 'qwen' }), { ok: false, error: 'this chat runs on Qwen Code; start a new chat to use Gemini CLI' });
  assert.equal(chatEngine({ model: 'x', engine: 'gemini' }), 'gemini');
});

test('the prompt: worca\'s file tools, no sub-agents, images (and PDFs) as blocks of read_attachment, the engine named', () => {
  for (const E of ENGINES_UNDER_TEST) {
    const rules = engineSystemRules(E.engine);
    assert.match(rules, /the worca file tools read_file, grep and glob/);
    assert.ok(rules.includes('read_attachment returns the image'), 'images come back as a block of the result');
    assert.equal(rules.includes(`A ${E.label} chat cannot view a PDF`), E.engine === 'goose');
    assert.ok(rules.includes(`this chat runs on ${E.cli}`));
    assert.doesNotMatch(rules, /Codex CLI|sub-agent/);
    assert.ok(buildSystemPrompt([], { engine: E.engine }).startsWith(rules));
    assert.ok(buildSystemPrompt([], { engine: E.engine, web: { enabled: true, allowedDomains: ['a.com'] } }).includes(`${E.label}'s own web tools stay off.`));
    assert.ok(buildComposerSystemPrompt([], { engine: E.engine }).includes(E.engine === 'goose' ? 'a Goose chat cannot view a PDF' : 'For an image or PDF, read_attachment returns the image or PDF itself'));
    assert.equal(suggestionModel(E.engine, { inCatalog: () => true, ready: () => true }), null, 'no next-prompt suggestion');
  }
});

test('the panel: each engine\'s section and what it refuses before upload', () => {
  assert.deepEqual(pickerGroups(ROWS).map((g) => g.engine), ['claude', 'gemini', 'qwen']);
  for (const engine of ['qwen', 'gemini', 'goose', 'opencode']) {
    assert.equal(attachRefusal({ ext: '.png', engine }), null);
    assert.equal(attachRefusal({ ext: '.pdf', engine }), engine === 'goose' ? 'a Goose chat cannot view PDFs (Claude, Gemini CLI, OpenCode or Qwen Code chats can)' : null);
    assert.equal(attachRefusal({ ext: '.md', engine }), null);
  }
  assert.equal(isEngineSetupNotice({ kind: 'notice', qwenSetup: true }), true);
  assert.equal(isEngineSetupNotice({ kind: 'notice', codexSetup: true }), true);
  assert.equal(isEngineSetupNotice({ kind: 'notice' }), false);
});

// ── the turn ──
function seed() {
  const thread = createThread();
  const user = appendMessage(thread.id, { role: 'user', text: 'hello' });
  const asst = appendMessage(thread.id, { role: 'assistant', text: '', status: 'streaming' });
  return { thread, user, asst };
}
function makeTurn(E, s, over = {}, deps = {}) {
  const frames = [];
  const calls = [];
  const order = [];
  const titles = [];
  const turn = createAskTurn({
    threadId: s.thread.id, assistantMessageId: s.asst.id, userMessageId: s.user.id,
    prompt: 'PROMPT', systemPrompt: 'SYS', restoredPrompt: 'RESTORED', model: E.model, effort: 'medium', engine: E.engine,
    firstTurn: false, firstText: 'hello', ...over,
    deps: {
      onFrame: (f) => frames.push(f),
      generateTitle: async (...a) => { titles.push(a); return 'never'; },
      failedBecauseSignedOut: async () => { throw new Error(`never asked on ${E.label}`); },
      [`${E.engine}AskSupport`]: async () => { order.push('support'); return {}; },
      [`${E.engine}SelfTest`]: async () => { order.push('selfTest'); return {}; },
      [`${E.engine}Preflight`]: async () => { order.push('preflight'); return {}; },
      memoryMount: async () => null,
      askLimits: () => ({ maxTurns: 40, maxBudgetUsd: null }),
      ...deps,
      runClaudeImpl: deps.runClaudeImpl ? (o) => { calls.push(o); return deps.runClaudeImpl(o); } : undefined,
    },
  });
  return { turn, frames, calls, order, titles };
}
const reply = (E, o, { text = 'Answer', calls = null } = {}) => {
  o.onEvent({ type: 'session', sessionId: E.session });
  o.onEvent({ type: 'session', sessionId: E.session, model: E.model, init: true });
  if (calls) o.onEvent({ type: 'tool', parentId: null, calls });
  o.onEvent({ type: 'text', text, parentId: null, from: 'assistant', blocks: [text], messageId: 'm1' });
  o.onEvent({ type: 'result', text, isError: false, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  return { text, exitCode: 0 };
};

for (const E of ENGINES_UNDER_TEST) {
  test(`a ${E.label} turn: support check, self-test, preflight, then the locked-down spawn; the reply and session land`, async () => {
    const s = seed();
    const { turn, frames, calls, order } = makeTurn(E, s, {}, { runClaudeImpl: async (o) => { order.push('spawn'); return reply(E, o); } });
    await turn.run();
    assert.deepEqual(order, ['support', 'selfTest', 'preflight', 'spawn']);
    assert.equal(calls[0].engine, E.engine);
    assert.equal(calls[0].askLockdown, true);
    assert.equal('images' in calls[0], false);
    assert.equal(getMessage(s.asst.id).text, 'Answer');
    assert.equal(getThread(s.thread.id).sessionId, E.session);
    assert.equal(frames.at(-1).type, 'ask-done');
  });

  test(`a failed ${E.label} self-test: ${E.engine}-not-ready, a notice with the setup link, no spawn, no preflight`, async () => {
    const s = seed();
    const { turn, frames, calls, order } = makeTurn(E, s, {}, {
      [`${E.engine}SelfTest`]: async () => { order.push('selfTest'); return { refusal: `${E.label} offered tools a chat must not have (run_shell_command)` }; },
      runClaudeImpl: async (o) => reply(E, o),
    });
    await turn.run();
    assert.equal(calls.length, 0);
    assert.deepEqual(order, ['support', 'selfTest']);
    const err = frames.find((f) => f.type === 'ask-error');
    assert.equal(err.code, `${E.engine}-not-ready`);
    const notice = getMessage(s.asst.id).blocks.find((b) => b.kind === 'notice' && b[`${E.engine}Setup`]);
    assert.equal(notice.href, chatDescriptor(E.engine).notReady.docsUrl);
    assert.ok(notice.href.endsWith(`docs/models.md#${E.anchor}`));
    assert.ok(notice.text.startsWith(`${E.label} isn't ready: ${E.label} offered tools a chat must not have`));
  });

  test(`a ${E.label} binary without the lockdown flags is refused before the self-test`, async () => {
    const s = seed();
    const { turn, calls, order } = makeTurn(E, s, {}, {
      [`${E.engine}AskSupport`]: async () => { order.push('support'); return { refusal: 'too old' }; },
      runClaudeImpl: async (o) => reply(E, o),
    });
    await turn.run();
    assert.equal(calls.length, 0);
    assert.deepEqual(order, ['support']);
  });

  test(`a per-turn cost cap refuses a ${E.label} turn (it reports no cost); nothing spawns`, async () => {
    const s = seed();
    const { turn, frames, calls, order } = makeTurn(E, s, {}, { askLimits: () => ({ maxTurns: 40, maxBudgetUsd: 1 }), runClaudeImpl: async (o) => reply(E, o) });
    await turn.run();
    assert.equal(calls.length, 0);
    assert.deepEqual(order, []);
    assert.ok(frames.find((f) => f.type === 'ask-error').message.startsWith(E.cap(E)));
  });

  test(`the mock: no ${E.label} binary is asked`, async () => {
    const s = seed();
    const { turn, order, calls } = makeTurn(E, s, { mock: { card: null } }, { runClaudeImpl: async (o) => reply(E, o) });
    await turn.run();
    assert.deepEqual(order, []);
    assert.equal(calls.length, 1);
  });

  test(`the watchdog: a shell call or a tool that is not worca's ends a ${E.label} turn as an error`, async () => {
    for (const [name, re] of [['Bash', new RegExp(`^${E.label} tried to run a shell command`)], ['WebFetch', new RegExp(`^${E.label} used WebFetch, which a chat must not have`)]]) {
      const s = seed();
      const { turn, frames } = makeTurn(E, s, {}, { runClaudeImpl: async (o) => {
        reply(E, o, { calls: [{ id: 't1', name, input: {} }] });
        if (o.signal?.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
        return { text: '', exitCode: 0 };
      } });
      await turn.run();
      assert.match(frames.find((f) => f.type === 'ask-error').message, re);
    }
  });

  test(`a stored ${E.label} session the CLI no longer knows: one retry from history, no resume`, async () => {
    const s = seed();
    let n = 0;
    const { turn, calls } = makeTurn(E, s, { resumeSessionId: E.session }, { runClaudeImpl: async (o) => {
      n += 1;
      if (n === 1) { o.onEvent({ type: 'session', sessionId: E.session }); o.onEvent({ type: 'stderr', stream: 'err', text: 'x' }); throw new Error(E.resumeGone); }
      return reply(E, o);
    } });
    await turn.run();
    assert.equal(calls.length, 2);
    assert.equal(calls[0].resumeSessionId, E.session);
    assert.equal('resumeSessionId' in calls[1], false);
    assert.equal(calls[1].prompt, 'RESTORED');
    assert.ok(getMessage(s.asst.id).blocks.some((b) => b.kind === 'notice' && b.text === 'Context restored from history'));
  });

  test(`a ${E.label} chat's title is the prompt's own words: no title call outside the lockdown`, async () => {
    const s = seed();
    const { turn, titles } = makeTurn(E, s, { firstTurn: true, deterministicTitle: 'hello there' }, { runClaudeImpl: async (o) => reply(E, o) });
    await turn.run();
    await turn.titlePromise;
    assert.equal(titles.length, 0);
    assert.equal(getThread(s.thread.id).title, 'hello there');
  });
}

test('a model its engine rules out never starts a chat (OpenCode Zen, a Goose agent-CLI provider); the picker leaves it out', async () => {
  for (const [engine, model, re] of [['opencode', 'opencode/big-pickle', /OpenCode Zen's free models/], ['goose', 'claude-acp/default', /claude-acp is an agent CLI/]]) {
    const E = ENGINES_UNDER_TEST.find((x) => x.engine === engine);
    const s = seed();
    const { turn, frames, calls, order } = makeTurn({ ...E, model }, s, {}, { runClaudeImpl: async (o) => reply(E, o) });
    await turn.run();
    assert.equal(calls.length, 0);
    assert.deepEqual(order, []);
    assert.match(frames.find((f) => f.type === 'ask-error').message, re);
  }
  const cat = await createAskModels({ listModels: async () => [
    { id: 'opencode/big-pickle', efforts: [], custom: 'global', engine: 'opencode' }, { id: 'anthropic/claude-sonnet-5-5', efforts: [], custom: 'global', engine: 'opencode' },
    { id: 'claude-acp/default', efforts: [], custom: 'global', engine: 'goose' }, { id: 'google/gemini-3-flash', efforts: [], custom: 'global', engine: 'goose' },
  ], pluginModels: () => [], secretStatus: () => [], effortless: () => new Set(), askPrefs: () => ({ engine: 'claude', slots: {} }) }).askCatalog();
  assert.deepEqual(cat.models.map((m) => m.id), ['anthropic/claude-sonnet-5-5', 'google/gemini-3-flash']);
});

test('the watchdog keeps Goose\'s one named meta tool (load_skill); any other foreign tool still stops the turn', async () => {
  const E = ENGINES_UNDER_TEST.find((x) => x.engine === 'goose');
  const s = seed();
  const { turn, frames } = makeTurn(E, s, {}, { runClaudeImpl: async (o) => reply(E, o, { calls: [{ id: 't1', name: 'load_skill', input: { name: 'web-search' } }] }) });
  await turn.run();
  assert.equal(frames.at(-1).type, 'ask-done');
  const q = ENGINES_UNDER_TEST.find((x) => x.engine === 'qwen');
  const s2 = seed();
  const { turn: t2, frames: f2 } = makeTurn(q, s2, {}, { runClaudeImpl: async (o) => {
    reply(q, o, { calls: [{ id: 't1', name: 'load_skill', input: {} }] });
    if (o.signal?.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    return { text: '', exitCode: 0 };
  } });
  await t2.run();
  assert.match(f2.find((f) => f.type === 'ask-error').message, /^Qwen Code used load_skill/, 'only the engine that names it keeps it');
});
