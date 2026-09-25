// test/model-test.test.mjs — unit tests for the model connectivity check
// (Models-view Test button). testModel takes an injectable `run` so no claude
// binary is ever spawned; hintFor is pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testModel, hintFor, CLAUDE_SIGNED_OUT_HINT } from '../src/core/model-test.mjs';

// Never ask the real CLI whether it is signed in (the failure paths would).
const notSignedOut = async () => false;
import { bridgeEvents } from '../src/core/bridge/telemetry.mjs';

test('testModel: success returns ok + first-line capped reply and forwards the minimal run shape', async () => {
  let seen = null;
  const run = async (o) => { seen = o; return { text: '  OK\nsecond line ignored', exitCode: 0 }; };
  const res = await testModel('glm-4.7', { signedOut: notSignedOut, run });
  assert.deepEqual(res, { ok: true, text: 'OK' });
  assert.equal(seen.model, 'glm-4.7');
  assert.equal(seen.effort, 'low');
  assert.deepEqual(seen.allowedTools, []);
  assert.ok(seen.signal instanceof AbortSignal, 'timeout signal is wired');
  assert.ok(seen.prompt.length > 0);
  // modelEnv is whatever resolveModelEnv says for this id (undefined in the
  // sandboxed test env) — the key must be NAMED in the call either way.
  assert.ok('modelEnv' in seen);
});

test('testModel: long replies are capped', async () => {
  const run = async () => ({ text: 'x'.repeat(500), exitCode: 0 });
  const res = await testModel('m', { signedOut: notSignedOut, run });
  assert.equal(res.ok, true);
  assert.equal(res.text.length, 100);
});

test('testModel: run failure returns ok:false with the runner errorClass', async () => {
  const run = async () => {
    const err = new Error('claude exited with code 1: 401 authentication_error');
    err.errorClass = 'auth';
    throw err;
  };
  const res = await testModel('m', { signedOut: notSignedOut, run });
  assert.equal(res.ok, false);
  assert.equal(res.errorClass, 'auth');
  assert.match(res.message, /authentication_error/);
});

test('testModel: a failure on a signed-out CLI names the Claude Code sign-in, not the model token', async () => {
  const run = async () => {
    throw Object.assign(new Error('claude exited with code 1: Not logged in · Please run /login'), { errorClass: 'auth' });
  };
  const res = await testModel('m', { run, signedOut: async () => true });
  assert.equal(res.errorClass, 'auth');
  assert.equal(res.hint, CLAUDE_SIGNED_OUT_HINT);
  // Signed in, the same auth failure keeps the generic advice.
  const signedIn = await testModel('m', { run, signedOut: async () => false });
  assert.equal(signedIn.hint, hintFor('auth'));
});

test('testModel: errorClass falls back to classifyError on unstamped errors', async () => {
  const run = async () => { throw new Error('ECONNREFUSED 127.0.0.1:9999'); };
  const res = await testModel('m', { signedOut: notSignedOut, run });
  assert.equal(res.ok, false);
  assert.equal(res.errorClass, 'network');
});

test('testModel: abort surfaces as timeout', async () => {
  const run = async ({ signal }) => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    if (signal?.aborted) throw err;
    throw err; // caller-aborted before the spawn behaves the same
  };
  const ctrl = new AbortController();
  ctrl.abort();
  const res = await testModel('m', { signedOut: notSignedOut, signal: ctrl.signal, run });
  assert.equal(res.ok, false);
  assert.equal(res.errorClass, 'timeout');
  assert.match(res.message, /[Tt]imed out|aborted/);
});

test('testModel: empty reply is a failure, not a silent pass', async () => {
  const run = async () => ({ text: '   ', exitCode: 0 });
  const res = await testModel('m', { signedOut: notSignedOut, run });
  assert.equal(res.ok, false);
  assert.match(res.message, /empty reply/i);
});

test('hintFor maps recovery classes to actionable text', () => {
  assert.match(hintFor('auth'), /token|secret|authentication/i);
  assert.match(hintFor('network'), /ANTHROPIC_BASE_URL|unreachable/i);
  assert.match(hintFor('rate_limit'), /rate|overloaded/i);
  assert.match(hintFor('quota'), /quota|billing|credit/i);
  assert.match(hintFor('usage_limit'), /limit/i);
  assert.match(hintFor('timeout'), /timed out/i);
  assert.equal(hintFor(null), '');
  assert.equal(hintFor('unknown-class'), '');
});

