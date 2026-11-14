// test/design-write-guard-runner.test.mjs — the Design write guard through the Claude runner (plan Task 4): the
// `writeGuard` option rides the one --settings payload (inline and staged), a caller's extraSettings cannot switch it
// off, runClaude refuses it on every other engine before the mock short-circuit, and (POSIX fake claude) a real spawn
// carries it to a hook that decides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSettingsPayload, buildClaudeArgs, planClaudeInvocation, runClaude } from '../src/core/claude-runner.mjs';
import { isReservedModelEnvKey } from '../src/core/model-env.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'the fake claude shim is POSIX' : false };
const DIRS = { allowedDirs: [join(tmpdir(), 'work')] };
const BASE = { prompt: 'p', permissionMode: 'acceptEdits' };
const guardOf = (s) => s.hooks.PreToolUse.find((h) => h.matcher === 'Write|Edit|MultiEdit|NotebookEdit');

test('the guard rides the one --settings payload; absent, the argv is byte-identical; malformed, it throws', () => {
  const p = buildSettingsPayload({ deny: ['Read(~/.aws/**)'] }, { writeGuard: DIRS });
  assert.match(guardOf(p.settings).hooks[0].command, /write-guard-cli\.mjs/);
  assert.equal(p.settings.disableAllHooks, false);
  assert.deepEqual(p.settings.permissions.deny, ['Read(~/.aws/**)']);
  assert.deepEqual(buildClaudeArgs({ ...BASE, writeGuard: null }), buildClaudeArgs(BASE));
  assert.deepEqual(buildSettingsPayload(null, { writeGuard: null }), buildSettingsPayload(null, {}));
  for (const bad of [{}, { allowedDirs: [] }, { allowedDirs: ['rel'] }, 'x', 1, true, false, 0, '']) assert.throws(() => buildSettingsPayload(null, { writeGuard: bad }), /allowedDirs/, JSON.stringify(bad));
  const args = buildClaudeArgs({ ...BASE, writeGuard: DIRS });
  assert.match(args[args.indexOf('--settings') + 1], /write-guard-cli\.mjs/);
});

test('a caller\'s extraSettings cannot switch it off, and the read guard stays beside it', () => {
  const s = buildSettingsPayload(null, { writeGuard: DIRS, readGuard: join(tmpdir(), 'a.pdf'), extraSettings: { disableAllHooks: true, hooks: { PreToolUse: [] } } }).settings;
  assert.equal(s.disableAllHooks, false);
  assert.ok(guardOf(s));
  assert.ok(s.hooks.PreToolUse.some((h) => h.matcher === '*'));
});

test('the staged branch carries it too', () => {
  const plan = planClaudeInvocation({ ...BASE, prompt: 'p'.repeat(50), writeGuard: DIRS }, { dir: join(tmpdir(), 'staged'), limit: 10 });
  assert.equal(plan.staged, true);
  assert.match(plan.files.find((f) => f.path.endsWith('settings.json')).content, /write-guard-cli\.mjs/);
});

test('runClaude refuses it on an engine that cannot carry it', async () => {
  // mock: true: at RED nothing real spawns, and the refusal must come before the mock short-circuit
  for (const engine of ['codex', 'cursor', 'gemini', 'goose']) await assert.rejects(runClaude({ cwd: tmpdir(), prompt: 'p', engine, mock: true, writeGuard: DIRS }), /writeGuard/, engine);
  for (const bad of [false, 0, '']) await assert.rejects(runClaude({ cwd: tmpdir(), prompt: 'p', engine: 'codex', mock: true, writeGuard: bad }), /writeGuard/, `${JSON.stringify(bad)} is a value, never "no guard"`);
});

/** A fake claude (POSIX) that reports the two env switches that turn every settings hook off, as its result text. */
async function hookSwitchesSeen(opts) {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'dwgr-')));
  const bin = join(dir, 'fake-claude.mjs');
  writeFileSync(bin, `#!${process.execPath}
console.log(JSON.stringify({ type: 'result', result: JSON.stringify([process.env.CLAUDE_CODE_SIMPLE ?? null, process.env.CLAUDE_CODE_SAFE_MODE ?? null]), total_cost_usd: 0 }));
`);
  chmodSync(bin, 0o755);
  const keys = ['WORCA_MOCK', 'ORCH_MOCK', 'WORCA_BROKER_URL', 'CLAUDE_CODE_SIMPLE', 'CLAUDE_CODE_SAFE_MODE'];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK; delete process.env.WORCA_BROKER_URL;
  process.env.CLAUDE_CODE_SIMPLE = '1'; process.env.CLAUDE_CODE_SAFE_MODE = '1';
  try {
    return JSON.parse((await runClaude({ cwd: dir, prompt: 'hi', bin, ...opts(dir) })).text);
  } finally {
    for (const k of keys) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a guarded spawn never inherits CLAUDE_CODE_SIMPLE or CLAUDE_CODE_SAFE_MODE, which switch every settings hook off', POSIX, async () => {
  assert.deepEqual(await hookSwitchesSeen((dir) => ({ writeGuard: { allowedDirs: [dir] } })), [null, null], 'writeGuard');
  assert.deepEqual(await hookSwitchesSeen((dir) => ({ readGuard: join(dir, 'a.pdf') })), [null, null], 'readGuard');
  assert.deepEqual(await hookSwitchesSeen(() => ({})), ['1', '1'], 'an unguarded spawn keeps the ambient env as it was');
  for (const k of ['CLAUDE_CODE_SIMPLE', 'CLAUDE_CODE_SAFE_MODE']) assert.equal(isReservedModelEnvKey(k), true, `a model entry cannot set ${k}`);
});

test('runClaude forwards it to a real spawn, and the hook decides there (fake claude)', POSIX, async () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'dwgr-')));
  const bin = join(dir, 'fake-claude.mjs');
  writeFileSync(bin, `#!${process.execPath}
import { spawnSync } from 'node:child_process';
const argv = process.argv.slice(2);
const s = JSON.parse(argv[argv.indexOf('--settings') + 1]);
const { command } = s.hooks.PreToolUse.find((h) => h.matcher.startsWith('Write')).hooks[0];
const run = (file_path) => spawnSync('sh', ['-c', command], { input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path } }) }).status;
console.log(JSON.stringify({ type: 'result', result: [run(${JSON.stringify(join(dir, 'ok.html'))}), run('/etc/nope.html')].join(','), total_cost_usd: 0 }));
`);
  chmodSync(bin, 0o755);
  const prev = { mock: process.env.WORCA_MOCK, orch: process.env.ORCH_MOCK, broker: process.env.WORCA_BROKER_URL };
  delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK; delete process.env.WORCA_BROKER_URL;
  let res;
  try { res = await runClaude({ cwd: dir, prompt: 'hi', bin, writeGuard: { allowedDirs: [dir] } }); }
  finally { for (const [k, v] of [['WORCA_MOCK', prev.mock], ['ORCH_MOCK', prev.orch], ['WORCA_BROKER_URL', prev.broker]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } rmSync(dir, { recursive: true, force: true }); }
  assert.equal(res.text, '0,2');
});
