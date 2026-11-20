// test/claude-args-session-host.test.mjs — the host spawn's flags reach argv; its definitions ride a file in the shared staging dir.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { buildClaudeArgs, runClaude } from '../src/core/claude-runner.mjs';
import { planClaudeInvocation, stageClaudeInvocation, argvLength, ARGV_INLINE_LIMIT, buildSettingsPayload } from '../src/core/engines/claude.mjs';
import { hostGuardHookEntry } from '../src/core/host-guard.mjs';   // v4

process.env.WORCA_HOST_GUARD = '0';
const POSIX_SHIM = { skip: process.platform === 'win32' ? 'POSIX fake claude' : false };
const BASE = { prompt: 'p', permissionMode: 'acceptEdits' };
const DEFS = { 'worca-x-n_a-1-a1': { description: 'd', prompt: 'SYS\n\nBRIEF' } };
const GUARD = { hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'node guard.mjs' }] }] } };
const settingsOf = (args) => (args.includes('--settings') ? JSON.parse(args[args.indexOf('--settings') + 1]) : null);
const dirs = [];
after(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });

test('absent or false ⇒ byte-identical argv', () => {
  assert.deepEqual(buildClaudeArgs({ ...BASE, forwardSubagentText: false, agentsFile: null, mainThreadGuard: null }), buildClaudeArgs(BASE));
});

test('--forward-subagent-text and --agents <file>; the file wins over inline JSON', () => {
  const a = buildClaudeArgs({ ...BASE, forwardSubagentText: true, agentsFile: '/tmp/a.json', agents: { x: { prompt: 'p' } } });
  assert.equal(a.filter((x) => x === '--forward-subagent-text').length, 1);
  assert.equal(a.filter((x) => x === '--agents').length, 1);
  assert.equal(a[a.indexOf('--agents') + 1], '/tmp/a.json');
  assert.ok(a.indexOf('--forward-subagent-text') < a.indexOf('--agents'));
});

test('M-12 — an UNGROUPED staged spawn keeps inline --agents JSON (older CLIs read no file)', () => {
  const plan = planClaudeInvocation({ ...BASE, prompt: 'x'.repeat(30000), agents: DEFS }, { dir: '/tmp/stage' });
  assert.equal(plan.staged, true);
  assert.deepEqual(JSON.parse(plan.args[plan.args.indexOf('--agents') + 1]), DEFS);
  assert.equal(plan.files.some((f) => f.path.endsWith('agents.json')), false);
});

test('C-2 — agentsViaFile: a short argv still gets a staging dir, and agents.json lives IN it', () => {
  let made = 0;
  const plan = planClaudeInvocation({ ...BASE, agents: DEFS, agentsViaFile: true }, { dir: () => { made += 1; return '/tmp/stage2'; } });
  assert.equal(made, 1);
  assert.equal(plan.staged, false);
  const path = plan.args[plan.args.indexOf('--agents') + 1];
  assert.equal(path, join('/tmp/stage2', 'agents.json'));
  assert.deepEqual(JSON.parse(plan.files.find((f) => f.path === path).content), DEFS);
  assert.ok(!plan.args.join(' ').includes('BRIEF'), 'the brief never reaches argv');
});

test('v2 — agentsViaFile on the STAGED branch: agents.json sits beside the prompt files, never inline', () => {
  const plan = planClaudeInvocation({ ...BASE, prompt: 'x'.repeat(30000), agents: DEFS, agentsViaFile: true }, { dir: '/tmp/stage4' });
  assert.equal(plan.staged, true);
  assert.equal(plan.args[plan.args.indexOf('--agents') + 1], join('/tmp/stage4', 'agents.json'));
  assert.deepEqual(JSON.parse(plan.files.find((f) => f.path.endsWith('agents.json')).content), DEFS);
});

