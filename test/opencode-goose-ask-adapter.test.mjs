// test/opencode-goose-ask-adapter.test.mjs — Chat on OpenCode and Goose at the adapter (plans/ask-on-qwen-gemini-spike.md):
// OpenCode's chat agent and server names new per spawn, its permission, no Zen model, the spawn env by reference and the
// names mapped back; Goose's argv without the developer builtin, its own home, the real HOME for worca's child, the
// provider env kept, agent-CLI providers refused; the turn handles a session the CLI no longer knows.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { runOpencodeProcess, createOpencodeNormalizer, opencodeChat, opencodeProviderSignInEnv, OPENCODE_ASK_LOCKDOWN } from '../src/core/engines/opencode.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { runGooseProcess, buildGooseArgs, gooseChat, gooseChatModelProblem, GOOSE_ASK_LOCKDOWN } from '../src/core/engines/goose.mjs';
import { providerEnvPrefixes, chatSignInEnv } from '../src/core/engines/chat-descriptor.mjs';
import { buildSpawnEnv } from '../src/core/engines/spawn.mjs';
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

test('OpenCode chat: a server alias is stable per thread (a resumed session\'s learned names stay callable), random only without a seed', POSIX, async () => {
  const spawn = async (seed) => {
    const dir = tmp();
    const fake = fakeOpencode(dir, 'hi', { version: '1.19.4' });
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    try {
      await runOpencodeProcess({ cwd: dir, bin: fake.bin, prompt: 'p', model: 'anthropic/claude-sonnet-5-5', askLockdown: true, sandbox: 'read-only',
        mcpConfigPath: mcpFile(dir), envScrub: true, envAllowlist: [], scratchBase: tmp(), serverAliasSeed: seed });
    } finally { delete process.env.ANTHROPIC_API_KEY; }
    return Object.keys(fake.config().mcp)[0];
  };
  const a1 = await spawn('ask_2867fe2b');
  const a2 = await spawn('ask_2867fe2b');
  assert.equal(a2, a1, 'the same thread names its server the same on every spawn (a resume keeps the learned alias)');
  assert.match(a1, /^worca[a-f0-9]{8}$/, 'still a name no user server can take, seeded by the thread id');
  // The thread id alone does not give the name away: it is keyed by a secret this install made for itself, kept
  // beside worca's data and readable by the user only.
  assert.notEqual(a1, `worca${createHash('sha256').update('ask_2867fe2b').digest('hex').slice(0, 8)}`, 'not a plain hash of the thread id');
  const keyFile = join(process.env.WORCA_HOME, '.worca-cc', 'opencode-alias.key');
  assert.match(readFileSync(keyFile, 'utf8'), /^[0-9a-f]{64}$/);
  if (process.platform !== 'win32') assert.equal(statSync(keyFile).mode & 0o777, 0o600);
  // Another install (its own secret) names the same thread's server differently.
  const home = process.env.WORCA_HOME;
  process.env.WORCA_HOME = tmp();
  try { assert.notEqual(await spawn('ask_2867fe2b'), a1, 'another install, another name'); } finally { process.env.WORCA_HOME = home; }
  assert.equal(await spawn('ask_2867fe2b'), a1, 'back on this install: the same name again');
  const b = await spawn('ask_00000002');
  assert.notEqual(b, a1, 'a different thread gets a different alias');
  // Without a seed (the pre-thread-seed path) it stays a fresh random alias per spawn.
  const c1 = await spawn(null);
  const c2 = await spawn(null);
  assert.notEqual(c2, c1, 'no seed: random per spawn, as before');
  assert.match(c1, /^worca[a-z0-9]{6}$/);
});

test('runClaude forwards the thread\'s serverAliasSeed to an opencode chat spawn (drop-at-the-gate guard)', POSIX, async () => {
  const viaRunClaude = async () => {
    const dir = tmp();
    const fake = fakeOpencode(dir, 'hi', { version: '2.3.2' });
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    try {
      await runClaude({ cwd: dir, bin: fake.bin, prompt: 'p', model: 'aifarm-msp/DeepSeek-V4-Flash-0731', askLockdown: true, sandbox: 'read-only',
        engine: 'opencode', mcpConfigPath: mcpFile(dir), envScrub: true, envAllowlist: [], scratchBase: tmp(), serverAliasSeed: 'ask_2867fe2b' });
    } finally { delete process.env.ANTHROPIC_API_KEY; }
    return Object.keys(fake.config().mcp)[0];
  };
  const a = await viaRunClaude();
  assert.match(a, /^worca[a-f0-9]{8}$/, 'the seed survived runClaude to the opencode spawn');
  assert.equal(await viaRunClaude(), a, 'twice through the gate, the same thread seeds the same alias');
});

