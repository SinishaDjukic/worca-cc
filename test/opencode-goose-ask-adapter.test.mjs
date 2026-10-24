// test/opencode-goose-ask-adapter.test.mjs — Chat on OpenCode and Goose at the adapter (plans/ask-on-qwen-gemini-spike.md):
// OpenCode's chat agent and server names new per spawn, its permission, no Zen model, the spawn env by reference and the
// names mapped back; Goose's argv without the developer builtin, its own home, the real HOME for worca's child, the
// provider env kept, agent-CLI providers refused; the turn handles a session the CLI no longer knows.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { runOpencodeProcess, createOpencodeNormalizer, opencodeChat, OPENCODE_ASK_LOCKDOWN } from '../src/core/engines/opencode.mjs';
import { runGooseProcess, buildGooseArgs, gooseChat, gooseChatModelProblem, GOOSE_ASK_LOCKDOWN } from '../src/core/engines/goose.mjs';
import { providerEnvPrefixes } from '../src/core/engines/chat-descriptor.mjs';
import { fakeOpencode } from './helpers/fake-opencode.mjs';
import { fakeGoose } from './helpers/fake-goose.mjs';

useTempHome(after);
const POSIX = process.platform === 'win32' ? { skip: 'POSIX shell fixtures' } : {};
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-og-ask-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const mcpFile = (dir) => {
  const f = join(dir, 'mcp.json');
  writeFileSync(f, JSON.stringify({ mcpServers: { worca: { type: 'stdio', command: '/usr/bin/node', args: ['/s.mjs'], env: { WORCA_ASK_THREAD_ID: 'ask_00000001' } } } }));
  return f;
};

test('OpenCode chat spawn: its own agent denies every tool but worca\'s server, both named anew per spawn; no sub-agent, no Zen', POSIX, async () => {
  const dir = tmp();
  const fake = fakeOpencode(dir, 'hi', { version: '1.19.4' });
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  try {
    const out = await runOpencodeProcess({ cwd: dir, bin: fake.bin, prompt: 'p', systemPrompt: 'SYS', model: 'anthropic/claude-sonnet-5-5', askLockdown: true, sandbox: 'read-only',
      mcpConfigPath: mcpFile(dir), envScrub: true, envAllowlist: [], spawnEnv: { ASK_COMMAND_TOKEN: 'tok-1' }, scratchBase: tmp(), permissionRules: { deny: ['Bash(git push:*)'] } });
    assert.equal(out.text, 'hi');
  } finally { delete process.env.ANTHROPIC_API_KEY; }
  const cfg = fake.config();
  const agentName = fake.args()[fake.args().indexOf('--agent') + 1];
  assert.match(agentName, /^worca-chat-[a-z0-9]+$/);
  const server = Object.keys(cfg.mcp)[0];
  assert.match(server, /^worca[a-z0-9]{6}$/, 'a server name no user server can take');
  assert.deepEqual(cfg.agent[agentName].permission, { '*': 'deny', [`${server}_*`]: 'allow' });
  assert.deepEqual(cfg.agent.general, { disable: true });
  assert.deepEqual(cfg.agent.explore, { disable: true });
  assert.equal(cfg.permission, undefined, 'a chat applies no run guardrail rule: the agent denies everything');
  assert.equal(cfg.instructions, undefined);
  assert.deepEqual(cfg.mcp[server].environment, { ASK_COMMAND_TOKEN: '{env:ASK_COMMAND_TOKEN}', WORCA_ASK_THREAD_ID: 'ask_00000001' });
  const env = fake.env();
  assert.equal(env.ASK_COMMAND_TOKEN, 'tok-1');
  assert.equal(env.ANTHROPIC_API_KEY, 'sk-ant-test', 'the chat model\'s provider key is kept');
  assert.equal(env.OPENCODE_DISABLE_PROJECT_CONFIG, '1');
  assert.ok(fake.args().includes('--pure'));
  assert.ok(OPENCODE_ASK_LOCKDOWN && opencodeChat.lockdown());
  assert.match(opencodeChat.modelProblem('opencode/big-pickle'), /OpenCode Zen/);
  assert.equal(opencodeChat.modelProblem('anthropic/claude-sonnet-5-5'), null);
});

test('OpenCode: a chat\'s per-spawn server name reads as worca\'s own in the stream', () => {
  const n = createOpencodeNormalizer({ mcpServers: ['worcaab12cd'], serverNames: { worcaab12cd: 'worca' } });
  const ev = n.push({ type: 'tool_use', sessionID: 'ses_x', part: { tool: 'worcaab12cd_list_projects', callID: 'c1', state: { status: 'completed', input: {}, output: 'ok' } } });
  assert.equal(ev.find((e) => e.type === 'tool').calls[0].name, 'mcp__worca__list_projects');
});

