// test/qwen-gemini-ask-adapter.test.mjs — Chat on Qwen Code and Gemini CLI at the adapter (plans/ask-on-qwen-gemini-spike.md):
// the lockdown argv, the settings and policy files a chat spawn writes, the pinned env, the MCP env references, the
// support check and what an Ask spawn leaves to the turn (a session the CLI no longer knows).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  runQwenProcess, buildQwenArgs, qwenAskSupport, QWEN_ASK_LOCKDOWN, QWEN_BUILTIN_TOOLS, QWEN_NO_CORE_TOOL, QWEN_ASK_ENV, qwenChat,
} from '../src/core/engines/qwen.mjs';
import {
  runGeminiProcess, buildGeminiArgs, geminiAskSupport, geminiAskPolicyToml, GEMINI_ASK_LOCKDOWN, GEMINI_NO_CORE_TOOL, geminiChat,
} from '../src/core/engines/gemini.mjs';
import { versionAtLeast, mergeSettings, withEnvRefs } from '../src/core/engines/gemini-family.mjs';
import { fakeQwen, fakeGemini } from './helpers/fake-gemini-family.mjs';

useTempHome(after);
const POSIX = process.platform === 'win32' ? { skip: 'POSIX shell fixtures' } : {};
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-qg-ask-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const mcpFile = (dir) => {
  const f = join(dir, 'mcp.json');
  writeFileSync(f, JSON.stringify({ mcpServers: { worca: { type: 'stdio', command: '/usr/bin/node', args: ['/s.mjs'], env: { WORCA_ASK_THREAD_ID: 'ask_00000001' } } } }));
  return f;
};

test('Qwen argv: a chat names no core tool and excludes every other built-in, only worca\'s server', () => {
  const args = buildQwenArgs({ sessionId: 's', mcpNames: ['worca'], ask: true });
  assert.deepEqual(args.slice(-6), ['--allowed-mcp-server-names', 'worca', '--core-tools', QWEN_NO_CORE_TOOL, '--exclude-tools', QWEN_BUILTIN_TOOLS.join(',')]);
  for (const t of ['run_shell_command', 'read_file', 'write_file', 'web_fetch', 'agent', 'skill', 'tool_call', 'tool_search', 'send_message', 'monitor']) {
    assert.ok(QWEN_BUILTIN_TOOLS.includes(t), t);
  }
  assert.ok(!buildQwenArgs({ sessionId: 's' }).includes('--core-tools'), 'a pipeline spawn is unchanged');
  assert.ok(QWEN_ASK_LOCKDOWN && qwenChat.lockdown());
});

test('Qwen chat spawn: the lockdown settings over the machine\'s, the pinned env, the MCP child\'s env by reference', POSIX, async () => {
  const dir = tmp();
  const fake = fakeQwen(dir, 'hi');
  process.env.SSH_AUTH_SOCK = '/tmp/agent.sock';
  try {
    const out = await runQwenProcess({ cwd: dir, bin: fake.bin, prompt: 'p', systemPrompt: 'SYS', model: 'qwen3-coder', askLockdown: true, sandbox: 'read-only',
      mcpConfigPath: mcpFile(dir), envScrub: true, envAllowlist: ['SSH_AUTH_SOCK'], spawnEnv: { ASK_COMMAND_TOKEN: 'tok-1' } });
    assert.equal(out.text, 'hi');
  } finally { delete process.env.SSH_AUTH_SOCK; }
  const rec = fake.record();
  assert.ok(rec.args.includes('--core-tools') && rec.args.includes('--exclude-tools'));
  const sys = JSON.parse(rec.system);
  assert.equal(sys.tools.toolSearch.enabled, false, 'every registered tool is offered, none deferred');
  assert.equal(sys.disableAllHooks, true);
  assert.equal(sys.memory.enableManagedAutoMemory, false);
  assert.equal(sys.memory.mem0, null);
  assert.equal(sys.tools.discoveryCommand, '');
  assert.deepEqual(sys.mcpServers.worca.env, { ASK_COMMAND_TOKEN: '${ASK_COMMAND_TOKEN}', SSH_AUTH_SOCK: '${SSH_AUTH_SOCK}', WORCA_ASK_THREAD_ID: 'ask_00000001' });
  for (const [k, v] of Object.entries(QWEN_ASK_ENV)) assert.equal(rec.env[k], v, k);
  assert.equal(rec.env.ASK_COMMAND_TOKEN, 'tok-1', 'the token rides the env, never the settings file');
  assert.equal(rec.env.SSH_AUTH_SOCK, '/tmp/agent.sock');
});

test('Qwen chat spawn: a session Qwen no longer knows is the turn\'s to handle (no silent fresh start)', POSIX, async () => {
  const dir = tmp();
  const fake = fakeQwen(dir, 'x', { resumeError: 'No saved session found with ID s-9' });
  await assert.rejects(runQwenProcess({ cwd: dir, bin: fake.bin, prompt: 'p', askLockdown: true, mcpConfigPath: mcpFile(dir), resumeSessionId: 'qwen:s-9' }),
    (err) => qwenChat.resumeNotFound(err));
});

test('Gemini argv and policy: no extension; every tool denied, worca\'s server allowed above it', () => {
  const args = buildGeminiArgs({ sessionId: 's', mcpNames: ['worca'], policyFile: '/p.toml', ask: true });
  assert.deepEqual(args.slice(-4), ['--allowed-mcp-server-names', 'worca', '--extensions', 'none']);
  assert.ok(!buildGeminiArgs({ sessionId: 's' }).includes('--extensions'), 'a pipeline spawn is unchanged');
  const toml = geminiAskPolicyToml(['worca']);
  assert.match(toml, /\[\[rule\]\]\ntoolName = "\*"\ndecision = "deny"\npriority = 900/);
  assert.match(toml, /\[\[rule\]\]\nmcpName = "worca"\ntoolName = "\*"\ndecision = "allow"\npriority = 999/);
  assert.ok(GEMINI_ASK_LOCKDOWN && geminiChat.lockdown());
  assert.equal(geminiChat.ownFolder, true);
});

