// test/engine-spawn.test.mjs — the engine-agnostic spawn supervisor
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { superviseSpawn, buildSpawnEnv, composeSpawnEnv } from '../src/core/engines/spawn.mjs';

const POSIX = process.platform === 'win32' ? { skip: 'POSIX shell fixtures' } : {};
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-spawn-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function script(body) {
  const d = tmp();
  const f = join(d, 'bin.sh');
  writeFileSync(f, `#!/bin/sh\n${body}\n`);
  chmodSync(f, 0o755);
  return f;
}

const base = (over = {}) => ({
  displayBin: 'fake', cwd: tmpdir(), env: undefined, stdin: null, signal: undefined, asAgent: false,
  stagedDir: null, cleanup: () => {}, onEvent: () => {}, onStdoutLine: () => {},
  stdoutErrorDetail: () => '', classify: () => null,
  spawnError: (err, prefix) => new Error(`${prefix}: ${err.message}`),
  onDone: (code) => ({ code }), ...over,
});

test('stdout lines reach onStdoutLine, stderr lines become stderr events', POSIX, async () => {
  const seen = []; const events = [];
  const file = script("echo one; echo two; echo warn 1>&2");
  const r = await superviseSpawn(base({ file, args: [], onStdoutLine: (l) => seen.push(l), onEvent: (e) => events.push(e) }));
  assert.deepEqual(r, { code: 0 });
  assert.deepEqual(seen, ['one', 'two']);
  assert.deepEqual(events, [{ type: 'stderr', stream: 'err', text: 'warn' }]);
});

test('non-zero exit with empty stderr keeps the stdout detail and no stream tag', POSIX, async () => {
  const file = script('exit 3');
  const err = await superviseSpawn(base({ file, args: [], stdoutErrorDetail: () => 'Invalid API key', classify: (m) => (/API key/.test(m) ? 'auth' : null) }))
    .then(() => null, (e) => e);
  assert.equal(err.message, 'fake exited with code 3: Invalid API key');
  assert.equal(err.errorClass, 'auth');
  assert.equal(err.stream, undefined);
});

test('non-zero exit with stderr uses the strongest stderr class and tags stream:err', POSIX, async () => {
  const file = script('echo "429 rate limited" 1>&2; exit 1');
  const err = await superviseSpawn(base({ file, args: [], classify: (m) => (/429/.test(m) ? 'rate_limit' : null) })).then(() => null, (e) => e);
  assert.match(err.message, /^fake exited with code 1: 429 rate limited/);
  assert.equal(err.errorClass, 'rate_limit');
  assert.equal(err.stream, 'err');
});

test('abort rejects with AbortError and runs cleanup once', POSIX, async () => {
  const file = script('sleep 5');
  const ac = new AbortController();
  let cleaned = 0;
  const p = superviseSpawn(base({ file, args: [], signal: ac.signal, cleanup: () => { cleaned += 1; } }));
  setTimeout(() => ac.abort(), 50);
  const err = await p.then(() => null, (e) => e);
  assert.equal(err.name, 'AbortError');
  assert.equal(cleaned, 1);
});

test('stdin is written when given', POSIX, async () => {
  const seen = [];
  const file = script('cat');
  await superviseSpawn(base({ file, args: [], stdin: 'hello', onStdoutLine: (l) => seen.push(l) }));
  assert.deepEqual(seen, ['hello']);
});

test('a spawn failure runs cleanup and rejects through spawnError', async () => {
  let cleaned = 0;
  const err = await superviseSpawn(base({ file: join(tmp(), 'missing'), args: [], cleanup: () => { cleaned += 1; } })).then(() => null, (e) => e);
  assert.match(err.message, /^fake error: /);
  assert.equal(cleaned, 1);
});

test('buildSpawnEnv keeps the adapter prefixes under scrub and is undefined when off', () => {
  process.env.CODEX_TEST_KEEP = '1';
  process.env.ANTHROPIC_TEST_KEEP = '1';
  try {
    assert.equal(buildSpawnEnv(false, []), undefined);
    const claude = buildSpawnEnv(true, []);
    assert.equal(claude.ANTHROPIC_TEST_KEEP, '1');
    assert.equal(claude.CODEX_TEST_KEEP, undefined);
    const codex = buildSpawnEnv(true, [], ['CODEX_']);
    assert.equal(codex.CODEX_TEST_KEEP, '1');
    assert.equal(codex.ANTHROPIC_TEST_KEEP, undefined);
  } finally { delete process.env.CODEX_TEST_KEEP; delete process.env.ANTHROPIC_TEST_KEEP; }
});

test('composeSpawnEnv: overlay wins, host pid added last, GitHub credentials stripped', () => {
  process.env.GH_TOKEN = 'ghp_test';
  try {
    const { env, scrubbed } = composeSpawnEnv({ envScrub: false, overlay: { ANTHROPIC_MODEL: 'm' }, hostPid: 42 });
    assert.equal(scrubbed, false);
    assert.equal(env.ANTHROPIC_MODEL, 'm');
    assert.equal(env.WORCA_HOST_PID, '42');
    assert.equal(env.GH_TOKEN, undefined);
  } finally { delete process.env.GH_TOKEN; }
});

// ── the Claude adapter on top of the supervisor ───────────────────────────────
import { runClaudeProcess } from '../src/core/engines/claude.mjs';
import { readdirSync } from 'node:fs';

test('a staged invocation removes its temp dir when the spawn fails', async () => {
  const before = new Set(readdirSync(tmpdir()).filter((n) => n.startsWith('worca-claude-')));
  const err = await runClaudeProcess({
    cwd: tmpdir(), prompt: 'x'.repeat(30000), systemPrompt: 'S', permissionMode: 'acceptEdits',
    onEvent: () => {}, bin: join(tmp(), 'missing-claude'),
  }).then(() => null, (e) => e);
  assert.ok(err, 'rejects');
  const after = readdirSync(tmpdir()).filter((n) => n.startsWith('worca-claude-') && !before.has(n));
  assert.deepEqual(after, [], 'no staged dir left behind');
});