test('OpenCode chat: a session OpenCode no longer knows is the turn\'s to handle', POSIX, async () => {
  const dir = tmp();
  const fake = fakeOpencode(dir, 'x', { exit: 1, stderr: 'Error: Session not found', lines: [] });
  await assert.rejects(runOpencodeProcess({ cwd: dir, bin: fake.bin, prompt: 'p', model: 'anthropic/m', askLockdown: true, mcpConfigPath: mcpFile(dir), resumeSessionId: 'opencode:ses_abc123', scratchBase: tmp() }),
    (err) => opencodeChat.resumeNotFound(err));
});

test('Goose argv: a chat adds no built-in extension', () => {
  assert.ok(buildGooseArgs({ sessionName: 'worca-1' }).includes('--with-builtin'), 'a pipeline spawn keeps developer');
  const args = buildGooseArgs({ sessionName: 'worca-1', ask: true, model: 'google/gemini-3-flash' });
  assert.ok(!args.includes('--with-builtin'));
  assert.ok(args.includes('--no-profile'));
  assert.deepEqual(GOOSE_ASK_LOCKDOWN.metaTools, ['load_skill']);
  assert.deepEqual(gooseChat.metaTools, ['load_skill']);
});

test('Goose chat spawn: a home of its own, the real HOME and the spawn env for worca\'s child, the provider env kept', POSIX, async () => {
  const dir = tmp();
  const fake = fakeGoose(dir, 'hi');
  const chatHome = join(dir, 'chat-home');
  const realHome = process.env.HOME;
  process.env.GOOGLE_API_KEY = 'g-key'; process.env.OPENAI_API_KEY = 'o-key';
  try {
    const out = await runGooseProcess({ cwd: dir, bin: fake.bin, prompt: 'p', model: 'google/gemini-3-flash', askLockdown: true, sandbox: 'read-only', mcpConfigPath: mcpFile(dir),
      envScrub: true, envAllowlist: [], spawnEnv: { ASK_COMMAND_TOKEN: 'tok-1' }, scratchBase: tmp(), chatHome });
    assert.equal(out.text, 'hi');
  } finally { delete process.env.GOOGLE_API_KEY; delete process.env.OPENAI_API_KEY; }
  const rec = fake.record();
  assert.ok(!rec.args.includes('--with-builtin'));
  assert.equal(rec.env.HOME, chatHome);
  assert.equal(rec.env.XDG_CONFIG_HOME, join(chatHome, '.config'));
  assert.equal(rec.env.GOOGLE_API_KEY, 'g-key', 'its provider\'s key');
  assert.equal(rec.env.OPENAI_API_KEY, undefined, 'never another provider\'s');
  const wrapper = Object.values(rec.wrappers)[0];
  assert.match(wrapper, /HOME="\$WORCAMCP1_HOME"; export HOME/);
  assert.match(wrapper, /ASK_COMMAND_TOKEN="\$WORCAMCP1_ASK_COMMAND_TOKEN"/);
  assert.equal(rec.env.WORCAMCP1_HOME, realHome);
  assert.equal(rec.env.WORCAMCP1_ASK_COMMAND_TOKEN, 'tok-1');
});

test('Goose chat: an agent-CLI provider is refused; a model provider is not', () => {
  for (const id of ['claude-acp/default', 'codex/gpt-5', 'cursor-agent/auto', 'gemini-cli/pro', 'amp-acp/x']) assert.match(gooseChatModelProblem(id), /agent CLI/, id);
  for (const id of ['google/gemini-3-flash', 'openai/gpt-5.5', 'anthropic/claude-sonnet-5-5', 'openrouter/qwen/qwen3', 'ollama/llama3']) assert.equal(gooseChatModelProblem(id), null, id);
  assert.deepEqual(providerEnvPrefixes('openrouter/qwen/qwen3'), ['OPENROUTER_']);
  assert.deepEqual(providerEnvPrefixes('aws_bedrock/x'), ['AWS_BEDROCK_', 'AWS_']);
});

test('Goose chat: a session goose no longer knows is the turn\'s to handle', POSIX, async () => {
  const dir = tmp();
  const fake = fakeGoose(dir, 'x', { lines: [], exit: 1, stderr: "No session found with name 'worca-1-a'" });
  await assert.rejects(runGooseProcess({ cwd: dir, bin: fake.bin, prompt: 'p', model: 'google/m', askLockdown: true, mcpConfigPath: mcpFile(dir), resumeSessionId: 'goose:worca-1-a', scratchBase: tmp(), chatHome: join(dir, 'h') }),
    (err) => gooseChat.resumeNotFound(err));
});