test('v2 (C40) — mainThreadGuard reaches --settings as a runner-owned PreToolUse hook; extraSettings can never carry hooks', () => {
  const s = settingsOf(buildClaudeArgs({ ...BASE, mainThreadGuard: GUARD }));
  assert.ok(s?.hooks?.PreToolUse?.some((h) => h.hooks?.[0]?.command === 'node guard.mjs'));
  assert.equal(s.disableAllHooks, false, 'v3: a user\'s disableAllHooks cannot switch the guard off (as for the read guard)');
  assert.equal('disableAllHooks' in (settingsOf(buildClaudeArgs(BASE)) ?? {}), false, 'absent ⇒ unchanged');
  const viaExtra = settingsOf(buildClaudeArgs({ ...BASE, extraSettings: GUARD }));
  assert.ok(!JSON.stringify(viaExtra ?? {}).includes('guard.mjs'), 'RUNNER_SETTINGS_KEYS strips hooks from extraSettings (claude.mjs:40)');
  const staged = planClaudeInvocation({ ...BASE, prompt: 'x'.repeat(30000), mainThreadGuard: GUARD }, { dir: '/tmp/stage5' });
  assert.match(staged.files.find((f) => f.path.endsWith('settings.json')).content, /node guard\.mjs/);
});

test('stageClaudeInvocation returns the dir that superviseSpawn shares with the agent user, holding agents.json', async () => {
  const s = stageClaudeInvocation({ ...BASE, agents: DEFS, agentsViaFile: true });
  dirs.push(s.dir);
  const path = s.args[s.args.indexOf('--agents') + 1];
  assert.equal(dirname(path), s.dir, 'stagedDir: plan.dir (claude.mjs:666) is what shareWithAgent opens (spawn.mjs:174-179)');
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), DEFS);
});

test('a host spawn with a 60 KB member brief stays under the argv limit (Windows-safe)', () => {
  const plan = planClaudeInvocation({ ...BASE, prompt: 'Dispatch sub-agent worca-x-n_impl-2-a1 now.', systemPrompt: 'HOST CONTRACT',
    agents: { 'worca-x-n_impl-2-a1': { prompt: 'B'.repeat(60000) } }, agentsViaFile: true, forwardSubagentText: true, maxTurns: 4 }, { dir: '/tmp/s3' });
  assert.ok(argvLength('claude', plan.args) < ARGV_INLINE_LIMIT);
  assert.ok(plan.files.some((f) => f.path === join('/tmp/s3', 'agents.json')), 'v2: the 60 KB brief rides the file');
});

test('runClaude FORWARDS forwardSubagentText and agentsViaFile to the real spawn (drop-at-gate guard)', POSIX_SHIM, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-host-argv-')); dirs.push(dir);
  const out = join(dir, 'argv.txt');
  const seen = join(dir, 'agents-seen.json');
  const bin = join(dir, 'fake-claude.sh');
  await writeFile(bin, `#!/bin/sh\nprev=""\nfor a in "$@"; do printf '%s\\0' "$a" >> ${JSON.stringify(out)}; if [ "$prev" = "--agents" ]; then cat "$a" > ${JSON.stringify(seen)}; fi; prev="$a"; done\nexit 0\n`);
  await chmod(bin, 0o755);
  const prev = { WORCA_MOCK: process.env.WORCA_MOCK, ORCH_MOCK: process.env.ORCH_MOCK };      // v2: mockEnabled reads both
  delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK;
  try { await runClaude({ cwd: dir, bin, prompt: 'p', forwardSubagentText: true, agents: DEFS, agentsViaFile: true, mainThreadGuard: GUARD }); }
  finally { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  const argv = (await readFile(out, 'utf8')).split('\0').filter(Boolean);
  assert.ok(argv.includes('--forward-subagent-text'));
  assert.match(argv[argv.indexOf('--agents') + 1], /worca-claude-[^/]+\/agents\.json$/);
  assert.deepEqual(JSON.parse(await readFile(seen, 'utf8')), DEFS, 'the file existed while the CLI ran');
  assert.match(argv[argv.indexOf('--settings') + 1], /node guard\.mjs/, 'v2: mainThreadGuard is named in both GATE places');
});

