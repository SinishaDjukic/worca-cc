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

test('an Error returned from onStdoutLine terminates the child and rejects with that error', POSIX, async () => {
  // Ignore SIGTERM so this also pins the grace -> SIGKILL escalation used for
  // a genuinely wedged harness, not only the cooperative shutdown path.
  const file = script("trap '' TERM; echo fatal; exec sleep 30");
  const expected = Object.assign(new Error('terminal stream event'), { errorClass: 'usage_limit' });
  let cleaned = 0;
  const previousGrace = process.env.WORCA_SIGKILL_GRACE_MS;
  process.env.WORCA_SIGKILL_GRACE_MS = '50';
  try {
    const started = Date.now();
    const err = await superviseSpawn(base({
      file, args: [], cleanup: () => { cleaned += 1; },
      onStdoutLine: (line) => line === 'fatal' ? expected : undefined,
    })).then(() => null, (e) => e);
    assert.equal(err, expected);
    assert.equal(err.errorClass, 'usage_limit');
    assert.equal(cleaned, 1);
    assert.ok(Date.now() - started < 2000, 'does not wait for the lingering child');
  } finally {
    if (previousGrace === undefined) delete process.env.WORCA_SIGKILL_GRACE_MS;
    else process.env.WORCA_SIGKILL_GRACE_MS = previousGrace;
  }
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

test('Claude synthetic usage-limit frame terminates a lingering CLI with a graceful-pause class', POSIX, async () => {
  const line = "You've hit your session limit · resets 6pm (Europe/Sofia)";
  const frame = JSON.stringify({
    type: 'assistant',
    isApiErrorMessage: true,
    message: { model: '<synthetic>', content: [{ type: 'text', text: line }] },
    error: 'rate_limit',
  });
  const file = script([
    `printf '%s\\n' ${JSON.stringify(frame)}`,
    // Production failure mode: an async tool keeps Claude alive after the limit frame.
    'exec sleep 30',
  ].join('\n'));
  const events = [];
  const started = Date.now();
  const err = await runClaudeProcess({
    cwd: tmpdir(), prompt: 'hi', systemPrompt: '', permissionMode: 'acceptEdits',
    onEvent: (e) => events.push(e), bin: file,
  }).then(() => null, (e) => e);
  assert.equal(err.errorClass, 'usage_limit');
  assert.match(err.message, /session limit.*resets 6pm/i);
  assert.ok(Date.now() - started < 2000, 'does not wait for the lingering CLI');
  assert.ok(events.some((e) => e.raw?.message?.model === '<synthetic>'), 'emits the limit event before termination');
});

test('Claude model text mentioning a session limit is not terminal', POSIX, async () => {
  const frame = JSON.stringify({
    type: 'assistant',
    message: { model: 'claude-sonnet', content: [{ type: 'text', text: 'The phrase "session limit" appears in this code.' }] },
  });
  const file = script([
    `printf '%s\\n' ${JSON.stringify(frame)}`,
    `printf '%s\\n' '{"type":"result","result":"done"}'`,
    'exit 0',
  ].join('\n'));
  const out = await runClaudeProcess({
    cwd: tmpdir(), prompt: 'hi', systemPrompt: '', permissionMode: 'acceptEdits',
    onEvent: () => {}, bin: file,
  });
  assert.equal(out.exitCode, 0);
  assert.equal(out.text, 'done');
});