test('OpenCode chat: a call still made to an OLDER alias of a resumed session is relabelled to worca\'s own, never tripped as foreign', () => {
  const n = createOpencodeNormalizer({ mcpServers: ['worca1a2b3c4d'], serverNames: { worca1a2b3c4d: 'worca' } });
  const raw = n.push({ type: 'tool_use', sessionID: 'ses_x', part: { tool: 'worcam93krx_propose_run', callID: 'c1', state: { status: 'error', input: {}, error: 'No tool named "worcam93krx_propose_run" is currently available' } } });
  assert.equal(raw.find((e) => e.type === 'tool').calls[0].name, 'mcp__worca__propose_run', 'a stale alias reads as worca\'s own tool, so the turn\'s allow-list holds');
  // Only a call that could not run is a stale alias: one that ran is another server's tool, and keeps the name the
  // turn's allow-list trips on. So does a name that is not worca's own plus an alias suffix.
  const name = (tool, status) => createOpencodeNormalizer({ mcpServers: ['worca1a2b3c4d'], serverNames: { worca1a2b3c4d: 'worca' } })
    .push({ type: 'tool_use', sessionID: 'ses_x', part: { tool, callID: 'c1', state: { status, input: {}, ...(status === 'error' ? { error: 'x' } : {}) } } })
    .find((e) => e.type === 'tool').calls[0].name;
  assert.equal(name('worcam93krx_propose_run', 'completed'), 'worcam93krx_propose_run', 'a call that ran was not made to a stale alias');
  assert.equal(name('worcam93krx_propose_run', 'running'), 'worcam93krx_propose_run', 'nor one still running');
  assert.equal(name('worcatools_delete_all', 'error'), 'worcatools_delete_all', 'a user server whose name merely starts with worca');
  assert.equal(name('worca0f9e8d7c_propose_run', 'error'), 'mcp__worca__propose_run', 'a thread-seeded alias (8 hex) of another thread');
  // A run (no serverNames) keeps an unmapped name as OpenCode's; a user server named exactly `worca` (no suffix) is not relabelled.
  const run = createOpencodeNormalizer({ mcpServers: [] });
  assert.equal(run.push({ type: 'tool_use', sessionID: 'ses_x', part: { tool: 'spike_magic_number', callID: 'c1', state: { status: 'completed', input: {} } } }).find((e) => e.type === 'tool').calls[0].name, 'spike_magic_number');
  const exact = createOpencodeNormalizer({ mcpServers: [], serverNames: {} });
  assert.equal(exact.push({ type: 'tool_use', sessionID: 'ses_x', part: { tool: 'worca_release', callID: 'c1', state: { status: 'completed', input: {} } } }).find((e) => e.type === 'tool').calls[0].name, 'worca_release');
});

/** An env whose opencode config is only `<dir>/.config/opencode`: a runner's XDG_CONFIG_HOME or OPENCODE_CONFIG
 *  (GitHub's Ubuntu image sets XDG_CONFIG_HOME) would point the reader elsewhere. */
const homeOnly = (dir) => ({ ...process.env, HOME: dir, XDG_CONFIG_HOME: '', OPENCODE_CONFIG: '' });

test('OpenCode chat sign-in env: OpenCode 1.x names its provider blocks `provider` — read as well as 2.x `providers`', () => {
  const dir = tmp();
  const cfgDir = join(dir, '.config', 'opencode');
  mkdirSync(cfgDir, { recursive: true });
  writeFileSync(join(cfgDir, 'opencode.json'), JSON.stringify({
    provider: { farm: { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'https://f/v1', apiKey: '{env:FARM_V1_KEY}' } } },
  }));
  assert.deepEqual(opencodeProviderSignInEnv('farm/deepseek', homeOnly(dir)), ['FARM_V1_KEY']);
  // Both keys in one file: each provider's block is read from wherever it is declared.
  writeFileSync(join(cfgDir, 'opencode.json'), JSON.stringify({
    provider: { one: { options: { apiKey: '{env:ONE_KEY}' } } },
    providers: { two: { settings: { apiKey: '{env:TWO_KEY}' } } },
  }));
  assert.deepEqual(opencodeProviderSignInEnv('one/m', homeOnly(dir)), ['ONE_KEY']);
  assert.deepEqual(opencodeProviderSignInEnv('two/m', homeOnly(dir)), ['TWO_KEY']);
});