test('Gemini chat spawn: the chat folder\'s settings (no built-in, no hook, no discovery) and the admin policy; both gone after', POSIX, async () => {
  const dir = tmp();
  const fake = fakeGemini(dir, 'hi');
  const cwd = join(dir, 'chats', 'gemini', 'ask_00000001');   // the chat's own folder: the spawn makes it
  const out = await runGeminiProcess({ cwd, bin: fake.bin, prompt: 'p', systemPrompt: 'SYS', askLockdown: true, sandbox: 'read-only', mcpConfigPath: mcpFile(dir),
    envScrub: true, envAllowlist: [], spawnEnv: { ASK_COMMAND_TOKEN: 'tok-1' } });
  assert.equal(out.text, 'hi');
  const rec = fake.record();
  assert.equal(rec.cwd, cwd);
  const settings = JSON.parse(rec.gemini);
  assert.deepEqual(settings.tools.core, [GEMINI_NO_CORE_TOOL]);
  assert.equal(settings.hooksConfig.enabled, false);
  assert.equal(settings.tools.discoveryCommand, '');
  assert.deepEqual(settings.mcpServers.worca.env, { ASK_COMMAND_TOKEN: '${ASK_COMMAND_TOKEN}', WORCA_ASK_THREAD_ID: 'ask_00000001' });
  assert.equal(rec.policy, geminiAskPolicyToml(['worca']));
  assert.ok(rec.args.includes('--extensions'));
  assert.equal(rec.env.GEMINI_CLI_TRUST_WORKSPACE, 'true');
  assert.match(rec.stdin, /^=== SYSTEM ===\n[\s\S]*SYS\n=== END SYSTEM ===\n\np$/);
  assert.equal(existsSync(join(cwd, '.gemini', 'settings.json')), false, 'the settings file (it names the thread) is removed');
});

test('the Ask path of each adapter: no read-only refusal, no Worca-home refusal of its cwd', POSIX, async () => {
  const dir = tmp();
  const q = fakeQwen(dir, 'q');
  // The chat's cwd is worca's ask scratch dir, inside Worca's home: a chat has no file tool, so it is allowed there.
  const home = join(process.env.WORCA_HOME, 'tmp', 'ask');
  mkdirSync(home, { recursive: true });
  assert.equal((await runQwenProcess({ cwd: home, bin: q.bin, prompt: 'p', askLockdown: true, sandbox: 'read-only', mcpConfigPath: mcpFile(dir) })).text, 'q');
  await assert.rejects(runQwenProcess({ cwd: home, bin: q.bin, prompt: 'p', sandbox: 'read-only' }), /read-only/);
});

/** A CLI that answers --version and --help only. */
function helpBin(dir, name, { version, help }) {
  const bin = join(dir, name);
  writeFileSync(bin, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo ${JSON.stringify(version)}; exit 0; fi\ncat <<'EOF'\n${help}\nEOF\n`);
  chmodSync(bin, 0o755);
  return bin;
}

test('support: every lockdown flag in --help and the verified version, else a refusal that says what to update', POSIX, async () => {
  const dir = tmp();
  const qHelp = '  --core-tools  Core tool paths\n  --exclude-tools  Tools to exclude\n  --allowed-mcp-server-names  Allowed';
  assert.deepEqual(await qwenAskSupport({ bin: helpBin(dir, 'q1', { version: '0.26.1', help: qHelp }) }), {});
  assert.match((await qwenAskSupport({ bin: helpBin(dir, 'q2', { version: '0.25.0', help: qHelp }) })).refusal, /0\.25\.0; a chat needs Qwen Code 0\.26\.1 or newer/);
  assert.match((await qwenAskSupport({ bin: helpBin(dir, 'q3', { version: '0.27.0', help: '  --core-tools x' }) })).refusal, /has no --exclude-tools, --allowed-mcp-server-names/);
  assert.match((await qwenAskSupport({ bin: join(dir, 'missing') })).refusal, /cannot run .* \(ENOENT\) — install Qwen Code/);
  const gHelp = '      --admin-policy  x\n      --allowed-mcp-server-names  x\n  -e, --extensions  x';
  assert.deepEqual(await geminiAskSupport({ bin: helpBin(dir, 'g1', { version: '0.65.0', help: gHelp }) }), {});
  assert.match((await geminiAskSupport({ bin: helpBin(dir, 'g2', { version: '0.63.0', help: gHelp }) })).refusal, /Gemini CLI 0\.65\.0 or newer/);
});

test('the family helpers: version order, settings merged deeply with null kept, env references added once', () => {
  assert.equal(versionAtLeast('0.26.1', '0.26.1'), true);
  assert.equal(versionAtLeast('0.27.0-nightly', '0.26.1'), true);
  assert.equal(versionAtLeast('0.9.9', '0.26.1'), false);
  assert.deepEqual(mergeSettings({ a: { b: 1, c: [1] }, m: { mem0: { x: 1 } } }, { a: { c: [2] }, m: { mem0: null } }), { a: { b: 1, c: [2] }, m: { mem0: null } });
  assert.deepEqual(withEnvRefs({ s: { command: 'n', env: { K: 'own' } }, r: { url: 'https://x' } }, ['K', 'T']),
    { s: { command: 'n', env: { K: 'own', T: '${T}' } }, r: { url: 'https://x' } }, 'a server\'s own value wins; a remote server is untouched');
});