test('testModel: a bridge failure for this model replaces the CLI message (a bridged run\'s stderr only carries warnings)', async () => {
  const listeners = bridgeEvents.listenerCount('failure');
  const fix = 'copilot: model "gpt-6-astra" is not accessible via the /chat/completions endpoint — this model needs a different API: re-import it (Settings › Models › Import models…) or change its API in the model editor';
  const run = async () => {
    bridgeEvents.emit('failure', { tag: '', catalogId: 'other-model', provider: 'copilot', status: 400, message: 'unrelated' });
    bridgeEvents.emit('failure', { tag: '', catalogId: 'CP-Test-Model', provider: 'copilot', status: 400, message: fix });
    // A pipeline run on the same model at the same moment carries its execution id as tag: not ours.
    bridgeEvents.emit('failure', { tag: 'exec-9', catalogId: 'cp-test-model', provider: 'copilot', status: 429, message: 'a concurrent pipeline run' });
    throw new Error('claude exited with code 1: ⚠ claude.ai connectors are disabled … [claude-code:unrecognized_model] {"model":"cp-test-model","query_source":"sdk"}');
  };
  const res = await testModel('cp-test-model', { signedOut: notSignedOut, run });
  assert.equal(res.ok, false);
  assert.equal(res.message, fix);
  assert.equal(bridgeEvents.listenerCount('failure'), listeners, 'listener removed');
  const other = await testModel('m', { signedOut: notSignedOut, run: async () => { bridgeEvents.emit('failure', { catalogId: 'not-m', message: 'x' }); throw new Error('claude exited with code 1: boom'); } });
  assert.match(other.message, /boom/);
  assert.equal(bridgeEvents.listenerCount('failure'), listeners);
  // The id matches case-insensitively either way round, and the bridge's reason picks the error class and hint.
  const limited = await testModel('CP-Test-Model', { signedOut: notSignedOut, run: async () => { bridgeEvents.emit('failure', { tag: '', catalogId: 'cp-test-model', provider: 'copilot', status: 429, message: 'copilot: rate limited (429) — slow down' }); throw new Error('claude exited with code 1: ⚠ claude.ai connectors are disabled'); } });
  assert.equal(limited.message, 'copilot: rate limited (429) — slow down');
  assert.equal(limited.errorClass, 'rate_limit');
  assert.equal(limited.hint, hintFor('rate_limit'));
  const ok = await testModel('cp-test-model', { signedOut: notSignedOut, run: async () => ({ text: 'OK', exitCode: 0 }) });
  assert.deepEqual(ok, { ok: true, text: 'OK' });
});

test('testModel: when the Test times out while the CLI retries a failure the bridge booked, that failure is the answer — without the ANTHROPIC_BASE_URL hint', async () => {
  const listeners = bridgeEvents.listenerCount('failure');
  const aborted = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
  const unreachable = 'openai: endpoint unreachable — getaddrinfo ENOTFOUND api.example.test';
  const res = await testModel('cp', { signedOut: notSignedOut, run: async () => { bridgeEvents.emit('failure', { tag: '', catalogId: 'cp', provider: 'openai', status: 502, message: unreachable }); throw aborted(); } });
  assert.deepEqual(res, { ok: false, errorClass: 'network', message: unreachable });
  // Nothing booked: still the timeout.
  const plain = await testModel('cp', { signedOut: notSignedOut, run: async () => { throw aborted(); } });
  assert.deepEqual([plain.errorClass, plain.hint], ['timeout', hintFor('timeout')]);
  // A Test the caller cancelled stays a timeout, whatever was booked.
  const ctrl = new AbortController();
  ctrl.abort();
  const cancelled = await testModel('cp', { signedOut: notSignedOut, signal: ctrl.signal, run: async () => { bridgeEvents.emit('failure', { tag: '', catalogId: 'cp', message: unreachable }); throw aborted(); } });
  assert.equal(cancelled.errorClass, 'timeout');
  assert.equal(bridgeEvents.listenerCount('failure'), listeners);
});