test('M-11 — the capability probe reads --forward-subagent-text from --help and the agents file from the version', POSIX_SHIM, async () => {
  const { probeClaudeCapabilities } = await import('../src/core/preflight.mjs');
  const fake = async (version, help) => {                          // v2: hermetic, like test/skills-host.test.mjs:126-131
    const d = await mkdtemp(join(tmpdir(), 'worca-probe-')); dirs.push(d);
    const bin = join(d, 'claude');
    await writeFile(bin, `#!/bin/sh\ncase "$1" in\n  --version) echo "${version} (Claude Code)";;\n  --help) printf '%s\\n' ${JSON.stringify(help)};;\nesac\nexit 0\n`);
    await chmod(bin, 0o755);
    return bin;
  };
  const yes = await probeClaudeCapabilities(await fake('2.1.308', '  --mcp-config <configs...>\n  --forward-subagent-text  Forward sub-agent text'));
  assert.equal(yes.forwardSubagentText, true);
  assert.equal(yes.agentsFile, true);
  const old = await probeClaudeCapabilities(await fake('2.1.278', '  --mcp-config <configs...>'));
  assert.equal(old.forwardSubagentText, false, 'no flag in --help');
  assert.equal(old.agentsFile, false, 'older than 2.1.281');
  const caps = await probeClaudeCapabilities('claude');          // the no-real-claude shim (first on PATH under tools/test.mjs)
  assert.equal(caps.forwardSubagentText, true);
  assert.equal(caps.agentsFile, true);
});

test('v4 — the main-thread guard is appended after the host guard, never in its place; an empty guard is no guard', () => {
  const prev = process.env.WORCA_HOST_GUARD;
  delete process.env.WORCA_HOST_GUARD;                              // this file sets '0' at the top
  try {
    const pre = buildSettingsPayload(null, { hostGuard: true, mainThreadGuard: GUARD }).settings.hooks.PreToolUse;
    assert.deepEqual(pre.slice(-2), [hostGuardHookEntry(), ...GUARD.hooks.PreToolUse]);
  } finally {
    if (prev === undefined) delete process.env.WORCA_HOST_GUARD; else process.env.WORCA_HOST_GUARD = prev;
  }
  assert.deepEqual(buildClaudeArgs({ ...BASE, mainThreadGuard: { hooks: { PreToolUse: [] } } }), buildClaudeArgs(BASE));
});

test('v4 — the agents-file floor is 2.1.281 itself; v5: a CLI with no version or no --help reads false, never throws', POSIX_SHIM, async () => {
  const { probeClaudeCapabilities } = await import('../src/core/preflight.mjs');
  const fake = async (version, help = '  --mcp-config <configs...>') => {   // null ⇒ that probe exits 1 (execSafe → null)
    const d = await mkdtemp(join(tmpdir(), 'worca-probe-')); dirs.push(d);
    const bin = join(d, 'claude');
    const say = (v) => (v === null ? 'exit 1' : `printf '%s\\n' ${JSON.stringify(v)}`);
    await writeFile(bin, `#!/bin/sh\ncase "$1" in\n  --version) ${say(version === null ? null : `${version} (Claude Code)`)};;\n  --help) ${say(help)};;\nesac\nexit 0\n`);
    await chmod(bin, 0o755);
    return bin;
  };
  assert.equal((await probeClaudeCapabilities(await fake('2.1.281'))).agentsFile, true);
  assert.equal((await probeClaudeCapabilities(await fake('2.1.280'))).agentsFile, false);
  const noVersion = await probeClaudeCapabilities(await fake(null, '  --forward-subagent-text'));
  assert.equal(noVersion.version, null);
  assert.equal(noVersion.agentsFile, false, 'no version ⇒ no agents file');
  assert.equal(noVersion.forwardSubagentText, true);
  const noHelp = await probeClaudeCapabilities(await fake('2.1.308', null));
  assert.equal(noHelp.forwardSubagentText, false, 'no --help ⇒ no flag');
  assert.equal(noHelp.agentsFile, true);
});

test('v5 — only `true` turns a host option on; agentsViaFile with no definitions takes no dir and writes no file', () => {
  const noDir = { dir: () => { throw new Error('no staging dir wanted'); } };
  assert.deepEqual(buildClaudeArgs({ ...BASE, forwardSubagentText: 'true' }), buildClaudeArgs(BASE));
  for (const agents of [undefined, null, {}]) {
    const plan = planClaudeInvocation({ ...BASE, agents, agentsViaFile: true }, noDir);
    assert.deepEqual(plan.files, [], String(agents));
    assert.deepEqual(plan.args, buildClaudeArgs(BASE), String(agents));
  }
  const loose = planClaudeInvocation({ ...BASE, agents: DEFS, agentsViaFile: 1 }, noDir);
  assert.deepEqual(JSON.parse(loose.args[loose.args.indexOf('--agents') + 1]), DEFS, 'not `true` ⇒ inline JSON, as ungrouped');
});
