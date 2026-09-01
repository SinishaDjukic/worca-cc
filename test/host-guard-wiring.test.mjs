// test/host-guard-wiring.test.mjs
// The host guard reaches every real spawn through the ONE --settings seam
// (buildSettingsPayload), plus the WORCA_HOST_PID env var and a system-prompt
// preamble — all injected at the runReal boundary so the pure builders stay
// byte-identical without the `hostGuard` opt (spawn-args.test.mjs baselines).
// Kill-switch: WORCA_HOST_GUARD=0/false disables all three.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildClaudeArgs, buildSettingsPayload, planClaudeInvocation, runClaude,
} from '../src/core/claude-runner.mjs';
import { hostGuardEnabled, hostGuardHookEntry, hostGuardSystemPrompt } from '../src/core/host-guard.mjs';

const POSIX_SHIM = { skip: process.platform === 'win32' ? 'fake claude shim is a POSIX shell script' : false };
const BASE = { prompt: 'p', permissionMode: 'acceptEdits' };

const dirs = [];
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'worca-cc-hostguard-')); dirs.push(d); return d; };
after(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });

const withEnv = (kv, fn) => {
  const prev = {};
  for (const [k, v] of Object.entries(kv)) { prev[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  const restore = () => { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
  try { const r = fn(); if (r && typeof r.finally === 'function') return r.finally(restore); restore(); return r; } catch (e) { restore(); throw e; }
};

// ── the payload ──────────────────────────────────────────────────────────────

test('buildSettingsPayload: hostGuard adds a PreToolUse Bash hook running host-guard.mjs', () => {
  const payload = buildSettingsPayload(null, { hostGuard: true });
  assert.ok(payload, 'payload present with the guard alone');
  const entries = payload.settings.hooks?.PreToolUse ?? [];
  assert.equal(entries.length, 1);
  assert.equal(entries[0].matcher, 'Bash');
  assert.match(entries[0].hooks[0].command, /host-guard\.mjs/);
  assert.equal(payload.hook, false, 'the guard must NOT switch on --include-hook-events (telemetry-only flag)');
});

test('buildSettingsPayload: guard coexists with permission rules and telemetry hooks', () => {
  const rules = { deny: ['Bash(curl:*)'] };
  const both = buildSettingsPayload(rules, { hostGuard: true });
  assert.deepEqual(both.settings.permissions, rules);
  assert.match(both.settings.hooks.PreToolUse[0].hooks[0].command, /host-guard\.mjs/);

  withEnv({ WORCA_SUBAGENT_HOOKS: '1' }, () => {
    const merged = buildSettingsPayload(null, { hostGuard: true });
    assert.equal(merged.hook, true, 'telemetry still drives --include-hook-events');
    assert.equal(merged.settings.hooks.PostToolUse[0].matcher, 'Agent', 'telemetry PostToolUse survives');
    assert.match(merged.settings.hooks.PreToolUse[0].hooks[0].command, /host-guard\.mjs/);
  });
});

test('buildSettingsPayload: WORCA_HOST_GUARD=0 disables the guard (payload back to null)', () => {
  withEnv({ WORCA_HOST_GUARD: '0' }, () => {
    assert.equal(hostGuardEnabled(), false);
    assert.equal(buildSettingsPayload(null, { hostGuard: true }), null);
  });
  assert.equal(hostGuardEnabled(), true, 'default is ON');
});

test('buildClaudeArgs: hostGuard emits exactly ONE --settings carrying the hook; without it argv is byte-identical', () => {
  const guarded = buildClaudeArgs({ ...BASE, hostGuard: true });
  const i = guarded.indexOf('--settings');
  assert.ok(i > -1);
  assert.equal(guarded.indexOf('--settings', i + 1), -1, 'exactly one --settings');
  assert.match(guarded[i + 1], /host-guard\.mjs/);
  assert.deepEqual(buildClaudeArgs({ ...BASE }), [
    '-p', 'p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
  ], 'no hostGuard opt => legacy argv untouched');
});

test('planClaudeInvocation: the staged settings.json carries the guard hook', () => {
  const plan = planClaudeInvocation(
    { ...BASE, prompt: 'x'.repeat(200), hostGuard: true },
    { dir: () => '/staged', limit: 10 },
  );
  const settings = plan.files.find((f) => f.path.endsWith('settings.json'));
  assert.ok(settings, 'settings.json staged');
  assert.match(settings.content, /host-guard\.mjs/);
});

// ── the spawn: env var + system-prompt preamble, end to end ──────────────────

test('hostGuardSystemPrompt names the PID and the banned patterns', () => {
  const text = hostGuardSystemPrompt(4242);
  assert.match(text, /4242/);
  assert.match(text, /pkill/);
});

test('hostGuardHookEntry points node at this repo\'s host-guard.mjs', () => {
  const entry = hostGuardHookEntry();
  assert.equal(entry.matcher, 'Bash');
  assert.match(entry.hooks[0].command, /host-guard\.mjs/);
});

/** Fake claude recording argv (NUL-separated) and WORCA_HOST_PID to files. */
async function fakeBin(dir, argvFile, envFile) {
  const bin = join(dir, 'fake-claude.sh');
  await writeFile(
    bin,
    '#!/bin/sh\n' +
    `for a in "$@"; do printf '%s\\0' "$a" >> ${JSON.stringify(argvFile)}; done\n` +
    `printf '%s' "\${WORCA_HOST_PID-unset}" > ${JSON.stringify(envFile)}\n` +
    'exit 0\n',
    'utf8',
  );
  await chmod(bin, 0o755);
  return bin;
}

test('runClaude spawns with the guard settings, the preamble, and WORCA_HOST_PID', POSIX_SHIM, async () => {
  const dir = await tmp();
  const argvFile = join(dir, 'argv.txt');
  const envFile = join(dir, 'env.txt');
  const bin = await fakeBin(dir, argvFile, envFile);
  await runClaude({ cwd: dir, prompt: 'hi', systemPrompt: 'ROLE PROMPT', bin });
  const argv = (await readFile(argvFile, 'utf8')).split('\0');
  const settings = argv[argv.indexOf('--settings') + 1];
  assert.match(settings, /host-guard\.mjs/, 'guard hook in --settings');
  const sys = argv[argv.indexOf('--append-system-prompt') + 1];
  assert.match(sys, new RegExp(String(process.pid)), 'preamble names the host PID');
  assert.ok(sys.endsWith('ROLE PROMPT'), 'role prompt survives after the preamble');
  assert.equal(await readFile(envFile, 'utf8'), String(process.pid), 'child sees WORCA_HOST_PID');
});

test('runClaude with WORCA_HOST_GUARD=0 spawns the legacy argv and no env var', POSIX_SHIM, async () => {
  const dir = await tmp();
  const argvFile = join(dir, 'argv.txt');
  const envFile = join(dir, 'env.txt');
  const bin = await fakeBin(dir, argvFile, envFile);
  await withEnv({ WORCA_HOST_GUARD: '0' }, () => runClaude({ cwd: dir, prompt: 'hi', bin }));
  const argv = (await readFile(argvFile, 'utf8')).split('\0');
  assert.ok(!argv.includes('--settings'), 'no settings payload');
  assert.ok(!argv.includes('--append-system-prompt'), 'no preamble when systemPrompt is empty');
  assert.equal(await readFile(envFile, 'utf8'), 'unset', 'no WORCA_HOST_PID');
});
