// test/agent-user.test.mjs
// src/core/agent-user.mjs + its two callers: pipeline agents (runClaude asAgent) and graph
// scripts start under WORCA_AGENT_USER through sudo when the container set one up; nothing
// changes when it is unset. A fake `sudo` on PATH records the argv and runs the command.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, readFile, mkdir, stat } from 'node:fs/promises';
import { chmodSync, statSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import {
  agentIdentity, resolveOnPath, agentSpawn, killAgentGroup, killAgentGroupSync, shareWithAgent, assertOwnFolders,
} from '../src/core/agent-user.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { runOpts } from '../src/core/phases.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'sudo and the fake bins are POSIX' : false };
const ID = { user: 'worca-agent', home: '/data/agent-home', gid: 1001 };

test('agentIdentity: needs a valid user name and an absolute HOME; gid optional', () => {
  assert.equal(agentIdentity({}), null);
  assert.equal(agentIdentity({ WORCA_AGENT_USER: 'worca-agent' }), null, 'no HOME');
  assert.equal(agentIdentity({ WORCA_AGENT_USER: 'root; rm -rf /', WORCA_AGENT_HOME: '/h' }), null);
  assert.equal(agentIdentity({ WORCA_AGENT_USER: 'worca-agent', WORCA_AGENT_HOME: 'rel' }), null);
  assert.deepEqual(agentIdentity({ WORCA_AGENT_USER: 'worca-agent', WORCA_AGENT_HOME: '/data/agent-home', WORCA_AGENT_GID: '1001' }), ID);
  assert.deepEqual(agentIdentity({ WORCA_AGENT_USER: 'worca-agent', WORCA_AGENT_HOME: '/h', WORCA_AGENT_GID: 'x' }), { user: 'worca-agent', home: '/h', gid: null });
});

test('resolveOnPath: absolute stays, bare names resolve on PATH, relative paths and misses are null', () => {
  const isFile = (p) => p === '/usr/local/bin/claude';
  assert.equal(resolveOnPath('/opt/claude', '', isFile), '/opt/claude');
  assert.equal(resolveOnPath('claude', `/nope${delimiter}/usr/local/bin`, isFile), '/usr/local/bin/claude');
  assert.equal(resolveOnPath('claude', '/nope', isFile), null);
  assert.equal(resolveOnPath('./claude', '/usr/local/bin', isFile), null);
});

test('agentSpawn: sudo -n -E -u <user> -- <abs bin>, the agent\'s HOME/USER/LOGNAME, nothing else changed', () => {
  const w = agentSpawn('claude', ['-p', 'x'], { PATH: '/usr/local/bin', ANTHROPIC_API_KEY: 'k', HOME: '/data/home' }, ID,
    { isFile: (p) => p === '/usr/local/bin/claude' });
  assert.deepEqual(w, {
    file: 'sudo',
    args: ['-n', '-E', '-u', 'worca-agent', '--', '/usr/local/bin/claude', '-p', 'x'],
    env: { PATH: '/usr/local/bin', ANTHROPIC_API_KEY: 'k', HOME: '/data/agent-home', USER: 'worca-agent', LOGNAME: 'worca-agent' },
  });
  assert.throws(() => agentSpawn('claude', [], { PATH: '/nope' }, ID, { isFile: () => false }), /not found on PATH/);
});

test('agentSpawn: a caller\'s own HOME for the agent (a Goose chat\'s home) replaces the agent\'s', () => {
  const w = agentSpawn('/usr/bin/goose', [], { PATH: '/usr/bin', HOME: '/srv' }, ID, { isFile: () => true, home: '/data/agent-home/.worca/goose-chat-home' });
  assert.equal(w.env.HOME, '/data/agent-home/.worca/goose-chat-home');
  assert.equal(w.env.USER, 'worca-agent');
});

const mode = async (p) => (await stat(p)).mode & 0o7777;

