// test/ask-copilot.test.mjs — an Ask Worca chat on Copilot: the spawn's lockdown options, the MCP child's file tools,
// the catalog, the prompt, the turn's readiness gate and the panel's engine rules.
import { test, after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { buildAskSpawnOptions, buildMcpConfig } from '../src/core/ask/spawn.mjs';
import { defaultFileDeps } from '../src/core/ask/file-deps.mjs';
import { createAskModels, chatEngine } from '../src/core/ask/models.mjs';
import { ASK_SYSTEM_RULES, ASK_COPILOT_REWRITES, copilotSystemRules, buildSystemPrompt, buildComposerSystemPrompt } from '../src/core/ask/prompt.mjs';
import { createAskTurn, COPILOT_NOT_READY_CODE, COPILOT_SETUP_DOCS_URL } from '../src/core/ask/turn.mjs';
import { suggestionModel } from '../src/core/ask/suggest.mjs';
import { createThread, appendMessage, getMessage, getThread } from '../src/core/ask/store.mjs';
import { ASK_ENGINES, CODEX_EFFORTS } from '../src/core/model-env.mjs';
import { ASK_CHAT_ENGINES, attachRefusal, pickerGroups, chatEngineOf } from '../ui/public/ask-engine.mjs';

useTempHome(after);
// settings.json lives under $HOME/.worca-cc (the Ask slot, the Ask caps): HOME is a scratch dir too.
const prevHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
const scratchHome = mkdtempSync(join(tmpdir(), 'worca-ask-copilot-home-'));
process.env.HOME = scratchHome; process.env.USERPROFILE = scratchHome; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
after(() => {
  for (const [k, v] of [['HOME', prevHome.HOME], ['USERPROFILE', prevHome.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prevHome.ALLOW]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(scratchHome, { recursive: true, force: true });
});

const spawnBase = (over = {}) => ({
  thread: { id: 'ask_00000001', sessionId: null },
  turn: { prompt: 'hello', systemPrompt: 'SYS', model: 'copilot/gpt-5.4', effort: 'medium', modelEnv: { X: '1' }, images: ['/att/a.png'] },
  limits: { maxTurns: 40, maxBudgetUsd: null }, env: {},
  mcpConfigPath: '/h/.worca-cc/tmp/ask/mcp-askm_00000001.json',
  scratchDir: '/h/.worca-cc/tmp/ask',
  memoryDir: '/h/.worca-cc/ask/memory/global',
  web: { enabled: true, allowedDomains: ['example.com'], search: { url: 'https://s/{query}', keyVar: 'BRAVE_KEY' } },
  ...over,
});

test('the engine lists agree: the panel offers what the server runs', () => {
  assert.deepEqual([...ASK_CHAT_ENGINES], ASK_ENGINES);
  assert.ok(ASK_ENGINES.includes('copilot') && !ASK_ENGINES.includes('cursor'));
});

test('a Copilot chat: the adapter lockdown, the worca MCP server, no folder, no images, none of Claude\'s levers', () => {
  const { signal, onEvent, ...o } = buildAskSpawnOptions({ ...spawnBase({ thread: { id: 'ask_00000001', sessionId: 'copilot:0b5e8c1a-0000-4000-8000-000000000001' } }),
    engine: 'copilot', commands: { url: 'http://127.0.0.1:1/c', token: 'tok-1' } });
  assert.deepEqual(o, {
    engine: 'copilot', cwd: '/h/.worca-cc/tmp/ask', prompt: 'hello', systemPrompt: 'SYS', model: 'copilot/gpt-5.4', effort: 'medium',
    sandbox: 'read-only', askLockdown: true, mcpConfigPath: '/h/.worca-cc/tmp/ask/mcp-askm_00000001.json',
    envScrub: true, envAllowlist: ['SSH_AUTH_SOCK', 'BRAVE_KEY'], resumeSessionId: 'copilot:0b5e8c1a-0000-4000-8000-000000000001',
    spawnEnv: { ASK_COMMAND_TOKEN: 'tok-1' },
  });
});

test('the MCP child of a Copilot chat gets worca\'s file tools and classifies on Copilot', () => {
  const doc = buildMcpConfig({ homeBase: '/h', threadId: 'ask_00000001', serverPath: '/s.mjs', env: {}, engine: 'copilot', skillRoot: '/h/.worca-cc/ask/ask_00000001/skills/askm_1' });
  assert.equal(doc.mcpServers.worca.env.WORCA_ASK_ENGINE, 'copilot');
  assert.equal(doc.mcpServers.worca.env.WORCA_ASK_SKILL_ROOT, '/h/.worca-cc/ask/ask_00000001/skills/askm_1');
  const d = defaultFileDeps({ threadId: 'ask_00000001', env: { WORCA_ASK_ENGINE: 'copilot' } });
  assert.equal(d.engine, 'copilot');
  assert.equal(typeof d.files.readFile, 'function');
  assert.equal('WORCA_ASK_ENGINE' in buildMcpConfig({ homeBase: '/h', threadId: 'ask_00000001', serverPath: '/s.mjs', env: {} }).mcpServers.worca.env, false);
});

const ROWS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false, hasEnv: false, engine: 'claude' },
  { id: 'gpt-5.5', label: 'GPT-5.5', efforts: [...CODEX_EFFORTS], custom: false, hasEnv: false, engine: 'codex', builtin: true },
  { id: 'copilot/gpt-5.4', label: 'GPT-5.4', efforts: ['low', 'medium', 'high'], custom: false, hasEnv: false, engine: 'copilot', builtin: true },
  { id: 'copilot/claude-sonnet-5.5', label: 'Claude Sonnet 5.5', efforts: ['low', 'medium', 'high'], custom: false, hasEnv: false, engine: 'copilot', builtin: true },
];
const mk = (prefs = { engine: 'claude', slots: {} }, { copilotAvailable = () => true } = {}) => createAskModels({ listModels: async () => ROWS, pluginModels: () => [],
  secretStatus: () => [], effortless: () => new Set(), askPrefs: () => prefs, codexAvailable: () => true, copilotAvailable });

test('askCatalog: Copilot rows, their default, and askEngine copilot', async () => {
  const cat = await mk({ engine: 'copilot', slots: { copilot: { model: 'copilot/claude-sonnet-5.5', effort: 'high' } } }).askCatalog();
  assert.deepEqual(cat.models.filter((m) => m.engine === 'copilot').map((m) => m.id), ['copilot/gpt-5.4', 'copilot/claude-sonnet-5.5']);
  assert.deepEqual(cat.defaults.copilot, { model: 'copilot/claude-sonnet-5.5', effort: 'high' });
  assert.equal(cat.askEngine, 'copilot');
  assert.deepEqual(cat.default, cat.defaults.copilot);
  const plain = await mk({ engine: 'copilot', slots: {} }).askCatalog();
  assert.deepEqual(plain.defaults.copilot, { model: 'copilot/gpt-5.4', effort: 'medium' }, 'no slot: the first row, at medium');
  const off = await mk({ engine: 'copilot', slots: {} }, { copilotAvailable: () => false }).askCatalog();
  assert.equal(off.models.some((m) => m.engine === 'copilot'), false);
  assert.equal(off.askEngine, 'claude');
});

test('a Copilot chat takes only Copilot models', async () => {
  const m = mk();
  assert.deepEqual(await m.validateModelEffort('copilot/gpt-5.4', 'high', { engine: 'copilot' }), { ok: true, model: 'copilot/gpt-5.4', effort: 'high' });
  assert.deepEqual(await m.validateModelEffort('gpt-5.5', 'low', { engine: 'copilot' }), { ok: false, error: 'this chat runs on Copilot; start a new chat to use Codex' });
  assert.equal(chatEngine({ model: 'x', engine: 'copilot' }), 'copilot');
});

test('the prompt: worca\'s file tools, no sub-agents, no images, the Copilot CLI named', () => {
  for (const [from] of ASK_COPILOT_REWRITES) assert.equal(ASK_SYSTEM_RULES.split(from).length, 2, `once: ${from.slice(0, 50)}`);
  const rules = copilotSystemRules();
  assert.match(rules, /the worca file tools read_file, grep and glob/);
  assert.match(rules, /a Copilot chat cannot view them/);
  assert.match(rules, /this chat runs on the GitHub Copilot CLI with Copilot's own sign-in/);
  assert.doesNotMatch(rules, /Codex CLI|sub-agent/);
  assert.ok(buildSystemPrompt([], { engine: 'copilot' }).startsWith(rules));
  const web = buildSystemPrompt([], { engine: 'copilot', web: { enabled: true, allowedDomains: ['a.com'] } });
  assert.match(web, /Copilot's own web tools stay off\./);
  assert.match(buildComposerSystemPrompt([], { engine: 'copilot' }), /plus the worca file tools read_file, grep and glob.*A Copilot chat cannot view images or PDFs/s);
});

test("Copilot's next-prompt suggestion runs on an included model (no premium request on a paid plan)", () => {
  assert.equal(suggestionModel('copilot', { chatModel: 'copilot/claude-sonnet-5.5' }), 'gpt-5-mini');
});

test('the panel: Copilot\'s own section, its lock, and what it refuses before upload', () => {
  const groups = pickerGroups(ROWS);
  assert.deepEqual(groups.map((g) => g.engine), ['claude', 'codex', 'copilot']);
  assert.deepEqual(pickerGroups(ROWS, { lock: 'copilot' }).map((g) => g.models.map((m) => m.id)), [['copilot/gpt-5.4', 'copilot/claude-sonnet-5.5']]);
  assert.equal(chatEngineOf([{ role: 'assistant' }], 'gone', { models: [] }, 'copilot'), 'copilot');
  assert.equal(attachRefusal({ ext: '.png', engine: 'copilot' }), 'a Copilot chat cannot view images or PDFs (Claude, Gemini CLI, OpenCode or Qwen Code chats view both)');
  assert.equal(attachRefusal({ ext: '.pdf', engine: 'copilot' }), 'a Copilot chat cannot view images or PDFs (Claude, Gemini CLI, OpenCode or Qwen Code chats view both)');
  assert.equal(attachRefusal({ ext: '.md', engine: 'copilot' }), null);
  assert.equal(attachRefusal({ ext: '.png', engine: 'codex' }), null);
});

// ── the turn ──
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
    prompt: 'PROMPT', systemPrompt: 'SYS', restoredPrompt: 'RESTORED', model: 'copilot/gpt-5.4', effort: 'medium', engine: 'copilot',
    firstTurn: false, firstText: 'hello', ...over,
    deps: {
      onFrame: (f) => frames.push(f),
      generateTitle: async () => '',
      failedBecauseSignedOut: async () => { throw new Error('never asked on Copilot'); },
      copilotPreflight: async () => ({}),
      copilotAskSupport: async () => ({}),
      memoryMount: async () => null,
      askLimits: () => ({ maxTurns: 40, maxBudgetUsd: null }),
      ...deps,
      runClaudeImpl: deps.runClaudeImpl ? (o) => { calls.push(o); return deps.runClaudeImpl(o); } : undefined,
    },
  });
  return { turn, frames, calls };
}
const SESSION = 'copilot:0b5e8c1a-0000-4000-8000-000000000001';
const reply = (o, { text = 'Answer', calls = null } = {}) => {
  o.onEvent({ type: 'session', sessionId: SESSION });
  o.onEvent({ type: 'session', sessionId: SESSION, model: 'gpt-5.4', init: true });
  if (calls) o.onEvent({ type: 'tool', parentId: null, calls });
  o.onEvent({ type: 'text', text, parentId: null, from: 'assistant', blocks: [text], messageId: 'm1' });
  o.onEvent({ type: 'result', text, isError: false, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  return { text, exitCode: 0 };
};

test('a Copilot turn spawns copilot locked down with the worca MCP server; the reply and session land', async () => {
  const s = seed();
  const { turn, frames, calls } = makeTurn(s, {}, { runClaudeImpl: async (o) => reply(o) });
  await turn.run();
  assert.equal(calls[0].engine, 'copilot');
  assert.equal(calls[0].askLockdown, true);
  assert.equal(calls[0].sandbox, 'read-only');
  assert.equal('images' in calls[0], false);
  assert.ok(frames.some((f) => f.type === 'ask-delta' && f.text === 'Answer'), 'the whole message streams as one delta');
  assert.equal(getMessage(s.asst.id).text, 'Answer');
  assert.equal(getThread(s.thread.id).sessionId, SESSION);
  assert.equal(frames.at(-1).type, 'ask-done');
});

test('a per-turn cost cap refuses a Copilot turn (it reports no cost); nothing spawns', async () => {
  const s = seed();
  const { turn, frames, calls } = makeTurn(s, {}, { askLimits: () => ({ maxTurns: 40, maxBudgetUsd: 1 }), runClaudeImpl: async (o) => reply(o) });
  await turn.run();
  assert.equal(calls.length, 0);
  assert.match(frames.find((f) => f.type === 'ask-error').message, /A per-turn cost cap is set, and Copilot reports no cost/);
});

test('a copilot without the lockdown flags: copilot-not-ready, a notice with the setup link, no spawn', async () => {
  const s = seed();
  const { turn, frames, calls } = makeTurn(s, {}, { copilotAskSupport: async () => ({ refusal: 'this copilot has no --available-tools' }), runClaudeImpl: async (o) => reply(o) });
  await turn.run();
  assert.equal(calls.length, 0);
  const err = frames.find((f) => f.type === 'ask-error');
  assert.equal(err.code, COPILOT_NOT_READY_CODE);
  const notice = getMessage(s.asst.id).blocks.find((b) => b.kind === 'notice' && b.copilotSetup);
  assert.equal(notice.href, COPILOT_SETUP_DOCS_URL);
  assert.match(notice.text, /^Copilot isn't ready: this copilot has no --available-tools/);
});

test('the watchdog: a shell call or a tool that is not worca\'s ends a Copilot turn as an error', async () => {
  for (const [name, re] of [['Bash', /^Copilot tried to run a shell command/], ['WebFetch', /^Copilot used WebFetch, which a chat must not have/]]) {
    const s = seed();
    const { turn, frames } = makeTurn(s, {}, { runClaudeImpl: async (o) => {
      reply(o, { calls: [{ id: 't1', name, input: {} }] });
      if (o.signal?.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
      return { text: '', exitCode: 0 };
    } });
    await turn.run();
    assert.match(frames.find((f) => f.type === 'ask-error').message, re);
  }
});