test('OpenCode chat sign-in env: the model\'s provider {env:…} key rides the scrub by exact name — and only its own', () => {
  const dir = tmp();
  const cfgDir = join(dir, '.config', 'opencode');
  mkdirSync(cfgDir, { recursive: true });
  // A provider reads its key from a var no prefix covers (here: a farm gateway key stored in ANTHROPIC_AUTH_TOKEN).
  writeFileSync(join(cfgDir, 'opencode.jsonc'), `{
    // the user's provider blocks; a nested model setting may reference an env var too
    "provider": { "ignored": true },
    "providers": {
      "farm": {
        "package": "aisdk:@ai-sdk/openai-compatible",
        "settings": { "baseURL": "https://f/v1", "apiKey": "{env:FARM_KEY}" },
        "models": { "deepseek": { "settings": { "extra": "{env:FARM_EXTRA}" } } }
      },
      "other": { "settings": { "apiKey": "{env:OTHER_PROVIDER_KEY}" } }
    },
  }`);
  const atHome = homeOnly(dir);
  assert.deepEqual(opencodeProviderSignInEnv('farm/deepseek', atHome), ['FARM_EXTRA', 'FARM_KEY'], 'every {env:…} of the provider block, sorted');
  assert.deepEqual(opencodeProviderSignInEnv('other/m', atHome), ['OTHER_PROVIDER_KEY'], 'a provider reads only its own block');
  assert.deepEqual(opencodeProviderSignInEnv('missing/m', atHome), [], 'an unknown provider: prefixes only');
  assert.deepEqual(opencodeProviderSignInEnv('farm/m', homeOnly(join(dir, 'nope'))), [], 'no config: no names');
  const allow = chatSignInEnv(opencodeChat, 'farm/deepseek', { ...atHome, FARM_KEY: 'sk-farm', FARM_EXTRA: 'x', OTHER_PROVIDER_KEY: 'sk-other' });
  assert.ok(allow.includes('FARM_KEY'), 'the provider key survives the chat allowlist');
  assert.ok(allow.includes('FARM_EXTRA'));
  assert.ok(!allow.includes('OTHER_PROVIDER_KEY'), 'never another provider\'s key');
  assert.ok(!allow.includes('ANTHROPIC_AUTH_TOKEN'), 'a var no provider of this model reads never rides in');
  // The scrub keeps exactly those names; a --standalone child (2.x) resolves the provider key from its own env.
  const prevHome = process.env.HOME;
  process.env.HOME = dir;
  process.env.FARM_KEY = 'sk-farm';
  try {
    const childEnv = buildSpawnEnv(true, [...chatSignInEnv(opencodeChat, 'farm/deepseek', process.env), 'SSH_AUTH_SOCK'], ['OPENCODE_', 'AIFARM_MSP_']);
    assert.equal(childEnv.FARM_KEY, 'sk-farm', 'the exact-name allowlist reaches the scrubbed child env');
    assert.equal(childEnv.OTHER_PROVIDER_KEY, undefined);
  } finally {
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    delete process.env.FARM_KEY;
  }
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

test('a relayed Goose chat (the agent user): its home is a worca folder in the agent\'s own home, made by goose; its MCP children get the agent\'s HOME', POSIX, async () => {
  const dir = tmp();
  const fake = fakeGoose(dir, 'hi');
  const sudo = join(dir, 'sudo');
  writeFileSync(sudo, '#!/bin/sh\nwhile [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"\n', { mode: 0o755 });
  const agentHome = join(dir, 'agent-home');
  const keys = ['PATH', 'WORCA_AGENT_USER', 'WORCA_AGENT_HOME', 'WORCA_AGENT_GID', 'WORCA_AGENT_POOL'];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { PATH: `${dir}:${process.env.PATH}`, WORCA_AGENT_USER: 'worca-agent', WORCA_AGENT_HOME: agentHome });
  delete process.env.WORCA_AGENT_GID; delete process.env.WORCA_AGENT_POOL;
  try {
    await runGooseProcess({ cwd: dir, bin: fake.bin, prompt: 'p', model: 'google/gemini-3-flash', askLockdown: true, sandbox: 'read-only', mcpConfigPath: mcpFile(dir),
      envScrub: true, envAllowlist: ['HOME'], asAgent: true, scratchBase: tmp() });
  } finally { for (const k of keys) if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  const rec = fake.record();
  const home = join(agentHome, '.worca', 'goose-chat-home');
  assert.equal(rec.env.HOME, home, 'not the agent\'s own HOME: none of its goose config, skills or hints');
  assert.equal(rec.env.XDG_DATA_HOME, join(home, '.local', 'share'));
  assert.equal(rec.env.WORCAMCP1_HOME, agentHome, 'an allowlisted HOME reference never brings the server\'s back');
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