test('shareWithAgent: the whole staged folder for the group (sub-folders traversable, executables kept), traverse-only above it up to stopAt', POSIX, async () => {
  const root = await mkdtemp(join(tmpdir(), 'worca-share-'));
  const tmpBase = join(root, 'tmp');
  const staged = join(tmpBase, 'gemini', 'ask_1', '.gemini');
  await mkdir(join(staged, 'agents'), { recursive: true, mode: 0o700 });
  await chmod(join(tmpBase, 'gemini'), 0o700); await chmod(join(tmpBase, 'gemini', 'ask_1'), 0o700); await chmod(tmpBase, 0o700);
  await writeFile(join(staged, 'settings.json'), '{}', { mode: 0o600 });
  await writeFile(join(staged, 'agents', 'node.md'), 'x', { mode: 0o600 });
  await writeFile(join(staged, 'wrapper'), '#!/bin/sh\n', { mode: 0o700 });
  const id = { ...ID, gid: process.getgid() };
  shareWithAgent(staged, id, { stopAt: tmpBase });
  assert.equal(await mode(staged), 0o750);
  assert.equal(await mode(join(staged, 'agents')), 0o750, 'a sub-folder stays traversable');
  assert.equal(await mode(join(staged, 'agents', 'node.md')), 0o640);
  assert.equal(await mode(join(staged, 'settings.json')), 0o640);
  assert.equal(await mode(join(staged, 'wrapper')), 0o750, 'an executable stays executable');
  assert.equal(await mode(join(tmpBase, 'gemini', 'ask_1')), 0o710, 'traverse, never list');
  assert.equal(await mode(join(tmpBase, 'gemini')), 0o710);
  assert.equal(await mode(tmpBase), 0o700, 'nothing at or above stopAt');
  shareWithAgent(staged, id, { stopAt: tmpBase, writable: true });
  assert.equal(await mode(staged), 0o770, 'writable: the agent writes into it (Copilot\'s usage file)');
  const lone = join(root, 'other', 'spawn-1');
  await mkdir(lone, { recursive: true, mode: 0o700 });
  await chmod(join(root, 'other'), 0o700);
  shareWithAgent(lone, id);
  assert.equal(await mode(join(root, 'other')), 0o710, 'without stopAt: its direct parent only');
  assert.equal(await mode(root), (await stat(root)).mode & 0o7777);
  shareWithAgent(lone, { ...id, gid: null });   // no shared group: nothing to do, never a throw
});

test('V10: shareWithAgent gives staged files to the agent user\'s own group; a non-sticky parent gets traverse only, a sticky one keeps its bits', POSIX, async () => {
  const root = await mkdtemp(join(tmpdir(), 'worca-share-'));
  const tmpBase = join(root, 'tmp');
  const staged = join(tmpBase, 'copilot', 'spawn-1');
  await mkdir(staged, { recursive: true });
  await chmod(join(tmpBase, 'copilot'), 0o770);   // what umask 0007 leaves on a folder the server made
  await writeFile(join(staged, 'mcp-config.json'), '{"env":{"WORCA_ASK_RELAY_TOKEN":"t"}}', { mode: 0o600 });
  const chowns = [];
  const fsOps = { chownSync: (p, _u, g) => chowns.push([p, g]), chmodSync, statSync, readdirSync };
  const id = { ...ID, gid: 1001, runGid: 1101 };
  shareWithAgent(staged, id, { stopAt: tmpBase, writable: true, fsOps });
  const gidOf = (p) => chowns.find(([q]) => q === p)?.[1];
  assert.equal(gidOf(join(staged, 'mcp-config.json')), 1101, 'the token file: that agent user\'s own group, never the shared one');
  assert.equal(gidOf(staged), 1101);
  assert.equal(gidOf(join(tmpBase, 'copilot')), 1001, 'the parent: the shared group, for traverse');
  assert.equal(await mode(join(tmpBase, 'copilot')), 0o710, 'never list, never write: no other agent replaces what is inside');
  assert.equal(await mode(join(staged, 'mcp-config.json')), 0o640);
  // A sticky parent (tmp/ask, 3770 in the image) keeps write and sticky.
  const sticky = join(root, 'tmp2'); const ask = join(sticky, 'ask'); const g = join(ask, 'gemini', 't1', '.gemini');
  await mkdir(g, { recursive: true }); await chmod(ask, 0o1770);
  shareWithAgent(g, id, { stopAt: sticky, fsOps });
  assert.equal(await mode(ask), 0o1770);
  // Without a pool group, the shared group as before.
  chowns.length = 0;
  shareWithAgent(staged, { ...ID, gid: 1001 }, { stopAt: tmpBase, fsOps });
  assert.equal(gidOf(join(staged, 'mcp-config.json')), 1001);
});

