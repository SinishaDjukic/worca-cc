// test/preflight-claude-auth.test.mjs
// src/core/preflight.mjs#probeClaudeAuth — is the Claude Code CLI signed in?
// Every case injects `run`, so nothing here spawns a claude binary.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  probeClaudeAuth, parseClaudeAuthStatus, claudeAuthFromEnv, clearClaudeAuthCache, CLAUDE_AUTH_TTL_MS,
  isClaudeSignedOutError,
} from '../src/core/preflight.mjs';

beforeEach(() => clearClaudeAuthCache());

/** A fake `claude auth status` that counts its calls. */
function fakeRun(out, code = 0) {
  const calls = [];
  const run = async (exe, args) => { calls.push([exe, ...args]); return { code, out }; };
  return { run, calls };
}

test('parseClaudeAuthStatus: the JSON form (the default output)', () => {
  assert.equal(parseClaudeAuthStatus('{"loggedIn": true, "authMethod": "claude.ai"}'), 'signed-in');
  assert.equal(parseClaudeAuthStatus('{\n  "loggedIn": false\n}\n'), 'signed-out');
});

test('parseClaudeAuthStatus: text forms, and anything unrecognised is unknown', () => {
  assert.equal(parseClaudeAuthStatus('Not logged in. Run claude /login'), 'signed-out');
  assert.equal(parseClaudeAuthStatus('Logged in as someone@example.com'), 'signed-in');
  assert.equal(parseClaudeAuthStatus("error: unknown command 'auth'"), 'unknown');
  assert.equal(parseClaudeAuthStatus(''), 'unknown');
  assert.equal(parseClaudeAuthStatus(null), 'unknown');
});

test('isClaudeSignedOutError: the CLI\'s signed-out failure, not other auth errors', () => {
  assert.equal(isClaudeSignedOutError('claude exited with code 1: Not logged in · Please run /login'), true);
  assert.equal(isClaudeSignedOutError('Invalid API key · Please run /login'), true);
  assert.equal(isClaudeSignedOutError('claude exited with code 1: 401 authentication_error'), false);
  assert.equal(isClaudeSignedOutError(null), false);
});

test('probeClaudeAuth: reads `claude auth status`, whatever its exit code', async () => {
  const out = fakeRun('{"loggedIn": false}', 1);
  const r = await probeClaudeAuth({ bin: 'claude', env: {}, run: out.run });
  assert.deepEqual(r, { state: 'signed-out', source: 'cli', detail: null });
  assert.deepEqual(out.calls, [['claude', 'auth', 'status']]);
});

test('probeClaudeAuth: a failed spawn / timeout (no result) is unknown, never signed out', async () => {
  const r = await probeClaudeAuth({ bin: 'claude', env: {}, run: async () => null });
  assert.equal(r.state, 'unknown');
  clearClaudeAuthCache();
  const t = await probeClaudeAuth({ bin: 'claude', env: {}, run: async () => { throw new Error('boom'); } });
  assert.equal(t.state, 'unknown');
});

test('probeClaudeAuth: an auth env var counts as signed in without asking the CLI', async () => {
  for (const env of [
    { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9/m/x' },
    { ANTHROPIC_AUTH_TOKEN: 'secret' },
    { CLAUDE_CODE_USE_BEDROCK: '1' },
    { CLAUDE_CODE_USE_VERTEX: 'true' },
  ]) {
    const out = fakeRun('{"loggedIn": false}', 1);
    const r = await probeClaudeAuth({ env, run: out.run });
    assert.equal(r.state, 'signed-in', JSON.stringify(env));
    assert.equal(r.source, 'env');
    assert.equal(out.calls.length, 0, 'claude is not started');
  }
  // An explicit off ('0' / 'false') or an empty value is not a sign-in.
  assert.equal(claudeAuthFromEnv({ CLAUDE_CODE_USE_BEDROCK: '0', CLAUDE_CODE_USE_VERTEX: 'false', ANTHROPIC_API_KEY: ' ' }), null);
});

test('probeClaudeAuth: mock mode never starts claude', async () => {
  const out = fakeRun('{"loggedIn": false}', 1);
  assert.equal((await probeClaudeAuth({ env: { WORCA_MOCK: '1' }, run: out.run })).state, 'unknown');
  assert.equal((await probeClaudeAuth({ env: {}, mock: true, run: out.run })).source, 'mock');
  assert.equal(out.calls.length, 0);
});

test('probeClaudeAuth: the answer is remembered for 60 s; force re-checks', async () => {
  let t = 1_000;
  const now = () => t;
  const out = fakeRun('{"loggedIn": false}', 1);
  await probeClaudeAuth({ env: {}, now, run: out.run });
  await probeClaudeAuth({ env: {}, now, run: out.run });
  assert.equal(out.calls.length, 1, 'second call within the TTL is remembered');
  await probeClaudeAuth({ env: {}, now, run: out.run, force: true });
  assert.equal(out.calls.length, 2, 'force skips the remembered answer');
  t += CLAUDE_AUTH_TTL_MS;
  await probeClaudeAuth({ env: {}, now, run: out.run });
  assert.equal(out.calls.length, 3, 'expired after the TTL');
  assert.equal(CLAUDE_AUTH_TTL_MS, 60_000);
});

test('probeClaudeAuth: concurrent callers share one spawn', async () => {
  const out = fakeRun('{"loggedIn": true}');
  const [a, b] = await Promise.all([
    probeClaudeAuth({ env: {}, run: out.run }),
    probeClaudeAuth({ env: {}, run: out.run }),
  ]);
  assert.equal(a.state, 'signed-in');
  assert.equal(b.state, 'signed-in');
  assert.equal(out.calls.length, 1);
});
