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

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitDead = async (pid, ms = 3000) => { const t = Date.now(); while (alive(pid) && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 25)); return !alive(pid); };

test('E3: a stop kills the agent\'s whole process group — a background job dies with it', POSIX, async () => {
  const d = tmp();
  const pidFile = join(d, 'bg.pid');
  // A background job that outlives a plain SIGTERM to the parent (the run_in_background test suite).
  const file = script(`sleep 30 & echo $! > ${pidFile}; echo started; wait`);
  const ac = new AbortController();
  const p = superviseSpawn(base({ file, args: [], signal: ac.signal, onStdoutLine: (l) => { if (l === 'started') ac.abort(); } }))
    .then(() => null, (e) => e);
  const err = await p;
  assert.equal(err.name, 'AbortError');
  const { readFileSync } = await import('node:fs');
  const bg = Number(readFileSync(pidFile, 'utf8'));
  assert.ok(await waitDead(bg), `background job ${bg} was killed with the group`);
});

test('E3: background jobs an agent left behind are reaped when it exits normally', POSIX, async () => {
  const d = tmp();
  const pidFile = join(d, 'bg.pid');
  const file = script(`(trap '' HUP; exec sleep 30) > /dev/null 2>&1 & echo $! > ${pidFile}; exit 0`);
  const r = await superviseSpawn(base({ file, args: [] }));
  assert.deepEqual(r, { code: 0 });
  const { readFileSync } = await import('node:fs');
  const bg = Number(readFileSync(pidFile, 'utf8'));
  assert.ok(await waitDead(bg), `leftover job ${bg} was reaped`);
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

test('composeSpawnEnv: a proxy URL with a login never reaches the child; NO_PROXY and a login-free URL do', () => {
  const saved = Object.fromEntries(['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'NO_PROXY'].map((k) => [k, process.env[k]]));
  const restore = () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
  try {
    for (const k of ['https_proxy', 'http_proxy']) delete process.env[k];
    Object.assign(process.env, { HTTPS_PROXY: 'http://ACME%5Cjdoe:s3cret@proxy.corp.example:8080', HTTP_PROXY: 'http://proxy.corp.example:8080', NO_PROXY: 'intranet.example' });
    for (const envScrub of [false, true]) {
      const { env } = composeSpawnEnv({ envScrub });
      for (const [k, v] of Object.entries(env)) assert.doesNotMatch(String(v), /s3cret/, `${k} (scrub ${envScrub})`);
      assert.equal(env.HTTP_PROXY, undefined, 'all proxy URLs go, or the child would be half-routed');
      assert.equal(env.NO_PROXY, 'intranet.example');
    }
    process.env.HTTPS_PROXY = 'http://127.0.0.1:3128';
    assert.equal(composeSpawnEnv({ envScrub: true }).env.HTTPS_PROXY, 'http://127.0.0.1:3128');
    // ALL_PROXY and tool-specific names go too, even when HTTP(S)_PROXY carries none.
    Object.assign(process.env, { ALL_PROXY: 'http://u:s3cret@proxy:8080', npm_config_https_proxy: 'http://u:s3cret@proxy:8080', FTP_PROXY: 'http://proxy:21' });
    const env = composeSpawnEnv({ envScrub: false, envAllowlist: [] }).env;
    for (const [k, v] of Object.entries(env)) assert.doesNotMatch(String(v), /s3cret/, k);
    assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:3128', 'a login-free HTTPS_PROXY stays');
    assert.equal(env.FTP_PROXY, 'http://proxy:21', 'a login-free alias stays');
  } finally { restore(); for (const k of ['ALL_PROXY', 'npm_config_https_proxy', 'FTP_PROXY']) delete process.env[k]; }
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