test('V10: assertOwnFolders refuses a link, or a folder another user made, between the shared base and the chat folder', POSIX, async () => {
  const root = await mkdtemp(join(tmpdir(), 'worca-own-'));
  const ask = join(root, 'ask');
  await mkdir(join(ask, 'gemini', 't1'), { recursive: true });
  assert.doesNotThrow(() => assertOwnFolders(join(ask, 'gemini', 't1', '.gemini'), ask), 'worca\'s own folders, and one not made yet');
  assert.throws(() => assertOwnFolders(join(ask, 'gemini', 't1'), ask, { uid: process.getuid() + 1 }), /another user/);
  const elsewhere = join(root, 'elsewhere'); await mkdir(elsewhere);
  symlinkSync(elsewhere, join(ask, 'qwen'));
  assert.throws(() => assertOwnFolders(join(ask, 'qwen', 't1'), ask), /a link/);
  assert.doesNotThrow(() => assertOwnFolders(join(ask, 'gemini'), ask, { uid: null }), 'no uids: nothing to check');
});

test('killAgentGroup(Sync): kills the whole group as the agent, never pid 1 or a bad pid', () => {
  const calls = [];
  const impl = (file, args) => { calls.push([file, ...args]); return { on() {}, unref() {} }; };
  killAgentGroup(4242, ID, impl);
  killAgentGroupSync(4243, ID, impl);
  killAgentGroup(1, ID, impl);
  killAgentGroup(NaN, ID, impl);
  killAgentGroup(4244, null, impl);
  assert.deepEqual(calls, [
    ['sudo', '-n', '-u', 'worca-agent', '--', 'kill', '-KILL', '--', '-4242'],
    ['sudo', '-n', '-u', 'worca-agent', '--', 'kill', '-KILL', '--', '-4243'],
  ]);
});

test('phases: every role and node asks to run as the agent', () => {
  assert.equal(runOpts({ projectDir: '/p', claudeOpts: {} }, { role: 'implementer', prompt: 'p', systemPrompt: 's' }).asAgent, true);
});

/** A fake sudo that records its argv, drops the flags up to `--` and runs the rest. */
async function fakeSudo(dir, log) {
  const bin = join(dir, 'sudo');
  await writeFile(bin, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nwhile [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"\n`);
  await chmod(bin, 0o755);
}

async function withAgentEnv(dir, fn) {
  const keys = ['PATH', 'WORCA_AGENT_USER', 'WORCA_AGENT_HOME', 'WORCA_AGENT_GID', 'WORCA_MOCK'];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.PATH = `${dir}${delimiter}${process.env.PATH}`;
  process.env.WORCA_AGENT_USER = 'worca-agent';
  process.env.WORCA_AGENT_HOME = join(dir, 'agent-home');
  delete process.env.WORCA_AGENT_GID;
  delete process.env.WORCA_MOCK;
  try { return await fn(); } finally {
    for (const k of keys) if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
  }
}

test('runClaude asAgent: the spawn goes through sudo as the agent, with the agent\'s HOME', POSIX, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-agent-user-'));
  const log = join(dir, 'sudo.log');
  const out = join(dir, 'env.txt');
  const bin = join(dir, 'fake-claude.sh');
  await writeFile(bin, `#!/bin/sh\nenv > ${JSON.stringify(out)}\nexit 0\n`);
  await chmod(bin, 0o755);
  await fakeSudo(dir, log);
  await withAgentEnv(dir, async () => {
    await runClaude({ cwd: dir, bin, prompt: 'p', asAgent: true });
  });
  const argv = (await readFile(log, 'utf8')).trim();
  assert.ok(argv.startsWith(`-n -E -u worca-agent -- ${bin} `), argv);
  const env = await readFile(out, 'utf8');
  assert.match(env, new RegExp(`^HOME=${join(dir, 'agent-home')}$`, 'm'));
  assert.match(env, /^USER=worca-agent$/m);
});

test('runClaude without asAgent, or with no agent user configured, never calls sudo', POSIX, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-agent-user-'));
  const log = join(dir, 'sudo.log');
  const bin = join(dir, 'fake-claude.sh');
  await writeFile(bin, '#!/bin/sh\nexit 0\n');
  await chmod(bin, 0o755);
  await fakeSudo(dir, log);
  await withAgentEnv(dir, () => runClaude({ cwd: dir, bin, prompt: 'p' }));   // a server-side helper
  const prev = process.env.PATH;
  process.env.PATH = `${dir}${delimiter}${prev}`;
  try { await runClaude({ cwd: dir, bin, prompt: 'p', asAgent: true }); } finally { process.env.PATH = prev; }   // no WORCA_AGENT_USER
  await assert.rejects(readFile(log, 'utf8'), { code: 'ENOENT' });
});
