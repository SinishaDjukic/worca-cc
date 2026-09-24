// test/agent-user.test.mjs
// src/core/agent-user.mjs + its two callers: pipeline agents (runClaude asAgent) and graph
// scripts start under WORCA_AGENT_USER through sudo when the container set one up; nothing
// changes when it is unset. A fake `sudo` on PATH records the argv and runs the command.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import {
  agentIdentity, resolveOnPath, agentSpawn, killAgentGroup, killAgentGroupSync,
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
